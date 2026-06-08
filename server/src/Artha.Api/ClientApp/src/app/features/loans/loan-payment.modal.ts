import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonInput,
  IonItem,
  IonLabel,
  IonSegment,
  IonSegmentButton,
  IonSelect,
  IonSelectOption,
  IonTitle,
  IonToggle,
  IonToolbar,
  ModalController,
} from '@ionic/angular/standalone';
import { DEFAULT_ACCOUNT_ID } from '../../core/models/account.model';
import { LoanPaymentInput, LoanPaymentType } from '../../core/models/loan.model';
import { AccountsStore } from '../accounts/accounts.store';
import { CategoriesStore } from '../categories/categories.store';

/** What the loan detail page receives back when a payment is saved. */
export interface LoanPaymentResult {
  payment: LoanPaymentInput;
  /** When set, also log this payment as an expense. */
  expense: { categoryId: string; accountId: string } | null;
}

/** Bottom-sheet for recording a loan payment (EMI or prepayment). */
@Component({
  selector: 'artha-loan-payment-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    IonButton,
    IonButtons,
    IonContent,
    IonHeader,
    IonInput,
    IonItem,
    IonLabel,
    IonSegment,
    IonSegmentButton,
    IonSelect,
    IonSelectOption,
    IonTitle,
    IonToggle,
    IonToolbar,
  ],
  template: `
    <ion-header class="ion-no-border">
      <ion-toolbar>
        <ion-buttons slot="start"><ion-button (click)="cancel()">Cancel</ion-button></ion-buttons>
        <ion-title>Record payment</ion-title>
        <ion-buttons slot="end">
          <ion-button [strong]="true" [disabled]="!canSave()" (click)="save()">Save</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <form [formGroup]="form" class="wrap">
        <div class="seg">
          <ion-segment [value]="form.controls.type.value" (ionChange)="setType($event)">
            <ion-segment-button value="emi"><ion-label>EMI</ion-label></ion-segment-button>
            <ion-segment-button value="prepayment"><ion-label>Prepayment</ion-label></ion-segment-button>
          </ion-segment>
        </div>
        <p class="hint">
          @if (form.controls.type.value === 'prepayment') {
            Goes entirely to principal — shortens the loan.
          } @else {
            A regular installment — interest is taken first, the rest reduces principal.
          }
        </p>

        <div class="card">
          <ion-item lines="full">
            <ion-input label="Amount" labelPlacement="stacked" type="number" inputmode="decimal"
              step="0.01" min="0" formControlName="amount" aria-label="Amount"></ion-input>
          </ion-item>
          <ion-item lines="full">
            <div class="date-field">
              <span class="date-label">Date</span>
              <input class="date-input" type="date" formControlName="date" aria-label="Date" />
            </div>
          </ion-item>
          <ion-item lines="none">
            <ion-input label="Note" labelPlacement="stacked" placeholder="Optional"
              formControlName="note"></ion-input>
          </ion-item>
        </div>

        <!-- Also log as an expense -->
        <div class="card spaced">
          <ion-item [lines]="form.controls.addExpense.value ? 'full' : 'none'">
            <ion-toggle formControlName="addExpense" justify="space-between" labelPlacement="start">
              <ion-label>
                <h3>Also log as expense</h3>
                <p>So it shows in spending &amp; reports</p>
              </ion-label>
            </ion-toggle>
          </ion-item>
          @if (form.controls.addExpense.value) {
            <ion-item lines="full">
              <ion-select label="Category" labelPlacement="stacked" interface="popover"
                placeholder="Select" formControlName="categoryId">
                @for (cat of categories.active(); track cat.id) {
                  <ion-select-option [value]="cat.id">{{ cat.name }}</ion-select-option>
                }
              </ion-select>
            </ion-item>
            <ion-item lines="none">
              <ion-select label="Account" labelPlacement="stacked" interface="popover"
                placeholder="Select" formControlName="accountId">
                @for (acc of accounts.active(); track acc.id) {
                  <ion-select-option [value]="acc.id">{{ acc.name }}</ion-select-option>
                }
              </ion-select>
            </ion-item>
          }
        </div>
      </form>
    </ion-content>
  `,
  styles: [`
    ion-content { --background: var(--artha-bg); }
    .wrap { max-width: 560px; margin: 0 auto; padding: 12px 16px 24px; }
    .seg { padding: 4px 0 6px; }
    .hint { margin: 0 4px 12px; font-size: 12.5px; color: var(--artha-text-muted); }
    .card {
      background: var(--artha-surface); border: 1px solid var(--artha-border);
      border-radius: var(--artha-radius); box-shadow: var(--artha-shadow-sm); overflow: hidden;
    }
    .card.spaced { margin-top: 14px; }
    .card ion-item { --background: transparent; }
    .card h3 { margin: 0; font-size: 14px; font-weight: 600; }
    .card p { margin: 2px 0 0; font-size: 12px; color: var(--artha-text-muted); }
    .date-field { display: flex; flex-direction: column; gap: 4px; width: 100%; padding: 6px 0; }
    .date-label { font-size: 12px; color: var(--artha-text-muted); }
    .date-input { border: 0; outline: 0; background: transparent; font-size: 16px; color: var(--artha-text); font-family: inherit; }
  `],
})
export class LoanPaymentModal implements OnInit {
  private readonly modalCtrl = inject(ModalController);
  private readonly fb = inject(FormBuilder);
  protected readonly categories = inject(CategoriesStore);
  protected readonly accounts = inject(AccountsStore);

