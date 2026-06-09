import { DecimalPipe } from '@angular/common';
import { Component, Input, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonDatetime,
  IonDatetimeButton,
  IonHeader,
  IonIcon,
  IonItem,
  IonModal,
  IonNote,
  IonSelect,
  IonSelectOption,
  IonText,
  IonTextarea,
  IonTitle,
  IonToggle,
  IonToolbar,
  ModalController,
} from '@ionic/angular/standalone';
import { ConflictNotifierService } from '../../core/feedback/conflict-notifier.service';
import { Expense } from '../../core/models/expense.model';
import { AccountsStore } from '../accounts/accounts.store';
import { CategoriesStore } from '../categories/categories.store';
import { ExpensesStore } from '../expenses/expenses.store';
import { ParsedExpense } from './sms-parser';

/**
 * Confirm-before-save dialog for an expense detected in a bank SMS. Everything
 * is pre-filled from the parsed message but fully editable; nothing is written
 * until the user taps Save.
 */
@Component({
  selector: 'artha-sms-confirm',
  standalone: true,
  imports: [
    DecimalPipe,
    FormsModule,
    IonButton,
    IonButtons,
    IonContent,
    IonDatetime,
    IonDatetimeButton,
    IonHeader,
    IonIcon,
    IonItem,
    IonModal,
    IonNote,
    IonSelect,
    IonSelectOption,
    IonText,
    IonTextarea,
    IonTitle,
    IonToggle,
    IonToolbar,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-button (click)="dismiss()">{{ canDismiss ? 'Back' : 'Cancel' }}</ion-button>
        </ion-buttons>
        <ion-title>
          {{ mode === 'edit'
            ? (isIncome() ? 'Edit income' : 'Edit expense')
            : (isIncome() ? 'Log income?' : 'Log expense?') }}
        </ion-title>
        @if (canDismiss) {
          <ion-buttons slot="end">
            <ion-button color="danger" (click)="discard()">Dismiss</ion-button>
          </ion-buttons>
        }
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <form (ngSubmit)="save()">
        <div class="wrap">
          <p class="lead">
            Detected from a message by <strong>{{ parsed.sender || 'your bank' }}</strong>.
            @if (parsed.sender) {
              <button type="button" class="ignore-link" (click)="ignoreSender()">Ignore sender</button>
            }
          </p>

          <!-- Original SMS, so you can see what's being logged. -->
          <ion-note class="raw">{{ parsed.raw }}</ion-note>

          @if (duplicate) {
            <div class="dupe" role="alert">
              <ion-icon name="alert-circle-outline" aria-hidden="true"></ion-icon>
              <div>
                <p class="dupe-title">Possible duplicate</p>
                <p class="dupe-body">
                  An expense for the same amount is already logged on
                  {{ duplicate.date }}@if (duplicate.note) { — “{{ duplicate.note }}”}.
                  Save only if this is a separate transaction.
                </p>
              </div>
            </div>
          }

          <!-- Amount hero -->
          <div class="amount">
            <div class="amount-label">AMOUNT</div>
            <div class="amount-row">
              <span class="cur">{{ currencySymbol() }}</span>
              <input
                class="amount-input"
                type="number"
                inputmode="decimal"
                step="0.01"
                min="0"
                placeholder="0"
                [(ngModel)]="amount"
                [ngModelOptions]="{ standalone: true }"
                (focus)="selectAll($event)"
                aria-label="Amount"
              />
            </div>
          </div>

          <!-- Date -->
          <div class="section-label">Date</div>
          <div class="chips">
            <button type="button" class="chip" [class.sel]="isToday()" (click)="setDate(0)">
              Today
            </button>
            <button type="button" class="chip" [class.sel]="isYesterday()" (click)="setDate(1)">
              Yesterday
            </button>
            <ion-datetime-button datetime="smsDatePicker" class="chip-dt"></ion-datetime-button>
            <ion-modal [keepContentsMounted]="true">
              <ng-template>
                <ion-datetime
                  id="smsDatePicker"
                  presentation="date"
                  [(ngModel)]="date"
                  [ngModelOptions]="{ standalone: true }"
                ></ion-datetime>
              </ng-template>
            </ion-modal>
          </div>

          <!-- Category + Account -->
          <div class="section-label">Details</div>
          <div class="card">
            <ion-item lines="full">
              <ion-select
                label="Category"
                labelPlacement="stacked"
                interface="popover"
                placeholder="Choose a category"
                [(ngModel)]="categoryId"
                [ngModelOptions]="{ standalone: true }"
              >
                @for (c of categories(); track c.id) {
                  <ion-select-option [value]="c.id">{{ c.name }}</ion-select-option>
                }
              </ion-select>
            </ion-item>
            <ion-item lines="none">
              <ion-select
                label="Account"
                labelPlacement="stacked"
                interface="popover"
                placeholder="Choose an account"
                [(ngModel)]="accountId"
                [ngModelOptions]="{ standalone: true }"
              >
                @for (a of accounts(); track a.id) {
                  <ion-select-option [value]="a.id">{{ a.name }}</ion-select-option>
                }
              </ion-select>
            </ion-item>
          </div>

          <!-- Note -->
          <div class="section-label">Note</div>
          <div class="card">
            <ion-item lines="none">
              <ion-textarea
                label="Optional"
                labelPlacement="stacked"
                rows="2"
                autoGrow="true"
                placeholder="What was this for?"
                [(ngModel)]="note"
                [ngModelOptions]="{ standalone: true }"
              ></ion-textarea>
            </ion-item>
          </div>

          <!-- Exclude -->
          <div class="card">
            <ion-item lines="none">
              <ion-toggle [(ngModel)]="excluded" [ngModelOptions]="{ standalone: true }">
                <div class="excl-title">Exclude from totals</div>
                <div class="excl-sub">Refunds, transfers, settlements</div>
              </ion-toggle>
            </ion-item>
          </div>

          @if (categories().length === 0 || accounts().length === 0) {
            <ion-text color="danger">
              <p class="warn">Add at least one category and account before logging expenses.</p>
            </ion-text>
          }

          @if (parsed.balance != null) {
            <ion-note class="bal">
              Balance in SMS: {{ parsed.balance | number: '1.0-2' }} — the account's balance will update to this.
            </ion-note>
          }
        </div>

        <!-- Sticky save -->
        <div class="save-bar">
          <ion-button type="submit" expand="block" [disabled]="!canSave() || saving()">
            <ion-icon name="save-outline" slot="start"></ion-icon>
            {{ saving() ? 'Saving…' : (mode === 'edit' ? 'Save changes' : (isIncome() ? 'Add income' : 'Add expense')) }}
          </ion-button>
        </div>
      </form>
    </ion-content>
  `,
  styles: [`
    ion-content { --background: var(--artha-bg); }
    .wrap { max-width: 640px; margin: 0 auto; padding: 8px 16px 16px; }

    .lead { margin: 0 0 12px; font-size: 14px; color: var(--artha-text-muted); }
    .ignore-link {
      margin-left: 8px; padding: 0; background: none; border: 0; cursor: pointer;
      color: var(--artha-negative); font-size: 13px; font-weight: 600; text-decoration: underline;
    }
    .dupe {
      display: flex;
      gap: 10px;
      align-items: flex-start;
      margin: 0 0 14px;
      padding: 12px 14px;
      border-radius: 10px;
      background: var(--artha-warning-tint, #fef3c7);
      border: 1px solid var(--artha-warning, #f59e0b);
    }
    .dupe ion-icon { font-size: 20px; color: var(--artha-warning, #f59e0b); flex-shrink: 0; }
    .dupe-title { margin: 0 0 2px; font-size: 13px; font-weight: 700; color: var(--artha-text); }
    .dupe-body { margin: 0; font-size: 12.5px; line-height: 1.4; color: var(--artha-text-muted); }

    /* Amount hero */
    .amount { text-align: center; padding: 6px 0 18px; }
    .amount-label {
      font-size: 11px; font-weight: 600; letter-spacing: 1.2px;
      color: var(--artha-text-subtle);
    }
    .amount-row {
      display: flex; align-items: center; justify-content: center; gap: 6px;
      margin-top: 8px;
    }
    .cur { font-size: 26px; font-weight: 700; color: var(--artha-text-muted); }
    .amount-input {
      border: 0; outline: 0; background: transparent;
      font-size: 46px; font-weight: 800; color: var(--artha-text);
      width: 7ch; max-width: 60vw; text-align: center; padding: 0;
      font-variant-numeric: tabular-nums;
    }
    .amount-input::placeholder { color: var(--artha-border-strong); }
    .amount-input::-webkit-outer-spin-button,
    .amount-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
    .amount-input { -moz-appearance: textfield; }

    .section-label {
      font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.4px;
      color: var(--artha-text-subtle); margin: 16px 4px 8px;
    }

    /* Date chips */
    .chips { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .chip {
      border: 1px solid var(--artha-border); background: var(--artha-surface);
      color: var(--artha-text-muted); font-size: 13px; font-weight: 600;
      padding: 8px 16px; border-radius: 999px; cursor: pointer;
    }
    .chip.sel {
      background: var(--artha-accent); border-color: var(--artha-accent); color: #fff;
    }
    .chip-dt {
      --background: var(--artha-surface);
      --color: var(--artha-text-muted);
      border: 1px solid var(--artha-border); border-radius: 999px;
    }

    /* Cards */
    .card {
      background: var(--artha-surface);
      border: 1px solid var(--artha-border);
      border-radius: var(--artha-radius);
      box-shadow: var(--artha-shadow-sm);
      overflow: hidden;
    }
    .card ion-item { --background: transparent; }
    .excl-title { font-size: 14px; color: var(--artha-text); }
    .excl-sub { font-size: 12px; color: var(--artha-text-muted); margin-top: 2px; }

    .bal { display: block; margin-top: 14px; font-size: 12.5px; color: var(--artha-accent); font-weight: 600; }
    .warn { font-size: 13px; }
    .raw {
      display: block;
      margin: 0 0 4px;
      padding: 10px 12px;
      font-size: 12px;
      line-height: 1.4;
      background: var(--artha-surface-2);
      border-radius: 8px;
      color: var(--artha-text-muted);
      white-space: pre-wrap;
    }

    /* Sticky save */
    .save-bar {
      position: sticky; bottom: 0;
      background: var(--artha-bg);
      box-shadow: 0 -1px 0 var(--artha-border);
      padding: 12px 16px 14px;
      max-width: 640px; margin: 0 auto;
    }
  `],
})
export class SmsConfirmModal implements OnInit {
  private readonly modalCtrl = inject(ModalController);
  private readonly categoriesStore = inject(CategoriesStore);
  private readonly accountsStore = inject(AccountsStore);
  private readonly expensesStore = inject(ExpensesStore);
  private readonly notifier = inject(ConflictNotifierService);

  /** Parsed SMS — required input. */
  @Input({ required: true }) parsed!: ParsedExpense;
  /** An already-logged expense this SMS likely duplicates, if any. */
  @Input() duplicate: Expense | null = null;
  /** Pre-resolved best-guess category id (may be empty). */
  @Input() categoryId = '';
  /** Pre-resolved default account id (may be empty). */
  @Input() accountId = '';
  /**
   * 'create' (default): Save writes the expense and dismisses with role 'saved'.
   * 'edit': used as the per-row editor in bulk review — Save returns the edited
   * fields with role 'edited' and writes nothing.
   */
  @Input() mode: 'create' | 'edit' = 'create';
  @Input() initialAmount?: number;
  @Input() initialDate?: string;
  @Input() initialNote?: string;
  @Input() initialExcluded?: boolean;
  /** When true (opened from the pending queue), show a Dismiss action that
      drops the item without logging it (dismisses with role 'dismiss'). */
  @Input() canDismiss = false;

  protected amount = 0;
  protected date = '';
  protected note = '';
  protected excluded = false;
  protected readonly saving = signal(false);

  protected readonly categories = () =>
    this.categoriesStore.items().filter((c) => !c.archived);
  protected readonly accounts = () =>
    this.accountsStore.items().filter((a) => !a.archived);

  ngOnInit(): void {
    this.amount = this.initialAmount ?? this.parsed.amount;
    this.date = this.initialDate ?? this.parsed.date;
    this.note = this.initialNote ?? (this.parsed.merchant ?? this.parsed.sender ?? '');
    this.excluded = this.initialExcluded ?? false;
  }

  protected canSave(): boolean {
    return this.amount > 0 && !!this.categoryId && !!this.accountId && !!this.date;
  }

  protected async save(): Promise<void> {
    if (!this.canSave()) {
      return;
    }
    // Bulk-review row editor: return the edited values, don't persist here.
    if (this.mode === 'edit') {
      await this.modalCtrl.dismiss(
        {
          amount: Number(this.amount),
          date: this.dateValue(),
          categoryId: this.categoryId,
          accountId: this.accountId,
          note: this.note?.trim() || null,
          excluded: this.excluded,
        },
        'edited',
      );
      return;
    }
    this.saving.set(true);
    try {
      await this.expensesStore.add({
        date: this.dateValue(),
        amount: Number(this.amount),
        categoryId: this.categoryId,
        accountId: this.accountId,
        note: this.note?.trim() || null,
        excluded: this.excluded,
        type: this.parsed.type,
      });
      // Return the chosen account + category so the capture service can learn
      // the SMS→account and merchant→category mappings for next time.
      await this.modalCtrl.dismiss(
        { accountId: this.accountId, categoryId: this.categoryId },
        'saved',
      );
    } catch {
      this.saving.set(false);
      await this.notifier.notifyError('Could not save the expense.');
    }
  }

  protected isIncome(): boolean {
    return this.parsed?.type === 'income';
  }

  protected dismiss(): void {
    void this.modalCtrl.dismiss(null, 'cancel');
  }

  /** Drop this detected expense from the queue without logging it. */
  protected discard(): void {
    void this.modalCtrl.dismiss(null, 'dismiss');
  }

  /** Stop prompting for this sender; the caller adds it to the ignore list. */
  protected ignoreSender(): void {
    void this.modalCtrl.dismiss(null, 'ignore');
  }

  /** Currency symbol for the selected account, e.g. ₹ / $ / €. */
  protected currencySymbol(): string {
    const acc = this.accountsStore.byId()[this.accountId];
    const code = acc?.currency || 'INR';
    try {
      const parts = new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: code,
      }).formatToParts(0);
      return parts.find((p) => p.type === 'currency')?.value ?? code;
    } catch {
      return code;
    }
  }

  protected selectAll(event: Event): void {
    (event.target as HTMLInputElement | null)?.select();
  }

  protected isToday(): boolean {
    return this.dateValue() === this.today();
  }

  protected isYesterday(): boolean {
    return this.dateValue() === this.daysAgo(1);
  }

  protected setDate(days: number): void {
    this.date = this.daysAgo(days);
  }

  /** The bound date trimmed to YYYY-MM-DD (ion-datetime can emit a full ISO). */
  private dateValue(): string {
    return (this.date ?? '').slice(0, 10);
  }

  private daysAgo(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }
}
