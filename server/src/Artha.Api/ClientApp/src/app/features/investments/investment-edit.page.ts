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
  IonTextarea,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';
import { ConflictNotifierService } from '../../core/feedback/conflict-notifier.service';
import {
  INVESTMENT_TYPE_LABELS,
  INVESTMENT_TYPE_OPTIONS,
  InvestmentType,
  InvestmentUpsertRequest,
} from '../../core/models/investment.model';
import { InvestmentsStore } from './investments.store';

// Which optional fields are shown per type, and which of those are required.
// Required fields are always a subset of the visible ones, so a hidden field
// never blocks the form.
const VISIBLE: Record<InvestmentType, string[]> = {
  recurring_deposit: [
    'investedAmount', 'currentValue', 'interestRate', 'installmentAmount',
    'startDate', 'maturityDate', 'institution',
  ],
  fixed_deposit: [
    'investedAmount', 'currentValue', 'interestRate',
    'startDate', 'maturityDate', 'institution', 'policyOrAccountNumber',
  ],
  mutual_fund: ['investedAmount', 'currentValue', 'institution'],
  insurance_policy: [
    'currentValue', 'installmentAmount', 'maturityDate',
    'institution', 'policyOrAccountNumber',
  ],
};

const REQUIRED: Record<InvestmentType, string[]> = {
  recurring_deposit: ['installmentAmount', 'interestRate', 'maturityDate'],
  fixed_deposit: ['interestRate', 'maturityDate'],
  mutual_fund: ['investedAmount', 'currentValue'],
  insurance_policy: ['policyOrAccountNumber'],
};

// Controls whose validators toggle as the type changes.
const TOGGLEABLE = [
  'investedAmount', 'currentValue', 'interestRate', 'installmentAmount',
  'startDate', 'maturityDate', 'policyOrAccountNumber',
] as const;

