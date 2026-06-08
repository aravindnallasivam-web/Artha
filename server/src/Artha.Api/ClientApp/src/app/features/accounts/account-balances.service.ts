// All-time spend per account, summed across every monthly shard.
//
// Account balances aren't stored — they're derived: balance = openingBalance
// minus everything ever spent from that account. This walks the manifest's
// shards (in parallel, like the reports aggregation) and totals spend by
// accountId. Excluded expenses (refunds/transfers) are left out.

import { Injectable, inject } from '@angular/core';
import { AppDataRepository } from '../../core/drive/app-data.repository';
import {
  DEFAULT_ACCOUNT_ID,
  DRIVE_FILES,
  ExpenseShard,
  Manifest,
  shardsNewestFirst,
} from '../../core/drive/drive-schema';

@Injectable({ providedIn: 'root' })
export class AccountBalancesService {
  private readonly repo = inject(AppDataRepository);

  /** Map of accountId -> all-time spent (non-excluded). */
  async spendByAccount(): Promise<Map<string, number>> {
    const spend = new Map<string, number>();
    const manifestDoc = await this.repo.read<Manifest>(DRIVE_FILES.manifest);
    if (!manifestDoc) {
      return spend;
    }
    const shardNames = shardsNewestFirst(manifestDoc.document).map((s) => s.shardName);
    const shards = await Promise.all(shardNames.map((name) => this.repo.read<ExpenseShard>(name)));
    for (const shard of shards) {
      if (!shard) {
        continue;
      }
      for (const e of shard.document.items) {
        if (e.excluded) {
          continue;
        }
        const acc = e.accountId || DEFAULT_ACCOUNT_ID;
        spend.set(acc, (spend.get(acc) ?? 0) + e.amount);
      }
    }
    return spend;
  }
}
