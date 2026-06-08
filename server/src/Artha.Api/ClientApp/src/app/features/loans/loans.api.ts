// Thin pass-through to the Drive-backed loans service (matches the other
// feature APIs, so the store stays transport-agnostic).
import { Injectable, inject } from '@angular/core';
import { Loan, LoanUpsertRequest } from '../../core/models/loan.model';
import { LoansDriveService } from './loans.drive';

@Injectable({ providedIn: 'root' })
export class LoansApi {
  private readonly drive = inject(LoansDriveService);

  list(includeArchived = false): Promise<Loan[]> {
    return this.drive.list(includeArchived);
  }

  create(request: LoanUpsertRequest): Promise<Loan> {
    return this.drive.create(request);
  }

  update(id: string, request: LoanUpsertRequest): Promise<Loan> {
    return this.drive.update(id, request);
  }

  remove(id: string): Promise<void> {
    return this.drive.remove(id);
  }
}
