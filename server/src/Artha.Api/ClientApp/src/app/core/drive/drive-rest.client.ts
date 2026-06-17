// Low-level Google Drive v3 REST client, scoped to the user's appDataFolder.
//
// TypeScript port of GoogleDriveClient.cs. Uses CapacitorHttp (the native HTTP
// bridge) so requests are made from the OS, not the WebView — which sidesteps
// CORS entirely on device. Every file lives in the hidden `appDataFolder`
// space, so the app can only ever see data it created.
//
// Writes use a two-step create (metadata POST, then a media PATCH) rather than
// multipart, which keeps the request bodies plain JSON and robust through
// CapacitorHttp.

import { Injectable, inject } from '@angular/core';
import { CapacitorHttp, HttpResponse } from '@capacitor/core';
import { GoogleTokenStore } from './google-token.store';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const APP_DATA_FOLDER = 'appDataFolder';
const FILE_FIELDS = 'id,name,headRevisionId,size';
const LIST_FIELDS = 'files(id,name,headRevisionId,size),nextPageToken';

export interface DriveFileMeta {
  id: string;
  name: string;
  headRevisionId: string;
  size?: string;
}

export interface DriveReadResult {
  fileId: string;
  name: string;
  headRevisionId: string;
  /** Parsed JSON content of the file. */
  content: unknown;
}

/** Optimistic-concurrency failure: the file moved on under us. */
export class DriveConflictError extends Error {
  constructor(
    readonly fileName: string,
    readonly currentEtag: string | null,
  ) {
    super(`Drive file '${fileName}' was modified by another writer.`);
    this.name = 'DriveConflictError';
  }
}

@Injectable({ providedIn: 'root' })
export class DriveRestClient {
  private readonly tokens = inject(GoogleTokenStore);

  /** Read a file (metadata + content) by name, or null if it doesn't exist. */
  async getByName(name: string): Promise<DriveReadResult | null> {
    const meta = await this.getMetaByName(name);
    if (!meta) {
      return null;
    }
    const content = await this.download(meta.id);
    return { fileId: meta.id, name: meta.name, headRevisionId: meta.headRevisionId, content };
  }

  /** Resolve a file's metadata by name without downloading its content. */
  async getMetaByName(name: string): Promise<DriveFileMeta | null> {
    const res = await this.request({
      method: 'GET',
      url: `${DRIVE_API}/files`,
      params: {
        spaces: APP_DATA_FOLDER,
        q: `name = '${escapeForQuery(name)}' and trashed = false`,
        fields: LIST_FIELDS,
        pageSize: '10',
      },
    });
    this.ensureOk(res, `find ${name}`);
    const files = ((res.data as { files?: DriveFileMeta[] })?.files ?? []);
    return files[0] ?? null;
  }

  /** Create a new appData file with the given JSON content. */
  async create(name: string, content: unknown): Promise<DriveFileMeta> {
    const metaRes = await this.request({
      method: 'POST',
      url: `${DRIVE_API}/files`,
      params: { fields: FILE_FIELDS },
      headers: { 'Content-Type': 'application/json' },
      data: { name, parents: [APP_DATA_FOLDER], mimeType: 'application/json' },
    });
    this.ensureOk(metaRes, `create ${name}`);
    const id = (metaRes.data as DriveFileMeta).id;
    return this.uploadMedia(id, content);
  }

  /**
   * Overwrite a file's content. Concurrency is enforced by the repository
   * layer (which compares headRevisionId before calling this), so this just
   * pushes the new bytes.
   */
  async update(fileId: string, content: unknown): Promise<DriveFileMeta> {
    return this.uploadMedia(fileId, content);
  }

  /** All appData files whose name starts with the given prefix. */
  async list(namePrefix?: string): Promise<DriveFileMeta[]> {
    const results: DriveFileMeta[] = [];
    let pageToken: string | undefined;

    do {
      const params: Record<string, string> = {
        spaces: APP_DATA_FOLDER,
        fields: LIST_FIELDS,
        pageSize: '100',
      };
      if (pageToken) {
        params['pageToken'] = pageToken;
      }
      if (namePrefix) {
        params['q'] = `name contains '${escapeForQuery(namePrefix)}'`;
      }

      const res = await this.request({ method: 'GET', url: `${DRIVE_API}/files`, params });
      this.ensureOk(res, 'list');
      const page = res.data as { files?: DriveFileMeta[]; nextPageToken?: string };
      for (const file of page.files ?? []) {
        // `name contains` matches anywhere; narrow to a true prefix.
        if (!namePrefix || file.name.startsWith(namePrefix)) {
          results.push(file);
        }
      }
      pageToken = page.nextPageToken;
    } while (pageToken);

    return results;
  }

  async delete(fileId: string): Promise<void> {
    const res = await this.request({ method: 'DELETE', url: `${DRIVE_API}/files/${fileId}` });
    this.ensureOk(res, `delete ${fileId}`);
  }

  private async download(fileId: string): Promise<unknown> {
    const res = await this.request({
      method: 'GET',
      url: `${DRIVE_API}/files/${fileId}`,
      params: { alt: 'media' },
    });
    this.ensureOk(res, `download ${fileId}`);
    return res.data;
  }

  private async uploadMedia(fileId: string, content: unknown): Promise<DriveFileMeta> {
    const res = await this.request({
      method: 'PATCH',
      url: `${DRIVE_UPLOAD}/files/${fileId}`,
      params: { uploadType: 'media', fields: FILE_FIELDS },
      headers: { 'Content-Type': 'application/json' },
      data: content,
    });
    this.ensureOk(res, `upload ${fileId}`);
    return res.data as DriveFileMeta;
  }

  private async request(options: {
    method: string;
    url: string;
    params?: Record<string, string>;
    headers?: Record<string, string>;
    data?: unknown;
  }): Promise<HttpResponse> {
    const token = await this.tokens.getAccessToken();
    return CapacitorHttp.request({
      method: options.method,
      url: options.url,
      params: options.params,
      headers: { Authorization: `Bearer ${token}`, ...(options.headers ?? {}) },
      data: options.data,
    });
  }

  private ensureOk(res: HttpResponse, context: string): void {
    if (res.status < 200 || res.status >= 300) {
      const detail = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
      throw new Error(`Drive ${context} failed (HTTP ${res.status}): ${detail}`);
    }
  }
}

function escapeForQuery(raw: string): string {
  return raw.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
