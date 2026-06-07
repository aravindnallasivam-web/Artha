// Thin pass-through to the Drive-backed service. Kept as `ExpensesApi` so the
// store's injection point is unchanged after the serverless cutover. The .xlsx/
// .csv import endpoints were dropped with the move off the server.
import { Injectable, inject } from '@angular/core';
import {
  Expense,
  ExpenseCreateRequest,
  ExpenseListResponse,
  ExpenseUpdateRequest,
} from '../../core/models/expense.model';
import { ExpensesDriveService } from './expenses.drive';

@Injectable({ providedIn: 'root' })
export class ExpensesApi {
  private readonly drive = inject(ExpensesDriveService);

  list(from?: string, to?: string): Promise<ExpenseListResponse> {
    return this.drive.list(from, to);
  }

  create(request: ExpenseCreateRequest): Promise<Expense> {
    return this.drive.create(request);
  }

  update(id: string, request: ExpenseUpdateRequest): Promise<Expense> {
    return this.drive.update(id, request);
  }

  remove(id: string): Promise<void> {
    return this.drive.remove(id);
  }
}
