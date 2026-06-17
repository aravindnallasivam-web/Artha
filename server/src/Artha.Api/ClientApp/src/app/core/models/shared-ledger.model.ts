import { Account } from './account.model';
import { Category } from './category.model';
import { Expense } from './expense.model';

/** Read-only snapshot one user shares with another (written to a Drive folder). */
export interface SharedSnapshot {
  schemaVersion: number;
  generatedAt: string;
  owner: { name: string; email: string };
  currency: string;
  categories: Category[];
  accounts: Account[];
  expenses: Expense[];
}

/** Local record of an outbound share (the producer side). */
export interface OutboundShare {
  /** Email the ledger is shared with (read-only). */
  email: string;
  /** Drive folder + snapshot file ids backing the share. */
  folderId: string;
  fileId: string;
  /** When the snapshot was last written. */
  updatedAt: string;
}
