// First-run seeding of the user's Drive appdata.
//
// Port of AppDataBootstrapper.cs. On the first Drive-backed call we ensure
// accounts.json / categories.json / settings.json / manifest.json exist with
// sensible defaults. accounts.json is the "fully bootstrapped" marker, so the
// common case is a single Drive lookup. Idempotent and de-duped in-process.

import { Injectable, inject } from '@angular/core';
import { Account } from '../models/account.model';
import { Category } from '../models/category.model';
import { AppDataRepository } from './app-data.repository';
import { DriveRestClient } from './drive-rest.client';
import {
  AccountList,
  CategoryList,
  DEFAULT_ACCOUNT_ID,
  DRIVE_FILES,
  Manifest,
  SCHEMA_VERSION,
  SettingsDocument,
  emptyManifest,
} from './drive-schema';

@Injectable({ providedIn: 'root' })
export class DriveBootstrap {
  private readonly repo = inject(AppDataRepository);
  private readonly drive = inject(DriveRestClient);

  private done = false;
  private inFlight: Promise<void> | null = null;

  /** Ensure the appdata files exist. Cheap no-op after the first success. */
  async ensureInitialized(): Promise<void> {
    if (this.done) {
      return;
    }
    this.inFlight ??= this.run().finally(() => {
      this.inFlight = null;
    });
    await this.inFlight;
  }

  /** Forget the in-process guard — call on sign-out so a new account re-seeds. */
  reset(): void {
    this.done = false;
    this.inFlight = null;
  }

  private async run(): Promise<void> {
    // Fast path: accounts.json present => already bootstrapped.
    if (await this.drive.getMetaByName(DRIVE_FILES.accounts)) {
      this.done = true;
      return;
    }

    const locale = typeof navigator !== 'undefined' ? navigator.language : null;
    const currency = defaultCurrencyFor(locale);

    // accounts.json first — it's the marker that the user is fully seeded.
    await this.repo.write<AccountList>(DRIVE_FILES.accounts, {
      schemaVersion: SCHEMA_VERSION,
      items: buildDefaultAccounts(currency),
    });

    // If a manifest already exists this is a pre-accounts user; seeding the
    // accounts file is all that's needed. Otherwise it's a brand-new user —
    // seed categories + settings + an empty manifest (manifest written last).
    if (!(await this.drive.getMetaByName(DRIVE_FILES.manifest))) {
      await this.repo.write<CategoryList>(DRIVE_FILES.categories, {
        schemaVersion: SCHEMA_VERSION,
        items: buildDefaultCategories(),
      });
      await this.repo.write<SettingsDocument>(DRIVE_FILES.settings, {
        schemaVersion: SCHEMA_VERSION,
        currency,
        firstRunCompleted: false,
        locale,
      });
      await this.repo.write<Manifest>(DRIVE_FILES.manifest, emptyManifest());
    }

    this.done = true;
  }
}

function buildDefaultAccounts(currency: string): Account[] {
  return [
    {
      id: DEFAULT_ACCOUNT_ID,
      name: 'Cash',
      type: 'cash',
      currency,
      openingBalance: 0,
      color: '#22c55e',
      icon: 'cash-outline',
      archived: false,
      bank: null,
    },
  ];
}

function buildDefaultCategories(): Category[] {
  const seed: [string, string, string, string][] = [
    ['cat-food', 'Food', '#ef4444', 'restaurant'],
    ['cat-transport', 'Transport', '#3b82f6', 'car'],
    ['cat-bills', 'Bills', '#f59e0b', 'receipt'],
    ['cat-entertainment', 'Entertainment', '#a855f7', 'musical-notes'],
    ['cat-health', 'Health', '#22c55e', 'medkit'],
    ['cat-other', 'Other', '#64748b', 'ellipsis-horizontal'],
  ];
  return seed.map(([id, name, color, icon]) => ({
    id,
    name,
    color,
    icon,
    archived: false,
    excludeFromReports: false,
  }));
}

/** Pick a sensible default currency from the device locale (port of server). */
export function defaultCurrencyFor(locale: string | null): string {
  if (!locale) {
    return 'USD';
  }
  const l = locale.replace(/_/g, '-').toLowerCase();
  if (l.startsWith('en-in') || l.startsWith('hi')) return 'INR';
  if (l.startsWith('en-gb')) return 'GBP';
  if (l.startsWith('en-au')) return 'AUD';
  if (l.startsWith('en-ca')) return 'CAD';
  if (l.startsWith('ja')) return 'JPY';
  if (
    l.startsWith('de') ||
    l.startsWith('fr') ||
    l.startsWith('es') ||
    l.startsWith('it') ||
    l.startsWith('nl') ||
    l.startsWith('pt') ||
    l.startsWith('en-ie')
  ) {
    return 'EUR';
  }
  return 'USD';
}
