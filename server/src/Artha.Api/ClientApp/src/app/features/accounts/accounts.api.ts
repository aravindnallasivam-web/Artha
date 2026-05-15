import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Account, AccountUpsertRequest } from '../../core/models/account.model';

@Injectable({ providedIn: 'root' })
export class AccountsApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}/api/accounts`;

  list(includeArchived = false): Promise<Account[]> {
    const params: Record<string, string> = {};
    if (includeArchived) params['includeArchived'] = 'true';
    return firstValueFrom(this.http.get<Account[]>(this.baseUrl, { params }));
  }

  create(request: AccountUpsertRequest): Promise<Account> {
    return firstValueFrom(this.http.post<Account>(this.baseUrl, request));
  }

  update(id: string, request: AccountUpsertRequest): Promise<Account> {
    return firstValueFrom(this.http.put<Account>(`${this.baseUrl}/${id}`, request));
  }

  remove(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${this.baseUrl}/${id}`));
  }
}
