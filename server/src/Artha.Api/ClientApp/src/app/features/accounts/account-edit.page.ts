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
  IonNote,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';
import { ConflictNotifierService } from '../../core/feedback/conflict-notifier.service';
import {
  ACCOUNT_TYPE_ICONS,
  ACCOUNT_TYPE_LABELS,
  AccountType,
  AccountUpsertRequest,
  DEFAULT_ACCOUNT_ID,
} from '../../core/models/account.model';
import { BANK_PRESETS } from '../../core/models/bank-preset';
import { AccountsStore } from './accounts.store';

const TYPE_OPTIONS: AccountType[] = ['cash', 'checking', 'savings', 'credit_card', 'other'];
const COLOR_SWATCHES = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#f43f5e', '#a855f7', '#64748b'];

@Component({
  selector: 'artha-account-edit',
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
    IonNote,
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
          <ion-back-button defaultHref="/accounts"></ion-back-button>
        </ion-buttons>
        <ion-title>{{ mode() === 'edit' ? 'Edit account' : 'New account' }}</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      @if (loading()) {
        <div class="state"><ion-spinner></ion-spinner></div>
      } @else {
        <form [formGroup]="form" (ngSubmit)="save()">
          <div class="wrap">
            <div class="preview">
              <div
                class="preview-badge"
                [style.background]="previewBg()"
                [style.color]="previewColor()"
              >
                <ion-icon [name]="previewIcon()"></ion-icon>
              </div>
              <div class="preview-name">{{ form.controls.name.value || 'Account name' }}</div>
              <div class="preview-meta">
                {{ typeLabel(form.controls.type.value) }} · {{ previewCurrency() }}
              </div>
            </div>

            <div class="section-label">Details</div>
            <div class="card">
              <ion-item lines="full">
                <ion-input
                  label="Name"
                  labelPlacement="stacked"
                  type="text"
                  formControlName="name"
                  placeholder="e.g. HDFC Checking"
                ></ion-input>
              </ion-item>
              <ion-item lines="full">
                <ion-select
                  label="Type"
                  labelPlacement="stacked"
                  formControlName="type"
                  interface="popover"
                >
                  @for (t of typeOptions; track t) {
                    <ion-select-option [value]="t">{{ typeLabel(t) }}</ion-select-option>
                  }
                </ion-select>
              </ion-item>
              <ion-item lines="full">
                <ion-input
                  label="Currency"
                  labelPlacement="stacked"
                  type="text"
                  maxlength="3"
                  formControlName="currency"
                  placeholder="USD"
                ></ion-input>
              </ion-item>
              <ion-item lines="none">
                <ion-input
                  label="Opening balance"
                  labelPlacement="stacked"
                  type="number"
                  inputmode="decimal"
                  step="0.01"
                  formControlName="openingBalance"
                ></ion-input>
              </ion-item>
            </div>

            <div class="section-label">Appearance</div>
            <div class="card swatch-card">
              <div class="field-label">Color</div>
              <div class="swatches">
                @for (c of colors; track c) {
                  <button
                    type="button"
                    class="swatch"
                    [style.background]="c"
                    [class.selected]="isColorSelected(c)"
                    [attr.aria-label]="'Colour ' + c"
                    (click)="selectColor(c)"
                  ></button>
                }
                <button
                  type="button"
                  class="swatch none"
                  [class.selected]="!form.controls.color.value"
                  aria-label="No colour"
                  (click)="selectColor('')"
                >
                  <ion-icon name="close-outline"></ion-icon>
                </button>
              </div>
            </div>

            <div class="section-label">Bank · SMS balance sync</div>
            <div class="card">
              <ion-item lines="none">
                <ion-select
                  label="Bank"
                  labelPlacement="stacked"
                  formControlName="bank"
                  interface="action-sheet"
                >
                  <ion-select-option [value]="''">None</ion-select-option>
                  @for (b of bankOptions; track b.id) {
                    <ion-select-option [value]="b.id">{{ b.name }}</ion-select-option>
                  }
                </ion-select>
              </ion-item>
            </div>
            <div class="field-note">
              Lets you sync this account's balance by texting the bank (Android).
            </div>

            @if (isDefaultAccount()) {
              <ion-note color="medium" class="hint">
                The default Cash account can be renamed but not deleted — legacy
                expenses fall back to it.
              </ion-note>
            }

            <ion-button
              type="submit"
              expand="block"
              class="save-btn"
              [disabled]="form.invalid || saving()"
            >
              <ion-icon name="save-outline" slot="start"></ion-icon>
              {{ saving() ? 'Saving…' : (mode() === 'edit' ? 'Save changes' : 'Add account') }}
            </ion-button>
          </div>
        </form>
      }
    </ion-content>
  `,
  styles: [`
    ion-content { --background: var(--artha-bg); }
    .state { display: flex; justify-content: center; padding: 48px; }
    .wrap { max-width: 640px; margin: 0 auto; padding: 8px 16px 32px; }

    .preview {
      display: flex; flex-direction: column; align-items: center;
      gap: 4px; padding: 10px 0 18px;
    }
    .preview-badge {
      width: 64px; height: 64px; border-radius: 18px; margin-bottom: 6px;
      display: flex; align-items: center; justify-content: center; font-size: 30px;
    }
    .preview-name { font-size: 17px; font-weight: 700; color: var(--artha-text); }
    .preview-meta { font-size: 13px; color: var(--artha-text-muted); }

    .section-label {
      font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.4px;
      color: var(--artha-text-subtle); margin: 18px 4px 8px;
    }
    .card {
      background: var(--artha-surface);
      border: 1px solid var(--artha-border);
      border-radius: var(--artha-radius);
      box-shadow: var(--artha-shadow-sm);
      overflow: hidden;
    }
    .card ion-item { --background: transparent; }

    .swatch-card { padding: 14px 16px; }
    .field-label { font-size: 13px; color: var(--artha-text-muted); margin-bottom: 12px; }
    .swatches { display: flex; flex-wrap: wrap; gap: 14px; }
    .swatch {
      width: 30px; height: 30px; border-radius: 50%; border: 2px solid transparent;
      cursor: pointer; padding: 0;
      box-shadow: 0 0 0 1px var(--artha-border) inset;
    }
    .swatch.selected { border-color: var(--artha-text); }
    .swatch.none {
      background: var(--artha-surface-2); color: var(--artha-text-subtle);
      display: flex; align-items: center; justify-content: center; font-size: 16px;
    }

    .field-note {
      font-size: 12.5px; color: var(--artha-text-muted);
      margin: 8px 6px 0; line-height: 1.45;
    }
    .hint { display: block; padding: 12px 6px; font-size: 13px; }
    .save-btn { margin-top: 26px; }
  `],
})
export class AccountEditPage implements OnInit {
  private readonly store = inject(AccountsStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  private readonly notifier = inject(ConflictNotifierService);

  protected readonly typeOptions = TYPE_OPTIONS;
  protected readonly bankOptions = BANK_PRESETS;
  protected readonly colors = COLOR_SWATCHES;
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly mode = signal<'create' | 'edit'>('create');

  protected readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(60)]],
    type: ['cash' as AccountType, Validators.required],
    currency: ['USD', [Validators.required, Validators.minLength(3), Validators.maxLength(3)]],
    openingBalance: [0, Validators.required],
    color: [''],
    bank: [''],
  });

  private editingId: string | null = null;

  async ngOnInit(): Promise<void> {
    this.loading.set(true);
    try {
      if (this.store.items().length === 0) {
        await this.store.load(true);
      }
      const id = this.route.snapshot.paramMap.get('id');
      if (id) {
        this.mode.set('edit');
        this.editingId = id;
        const account = this.store.byId()[id];
        if (account) {
          this.form.patchValue({
            name: account.name,
            type: account.type,
            currency: account.currency,
            openingBalance: account.openingBalance,
            color: account.color ?? '',
            bank: account.bank ?? '',
          });
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
    const payload: AccountUpsertRequest = {
      name: raw.name.trim(),
      type: raw.type,
      currency: raw.currency.trim().toUpperCase(),
      openingBalance: Number(raw.openingBalance),
      color: raw.color?.trim() || null,
      icon: null,
      bank: raw.bank || null,
    };
    try {
      if (this.editingId) {
        await this.store.update(this.editingId, payload);
      } else {
        await this.store.add(payload);
      }
      await this.router.navigate(['/accounts']);
    } catch (err) {
      await this.notifier.notifyError(
        this.editingId ? 'Could not save changes.' : 'Could not add account.',
      );
    } finally {
      this.saving.set(false);
    }
  }

  protected typeLabel(t: AccountType): string {
    return ACCOUNT_TYPE_LABELS[t];
  }

  protected isDefaultAccount(): boolean {
    return this.editingId === DEFAULT_ACCOUNT_ID;
  }

  protected selectColor(c: string): void {
    this.form.patchValue({ color: c });
  }

  protected isColorSelected(c: string): boolean {
    return this.form.controls.color.value === c;
  }

  protected previewIcon(): string {
    return ACCOUNT_TYPE_ICONS[this.form.controls.type.value] || 'wallet-outline';
  }

  protected previewColor(): string {
    return this.form.controls.color.value || 'var(--artha-accent)';
  }

  protected previewBg(): string {
    const c = this.form.controls.color.value;
    return c ? `${c}22` : 'var(--artha-accent-tint)';
  }

  protected previewCurrency(): string {
    return (this.form.controls.currency.value || 'USD').toUpperCase();
  }
}
