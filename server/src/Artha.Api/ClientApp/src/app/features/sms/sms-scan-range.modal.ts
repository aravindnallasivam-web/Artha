import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonInput,
  IonItem,
  IonLabel,
  IonNote,
  IonTitle,
  IonToolbar,
  ModalController,
} from '@ionic/angular/standalone';

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Lets the user pick the date range for an SMS inbox scan: quick presets plus
 * custom From/To. Dismisses with { from, to } (ISO dates) and role 'scan'.
 */
@Component({
  selector: 'artha-sms-scan-range',
  standalone: true,
  imports: [
    FormsModule,
    IonButton,
    IonButtons,
    IonContent,
    IonHeader,
    IonInput,
    IonItem,
    IonLabel,
    IonNote,
    IonTitle,
    IonToolbar,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-button (click)="cancel()">Cancel</ion-button>
        </ion-buttons>
        <ion-title>Scan SMS</ion-title>
        <ion-buttons slot="end">
          <ion-button strong="true" [disabled]="!isRangeValid()" (click)="scan()">Scan</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <p class="lead">Look for bank expense messages in this period.</p>

      <div class="presets">
        @for (p of presets; track p.days) {
          <button
            type="button"
            class="preset"
            [class.active]="activeDays() === p.days"
            (click)="applyPreset(p.days)"
          >{{ p.label }}</button>
        }
      </div>

      <ion-item>
        <ion-input
          label="From"
          labelPlacement="stacked"
          type="date"
          [max]="today"
          [(ngModel)]="from"
          (ngModelChange)="activeDays.set(0)"
        ></ion-input>
      </ion-item>
      <ion-item>
        <ion-input
          label="To"
          labelPlacement="stacked"
          type="date"
          [max]="today"
          [(ngModel)]="to"
          (ngModelChange)="activeDays.set(0)"
        ></ion-input>
      </ion-item>

      @if (!isRangeValid()) {
        <ion-note color="danger" class="warn">“From” must be on or before “To”.</ion-note>
      }
    </ion-content>
  `,
  styles: [`
    .lead { margin: 0 0 14px; font-size: 14px; color: var(--artha-text-muted); }
    .presets { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }
    .preset {
      padding: 7px 14px; border-radius: 999px; cursor: pointer;
      border: 1px solid var(--artha-border-strong);
      background: var(--artha-surface); color: var(--artha-text-muted);
      font-size: 13px; font-weight: 600;
    }
    .preset.active {
      background: var(--artha-accent); border-color: var(--artha-accent); color: #fff;
    }
    .warn { display: block; margin-top: 10px; font-size: 13px; }
  `],
})
export class SmsScanRangeModal implements OnInit {
  private readonly modalCtrl = inject(ModalController);

  protected readonly today = isoDate(new Date());
  protected readonly presets = [
    { label: 'Last 7 days', days: 7 },
    { label: 'Last 30 days', days: 30 },
    { label: 'Last 90 days', days: 90 },
  ];

  protected from = '';
  protected to = '';
  protected readonly activeDays = signal<number>(30);

  ngOnInit(): void {
    this.applyPreset(30);
  }

  protected applyPreset(days: number): void {
    const now = new Date();
    const start = new Date();
    start.setDate(now.getDate() - days);
    this.from = isoDate(start);
    this.to = isoDate(now);
    this.activeDays.set(days);
  }

  // Custom edits clear the active preset highlight and re-validate.
  protected isRangeValid(): boolean {
    return !!this.from && !!this.to && this.from <= this.to;
  }

  protected cancel(): void {
    void this.modalCtrl.dismiss(null, 'cancel');
  }

  protected scan(): void {
    if (!this.isRangeValid()) {
      return;
    }
    void this.modalCtrl.dismiss({ from: this.from, to: this.to }, 'scan');
  }
}
