// Thin pass-through to the Drive-backed service. Kept as `PlannedExpensesApi`
// so the store's injection point is unchanged after the serverless cutover.
import { Injectable, inject } from '@angular/core';
import { PlannedExpense, PlannedExpenseUpsertRequest } from '../../core/models/planned-expense.model';
import { PlannedExpensesDriveService } from './planned-expenses.drive';

@Injectable({ providedIn: 'root' })
export class PlannedExpensesApi {
  private readonly drive = inject(PlannedExpensesDriveService);

  list(includeArchived = false): Promise<PlannedExpense[]> {
    return this.drive.list(includeArchived);
  }

  create(request: PlannedExpenseUpsertRequest): Promise<PlannedExpense> {
    return this.drive.create(request);
  }

  update(id: string, request: PlannedExpenseUpsertRequest): Promise<PlannedExpense> {
    return this.drive.update(id, request);
  }

  remove(id: string): Promise<void> {
    return this.drive.remove(id);
  }
}
