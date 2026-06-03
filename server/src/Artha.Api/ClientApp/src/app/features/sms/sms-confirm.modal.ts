import { Component, Input, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonInput,
  IonItem,
  IonLabel,
  IonNote,
  IonSelect,
  IonSelectOption,
  IonText,
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
    FormsModule,
    IonButton,
    IonButtons,
    IonContent,
    IonHeader,
    IonIcon,
    IonInput,
    IonItem,
    IonLabel,
    IonNote,
    IonSelect,
    IonSelectOption,
    IonText,
    IonTitle,
    IonToggle,
    IonToolbar,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-button (click)="dismiss()">Cancel</ion-button>
        </ion-buttons>
        <ion-title>Log expense?</ion-title>
        <ion-buttons slot="end">
          <ion-button
            strong="true"
            [disabled]="!canSave() || saving()"
            (click)="save()"
          >Save</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <p class="lead">
        Detected from a message by <strong>{{ parsed.sender || 'your bank' }}</strong>.
      </p>

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

      <ion-item>
        <ion-input
          label="Amount"
          labelPlacement="stacked"
          type="number"
          inputmode="decimal"
          [(ngModel)]="amount"
        ></ion-input>
      </ion-item>

      <ion-item>
        <ion-input
          label="Date"
          labelPlacement="stacked"
          type="date"
          [(ngModel)]="date"
        ></ion-input>
      </ion-item>

      <ion-item>
        <ion-select
          label="Category"
          labelPlacement="stacked"
          interface="action-sheet"
          [(ngModel)]="categoryId"
        >
          @for (c of categories(); track c.id) {
            <ion-select-option [value]="c.id">{{ c.name }}</ion-select-option>
          }
        </ion-select>
      </ion-item>

      <ion-item>
        <ion-select
          label="Account"
          labelPlacement="stacked"
          interface="action-sheet"
          [(ngModel)]="accountId"
        >
          @for (a of accounts(); track a.id) {
            <ion-select-option [value]="a.id">{{ a.name }}</ion-select-option>
          }
        </ion-select>
      </ion-item>

      <ion-item>
        <ion-input
          label="Note"
          labelPlacement="stacked"
          type="text"
          [(ngModel)]="note"
        ></ion-input>
      </ion-item>

      <ion-item>
        <ion-toggle [(ngModel)]="excluded">Exclude from spending totals</ion-toggle>
      </ion-item>

      @if (categories().length === 0 || accounts().length === 0) {
        <ion-text color="danger">
          <p class="warn">Add at least one category and account before logging expenses.</p>
        </ion-text>
      }

      <ion-note class="raw">{{ parsed.raw }}</ion-note>
    </ion-content>
  `,
  styles: [`
    .lead { margin: 0 0 12px; font-size: 14px; color: var(--artha-text-muted); }
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
    .warn { font-size: 13px; }
    .raw {
      display: block;
      margin-top: 16px;
      padding: 10px 12px;
      font-size: 12px;
      line-height: 1.4;
      background: var(--artha-surface-2);
      border-radius: 8px;
      color: var(--artha-text-muted);
      white-space: pre-wrap;
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
    this.amount = this.parsed.amount;
    this.date = this.parsed.date;
    this.note = this.parsed.merchant ?? this.parsed.sender ?? '';
  }

  protected canSave(): boolean {
    return this.amount > 0 && !!this.categoryId && !!this.accountId && !!this.date;
  }

  protected async save(): Promise<void> {
    if (!this.canSave()) {
      return;
    }
    this.saving.set(true);
    try {
      await this.expensesStore.add({
        date: this.date,
        amount: Number(this.amount),
        categoryId: this.categoryId,
        accountId: this.accountId,
        note: this.note?.trim() || null,
        excluded: this.excluded,
      });
      await this.modalCtrl.dismiss(null, 'saved');
    } catch {
      this.saving.set(false);
      await this.notifier.notifyError('Could not save the expense.');
    }
  }

  protected dismiss(): void {
    void this.modalCtrl.dismiss(null, 'cancel');
  }
}
