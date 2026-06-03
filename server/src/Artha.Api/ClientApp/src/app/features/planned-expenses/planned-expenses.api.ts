import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { PlannedExpense, PlannedExpenseUpsertRequest } from '../../core/models/planned-expense.model';

@Injectable({ providedIn: 'root' })
export class PlannedExpensesApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}/api/planned-expenses`;

  list(includeArchived = false): Promise<PlannedExpense[]> {
    const params: Record<string, string> = {};
    if (includeArchived) params['includeArchived'] = 'true';
    return firstValueFrom(this.http.get<PlannedExpense[]>(this.baseUrl, { params }));
  }

  create(request: PlannedExpenseUpsertRequest): Promise<PlannedExpense> {
    return firstValueFrom(this.http.post<PlannedExpense>(this.baseUrl, request));
  }

  update(id: string, request: PlannedExpenseUpsertRequest): Promise<PlannedExpense> {
    return firstValueFrom(this.http.put<PlannedExpense>(`${this.baseUrl}/${id}`, request));
  }

  remove(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${this.baseUrl}/${id}`));
  }
}
