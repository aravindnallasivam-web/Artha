// Drive-backed settings service — port of SettingsController.
// Same public surface as SettingsApi.

import { Injectable, inject } from '@angular/core';
import { AppDataRepository } from '../../core/drive/app-data.repository';
import { DriveBootstrap, defaultCurrencyFor } from '../../core/drive/drive-bootstrap.service';
import { badRequest } from '../../core/drive/drive-errors';
import { DRIVE_FILES, SCHEMA_VERSION, SettingsDocument } from '../../core/drive/drive-schema';
import { Settings, SUPPORTED_CURRENCIES, SettingsUpdateRequest } from '../../core/models/settings.model';

@Injectable({ providedIn: 'root' })
export class SettingsDriveService {
  private readonly repo = inject(AppDataRepository);
  private readonly bootstrap = inject(DriveBootstrap);

  async get(): Promise<Settings> {
    await this.bootstrap.ensureInitialized();
    const doc = await this.repo.read<SettingsDocument>(DRIVE_FILES.settings);
    const locale = typeof navigator !== 'undefined' ? navigator.language : null;
    if (!doc) {
      return { currency: defaultCurrencyFor(locale), firstRunCompleted: false, locale };
    }
    return {
      currency: doc.document.currency,
      firstRunCompleted: doc.document.firstRunCompleted,
      locale: doc.document.locale ?? null,
    };
  }

  async put(request: SettingsUpdateRequest): Promise<Settings> {
    const currency = (request.currency ?? '').toUpperCase();
    if (!SUPPORTED_CURRENCIES.some((c) => c.code === currency)) {
      throw badRequest(
        `Currency '${request.currency}' is not supported: ${SUPPORTED_CURRENCIES.map((c) => c.code).join(', ')}`,
      );
    }
    await this.bootstrap.ensureInitialized();

    const existing = await this.repo.read<SettingsDocument>(DRIVE_FILES.settings);
    const locale = existing?.document.locale ?? (typeof navigator !== 'undefined' ? navigator.language : null);
    const updated: SettingsDocument = {
      schemaVersion: SCHEMA_VERSION,
      currency,
      firstRunCompleted: true,
      locale,
    };
    await this.repo.write<SettingsDocument>(DRIVE_FILES.settings, updated, existing?.etag);
    return { currency: updated.currency, firstRunCompleted: updated.firstRunCompleted, locale: updated.locale ?? null };
  }
}
