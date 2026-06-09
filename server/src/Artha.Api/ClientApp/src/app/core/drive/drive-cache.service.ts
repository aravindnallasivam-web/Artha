// Local-first cache + background sync for the Drive data files.
//
// Every screen reads small JSON files from Google Drive; doing that over the
// network on each open is slow. This sits between AppDataRepository and the
// Drive REST client and makes the app local-first:
//
//   read(name)  -> returns the local copy instantly, then refreshes from Drive
//                  in the background (skipped when we have unsynced edits).
//   write(name) -> updates the local copy immediately and queues a background
//                  push to Drive (retried when connectivity returns).
//
// Storage is Capacitor Preferences (durable on device, localStorage on web)
// with an in-memory mirror for speed. Conflict policy is last-write-wins, which
// is fine for a single-user app; cross-device edits converge on the next read.

import { Injectable, inject } from '@angular/core';
import { Network } from '@capacitor/network';
import { Preferences } from '@capacitor/preferences';
import { DriveRestClient } from './drive-rest.client';

interface CacheEntry {
  content: unknown;
  etag: string; // last revision we know Drive had
}

const KEY_PREFIX = 'artha.cache.v1.';
const DIRTY_KEY = 'artha.cache.v1.__dirty__';
const FLUSH_DEBOUNCE_MS = 800;
const REFRESH_THROTTLE_MS = 30_000;

@Injectable({ providedIn: 'root' })
export class DriveCache {
  private readonly drive = inject(DriveRestClient);

  private readonly mem = new Map<string, CacheEntry>();
  private readonly refreshing = new Set<string>();
  private readonly lastRefreshed = new Map<string, number>();
  private dirty = new Set<string>();

  private loaded = false;
  private flushing = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Push anything pending as soon as connectivity returns.
    void Network.addListener('networkStatusChange', (status) => {
      if (status.connected) {
        void this.flush();
      }
    });
  }

  /** True if a local copy exists (no network) — used for fast first-run checks. */
  async has(fileName: string): Promise<boolean> {
    await this.ensureLoaded();
    return (await this.load(fileName)) !== null;
  }

  /** Cache-first read. Local copy now; Drive refresh in the background. */
  async read(fileName: string): Promise<{ content: unknown; etag: string } | null> {
    await this.ensureLoaded();
    const entry = await this.load(fileName);
    if (entry) {
      void this.refresh(fileName);
      return { content: entry.content, etag: entry.etag };
    }
    // First time we've needed this file — fetch from Drive and seed the cache.
    const result = await this.drive.getByName(fileName);
    if (!result) {
      return null;
    }
    const seeded: CacheEntry = { content: result.content, etag: result.headRevisionId };
    await this.store(fileName, seeded);
    return { content: seeded.content, etag: seeded.etag };
  }

  /** Wipe the whole local cache (call on sign-out). Best-effort flushes any
   *  unsynced writes to Drive first so they aren't lost. */
  async clear(): Promise<void> {
    await this.flush().catch(() => undefined);
    this.mem.clear();
    this.dirty.clear();
    this.refreshing.clear();
    this.lastRefreshed.clear();
    this.loaded = false;
    try {
      const { keys } = await Preferences.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith(KEY_PREFIX)).map((k) => Preferences.remove({ key: k })),
      );
    } catch {
      // ignore
    }
  }

  /** Write locally immediately; queue a background push to Drive. */
  async write(fileName: string, content: unknown): Promise<string> {
    await this.ensureLoaded();
    const prev = await this.load(fileName);
    const entry: CacheEntry = { content, etag: prev?.etag ?? '' };
    await this.store(fileName, entry);
    this.dirty.add(fileName);
    await this.persistDirty();
    this.scheduleFlush();
    return entry.etag;
  }

  // ── internals ────────────────────────────────────────────────────────────

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) {
      return;
    }
    this.loaded = true;
    try {
      const raw = await Preferences.get({ key: DIRTY_KEY });
      if (raw.value) {
        this.dirty = new Set(JSON.parse(raw.value) as string[]);
      }
    } catch {
      // ignore
    }
    if (this.dirty.size > 0) {
      this.scheduleFlush(); // sync edits left over from a previous run
    }
  }

  private async load(fileName: string): Promise<CacheEntry | null> {
    const inMem = this.mem.get(fileName);
    if (inMem) {
      return inMem;
    }
    try {
      const raw = await Preferences.get({ key: KEY_PREFIX + fileName });
      if (!raw.value) {
        return null;
      }
      const entry = JSON.parse(raw.value) as CacheEntry;
      this.mem.set(fileName, entry);
      return entry;
    } catch {
      return null;
    }
  }

  private async store(fileName: string, entry: CacheEntry): Promise<void> {
    this.mem.set(fileName, entry);
    try {
      await Preferences.set({ key: KEY_PREFIX + fileName, value: JSON.stringify(entry) });
    } catch {
      // Storage full / unavailable — the in-memory copy still serves this run.
    }
  }

  /** Pull the latest from Drive into the cache, unless we have unsynced edits. */
  private async refresh(fileName: string): Promise<void> {
    if (this.dirty.has(fileName) || this.refreshing.has(fileName)) {
      return;
    }
    const last = this.lastRefreshed.get(fileName) ?? 0;
    if (Date.now() - last < REFRESH_THROTTLE_MS) {
      return; // refreshed very recently — don't hammer Drive on every read
    }
    this.refreshing.add(fileName);
    this.lastRefreshed.set(fileName, Date.now());
    try {
      const meta = await this.drive.getMetaByName(fileName);
      if (!meta) {
        return;
      }
      const current = this.mem.get(fileName);
      if (current && current.etag === meta.headRevisionId) {
        return; // unchanged on Drive
      }
      const result = await this.drive.getByName(fileName);
      if (result && !this.dirty.has(fileName)) {
        await this.store(fileName, { content: result.content, etag: result.headRevisionId });
      }
    } catch {
      // Offline / transient — keep serving the cached copy.
    } finally {
      this.refreshing.delete(fileName);
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, FLUSH_DEBOUNCE_MS);
  }

  /** Push every dirty file to Drive (last-write-wins). Stops on the first
   *  failure (likely offline) and retries on the next trigger. */
  private async flush(): Promise<void> {
    if (this.flushing) {
      return;
    }
    this.flushing = true;
    try {
      for (const fileName of [...this.dirty]) {
        const entry = await this.load(fileName);
        if (!entry) {
          this.dirty.delete(fileName);
          continue;
        }
        try {
          const meta = await this.drive.getMetaByName(fileName);
          const result = meta
            ? await this.drive.update(meta.id, entry.content)
            : await this.drive.create(fileName, entry.content);
          // Adopt the new revision; our content is the latest writer's.
          await this.store(fileName, { content: entry.content, etag: result.headRevisionId });
          this.dirty.delete(fileName);
          await this.persistDirty();
        } catch {
          break; // offline / transient — leave the rest dirty for next time
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  private async persistDirty(): Promise<void> {
    try {
      await Preferences.set({ key: DIRTY_KEY, value: JSON.stringify([...this.dirty]) });
    } catch {
      // ignore
    }
  }
}