  /** Set by ModalController componentProps. */
  emi = 0;
  defaultAccountId: string | null = null;

  protected readonly busy = signal(false);

  protected readonly form = this.fb.nonNullable.group({
    amount: [null as number | null, [Validators.required, Validators.min(0.01)]],
    date: [todayIso(), Validators.required],
    type: ['emi' as LoanPaymentType, Validators.required],
    note: [''],
    addExpense: [true],
    categoryId: [null as string | null],
    accountId: [null as string | null],
  });

  async ngOnInit(): Promise<void> {
    if (this.emi > 0 && this.form.controls.amount.value == null) {
      this.form.patchValue({ amount: Math.round(this.emi) });
    }
    await Promise.all([this.categories.load(), this.accounts.load()]);
    this.form.patchValue({
      categoryId: this.bestCategoryId(),
      accountId: this.defaultAccountId ?? this.accounts.active()[0]?.id ?? DEFAULT_ACCOUNT_ID,
    });
  }

  /** True when the form is valid, including a category if logging an expense. */
  protected canSave(): boolean {
    if (this.form.invalid) return false;
    return !this.form.controls.addExpense.value || !!this.form.controls.categoryId.value;
  }

  protected setType(event: Event): void {
    const value = (event as CustomEvent<{ value: LoanPaymentType }>).detail?.value;
    if (value) {
      this.form.patchValue({ type: value });
    }
  }

  protected cancel(): void {
    void this.modalCtrl.dismiss(null, 'cancel');
  }

  protected save(): void {
    if (!this.canSave()) return;
    const raw = this.form.getRawValue();
    const payment: LoanPaymentInput = {
      amount: Number(raw.amount),
      date: raw.date,
      type: raw.type,
      note: raw.note?.trim() ? raw.note.trim() : null,
    };
    const expense =
      raw.addExpense && raw.categoryId
        ? { categoryId: raw.categoryId, accountId: raw.accountId || DEFAULT_ACCOUNT_ID }
        : null;
    const result: LoanPaymentResult = { payment, expense };
    void this.modalCtrl.dismiss(result, 'save');
  }

  /** Prefer a loan/EMI/bills-like category, else the first active one. */
  private bestCategoryId(): string | null {
    const cats = this.categories.active();
    const match = cats.find((c) => /loan|emi|bill|debt|mortgage/i.test(c.name));
    return (match ?? cats[0])?.id ?? null;
  }
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
