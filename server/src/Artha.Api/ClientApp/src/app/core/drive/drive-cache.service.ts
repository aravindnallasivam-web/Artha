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

import { Injectable, computed, inject, signal } from '@angular/core';
import { Network } from '@capacitor/network';
import { Preferences } from '@capacitor/preferences';
import { DriveRestClient } from './drive-rest.client';

export type SyncState = 'synced' | 'saving' | 'pending' | 'offline';

interface CacheEntry {
  content: unknown; // current local copy (may have unsynced edits)
  base?: unknown; // last copy we synced with Drive — the 3-way merge ancestor
  etag: string; // Drive revision the base corresponds to
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

  // ── Sync status (for the UI indicator) ───────────────────────────────────
  private readonly pendingCount = signal(0);
  private readonly syncing = signal(false);
  private readonly online = signal(true);
  /** Coarse sync state for a small "saving… / synced" indicator. */
  readonly syncState = computed<SyncState>(() => {
    if (this.syncing()) return 'saving';
    if (this.pendingCount() > 0) return this.online() ? 'pending' : 'offline';
    return 'synced';
  });

  constructor() {
    void Network.getStatus().then((s) => this.online.set(s.connected)).catch(() => undefined);
    // Push anything pending as soon as connectivity returns.
    void Network.addListener('networkStatusChange', (status) => {
      this.online.set(status.connected);
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
    // Fresh from Drive: local copy == synced base.
    const seeded: CacheEntry = {
      content: result.content,
      base: result.content,
      etag: result.headRevisionId,
    };
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
    this.pendingCount.set(0);
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
    // Keep the last-synced base so a later conflict can be 3-way merged.
    const entry: CacheEntry = {
      content,
      base: prev ? prev.base ?? prev.content : content,
      etag: prev?.etag ?? '',
    };
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
    this.pendingCount.set(this.dirty.size);
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
        // No local edits, so local copy == synced base.
        await this.store(fileName, {
          content: result.content,
          base: result.content,
          etag: result.headRevisionId,
        });
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

  /**
   * Push every dirty file to Drive. Before overwriting, check whether Drive's
   * revision advanced past the one our local copy was based on; if it did
   * (another device wrote in the meantime), merge the two by item id rather
   * than clobbering the remote change. Stops on the first failure (likely
   * offline) and retries on the next trigger.
   */
  private async flush(): Promise<void> {
    if (this.flushing || this.dirty.size === 0) {
      return;
    }
    this.flushing = true;
    this.syncing.set(true);
    try {
      for (const fileName of [...this.dirty]) {
        const entry = await this.load(fileName);
        if (!entry) {
          this.dirty.delete(fileName);
          continue;
        }
        try {
          const meta = await this.drive.getMetaByName(fileName);
          let content = entry.content;
          let result;
          if (!meta) {
            result = await this.drive.create(fileName, content);
          } else {
            const upToDate = entry.etag && meta.headRevisionId === entry.etag;
            if (!upToDate) {
              // Drive moved ahead of our base (or we never synced this file) —
              // pull the current remote and 3-way merge (base, local, remote) so
              // we keep the other device's changes and honour real deletions.
              const remote = await this.drive.getByName(fileName);
              if (remote) {
                content = mergeContent(entry.base, entry.content, remote.content);
              }
            }
            result = await this.drive.update(meta.id, content);
          }
          // What we just wrote is now the synced base.
          await this.store(fileName, { content, base: content, etag: result.headRevisionId });
          this.dirty.delete(fileName);
          await this.persistDirty();
        } catch {
          break; // offline / transient — leave the rest dirty for next time
        }
      }
    } finally {
      this.flushing = false;
      this.syncing.set(false);
    }
  }

  private async persistDirty(): Promise<void> {
    this.pendingCount.set(this.dirty.size);
    try {
      await Preferences.set({ key: DIRTY_KEY, value: JSON.stringify([...this.dirty]) });
    } catch {
      // ignore
    }
  }
}

interface Mergeable {
  items?: unknown[];
  shards?: string[];
  [key: string]: unknown;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function itemId(item: unknown): string | null {
  const id = (item as { id?: unknown })?.id;
  return id == null ? null : String(id);
}

function mapById(items: unknown[] | undefined): Map<string, unknown> {
  const map = new Map<string, unknown>();
  for (const item of items ?? []) {
    const id = itemId(item);
    if (id != null) map.set(id, item);
  }
  return map;
}

function sameItem(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Three-way merge of one appdata file when the local copy and Drive have both
 * moved past the common ancestor (`base` = the last copy we synced):
 *   - list files (`{ items: [{ id, … }] }`) merge per item id. An item edited
 *     on one side only takes that side; edited on both, the local edit wins; a
 *     real deletion (present in base, gone on one side, untouched on the other)
 *     is honoured; an edit-vs-delete is resolved by keeping the edit.
 *   - the manifest unions its shard keys.
 *   - scalar docs (settings) keep local.
 * Falls back to a local-wins union when no base is available (older caches).
 */
function mergeContent(base: unknown, local: unknown, remote: unknown): unknown {
  if (!isObject(local) || !isObject(remote)) {
    return local;
  }
  const l = local as Mergeable;
  const r = remote as Mergeable;
  const b = (isObject(base) ? base : {}) as Mergeable;

  if (Array.isArray(l.items) && Array.isArray(r.items)) {
    const baseMap = mapById(b.items);
    const localMap = mapById(l.items);
    const remoteMap = mapById(r.items);
    const chosen = new Map<string, unknown>();

    const ids = new Set<string>([...baseMap.keys(), ...localMap.keys(), ...remoteMap.keys()]);
    for (const id of ids) {
      const inB = baseMap.has(id);
      const lo = localMap.get(id);
      const re = remoteMap.get(id);
      const inL = localMap.has(id);
      const inR = remoteMap.has(id);
      const localChanged = inL && (!inB || !sameItem(lo, baseMap.get(id)));
      const remoteChanged = inR && (!inB || !sameItem(re, baseMap.get(id)));

      if (inL && inR) {
        chosen.set(id, localChanged || !remoteChanged ? lo : re);
      } else if (inL && !inR) {
        // Gone on remote. Keep if locally added (not in base) or locally edited
        // (edit beats the remote delete); otherwise honour the remote delete.
        if (!inB || localChanged) chosen.set(id, lo);
      } else if (!inL && inR) {
        // Gone on local. Keep if remotely added or remotely edited; otherwise
        // honour the local delete.
        if (!inB || remoteChanged) chosen.set(id, re);
      }
      // gone on both → deleted everywhere → drop
    }

    // Emit in local order, then any remote-only survivors.
    const out: unknown[] = [];
    const emitted = new Set<string>();
    for (const item of l.items) {
      const id = itemId(item);
      if (id != null && chosen.has(id)) {
        out.push(chosen.get(id));
        emitted.add(id);
      }
    }
    for (const item of r.items) {
      const id = itemId(item);
      if (id != null && chosen.has(id) && !emitted.has(id)) {
        out.push(chosen.get(id));
        emitted.add(id);
      }
    }
    return { ...l, items: out };
  }

  if (Array.isArray(l.shards) && Array.isArray(r.shards)) {
    return { ...l, shards: [...new Set([...r.shards, ...l.shards])].sort() };
  }

  return local;
}