@Component({
  selector: 'artha-investment-edit',
  standalone: true,
  imports: [
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
    IonTextarea,
    IonTitle,
    IonToolbar,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button defaultHref="/investments"></ion-back-button>
        </ion-buttons>
        <ion-title>{{ mode() === 'edit' ? 'Edit investment' : 'New investment' }}</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      @if (loading()) {
        <ion-spinner></ion-spinner>
      } @else {
        <form [formGroup]="form" (ngSubmit)="save()">
          <ion-item>
            <ion-select
              label="Type"
              labelPlacement="floating"
              formControlName="type"
              interface="popover"
            >
              @for (t of typeOptions; track t) {
                <ion-select-option [value]="t">{{ typeLabel(t) }}</ion-select-option>
              }
            </ion-select>
          </ion-item>

          <ion-item>
            <ion-input
              label="Name"
              labelPlacement="floating"
              type="text"
              formControlName="name"
              placeholder="e.g. SBI RD 2026"
            ></ion-input>
          </ion-item>

          <ion-item>
            <ion-input
              label="Currency"
              labelPlacement="floating"
              type="text"
              maxlength="3"
              formControlName="currency"
              placeholder="INR"
            ></ion-input>
          </ion-item>

          @if (show('institution')) {
            <ion-item>
              <ion-input
                [label]="institutionLabel()"
                labelPlacement="floating"
                type="text"
                formControlName="institution"
              ></ion-input>
            </ion-item>
          }

          @if (show('policyOrAccountNumber')) {
            <ion-item>
              <ion-input
                [label]="policyLabel()"
                labelPlacement="floating"
                type="text"
                formControlName="policyOrAccountNumber"
              ></ion-input>
            </ion-item>
          }

          @if (show('investedAmount')) {
            <ion-item>
              <ion-input
                label="Amount invested"
                labelPlacement="floating"
                type="number"
                inputmode="decimal"
                step="0.01"
                formControlName="investedAmount"
              ></ion-input>
            </ion-item>
          }

          @if (show('currentValue')) {
            <ion-item>
              <ion-input
                [label]="currentValueLabel()"
                labelPlacement="floating"
                type="number"
                inputmode="decimal"
                step="0.01"
                formControlName="currentValue"
              ></ion-input>
            </ion-item>
          }

          @if (show('installmentAmount')) {
            <ion-item>
              <ion-input
                [label]="installmentLabel()"
                labelPlacement="floating"
                type="number"
                inputmode="decimal"
                step="0.01"
                formControlName="installmentAmount"
              ></ion-input>
            </ion-item>
          }

          @if (show('interestRate')) {
            <ion-item>
              <ion-input
                label="Interest rate (% p.a.)"
                labelPlacement="floating"
                type="number"
                inputmode="decimal"
                step="0.01"
                formControlName="interestRate"
              ></ion-input>
            </ion-item>
          }

          @if (show('startDate')) {
            <ion-item>
              <ion-input
                label="Start date"
                labelPlacement="floating"
                type="date"
                formControlName="startDate"
              ></ion-input>
            </ion-item>
          }

          @if (show('maturityDate')) {
            <ion-item>
              <ion-input
                [label]="maturityLabel()"
                labelPlacement="floating"
                type="date"
                formControlName="maturityDate"
              ></ion-input>
            </ion-item>
          }

          <ion-item>
            <ion-input
              label="Color (hex, optional)"
              labelPlacement="floating"
              type="text"
              placeholder="#22c55e"
              formControlName="color"
            ></ion-input>
          </ion-item>

          <ion-item>
            <ion-textarea
              label="Note (optional)"
              labelPlacement="floating"
              autoGrow="true"
              formControlName="note"
            ></ion-textarea>
          </ion-item>

          <div class="actions">
            <ion-button type="submit" expand="block" [disabled]="form.invalid || saving()">
              <ion-icon name="save-outline" slot="start"></ion-icon>
              {{ saving() ? 'Saving…' : (mode() === 'edit' ? 'Save changes' : 'Add investment') }}
            </ion-button>
          </div>
        </form>
      }
    </ion-content>
  `,
  styles: [`
    .actions { margin-top: 24px; }
  `],
})
export class InvestmentEditPage implements OnInit {
  private readonly store = inject(InvestmentsStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  private readonly notifier = inject(ConflictNotifierService);

  protected readonly typeOptions = INVESTMENT_TYPE_OPTIONS;
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly mode = signal<'create' | 'edit'>('create');
  protected readonly currentType = signal<InvestmentType>('recurring_deposit');

  protected readonly form = this.fb.group({
    name: this.fb.nonNullable.control('', [Validators.required, Validators.maxLength(80)]),
    type: this.fb.nonNullable.control<InvestmentType>('recurring_deposit', Validators.required),
    currency: this.fb.nonNullable.control('INR', [
      Validators.required, Validators.minLength(3), Validators.maxLength(3),
    ]),
    institution: this.fb.nonNullable.control(''),
    policyOrAccountNumber: this.fb.nonNullable.control(''),
    investedAmount: this.fb.control<number | null>(null),
    currentValue: this.fb.control<number | null>(null),
    interestRate: this.fb.control<number | null>(null),
    installmentAmount: this.fb.control<number | null>(null),
    startDate: this.fb.nonNullable.control(''),
    maturityDate: this.fb.nonNullable.control(''),
    color: this.fb.nonNullable.control(''),
    note: this.fb.nonNullable.control(''),
  });

  private editingId: string | null = null;

  async ngOnInit(): Promise<void> {
    this.form.controls.type.valueChanges.subscribe((t) => {
      this.currentType.set(t);
      this.applyTypeValidators(t);
    });

    this.loading.set(true);
    try {
      if (this.store.items().length === 0) {
        await this.store.load(true);
      }
      const id = this.route.snapshot.paramMap.get('id');
      if (id) {
        this.mode.set('edit');
        this.editingId = id;
        const inv = this.store.byId()[id];
        if (inv) {
          this.form.patchValue({
            name: inv.name,
            type: inv.type,
            currency: inv.currency,
            institution: inv.institution ?? '',
            policyOrAccountNumber: inv.policyOrAccountNumber ?? '',
            investedAmount: inv.investedAmount,
            currentValue: inv.currentValue,
            interestRate: inv.interestRate,
            installmentAmount: inv.installmentAmount,
            startDate: inv.startDate ?? '',
            maturityDate: inv.maturityDate ?? '',
            color: inv.color ?? '',
            note: inv.note ?? '',
          });
        }
      }
      // Apply validators for the (possibly patched) current type.
      this.currentType.set(this.form.controls.type.value);
      this.applyTypeValidators(this.form.controls.type.value);
    } finally {
      this.loading.set(false);
    }
  }

  async save(): Promise<void> {
    if (this.form.invalid) return;
    this.saving.set(true);
    const raw = this.form.getRawValue();
    const payload: InvestmentUpsertRequest = {
      name: raw.name.trim(),
      type: raw.type,
      currency: raw.currency.trim().toUpperCase(),
      investedAmount: this.num(raw.investedAmount),
      currentValue: this.num(raw.currentValue),
      interestRate: this.optionalNum(raw.interestRate),
      installmentAmount: this.optionalNum(raw.installmentAmount),
      startDate: raw.startDate?.trim() || null,
      maturityDate: raw.maturityDate?.trim() || null,
      institution: raw.institution?.trim() || null,
      policyOrAccountNumber: raw.policyOrAccountNumber?.trim() || null,
      note: raw.note?.trim() || null,
      color: raw.color?.trim() || null,
      icon: null,
    };
    try {
      if (this.editingId) {
        await this.store.update(this.editingId, payload);
      } else {
        await this.store.add(payload);
      }
      await this.router.navigate(['/investments']);
    } catch (err) {
      await this.notifier.notifyError(
        this.editingId ? 'Could not save changes.' : 'Could not add investment.',
      );
    } finally {
      this.saving.set(false);
    }
  }

  protected show(field: string): boolean {
    return VISIBLE[this.currentType()].includes(field);
  }

  protected typeLabel(t: InvestmentType): string {
    return INVESTMENT_TYPE_LABELS[t];
  }

  protected institutionLabel(): string {
    switch (this.currentType()) {
      case 'mutual_fund': return 'Fund house';
      case 'insurance_policy': return 'Provider';
      default: return 'Bank / institution';
    }
  }

  protected policyLabel(): string {
    return this.currentType() === 'insurance_policy'
      ? 'Policy number'
      : 'Account number (optional)';
  }

  protected installmentLabel(): string {
    return this.currentType() === 'insurance_policy'
      ? 'Premium amount'
      : 'Monthly installment';
  }

  protected currentValueLabel(): string {
    switch (this.currentType()) {
      case 'mutual_fund': return 'Current value';
      case 'insurance_policy': return 'Sum assured';
      default: return 'Current / maturity value';
    }
  }

  protected maturityLabel(): string {
    return this.currentType() === 'insurance_policy' ? 'Maturity date (optional)' : 'Maturity date';
  }

  private applyTypeValidators(type: InvestmentType): void {
    const required = REQUIRED[type];
    for (const name of TOGGLEABLE) {
      const control = this.form.get(name);
      if (!control) continue;
      if (required.includes(name)) {
        control.setValidators([Validators.required]);
      } else {
        control.clearValidators();
      }
      control.updateValueAndValidity({ emitEvent: false });
    }
  }

  private num(value: number | null): number {
    return value === null || Number.isNaN(value) ? 0 : Number(value);
  }

  private optionalNum(value: number | null): number | null {
    return value === null || Number.isNaN(value) ? null : Number(value);
  }
}
