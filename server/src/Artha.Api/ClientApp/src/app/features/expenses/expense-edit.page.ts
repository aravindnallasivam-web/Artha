import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonDatetime,
  IonDatetimeButton,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonModal,
  IonSegment,
  IonSegmentButton,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonTextarea,
  IonTitle,
  IonToggle,
  IonToolbar,
} from '@ionic/angular/standalone';
import { ConflictNotifierService } from '../../core/feedback/conflict-notifier.service';
import { DEFAULT_ACCOUNT_ID } from '../../core/models/account.model';
import { TransactionType } from '../../core/models/expense.model';
import { AccountsStore } from '../accounts/accounts.store';
import { CategoryPickerComponent } from '../categories/category-picker.component';
import { CategoriesStore } from '../categories/categories.store';
import { ExpensesStore } from './expenses.store';

@Component({
  selector: 'artha-expense-edit',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    CategoryPickerComponent,
    IonBackButton,
    IonButton,
    IonButtons,
    IonContent,
    IonDatetime,
    IonDatetimeButton,
    IonHeader,
    IonIcon,
    IonItem,
    IonLabel,
    IonModal,
    IonSegment,
    IonSegmentButton,
    IonSelect,
    IonSelectOption,
    IonSpinner,
    IonTextarea,
    IonTitle,
    IonToggle,
    IonToolbar,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button defaultHref="/expenses"></ion-back-button>
        </ion-buttons>
        <ion-title>
          {{ mode() === 'edit' ? 'Edit ' : 'New ' }}{{ isIncome() ? 'income' : 'expense' }}
        </ion-title>
        @if (mode() === 'edit' && !isIncome()) {
          <ion-buttons slot="end">
            <ion-button (click)="makeRecurring()" aria-label="Make recurring">
              <ion-icon name="calendar-outline" slot="icon-only"></ion-icon>
            </ion-button>
          </ion-buttons>
        }
      </ion-toolbar>
    </ion-header>

    <ion-content>
      @if (loading()) {
        <div class="state"><ion-spinner></ion-spinner></div>
      } @else {
        <form [formGroup]="form" (ngSubmit)="save()">
          <div class="wrap">
            <!-- Expense / Income -->
            <ion-segment class="type-seg" [value]="form.controls.type.value" (ionChange)="onTypeChange($event)">
              <ion-segment-button value="expense"><ion-label>Expense</ion-label></ion-segment-button>
              <ion-segment-button value="income"><ion-label>Income</ion-label></ion-segment-button>
            </ion-segment>

            <!-- Amount hero -->
            <div class="amount" [class.amount--income]="isIncome()">
              <div class="amount-label">AMOUNT</div>
              <div class="amount-row">
                <span class="cur">{{ isIncome() ? '+' : '' }}{{ currencySymbol() }}</span>
                <input
                  class="amount-input"
                  type="number"
                  inputmode="decimal"
                  step="0.01"
                  min="0"
                  placeholder="0"
                  formControlName="amount"
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
              <ion-datetime-button datetime="datePicker" class="chip-dt"></ion-datetime-button>
              <ion-modal [keepContentsMounted]="true">
                <ng-template>
                  <ion-datetime
                    id="datePicker"
                    presentation="date"
                    formControlName="date"
                  ></ion-datetime>
                </ng-template>
              </ion-modal>
            </div>

            <!-- Category + Account -->
            <div class="section-label">Details</div>
            <div class="card">
              <ion-item lines="full">
                <artha-category-picker formControlName="categoryId"></artha-category-picker>
              </ion-item>
              <ion-item lines="none">
                <ion-select
                  label="Account"
                  labelPlacement="stacked"
                  formControlName="accountId"
                  interface="popover"
                  placeholder="Choose an account"
                >
                  @for (acc of accounts(); track acc.id) {
                    <ion-select-option [value]="acc.id">{{ acc.name }}</ion-select-option>
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
                  formControlName="note"
                ></ion-textarea>
              </ion-item>
            </div>

            <!-- Exclude -->
            <div class="card">
              <ion-item lines="none">
                <ion-toggle formControlName="excluded">
                  <div class="excl-title">Exclude from totals</div>
                  <div class="excl-sub">Refunds, transfers, settlements</div>
                </ion-toggle>
              </ion-item>
            </div>
          </div>

          <!-- Sticky save -->
          <div class="save-bar">
            <ion-button type="submit" expand="block" [disabled]="form.invalid || saving()">
              <ion-icon name="save-outline" slot="start"></ion-icon>
              {{ saving() ? 'Saving…' : (mode() === 'edit' ? 'Save changes' : (isIncome() ? 'Add income' : 'Add expense')) }}
            </ion-button>
          </div>
        </form>
      }
    </ion-content>
  `,
  styles: [`
    ion-content { --background: var(--artha-bg); }
    .state { display: flex; justify-content: center; padding: 48px; }
    .wrap { max-width: 640px; margin: 0 auto; padding: 8px 16px 16px; }

    .type-seg { margin: 6px 0 4px; }

    /* Amount hero */
    .amount { text-align: center; padding: 14px 0 22px; }
    .amount--income .amount-input,
    .amount--income .cur { color: var(--artha-positive); }
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

    /* Cards (match account-edit) */
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

    /* Sticky save */
    .save-bar {
      position: sticky; bottom: 0;
      background: var(--artha-bg);
      box-shadow: 0 -1px 0 var(--artha-border);
      padding: 12px 16px 14px;
      max-width: 640px; margin: 0 auto;
    }
    @media (max-width: 767.98px) {
      .save-bar { padding-bottom: 70px; } /* clear the mobile bottom tab bar */
    }
  `],
})
export class ExpenseEditPage implements OnInit {
  private readonly expensesStore = inject(ExpensesStore);
  protected readonly categoriesStore = inject(CategoriesStore);
  protected readonly accountsStore = inject(AccountsStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  private readonly notifier = inject(ConflictNotifierService);

  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly mode = signal<'create' | 'edit'>('create');
  protected readonly categories = computed(() => this.categoriesStore.active());
  protected readonly accounts = computed(() => this.accountsStore.active());

  protected readonly form = this.fb.nonNullable.group({
    date: [this.today(), Validators.required],
    amount: [0, [Validators.required, Validators.min(0.01)]],
    categoryId: ['', Validators.required],
    accountId: [DEFAULT_ACCOUNT_ID, Validators.required],
    note: [''],
    excluded: [false],
    type: ['expense' as TransactionType, Validators.required],
  });

  protected isIncome(): boolean {
    return this.form.controls.type.value === 'income';
  }

  protected onTypeChange(event: Event): void {
    const value = (event as CustomEvent<{ value: TransactionType }>).detail?.value;
    if (value) {
      this.form.patchValue({ type: value });
    }
  }

  private editingId: string | null = null;

  async ngOnInit(): Promise<void> {
    this.loading.set(true);
    try {
      const loads: Promise<void>[] = [];
      if (this.categoriesStore.items().length === 0) loads.push(this.categoriesStore.load());
      if (this.accountsStore.items().length === 0) loads.push(this.accountsStore.load());
      await Promise.all(loads);

      const id = this.route.snapshot.paramMap.get('id');
      if (id) {
        this.mode.set('edit');
        this.editingId = id;
        let expense = this.expensesStore.findById(id);
        if (!expense) {
          await this.expensesStore.load();
          expense = this.expensesStore.findById(id);
        }
        if (expense) {
          this.form.patchValue({
            date: expense.date,
            amount: expense.amount,
            categoryId: expense.categoryId,
            accountId: expense.accountId || DEFAULT_ACCOUNT_ID,
            note: expense.note ?? '',
            excluded: expense.excluded ?? false,
            type: expense.type ?? 'expense',
          });
        }
      } else {
        const firstCat = this.categories()[0];
        if (firstCat) {
          this.form.patchValue({ categoryId: firstCat.id });
        }
        const firstAcc = this.accounts()[0];
        if (firstAcc) {
          this.form.patchValue({ accountId: firstAcc.id });
        }
      }
    } finally {
      this.loading.set(false);
    }
  }

  /** Turn this expense into a planned (recurring) bill — prefill the planned
      editor with its amount, category, name and day, for the user to confirm. */
  protected makeRecurring(): void {
    const raw = this.form.getRawValue();
    const date = this.dateValue();
    const day = date ? Number(date.slice(8, 10)) : NaN;
    const catName = raw.categoryId ? this.categoriesStore.byId()[raw.categoryId]?.name ?? null : null;
    void this.router.navigate(['/planned-expenses/new'], {
      state: {
        name: raw.note?.trim() || catName || '',
        amount: raw.amount || null,
        categoryId: raw.categoryId || null,
        dayOfMonth: Number.isFinite(day) && day >= 1 && day <= 31 ? day : null,
        cycle: 'monthly',
      },
    });
  }

  async save(): Promise<void> {
    if (this.form.invalid) return;
    this.saving.set(true);
    const raw = this.form.getRawValue();
    const payload = {
      date: this.toDateOnly(raw.date),
      amount: Number(raw.amount),
      categoryId: raw.categoryId,
      accountId: raw.accountId,
      note: raw.note?.trim() || null,
      excluded: raw.excluded,
      type: raw.type,
    };
    try {
      if (this.editingId) {
        await this.expensesStore.update(this.editingId, payload);
      } else {
        await this.expensesStore.add(payload);
      }
      await this.router.navigate(['/expenses']);
    } catch (err) {
      await this.notifier.notifyError(
        this.editingId ? 'Could not save changes.' : 'Could not add expense.',
      );
    } finally {
      this.saving.set(false);
    }
  }

  /** Currency symbol for the selected account, e.g. ₹ / $ / €. */
  protected currencySymbol(): string {
    const acc = this.accountsStore.byId()[this.form.controls.accountId.value];
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
    this.form.patchValue({ date: this.daysAgo(days) });
  }

  private dateValue(): string {
    return this.toDateOnly(this.form.controls.date.value);
  }

  private daysAgo(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private toDateOnly(value: string): string {
    // ion-datetime returns "2026-05-15T00:00:00.000+00:00" sometimes; trim.
    return (value ?? '').slice(0, 10);
  }
}
