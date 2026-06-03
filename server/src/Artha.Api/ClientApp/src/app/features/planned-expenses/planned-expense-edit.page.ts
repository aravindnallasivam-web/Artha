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
import {
  PLANNED_FREQUENCIES,
  PLANNED_FREQUENCY_LABELS,
  PlannedExpenseUpsertRequest,
  PlannedFrequency,
} from '../../core/models/planned-expense.model';
import { CategoriesStore } from '../categories/categories.store';
import { PlannedExpensesStore } from './planned-expenses.store';

@Component({
  selector: 'artha-planned-expense-edit',
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
              placeholder="e.g. Rent, Broadband"
            ></ion-input>
          </ion-item>

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
            <ion-select
              label="Recurs"
              labelPlacement="floating"
              formControlName="frequency"
              interface="popover"
            >
              @for (f of frequencies; track f) {
                <ion-select-option [value]="f">{{ frequencyLabel(f) }}</ion-select-option>
              }
            </ion-select>
          </ion-item>

          <ion-item>
            <ion-select
              label="Category (optional)"
              labelPlacement="floating"
              formControlName="categoryId"
              interface="popover"
              placeholder="None"
            >
              <ion-select-option [value]="null">None</ion-select-option>
              @for (cat of categories.active(); track cat.id) {
                <ion-select-option [value]="cat.id">{{ cat.name }}</ion-select-option>
              }
            </ion-select>
          </ion-item>

          <ion-item>
            <ion-input
              label="Due day of month (optional)"
              labelPlacement="floating"
              type="number"
              inputmode="numeric"
              min="1"
              max="31"
              formControlName="dayOfMonth"
              placeholder="e.g. 1"
            ></ion-input>
          </ion-item>

          <div class="actions">
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
    .actions { margin-top: 24px; }
  `],
})
export class PlannedExpenseEditPage implements OnInit {
  private readonly store = inject(PlannedExpensesStore);
  protected readonly categories = inject(CategoriesStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  private readonly notifier = inject(ConflictNotifierService);

  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly mode = signal<'create' | 'edit'>('create');
  protected readonly frequencies = PLANNED_FREQUENCIES;

  protected readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(60)]],
    amount: [null as number | null, [Validators.required, Validators.min(0.01)]],
    frequency: ['monthly' as PlannedFrequency, Validators.required],
    categoryId: [null as string | null],
    dayOfMonth: [null as number | null, [Validators.min(1), Validators.max(31)]],
  });

  private editingId: string | null = null;

  async ngOnInit(): Promise<void> {
    this.loading.set(true);
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
            frequency: item.frequency,
            categoryId: item.categoryId,
            dayOfMonth: item.dayOfMonth,
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
    const payload: PlannedExpenseUpsertRequest = {
      name: (raw.name ?? '').trim(),
      amount: Number(raw.amount),
      frequency: raw.frequency,
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

  protected frequencyLabel(f: PlannedFrequency): string {
    return PLANNED_FREQUENCY_LABELS[f];
  }
}
