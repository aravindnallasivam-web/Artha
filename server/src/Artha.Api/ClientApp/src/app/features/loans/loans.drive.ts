// Drive-backed loans service — CRUD over loans.json (a single LoanList file),
// mirroring the planned-expenses pattern.

import { Injectable, inject } from '@angular/core';
import { AppDataRepository } from '../../core/drive/app-data.repository';
import { DriveBootstrap } from '../../core/drive/drive-bootstrap.service';
import { badRequest, notFound } from '../../core/drive/drive-errors';
import { DRIVE_FILES, LoanList, SCHEMA_VERSION, newId } from '../../core/drive/drive-schema';
import { Loan, LoanUpsertRequest } from '../../core/models/loan.model';

@Injectable({ providedIn: 'root' })
export class LoansDriveService {
  private readonly repo = inject(AppDataRepository);
  private readonly bootstrap = inject(DriveBootstrap);

  async list(includeArchived = false): Promise<Loan[]> {
    await this.bootstrap.ensureInitialized();
    const doc = await this.repo.read<LoanList>(DRIVE_FILES.loans);
    return (doc?.document.items ?? []).filter((l) => includeArchived || !l.archived);
  }

  async create(request: LoanUpsertRequest): Promise<Loan> {
    this.validate(request);
    await this.bootstrap.ensureInitialized();

    const existing = await this.repo.read<LoanList>(DRIVE_FILES.loans);
    const list = existing?.document.items ?? [];
    const created: Loan = { id: newId('loan'), archived: false, ...normalize(request) };
    await this.repo.write<LoanList>(
      DRIVE_FILES.loans,
      { schemaVersion: SCHEMA_VERSION, items: [...list, created] },
      existing?.etag,
    );
    return created;
  }

  async update(id: string, request: LoanUpsertRequest): Promise<Loan> {
    this.validate(request);
    await this.bootstrap.ensureInitialized();

    const existing = await this.repo.read<LoanList>(DRIVE_FILES.loans);
    const list = [...(existing?.document.items ?? [])];
    const idx = list.findIndex((l) => l.id === id);
    if (idx < 0) {
      throw notFound();
    }
    list[idx] = { ...list[idx], ...normalize(request) };
    await this.repo.write<LoanList>(
      DRIVE_FILES.loans,
      { schemaVersion: SCHEMA_VERSION, items: list },
      existing?.etag,
    );
    return list[idx];
  }

  async remove(id: string): Promise<void> {
    await this.bootstrap.ensureInitialized();
    const existing = await this.repo.read<LoanList>(DRIVE_FILES.loans);
    const list = [...(existing?.document.items ?? [])];
    const idx = list.findIndex((l) => l.id === id);
    if (idx < 0) {
      throw notFound();
    }
    // Soft delete (archive), consistent with the rest of the app.
    list[idx] = { ...list[idx], archived: true };
    await this.repo.write<LoanList>(
      DRIVE_FILES.loans,
      { schemaVersion: SCHEMA_VERSION, items: list },
      existing?.etag,
    );
  }

  private validate(r: LoanUpsertRequest): void {
    if (!r.name?.trim()) {
      throw badRequest('Name is required.');
    }
    if (!(r.principal > 0)) {
      throw badRequest('Loan amount must be greater than zero.');
    }
    if (r.annualInterestRate < 0 || r.annualInterestRate > 100) {
      throw badRequest('Interest rate must be between 0 and 100%.');
    }
    if (!Number.isInteger(r.termMonths) || r.termMonths < 1 || r.termMonths > 600) {
      throw badRequest('Term must be between 1 and 600 months.');
    }
    if (!/^\d{4}-\d{2}-\d{2}/.test(r.startDate)) {
      throw badRequest('A valid start date is required.');
    }
  }
}

function normalize(r: LoanUpsertRequest): Omit<Loan, 'id' | 'archived'> {
  return {
    name: r.name.trim(),
    lender: r.lender?.trim() ? r.lender.trim() : null,
    principal: r.principal,
    annualInterestRate: r.annualInterestRate,
    termMonths: r.termMonths,
    startDate: r.startDate,
    accountId: r.accountId?.trim() ? r.accountId : null,
  };
}
