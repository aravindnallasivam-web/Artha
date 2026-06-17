// Producer side of family sharing.
//
// Writes a read-only snapshot of the user's ledger into a normal Drive folder
// ("Artha Shared") and grants another person read access to it. Uses the
// `drive.file` scope (the app may manage files it created), so no manual Google
// Drive steps are needed. The consumer reads the snapshot after picking the
// folder via the Google Picker (Phase 3).

import { Injectable, inject } from '@angular/core';
import { App } from '@capacitor/app';
import { CapacitorHttp, HttpResponse } from '@capacitor/core';
import { SessionService } from '../auth/session.service';
import { Expense } from '../models/expense.model';
import {
  OutboundShare,
  SharedSnapshot,
} from '../models/shared-ledger.model';
import { AppDataRepository } from './app-data.repository';
import {
  AccountList,
  CategoryList,
  DRIVE_FILES,
  ExpenseShard,
  Manifest,
  SCHEMA_VERSION,
  SettingsDocument,
  shardsNewestFirst,
} from './drive-schema';
import { GoogleTokenStore } from './google-token.store';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const SHARED_FOLDER_NAME = 'Artha Shared';
const SNAPSHOT_FILE_NAME = 'artha-ledger.json';
const OUT_KEY = 'artha.sharing.out';

@Injectable({ providedIn: 'root' })
export class DriveSharingService {
  private readonly tokens = inject(GoogleTokenStore);
  private readonly repo = inject(AppDataRepository);
  private readonly session = inject(SessionService);
  private lifecycleBound = false;

  /** The current outbound share, if any. */
  currentShare(): OutboundShare | null {
    try {
      const raw = localStorage.getItem(OUT_KEY);
      return raw ? (JSON.parse(raw) as OutboundShare) : null;
    } catch {
      return null;
    }
  }

  /**
   * Keep the shared copy current automatically: refresh on app start and each
   * time the app is backgrounded (when editing is likely done). Call once at
   * startup. No-op when nothing is shared.
   */
  async initialize(): Promise<void> {
    this.bindLifecycle();
    if (this.currentShare()) {
      try {
        await this.refresh();
      } catch {
        // Best-effort; will retry on the next background/start.
      }
    }
  }

  private bindLifecycle(): void {
    if (this.lifecycleBound) {
      return;
    }
    this.lifecycleBound = true;
    void App.addListener('appStateChange', ({ isActive }) => {
      if (!isActive && this.currentShare()) {
        void this.refresh().catch(() => undefined);
      }
    });
  }

  /** Share (read-only) with an email: create/refresh the snapshot + grant access. */
  async shareWith(email: string): Promise<OutboundShare> {
    const to = (email ?? '').trim();
    if (!to || !to.includes('@')) {
      throw new Error('Enter a valid email address to share with.');
    }
    const folderId = await this.ensureFolder();
    const fileId = await this.writeSnapshot(folderId, this.currentShare()?.fileId);
    await this.grantReader(folderId, to);
    const share: OutboundShare = { email: to, folderId, fileId, updatedAt: new Date().toISOString() };
    localStorage.setItem(OUT_KEY, JSON.stringify(share));
    return share;
  }

  /** Re-write the snapshot with the latest data (no permission change). */
  async refresh(): Promise<void> {
    const cur = this.currentShare();
    if (!cur) {
      return;
    }
    const fileId = await this.writeSnapshot(cur.folderId, cur.fileId);
    localStorage.setItem(OUT_KEY, JSON.stringify({ ...cur, fileId, updatedAt: new Date().toISOString() }));
  }

  /** Stop sharing: delete the shared folder (revokes access) and forget it. */
  async stopSharing(): Promise<void> {
    const cur = this.currentShare();
    if (cur) {
      try {
        await this.req('DELETE', `${DRIVE_API}/files/${cur.folderId}`);
      } catch {
        // Already gone / no access — clearing local state is enough.
      }
    }
    localStorage.removeItem(OUT_KEY);
  }

  // ── internals ──────────────────────────────────────────────────────────

  private async ensureFolder(): Promise<string> {
    const known = this.currentShare()?.folderId;
    if (known && (await this.fileExists(known))) {
      return known;
    }
    const found = await this.findFolder();
    if (found) {
      return found;
    }
    const res = await this.req('POST', `${DRIVE_API}/files`, {
      params: { fields: 'id' },
      headers: { 'Content-Type': 'application/json' },
      data: { name: SHARED_FOLDER_NAME, mimeType: FOLDER_MIME },
    });
    this.ensureOk(res, 'create shared folder');
    return (res.data as { id: string }).id;
  }

