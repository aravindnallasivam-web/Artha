import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonInput,
  IonItem,
  IonNote,
  IonTitle,
  IonToolbar,
  ModalController,
} from '@ionic/angular/standalone';

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

/** First day of the month `offset` months from this one (0 = this month). */
function monthStart(offset: number): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + offset, 1);
}

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
        @for (p of presets; track p.key) {
          <button
            type="button"
            class="preset"
            [class.active]="active() === p.key"
            (click)="applyPreset(p.key)"
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
          (ngModelChange)="active.set('')"
        ></ion-input>
      </ion-item>
      <ion-item>
        <ion-input
          label="To"
          labelPlacement="stacked"
          type="date"
          [max]="today"
          [(ngModel)]="to"
          (ngModelChange)="active.set('')"
        ></ion-input>
      </ion-item>

      @if (!isRangeValid()) {
        <ion-note color="danger" class="warn">“From” must be on or before “To”.</ion-note>
      } @else {
        <p class="summary">{{ summary() }}</p>
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
    .summary { margin: 12px 4px 0; font-size: 13px; font-weight: 600; color: var(--artha-text-muted); }
  `],
})
export class SmsScanRangeModal implements OnInit {
  private readonly modalCtrl = inject(ModalController);

  protected readonly today = isoDate(new Date());
  /** Quick ranges; each returns [from, to]. */
  protected readonly presets: { key: string; label: string; range: () => [Date, Date] }[] = [
    { key: '7d', label: 'Last 7 days', range: () => [daysAgo(7), new Date()] },
    { key: '30d', label: 'Last 30 days', range: () => [daysAgo(30), new Date()] },
    { key: 'month', label: 'This month', range: () => [monthStart(0), new Date()] },
    { key: 'last-month', label: 'Last month', range: () => [monthStart(-1), new Date(monthStart(0).getTime() - 86_400_000)] },
    { key: '90d', label: 'Last 90 days', range: () => [daysAgo(90), new Date()] },
    { key: '6m', label: 'Last 6 months', range: () => [monthStart(-5), new Date()] },
    { key: 'year', label: 'This year', range: () => [new Date(new Date().getFullYear(), 0, 1), new Date()] },
  ];

  protected from = '';
  protected to = '';
  protected readonly active = signal<string>('30d');

  ngOnInit(): void {
    this.applyPreset('30d');
  }

  protected applyPreset(key: string): void {
    const preset = this.presets.find((p) => p.key === key);
    if (!preset) return;
    const [start, end] = preset.range();
    this.from = isoDate(start);
    this.to = isoDate(end);
    this.active.set(key);
  }

  /** "1 Oct – 31 Oct 2026 · 31 days" for the chosen range. */
  protected summary(): string {
    const a = new Date(`${this.from}T00:00:00`);
    const b = new Date(`${this.to}T00:00:00`);
    const days = Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1;
    const fmt = (d: Date, year: boolean) =>
      d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}) });
    return `${fmt(a, a.getFullYear() !== b.getFullYear())} – ${fmt(b, true)} · ${days} ${days === 1 ? 'day' : 'days'}`;
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
