import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  Expense,
  ExpenseCreateRequest,
  ExpenseListResponse,
  ExpenseUpdateRequest,
} from '../../core/models/expense.model';
import {
  ImportConfirmRequest,
  ImportPreviewResponse,
  ImportResultResponse,
} from '../../core/models/import.model';

@Injectable({ providedIn: 'root' })
export class ExpensesApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}/api/expenses`;

  list(from?: string, to?: string): Promise<ExpenseListResponse> {
    const params: Record<string, string> = {};
    if (from) params['from'] = from;
    if (to) params['to'] = to;
    return firstValueFrom(this.http.get<ExpenseListResponse>(this.baseUrl, { params }));
  }

  create(request: ExpenseCreateRequest): Promise<Expense> {
    return firstValueFrom(this.http.post<Expense>(this.baseUrl, request));
  }

  update(id: string, request: ExpenseUpdateRequest): Promise<Expense> {
    return firstValueFrom(this.http.put<Expense>(`${this.baseUrl}/${id}`, request));
  }

  remove(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${this.baseUrl}/${id}`));
  }

  /** Upload a .xlsx/.csv file and get back a validated preview (writes nothing). */
  previewImport(file: File): Promise<ImportPreviewResponse> {
    const form = new FormData();
    form.append('file', file, file.name);
    return firstValueFrom(
      this.http.post<ImportPreviewResponse>(`${this.baseUrl}/import/preview`, form),
    );
  }

  /** Persist the confirmed import rows; auto-creates missing categories/accounts. */
  confirmImport(request: ImportConfirmRequest): Promise<ImportResultResponse> {
    return firstValueFrom(
      this.http.post<ImportResultResponse>(`${this.baseUrl}/import`, request),
    );
  }
}