  private async findFolder(): Promise<string | null> {
    const res = await this.req('GET', `${DRIVE_API}/files`, {
      params: {
        q: `name='${SHARED_FOLDER_NAME}' and mimeType='${FOLDER_MIME}' and trashed=false`,
        spaces: 'drive',
        fields: 'files(id)',
        pageSize: '5',
      },
    });
    this.ensureOk(res, 'find shared folder');
    return (res.data as { files?: { id: string }[] }).files?.[0]?.id ?? null;
  }

  private async writeSnapshot(folderId: string, knownFileId?: string): Promise<string> {
    const snapshot = await this.buildSnapshot();
    let fileId = knownFileId ?? (await this.findSnapshotFile(folderId));
    if (!fileId) {
      const meta = await this.req('POST', `${DRIVE_API}/files`, {
        params: { fields: 'id' },
        headers: { 'Content-Type': 'application/json' },
        data: { name: SNAPSHOT_FILE_NAME, parents: [folderId], mimeType: 'application/json' },
      });
      this.ensureOk(meta, 'create snapshot');
      fileId = (meta.data as { id: string }).id;
    }
    const up = await this.req('PATCH', `${DRIVE_UPLOAD}/files/${fileId}`, {
      params: { uploadType: 'media', fields: 'id' },
      headers: { 'Content-Type': 'application/json' },
      data: snapshot,
    });
    this.ensureOk(up, 'write snapshot');
    return fileId;
  }

  private async findSnapshotFile(folderId: string): Promise<string | null> {
    const res = await this.req('GET', `${DRIVE_API}/files`, {
      params: {
        q: `name='${SNAPSHOT_FILE_NAME}' and '${folderId}' in parents and trashed=false`,
        spaces: 'drive',
        fields: 'files(id)',
        pageSize: '5',
      },
    });
    this.ensureOk(res, 'find snapshot');
    return (res.data as { files?: { id: string }[] }).files?.[0]?.id ?? null;
  }

  private async grantReader(folderId: string, email: string): Promise<void> {
    const res = await this.req('POST', `${DRIVE_API}/files/${folderId}/permissions`, {
      params: { sendNotificationEmail: 'true', fields: 'id' },
      headers: { 'Content-Type': 'application/json' },
      data: { role: 'reader', type: 'user', emailAddress: email },
    });
    this.ensureOk(res, 'grant access');
  }

  private async buildSnapshot(): Promise<SharedSnapshot> {
    const [cats, accs, settings, manifestDoc] = await Promise.all([
      this.repo.read<CategoryList>(DRIVE_FILES.categories),
      this.repo.read<AccountList>(DRIVE_FILES.accounts),
      this.repo.read<SettingsDocument>(DRIVE_FILES.settings),
      this.repo.read<Manifest>(DRIVE_FILES.manifest),
    ]);
    const expenses: Expense[] = [];
    if (manifestDoc) {
      for (const { shardName } of shardsNewestFirst(manifestDoc.document)) {
        const shard = await this.repo.read<ExpenseShard>(shardName);
        if (shard) {
          expenses.push(...shard.document.items);
        }
      }
    }
    const user = this.session.currentUser();
    return {
      schemaVersion: SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      owner: { name: user?.name ?? '', email: user?.email ?? '' },
      currency: settings?.document.currency ?? 'USD',
      categories: cats?.document.items ?? [],
      accounts: accs?.document.items ?? [],
      expenses,
    };
  }

  private async fileExists(fileId: string): Promise<boolean> {
    try {
      const res = await this.req('GET', `${DRIVE_API}/files/${fileId}`, { params: { fields: 'id,trashed' } });
      return res.status >= 200 && res.status < 300 && !(res.data as { trashed?: boolean }).trashed;
    } catch {
      return false;
    }
  }

  private async req(
    method: string,
    url: string,
    options: { params?: Record<string, string>; headers?: Record<string, string>; data?: unknown } = {},
  ): Promise<HttpResponse> {
    const token = await this.tokens.getAccessToken();
    return CapacitorHttp.request({
      method,
      url,
      params: options.params,
      headers: { Authorization: `Bearer ${token}`, ...(options.headers ?? {}) },
      data: options.data,
    });
  }

  private ensureOk(res: HttpResponse, context: string): void {
    if (res.status < 200 || res.status >= 300) {
      const detail = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
      throw new Error(`Sharing — ${context} failed (HTTP ${res.status}): ${detail}`);
    }
  }
}
