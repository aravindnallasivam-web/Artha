// Typed JSON wrapper over the local-first DriveCache.
//
// Each well-known file (manifest, settings, categories, …) is read/written
// through this layer, which adds a schema-version forward-guard. The cache
// serves reads from a local copy instantly and pushes writes to Drive in the
// background, so this stays a thin, synchronous-feeling API for the stores.
//
// It is generic over the document type T, so one class serves every file.

import { Injectable, inject } from '@angular/core';
import { DriveCache } from './drive-cache.service';
import { SCHEMA_VERSION, SchemaVersioned } from './drive-schema';

export interface RepositoryDocument<T> {
  document: T;
  fileId: string;
  etag: string;
}

@Injectable({ providedIn: 'root' })
export class AppDataRepository {
  private readonly cache = inject(DriveCache);

  async read<T>(fileName: string): Promise<RepositoryDocument<T> | null> {
    const result = await this.cache.read(fileName);
    if (!result) {
      return null;
    }
    const document = result.content as T;
    guardSchemaVersion(document, fileName);
    return { document, fileId: '', etag: result.etag };
  }

  /**
   * Create or overwrite the file. The write lands in the local cache
   * immediately and is synced to Drive in the background. The ifMatchEtag
   * argument is accepted for call-site compatibility but no longer enforced
   * (the cache reconciles with Drive using last-write-wins). Returns the
   * last-known ETag.
   */
  async write<T>(fileName: string, document: T, _ifMatchEtag?: string | null): Promise<string> {
    return this.cache.write(fileName, document);
  }
}

function guardSchemaVersion(document: unknown, fileName: string): void {
  const version = (document as Partial<SchemaVersioned>)?.schemaVersion;
  if (typeof version === 'number' && version > SCHEMA_VERSION) {
    throw new Error(
      `Drive file '${fileName}' has schemaVersion ${version}, newer than supported ` +
        `(${SCHEMA_VERSION}). Update the app.`,
    );
  }
}
