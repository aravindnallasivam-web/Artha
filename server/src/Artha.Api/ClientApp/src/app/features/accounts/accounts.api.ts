// Thin pass-through to the Drive-backed service. Kept as `AccountsApi` so the
// store's injection point is unchanged after the serverless cutover.
import { Injectable, inject } from '@angular/core';
import { Account, AccountUpsertRequest } from '../../core/models/account.model';
import { AccountsDriveService } from './accounts.drive';

@Injectable({ providedIn: 'root' })
export class AccountsApi {
  private readonly drive = inject(AccountsDriveService);

  list(includeArchived = false): Promise<Account[]> {
    return this.drive.list(includeArchived);
  }

  create(request: AccountUpsertRequest): Promise<Account> {
    return this.drive.create(request);
  }

  update(id: string, request: AccountUpsertRequest): Promise<Account> {
    return this.drive.update(id, request);
  }

  remove(id: string): Promise<void> {
    return this.drive.remove(id);
  }
}
