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
  IonInput,
  IonItem,
  IonLabel,
  IonModal,
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
import { AccountsStore } from '../accounts/accounts.store';
import { CategoriesStore } from '../categories/categories.store';
import { PlannedExpensesStore } from '../planned-expenses/planned-expenses.store';
import { ExpensesStore } from './expenses.store';

@Component({
  selector: 'artha-expense-edit',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    IonBackButton,
    IonButton,
    IonButtons,
    IonContent,
    IonDatetime,
    IonDatetimeButton,
    IonHeader,
    IonIcon,
    IonInput,
    IonItem,
    IonLabel,
    IonModal,
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
        <ion-title>{{ mode() === 'edit' ? 'Edit expense' : 'New expense' }}</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      @if (loading()) {
        <ion-spinner></ion-spinner>
      } @else {
        <form [formGroup]="form" (ngSubmit)="save()">
          <ion-item>
            <ion-input
              label="Amount"
              labelPlacement="floating"
              type="number"
              inputmode="decimal"
              step="0.01"
              formControlName="amount"
            ></ion-input>
          </ion-item>

          <ion-item>
            <ion-label>Date</ion-label>
            <ion-datetime-button datetime="datePicker" slot="end"></ion-datetime-button>
            <ion-modal [keepContentsMounted]="true">
              <ng-template>
                <ion-datetime
                  id="datePicker"
                  presentation="date"
                  formControlName="date"
                ></ion-datetime>
              </ng-template>
            </ion-modal>
          </ion-item>

          <ion-item>
            <ion-select
              label="Category"
              labelPlacement="floating"
              formControlName="categoryId"
              interface="popover"
            >
              @for (cat of categories(); track cat.id) {
                <ion-select-option [value]="cat.id">{{ cat.name }}</ion-select-option>
              }
            </ion-select>
          </ion-item>

          <ion-item>
            <ion-select
              label="Account"
              labelPlacement="floating"
              formControlName="accountId"
              interface="popover"
            >
              @for (acc of accounts(); track acc.id) {
                <ion-select-option [value]="acc.id">{{ acc.name }}</ion-select-option>
              }
            </ion-select>
          </ion-item>

          @if (plannedBills().length > 0) {
            <ion-item>
              <ion-select
                label="Linked planned bill (optional)"
                labelPlacement="floating"
                formControlName="plannedExpenseId"
                interface="popover"
                placeholder="Not linked"
                (ionChange)="onPlannedSelected()"
              >
                <ion-select-option [value]="null">Not linked</ion-select-option>
                @for (bill of plannedBills(); track bill.id) {
                  <ion-select-option [value]="bill.id">{{ bill.name }}</ion-select-option>
                }
              </ion-select>
            </ion-item>
            <p class="hint">Marks this as a payment for a planned bill (rent, broadband…) so Reports can track it as paid.</p>
          }

          <ion-item>
            <ion-toggle formControlName="excluded">Exclude from totals</ion-toggle>
          </ion-item>
          <p class="hint">Won't count toward your spending (e.g. refunds, transfers, settlements).</p>

          <ion-item>
            <ion-textarea
              label="Note (optional)"
              labelPlacement="floating"
              rows="3"
              formControlName="note"
            ></ion-textarea>
          </ion-item>

          <div class="actions">
            <ion-button type="submit" expand="block" [disabled]="form.invalid || saving()">
              <ion-icon name="save-outline" slot="start"></ion-icon>
              {{ saving() ? 'Saving…' : (mode() === 'edit' ? 'Save changes' : 'Add expense') }}
            </ion-button>
          </div>
        </form>
      }
    </ion-content>
  `,
  styles: [`
    .actions { margin-top: 24px; }
    .hint {
      margin: 6px 16px 0;
      font-size: 12px;
      color: var(--ion-color-medium, #6b7280);
    }
  `],
})
export class ExpenseEditPage implements OnInit {
  private readonly expensesStore = inject(ExpensesStore);
  protected readonly categoriesStore = inject(CategoriesStore);
  protected readonly accountsStore = inject(AccountsStore);
  private readonly plannedStore = inject(PlannedExpensesStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  private readonly notifier = inject(ConflictNotifierService);

  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly mode = signal<'create' | 'edit'>('create');
  protected readonly categories = computed(() => this.categoriesStore.active());
  protected readonly accounts = computed(() => this.accountsStore.active());
  protected readonly plannedBills = computed(() => this.plannedStore.active());

  protected readonly form = this.fb.nonNullable.group({
    date: [this.today(), Validators.required],
    amount: [0, [Validators.required, Validators.min(0.01)]],
    categoryId: ['', Validators.required],
    accountId: [DEFAULT_ACCOUNT_ID, Validators.required],
    note: [''],
    excluded: [false],
    plannedExpenseId: [null as string | null],
  });

  private editingId: string | null = null;

  async ngOnInit(): Promise<void> {
    this.loading.set(true);
    try {
      const loads: Promise<void>[] = [];
      if (this.categoriesStore.items().length === 0) loads.push(this.categoriesStore.load());
      if (this.accountsStore.items().length === 0) loads.push(this.accountsStore.load());
      loads.push(this.plannedStore.load());
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
            plannedExpenseId: expense.plannedExpenseId ?? null,
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
      plannedExpenseId: raw.plannedExpenseId || null,
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

  /**
   * When a planned bill is chosen, prefill the amount and category from it
   * (still editable) so logging a recurring payment is one tap.
   */
  protected onPlannedSelected(): void {
    const id = this.form.controls.plannedExpenseId.value;
    if (!id) return;
    const bill = this.plannedStore.byId()[id];
    if (!bill) return;
    const patch: { amount: number; categoryId?: string } = { amount: bill.amount };
    if (bill.categoryId && this.categories().some((c) => c.id === bill.categoryId)) {
      patch.categoryId = bill.categoryId;
    }
    this.form.patchValue(patch);
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private toDateOnly(value: string): string {
    // ion-datetime returns "2026-05-15T00:00:00.000+00:00" sometimes; trim.
    return (value ?? '').slice(0, 10);
  }
}
