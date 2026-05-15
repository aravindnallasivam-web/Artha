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
  ACCOUNT_TYPE_LABELS,
  AccountType,
  AccountUpsertRequest,
  DEFAULT_ACCOUNT_ID,
} from '../../core/models/account.model';
import { AccountsStore } from './accounts.store';

const TYPE_OPTIONS: AccountType[] = ['cash', 'checking', 'savings', 'credit_card', 'other'];

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

    <ion-content class="ion-padding">
      @if (loading()) {
        <ion-spinner></ion-spinner>
      } @else {
        <form [formGroup]="form" (ngSubmit)="save()">
          <ion-item>
            <ion-input
              label="Name"
              labelPlacement="floating"
              type="text"
              formControlName="name"
              placeholder="e.g. HDFC Checking"
            ></ion-input>
          </ion-item>

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
              label="Currency"
              labelPlacement="floating"
              type="text"
              maxlength="3"
              formControlName="currency"
              placeholder="USD"
            ></ion-input>
          </ion-item>

          <ion-item>
            <ion-input
              label="Opening balance"
              labelPlacement="floating"
              type="number"
              inputmode="decimal"
              step="0.01"
              formControlName="openingBalance"
            ></ion-input>
          </ion-item>

          <ion-item>
            <ion-input
              label="Color (hex, optional)"
              labelPlacement="floating"
              type="text"
              placeholder="#3b82f6"
              formControlName="color"
            ></ion-input>
          </ion-item>

          @if (isDefaultAccount()) {
            <ion-note color="medium" class="hint">
              The default Cash account can be renamed but not deleted — legacy
              expenses fall back to it.
            </ion-note>
          }

          <div class="actions">
            <ion-button type="submit" expand="block" [disabled]="form.invalid || saving()">
              <ion-icon name="save-outline" slot="start"></ion-icon>
              {{ saving() ? 'Saving…' : (mode() === 'edit' ? 'Save changes' : 'Add account') }}
            </ion-button>
          </div>
        </form>
      }
    </ion-content>
  `,
  styles: [`
    .actions { margin-top: 24px; }
    .hint { display: block; padding: 12px 16px; font-size: 13px; }
  `],
})
export class AccountEditPage implements OnInit {
  private readonly store = inject(AccountsStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  private readonly notifier = inject(ConflictNotifierService);

  protected readonly typeOptions = TYPE_OPTIONS;
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly mode = signal<'create' | 'edit'>('create');

  protected readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(60)]],
    type: ['cash' as AccountType, Validators.required],
    currency: ['USD', [Validators.required, Validators.minLength(3), Validators.maxLength(3)]],
    openingBalance: [0, Validators.required],
    color: [''],
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
}
