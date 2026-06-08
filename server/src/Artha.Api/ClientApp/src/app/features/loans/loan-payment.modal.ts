import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonInput,
  IonItem,
  IonSegment,
  IonSegmentButton,
  IonLabel,
  IonTitle,
  IonToolbar,
  ModalController,
} from '@ionic/angular/standalone';
import { LoanPaymentInput, LoanPaymentType } from '../../core/models/loan.model';

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
    IonSegment,
    IonSegmentButton,
    IonLabel,
    IonTitle,
    IonToolbar,
  ],
  template: `
    <ion-header class="ion-no-border">
      <ion-toolbar>
        <ion-buttons slot="start"><ion-button (click)="cancel()">Cancel</ion-button></ion-buttons>
        <ion-title>Record payment</ion-title>
        <ion-buttons slot="end">
          <ion-button [strong]="true" [disabled]="form.invalid" (click)="save()">Save</ion-button>
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
      </form>
    </ion-content>
  `,
  styles: [`
    ion-content { --background: var(--artha-bg); }
    .wrap { max-width: 560px; margin: 0 auto; padding: 12px 16px; }
    .seg { padding: 4px 0 6px; }
    .hint { margin: 0 4px 12px; font-size: 12.5px; color: var(--artha-text-muted); }
    .card {
      background: var(--artha-surface); border: 1px solid var(--artha-border);
      border-radius: var(--artha-radius); box-shadow: var(--artha-shadow-sm); overflow: hidden;
    }
    .card ion-item { --background: transparent; }
    .date-field { display: flex; flex-direction: column; gap: 4px; width: 100%; padding: 6px 0; }
    .date-label { font-size: 12px; color: var(--artha-text-muted); }
    .date-input { border: 0; outline: 0; background: transparent; font-size: 16px; color: var(--artha-text); font-family: inherit; }
  `],
})
export class LoanPaymentModal implements OnInit {
  private readonly modalCtrl = inject(ModalController);
  private readonly fb = inject(FormBuilder);

  /** Set by ModalController componentProps. */
  emi = 0;

  protected readonly busy = signal(false);

  protected readonly form = this.fb.nonNullable.group({
    amount: [null as number | null, [Validators.required, Validators.min(0.01)]],
    date: [todayIso(), Validators.required],
    type: ['emi' as LoanPaymentType, Validators.required],
    note: [''],
  });

  ngOnInit(): void {
    if (this.emi > 0 && this.form.controls.amount.value == null) {
      this.form.patchValue({ amount: Math.round(this.emi) });
    }
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
    if (this.form.invalid) return;
    const raw = this.form.getRawValue();
    const payment: LoanPaymentInput = {
      amount: Number(raw.amount),
      date: raw.date,
      type: raw.type,
      note: raw.note?.trim() ? raw.note.trim() : null,
    };
    void this.modalCtrl.dismiss(payment, 'save');
  }
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
