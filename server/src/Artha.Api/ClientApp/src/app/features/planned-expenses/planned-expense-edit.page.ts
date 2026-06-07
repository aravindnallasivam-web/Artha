import { DecimalPipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonInput,
  IonItem,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';
import { ConflictNotifierService } from '../../core/feedback/conflict-notifier.service';
import { PlannedCycle, PlannedExpenseUpsertRequest } from '../../core/models/planned-expense.model';
import { CategoriesStore } from '../categories/categories.store';
import { SettingsStore } from '../settings/settings.store';
import { PlannedExpensesStore } from './planned-expenses.store';

@Component({
  selector: 'artha-planned-expense-edit',
  standalone: true,
  imports: [
    DecimalPipe,
    ReactiveFormsModule,
    IonBackButton,
    IonButton,
    IonButtons,
    IonContent,
    IonHeader,
    IonIcon,
    IonInput,
    IonItem,
    IonSelect,
    IonSelectOption,
    IonSpinner,
    IonTitle,
    IonToolbar,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button defaultHref="/planned-expenses"></ion-back-button>
        </ion-buttons>
        <ion-title>{{ mode() === 'edit' ? 'Edit planned expense' : 'New planned expense' }}</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      @if (loading()) {
        <div class="state"><ion-spinner></ion-spinner></div>
      } @else {
        <form [formGroup]="form" (ngSubmit)="save()">
          <div class="wrap">
            <!-- Amount hero -->
            <div class="amount">
              <div class="amount-label">
                {{ form.controls.cycle.value === 'yearly' ? 'YEARLY AMOUNT' : 'MONTHLY AMOUNT' }}
              </div>
              <div class="amount-row">
                <span class="cur">{{ currencySymbol() }}</span>
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
              @if (form.controls.cycle.value === 'yearly' && form.controls.amount.value) {
                <div class="amount-sub">
                  ≈ {{ currencySymbol() }}{{ +form.controls.amount.value / 12 | number: '1.0-0' }} / month in reports
                </div>
              }
            </div>

            <!-- Billing cycle -->
            <div class="section-label">Billing cycle</div>
            <div class="chips">
              <button
                type="button"
                class="chip"
                [class.sel]="form.controls.cycle.value === 'monthly'"
                (click)="setCycle('monthly')"
              >Monthly</button>
              <button
                type="button"
                class="chip"
                [class.sel]="form.controls.cycle.value === 'yearly'"
                (click)="setCycle('yearly')"
              >Yearly</button>
            </div>

            <!-- Name -->
            <div class="section-label">Name</div>
            <div class="card">
              <ion-item lines="none">
                <ion-input
                  labelPlacement="stacked"
                  placeholder="e.g. Rent, Broadband"
                  formControlName="name"
                  aria-label="Name"
                ></ion-input>
              </ion-item>
            </div>

            <!-- Details -->
            <div class="section-label">Details</div>
            <div class="card">
              <ion-item lines="full">
                <ion-select
                  label="Category"
                  labelPlacement="stacked"
                  interface="popover"
                  placeholder="None"
                  formControlName="categoryId"
                >
                  <ion-select-option [value]="null">None</ion-select-option>
                  @for (cat of categories.active(); track cat.id) {
                    <ion-select-option [value]="cat.id">{{ cat.name }}</ion-select-option>
                  }
                </ion-select>
              </ion-item>
              <ion-item lines="none">
                <ion-input
                  label="Due day of month"
                  labelPlacement="stacked"
                  type="number"
                  inputmode="numeric"
                  min="1"
                  max="31"
                  placeholder="Optional · e.g. 1"
                  formControlName="dayOfMonth"
                ></ion-input>
              </ion-item>
            </div>
          </div>

          <!-- Sticky save -->
          <div class="save-bar">
            <ion-button type="submit" expand="block" [disabled]="form.invalid || saving()">
              <ion-icon name="save-outline" slot="start"></ion-icon>
              {{ saving() ? 'Saving…' : (mode() === 'edit' ? 'Save changes' : 'Add planned expense') }}
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

    /* Amount hero */
    .amount { text-align: center; padding: 14px 0 20px; }
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
    .amount-sub { margin-top: 8px; font-size: 12.5px; color: var(--artha-accent); font-weight: 600; }

    .section-label {
      font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.4px;
      color: var(--artha-text-subtle); margin: 16px 4px 8px;
    }

    /* Cycle chips */
    .chips { display: flex; gap: 8px; }
    .chip {
      flex: 1;
      border: 1px solid var(--artha-border); background: var(--artha-surface);
      color: var(--artha-text-muted); font-size: 14px; font-weight: 600;
      padding: 10px 16px; border-radius: 999px; cursor: pointer;
    }
    .chip.sel {
      background: var(--artha-accent); border-color: var(--artha-accent); color: #fff;
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
export class PlannedExpenseEditPage implements OnInit {
  private readonly store = inject(PlannedExpensesStore);
  protected readonly categories = inject(CategoriesStore);
  protected readonly settings = inject(SettingsStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  private readonly notifier = inject(ConflictNotifierService);

  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly mode = signal<'create' | 'edit'>('create');

  protected readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(60)]],
    amount: [null as number | null, [Validators.required, Validators.min(0.01)]],
    cycle: ['monthly' as PlannedCycle, Validators.required],
    categoryId: [null as string | null],
    dayOfMonth: [null as number | null, [Validators.min(1), Validators.max(31)]],
  });

  private editingId: string | null = null;

  async ngOnInit(): Promise<void> {
    this.loading.set(true);
    void this.settings.load();
    try {
      await this.categories.load();
      if (this.store.items().length === 0) {
        await this.store.load(true);
      }
      const id = this.route.snapshot.paramMap.get('id');
      if (id) {
        this.mode.set('edit');
        this.editingId = id;
        const item = this.store.byId()[id];
        if (item) {
          this.form.patchValue({
            name: item.name,
            amount: item.amount,
            cycle: item.cycle,
            categoryId: item.categoryId,
            dayOfMonth: item.dayOfMonth,
          });
        }
      }
    } finally {
      this.loading.set(false);
    }
  }

  protected setCycle(cycle: PlannedCycle): void {
    this.form.patchValue({ cycle });
  }

  protected selectAll(event: Event): void {
    (event.target as HTMLInputElement | null)?.select();
  }

  /** Currency symbol for the user's settings currency, e.g. ₹ / $ / €. */
  protected currencySymbol(): string {
    const code = this.settings.currency() || 'INR';
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

  async save(): Promise<void> {
    if (this.form.invalid) return;
    this.saving.set(true);
    const raw = this.form.getRawValue();
    const payload: PlannedExpenseUpsertRequest = {
      name: (raw.name ?? '').trim(),
      amount: Number(raw.amount),
      cycle: raw.cycle,
      categoryId: raw.categoryId || null,
      dayOfMonth: raw.dayOfMonth != null && raw.dayOfMonth !== ('' as unknown as number)
        ? Number(raw.dayOfMonth)
        : null,
    };
    try {
      if (this.editingId) {
        await this.store.update(this.editingId, payload);
      } else {
        await this.store.add(payload);
      }
      await this.router.navigate(['/planned-expenses']);
    } catch (err) {
      await this.notifier.notifyError(
        this.editingId ? 'Could not save changes.' : 'Could not add planned expense.',
      );
    } finally {
      this.saving.set(false);
    }
  }
}
