import { CurrencyPipe, DatePipe } from '@angular/common';
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
import { LoanUpsertRequest } from '../../core/models/loan.model';
import { AccountsStore } from '../accounts/accounts.store';
import { SettingsStore } from '../settings/settings.store';
import { addMonths, computeEmi } from './loan-math';
import { LoansStore } from './loans.store';

@Component({
  selector: 'artha-loan-edit',
  standalone: true,
  imports: [
    CurrencyPipe,
    DatePipe,
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
        <ion-buttons slot="start"><ion-back-button defaultHref="/loans"></ion-back-button></ion-buttons>
        <ion-title>{{ mode() === 'edit' ? 'Edit loan' : 'New loan' }}</ion-title>
        @if (mode() === 'edit') {
          <ion-buttons slot="end">
            <ion-button color="danger" (click)="remove()" aria-label="Delete loan">
              <ion-icon slot="icon-only" name="trash-outline"></ion-icon>
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
            <!-- Loan amount hero -->
            <div class="amount">
              <div class="amount-label">LOAN AMOUNT</div>
              <div class="amount-row">
                <span class="cur">{{ currencySymbol() }}</span>
                <input class="amount-input" type="number" inputmode="decimal" step="1" min="0"
                  placeholder="0" formControlName="principal" (focus)="selectAll($event)" aria-label="Loan amount" />
              </div>
            </div>

            <!-- Live EMI preview -->
            @if (previewEmi() > 0) {
              <div class="preview">
                <div class="pv">
                  <span class="pv-label">EMI</span>
                  <span class="pv-value">{{ previewEmi() | currency: cur() : 'symbol' : '1.0-0' }}/mo</span>
                </div>
                <div class="pv">
                  <span class="pv-label">Total interest</span>
                  <span class="pv-value">{{ previewInterest() | currency: cur() : 'symbol' : '1.0-0' }}</span>
                </div>
                <div class="pv">
                  <span class="pv-label">Payoff</span>
                  <span class="pv-value">{{ previewPayoff() | date: 'MMM yyyy' }}</span>
                </div>
              </div>
            }

            <div class="section-label">Loan</div>
            <div class="card">
              <ion-item lines="full">
                <ion-input label="Name" labelPlacement="stacked" placeholder="e.g. Home loan"
                  formControlName="name"></ion-input>
              </ion-item>
              <ion-item lines="none">
                <ion-input label="Lender" labelPlacement="stacked" placeholder="Optional · e.g. HDFC"
                  formControlName="lender"></ion-input>
              </ion-item>
            </div>

            <div class="section-label">Terms</div>
            <div class="card">
              <ion-item lines="full">
                <ion-input label="Interest rate (% / year)" labelPlacement="stacked" type="number"
                  inputmode="decimal" step="0.01" min="0" max="100" placeholder="e.g. 8.5"
                  formControlName="annualInterestRate"></ion-input>
              </ion-item>
              <ion-item lines="full">
                <ion-input label="Term (months)" labelPlacement="stacked" type="number"
                  inputmode="numeric" min="1" max="600" placeholder="e.g. 240"
                  formControlName="termMonths"></ion-input>
              </ion-item>
              <ion-item lines="none">
                <div class="date-field">
                  <span class="date-label">First EMI date</span>
                  <input class="date-input" type="date" formControlName="startDate" aria-label="First EMI date" />
                </div>
              </ion-item>
            </div>

            <div class="section-label">Payment</div>
            <div class="card">
              <ion-item lines="none">
                <ion-select label="Paid from account" labelPlacement="stacked" interface="popover"
                  placeholder="None" formControlName="accountId">
                  <ion-select-option [value]="null">None</ion-select-option>
                  @for (acc of accounts.active(); track acc.id) {
                    <ion-select-option [value]="acc.id">{{ acc.name }}</ion-select-option>
                  }
                </ion-select>
              </ion-item>
            </div>
          </div>

          <div class="save-bar">
            <ion-button type="submit" expand="block" [disabled]="form.invalid || saving()">
              <ion-icon name="save-outline" slot="start"></ion-icon>
              {{ saving() ? 'Saving…' : (mode() === 'edit' ? 'Save changes' : 'Add loan') }}
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

    .amount { text-align: center; padding: 14px 0 16px; }
    .amount-label { font-size: 11px; font-weight: 600; letter-spacing: 1.2px; color: var(--artha-text-subtle); }
    .amount-row { display: flex; align-items: center; justify-content: center; gap: 6px; margin-top: 8px; }
    .cur { font-size: 24px; font-weight: 700; color: var(--artha-text-muted); }
    .amount-input {
      border: 0; outline: 0; background: transparent; font-size: 42px; font-weight: 800; color: var(--artha-text);
      width: 8ch; max-width: 64vw; text-align: center; padding: 0; font-variant-numeric: tabular-nums;
    }
    .amount-input::placeholder { color: var(--artha-border-strong); }
    .amount-input::-webkit-outer-spin-button, .amount-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
    .amount-input { -moz-appearance: textfield; }

    .preview {
      display: flex; justify-content: space-around; gap: 8px;
      background: var(--artha-accent-tint); border-radius: var(--artha-radius); padding: 12px;
    }
    .pv { display: flex; flex-direction: column; align-items: center; gap: 2px; }
    .pv-label { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.4px; color: var(--artha-text-muted); }
    .pv-value { font-size: 14px; font-weight: 800; color: var(--artha-accent); font-variant-numeric: tabular-nums; }

    .section-label {
      font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.4px;
      color: var(--artha-text-subtle); margin: 16px 4px 8px;
    }
    .card {
      background: var(--artha-surface); border: 1px solid var(--artha-border);
      border-radius: var(--artha-radius); box-shadow: var(--artha-shadow-sm); overflow: hidden;
    }
    .card ion-item { --background: transparent; }

    .date-field { display: flex; flex-direction: column; gap: 4px; width: 100%; padding: 6px 0; }
    .date-label { font-size: 12px; color: var(--artha-text-muted); }
    .date-input {
      border: 0; outline: 0; background: transparent; font-size: 16px; color: var(--artha-text);
      font-family: inherit;
    }

    .save-bar {
      position: sticky; bottom: 0; background: var(--artha-bg); box-shadow: 0 -1px 0 var(--artha-border);
      padding: 12px 16px 14px; max-width: 640px; margin: 0 auto;
    }
    @media (max-width: 767.98px) { .save-bar { padding-bottom: 70px; } }
  `],
})
export class LoanEditPage implements OnInit {
  private readonly store = inject(LoansStore);
  protected readonly accounts = inject(AccountsStore);
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
    lender: [''],
    principal: [null as number | null, [Validators.required, Validators.min(1)]],
    annualInterestRate: [null as number | null, [Validators.required, Validators.min(0), Validators.max(100)]],
    termMonths: [null as number | null, [Validators.required, Validators.min(1), Validators.max(600)]],
    startDate: [todayIso(), Validators.required],
    accountId: [null as string | null],
  });

  private editingId: string | null = null;

  async ngOnInit(): Promise<void> {
    this.loading.set(true);
    void this.settings.load();
    try {
      await this.accounts.load();
      if (this.store.items().length === 0) {
        await this.store.load(true);
      }
      const id = this.route.snapshot.paramMap.get('id');
      if (id) {
        this.mode.set('edit');
        this.editingId = id;
        const loan = this.store.byId()[id];
        if (loan) {
          this.form.patchValue({
            name: loan.name,
            lender: loan.lender ?? '',
            principal: loan.principal,
            annualInterestRate: loan.annualInterestRate,
            termMonths: loan.termMonths,
            startDate: loan.startDate,
            accountId: loan.accountId,
          });
        }
      }
    } finally {
      this.loading.set(false);
    }
  }

  protected cur(): string {
    return this.settings.currency() || 'USD';
  }

  protected previewEmi(): number {
    const r = this.form.getRawValue();
    return computeEmi(Number(r.principal) || 0, Number(r.annualInterestRate) || 0, Number(r.termMonths) || 0);
  }

  protected previewInterest(): number {
    const r = this.form.getRawValue();
    const term = Number(r.termMonths) || 0;
    return Math.max(0, this.previewEmi() * term - (Number(r.principal) || 0));
  }

  protected previewPayoff(): string {
    const r = this.form.getRawValue();
    const term = Number(r.termMonths) || 1;
    return addMonths(r.startDate || todayIso(), term - 1);
  }

  protected selectAll(event: Event): void {
    (event.target as HTMLInputElement | null)?.select();
  }

  protected currencySymbol(): string {
    const code = this.settings.currency() || 'INR';
    try {
      const parts = new Intl.NumberFormat(undefined, { style: 'currency', currency: code }).formatToParts(0);
      return parts.find((p) => p.type === 'currency')?.value ?? code;
    } catch {
      return code;
    }
  }

  async save(): Promise<void> {
    if (this.form.invalid) return;
    this.saving.set(true);
    const raw = this.form.getRawValue();
    const payload: LoanUpsertRequest = {
      name: (raw.name ?? '').trim(),
      lender: raw.lender?.trim() ? raw.lender.trim() : null,
      principal: Number(raw.principal),
      annualInterestRate: Number(raw.annualInterestRate),
      termMonths: Number(raw.termMonths),
      startDate: raw.startDate,
      accountId: raw.accountId || null,
    };
    try {
      if (this.editingId) {
        await this.store.update(this.editingId, payload);
      } else {
        await this.store.add(payload);
      }
      await this.router.navigate(['/loans']);
    } catch {
      await this.notifier.notifyError(this.editingId ? 'Could not save changes.' : 'Could not add loan.');
    } finally {
      this.saving.set(false);
    }
  }

  async remove(): Promise<void> {
    if (!this.editingId) return;
    try {
      await this.store.remove(this.editingId);
      await this.router.navigate(['/loans']);
    } catch {
      await this.notifier.notifyError('Could not delete loan.');
    }
  }
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
