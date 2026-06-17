// Drive-backed accounts service — port of AccountsController.
// Same public surface as AccountsApi.

import { Injectable, inject } from '@angular/core';
import { AppDataRepository } from '../../core/drive/app-data.repository';
import { DriveBootstrap } from '../../core/drive/drive-bootstrap.service';
import { badRequest, conflict, notFound } from '../../core/drive/drive-errors';
import {
  AccountList,
  DEFAULT_ACCOUNT_ID,
  DRIVE_FILES,
  ExpenseShard,
  Manifest,
  SCHEMA_VERSION,
  newId,
  shardsNewestFirst,
} from '../../core/drive/drive-schema';
import { Account, AccountType, AccountUpsertRequest } from '../../core/models/account.model';

const ACCOUNT_TYPES: AccountType[] = ['checking', 'savings', 'cash', 'credit_card', 'other'];

@Injectable({ providedIn: 'root' })
export class AccountsDriveService {
  private readonly repo = inject(AppDataRepository);
  private readonly bootstrap = inject(DriveBootstrap);

  async list(includeArchived = false): Promise<Account[]> {
    await this.bootstrap.ensureInitialized();
    const doc = await this.repo.read<AccountList>(DRIVE_FILES.accounts);
    return (doc?.document.items ?? []).filter((a) => includeArchived || !a.archived);
  }

  async create(request: AccountUpsertRequest): Promise<Account> {
    this.validate(request);
    await this.bootstrap.ensureInitialized();

    const existing = await this.repo.read<AccountList>(DRIVE_FILES.accounts);
    const list = existing?.document.items ?? [];
    const name = request.name.trim();
    if (list.some((a) => !a.archived && a.name.toLowerCase() === name.toLowerCase())) {
      throw badRequest(`An account named '${name}' already exists.`);
    }

    const created: Account = {
      id: newId('acc'),
      name,
      type: request.type.trim().toLowerCase() as AccountType,
      currency: request.currency.trim().toUpperCase(),
      openingBalance: request.openingBalance,
      color: request.color,
      icon: request.icon,
      archived: false,
      bank: request.bank,
    };
    await this.repo.write<AccountList>(
      DRIVE_FILES.accounts,
      { schemaVersion: SCHEMA_VERSION, items: [...list, created] },
      existing?.etag,
    );
    return created;
  }

  async update(id: string, request: AccountUpsertRequest): Promise<Account> {
    this.validate(request);
    await this.bootstrap.ensureInitialized();

    const existing = await this.repo.read<AccountList>(DRIVE_FILES.accounts);
    const list = [...(existing?.document.items ?? [])];
    const idx = list.findIndex((a) => a.id === id);
    if (idx < 0) {
      throw notFound();
    }
    const name = request.name.trim();
    if (list.some((a) => a.id !== id && !a.archived && a.name.toLowerCase() === name.toLowerCase())) {
      throw badRequest(`An account named '${name}' already exists.`);
    }

    list[idx] = {
      ...list[idx],
      name,
      type: request.type.trim().toLowerCase() as AccountType,
      currency: request.currency.trim().toUpperCase(),
      openingBalance: request.openingBalance,
      color: request.color,
      icon: request.icon,
      bank: request.bank,
    };
    await this.repo.write<AccountList>(
      DRIVE_FILES.accounts,
      { schemaVersion: SCHEMA_VERSION, items: list },
      existing?.etag,
    );
    return list[idx];
  }

  async remove(id: string): Promise<void> {
    if (id === DEFAULT_ACCOUNT_ID) {
      throw badRequest("The default Cash account can't be deleted.");
    }
    await this.bootstrap.ensureInitialized();

    const existing = await this.repo.read<AccountList>(DRIVE_FILES.accounts);
    const list = [...(existing?.document.items ?? [])];
    const idx = list.findIndex((a) => a.id === id);
    if (idx < 0) {
      throw notFound();
    }
    if (await this.isReferenced(id)) {
      throw conflict(
        'This account is referenced by one or more expenses. Archive it instead, or reassign those expenses first.',
        'account-in-use',
      );
    }
    // Soft delete so historical expense accountId references stay resolvable.
    list[idx] = { ...list[idx], archived: true };
    await this.repo.write<AccountList>(
      DRIVE_FILES.accounts,
      { schemaVersion: SCHEMA_VERSION, items: list },
      existing?.etag,
    );
  }

  private validate(request: AccountUpsertRequest): void {
    if (!request.name?.trim()) {
      throw badRequest('Name is required.');
    }
    if (!request.type || !ACCOUNT_TYPES.includes(request.type)) {
      throw badRequest(`Type must be one of: ${ACCOUNT_TYPES.join(', ')}.`);
    }
    if (!request.currency || request.currency.trim().length !== 3) {
      throw badRequest('Currency must be a 3-letter ISO code (e.g. USD).');
    }
  }

  private async isReferenced(accountId: string): Promise<boolean> {
    const manifestDoc = await this.repo.read<Manifest>(DRIVE_FILES.manifest);
    if (!manifestDoc) {
      return false;
    }
    for (const { shardName } of shardsNewestFirst(manifestDoc.document)) {
      const shard = await this.repo.read<ExpenseShard>(shardName);
      if (shard?.document.items.some((e) => e.accountId === accountId)) {
        return true;
      }
    }
    return false;
  }
}
