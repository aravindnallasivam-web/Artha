// Typed JSON wrapper over the Drive REST client.
//
// Port of AppDataRepository.cs. Each well-known file (manifest, settings,
// categories, …) is read/written through this layer, which adds:
//   - a schema-version forward-guard, and
//   - optimistic concurrency via the file's headRevisionId (ETag).
//
// It is generic over the document type T, so one class serves every file.

import { Injectable, inject } from '@angular/core';
import { DriveConflictError, DriveRestClient } from './drive-rest.client';
import { SCHEMA_VERSION, SchemaVersioned } from './drive-schema';

export interface RepositoryDocument<T> {
  document: T;
  fileId: string;
  etag: string;
}

@Injectable({ providedIn: 'root' })
export class AppDataRepository {
  private readonly drive = inject(DriveRestClient);

  async read<T>(fileName: string): Promise<RepositoryDocument<T> | null> {
    const result = await this.drive.getByName(fileName);
    if (!result) {
      return null;
    }
    const document = result.content as T;
    guardSchemaVersion(document, fileName);
    return { document, fileId: result.fileId, etag: result.headRevisionId };
  }

  /**
   * Create if absent, otherwise overwrite. When ifMatchEtag is supplied and no
   * longer matches the stored revision, a DriveConflictError is thrown so the
   * caller can re-read and retry. Returns the new ETag.
   */
  async write<T>(fileName: string, document: T, ifMatchEtag?: string | null): Promise<string> {
    const existing = await this.drive.getMetaByName(fileName);

    if (!existing) {
      const created = await this.drive.create(fileName, document);
      return created.headRevisionId;
    }

    if (ifMatchEtag && existing.headRevisionId !== ifMatchEtag) {
      throw new DriveConflictError(fileName, existing.headRevisionId);
    }

    const updated = await this.drive.update(existing.id, document);
    return updated.headRevisionId;
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
