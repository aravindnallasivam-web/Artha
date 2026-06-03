import { CurrencyPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonSpinner,
  IonTitle,
  IonToolbar,
  ModalController,
} from '@ionic/angular/standalone';
import { ConflictNotifierService } from '../../core/feedback/conflict-notifier.service';
import { ImportConfirmRow, ImportPreviewResponse } from '../../core/models/import.model';
import { ExpensesApi } from './expenses.api';

type Stage = 'pick' | 'preview' | 'importing';

@Component({
  selector: 'artha-expense-import',
  standalone: true,
  imports: [
    CurrencyPipe,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonButton,
    IonContent,
    IonIcon,
    IonSpinner,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Import expenses</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="dismiss()" aria-label="Close">
            <ion-icon name="close-outline" slot="icon-only"></ion-icon>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      @if (stage() === 'pick') {
        <div class="pick">
          <p class="lead">
            Upload an <strong>.xlsx</strong> or <strong>.csv</strong> file with one
            expense per row.
          </p>
          <p class="hint">
            The first row must have headers:
            <code>Date</code>, <code>Amount</code>, <code>Category</code>
            (and optionally <code>Account</code>, <code>Note</code>).
            Dates work best as <code>YYYY-MM-DD</code>.
          </p>
          <p class="hint">
            Categories and accounts are matched by name — any that don't exist yet
            are created automatically.
          </p>

          @if (error()) {
            <p class="error">{{ error() }}</p>
          }

          <input
            #fileInput
            type="file"
            accept=".xlsx,.csv"
            hidden
            (change)="onFileSelected($event)"
          />
          <div class="actions">
            <button type="button" class="primary" (click)="fileInput.click()">
              <ion-icon name="cloud-upload-outline"></ion-icon>
              <span>Choose file</span>
            </button>
            <button type="button" class="link" (click)="downloadTemplate()">
              Download template
            </button>
          </div>
        </div>
      }

      @if (stage() === 'preview' && preview(); as p) {
        <div class="summary-banner" [class.has-errors]="p.invalidCount > 0">
          <strong>{{ p.validCount }}</strong> ready to import
          @if (p.invalidCount > 0) {
            · <strong>{{ p.invalidCount }}</strong> with errors (skipped)
          }
          @if (p.newCategories.length > 0) {
            · creates {{ p.newCategories.length }} categor{{ p.newCategories.length === 1 ? 'y' : 'ies' }}
          }
          @if (p.newAccounts.length > 0) {
            · creates {{ p.newAccounts.length }} account{{ p.newAccounts.length === 1 ? '' : 's' }}
          }
        </div>

        <div class="table-wrap">
          <table class="preview-table">
            <thead>
              <tr>
                <th class="num">#</th>
                <th>Date</th>
                <th class="num">Amount</th>
                <th>Category</th>
                <th>Account</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              @for (row of p.rows; track row.rowNumber) {
                <tr [class.invalid]="!row.valid">
                  <td class="num">{{ row.rowNumber }}</td>
                  <td>{{ row.date ?? '—' }}</td>
                  <td class="num">
                    {{ row.amount != null ? (row.amount | currency: p.currency : 'symbol' : '1.2-2') : '—' }}
                  </td>
                  <td>{{ row.category ?? '—' }}</td>
                  <td>{{ row.account ?? 'Cash' }}</td>
                  <td>{{ row.note ?? '' }}</td>
                </tr>
                @if (!row.valid) {
                  <tr class="error-row">
                    <td></td>
                    <td colspan="5">{{ row.errors.join(' ') }}</td>
                  </tr>
                }
              }
            </tbody>
          </table>
        </div>

        <div class="footer-actions">
          <button type="button" class="link" (click)="reset()">Choose another file</button>
          <button
            type="button"
            class="primary"
            [disabled]="p.validCount === 0"
            (click)="confirm()"
          >
            Import {{ p.validCount }} expense{{ p.validCount === 1 ? '' : 's' }}
          </button>
        </div>
      }

      @if (stage() === 'importing') {
        <div class="importing">
          <ion-spinner name="crescent"></ion-spinner>
          <p>Importing…</p>
        </div>
      }
    </ion-content>
  `,
  styles: [`
    .lead { font-size: 15px; margin: 0 0 12px; }
    .hint { font-size: 13px; color: var(--artha-text-muted, #667); margin: 0 0 10px; line-height: 1.5; }
    code {
      background: var(--artha-surface-2, #f1f2f4);
      padding: 1px 5px; border-radius: 4px; font-size: 12px;
    }
    .error { color: var(--artha-danger, #c0392b); font-size: 13px; margin: 10px 0; }
    .actions { display: flex; align-items: center; gap: 14px; margin-top: 18px; }
    .primary {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 10px 18px; border: 0; border-radius: var(--artha-radius-sm, 8px);
      background: var(--artha-accent, #2f6df6); color: #fff;
      font-size: 14px; font-weight: 600; cursor: pointer;
    }
    .primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .link {
      background: none; border: 0; color: var(--artha-accent, #2f6df6);
      font-size: 13px; font-weight: 600; cursor: pointer; padding: 6px;
    }
    .summary-banner {
      font-size: 13px; padding: 10px 12px; border-radius: var(--artha-radius-sm, 8px);
      background: var(--artha-surface-2, #eef6ff); margin-bottom: 14px;
    }
    .summary-banner.has-errors { background: #fff5e6; }
    .table-wrap { overflow-x: auto; border: 1px solid var(--artha-border, #e3e5e8); border-radius: 8px; }
    .preview-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .preview-table th, .preview-table td {
      padding: 7px 10px; text-align: left; border-bottom: 1px solid var(--artha-border, #eee);
      white-space: nowrap;
    }
    .preview-table th { font-weight: 600; background: var(--artha-surface-2, #f7f8fa); }
    .preview-table .num { text-align: right; font-variant-numeric: tabular-nums; }
    .preview-table tr.invalid td { opacity: 0.55; }
    .preview-table tr.error-row td {
      color: var(--artha-danger, #c0392b); font-size: 12px; padding-top: 0;
      border-bottom: 1px solid var(--artha-border, #eee); white-space: normal;
    }
    .footer-actions {
      display: flex; align-items: center; justify-content: space-between;
      gap: 12px; margin-top: 16px;
    }
    .importing { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 40px 0; }
  `],
})
export class ExpenseImportModal {
  private readonly api = inject(ExpensesApi);
  private readonly modalCtrl = inject(ModalController);
  private readonly notifier = inject(ConflictNotifierService);

  protected readonly stage = signal<Stage>('pick');
  protected readonly preview = signal<ImportPreviewResponse | null>(null);
  protected readonly error = signal<string | null>(null);

  protected async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // allow re-selecting the same file later
    if (!file) {
      return;
    }

    this.error.set(null);
    try {
      const result = await this.api.previewImport(file);
      this.preview.set(result);
      this.stage.set('preview');
    } catch (err) {
      this.error.set(this.messageFrom(err, 'Could not read that file.'));
    }
  }

  protected async confirm(): Promise<void> {
    const p = this.preview();
    if (!p) {
      return;
    }
    const rows: ImportConfirmRow[] = p.rows
      .filter((r) => r.valid && r.date && r.amount != null && r.category)
      .map((r) => ({
        date: r.date as string,
        amount: r.amount as number,
        category: r.category as string,
        account: r.account,
        note: r.note,
      }));

    if (rows.length === 0) {
      return;
    }

    this.stage.set('importing');
    try {
      const result = await this.api.confirmImport({ rows });
      await this.modalCtrl.dismiss(result, 'imported');
    } catch (err) {
      this.stage.set('preview');
      await this.notifier.notifyError(this.messageFrom(err, 'Import failed.'));
    }
  }

  protected reset(): void {
    this.preview.set(null);
    this.error.set(null);
    this.stage.set('pick');
  }

  protected dismiss(): void {
    void this.modalCtrl.dismiss(null, 'cancel');
  }

  protected downloadTemplate(): void {
    const csv =
      'Date,Amount,Category,Account,Note\n' +
      '2026-06-01,12.50,Groceries,Cash,Lunch\n';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'artha-import-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  private messageFrom(err: unknown, fallback: string): string {
    const detail = (err as { error?: { detail?: string } })?.error?.detail;
    return typeof detail === 'string' && detail.length > 0 ? detail : fallback;
  }
}
