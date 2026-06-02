import { CurrencyPipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import {
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardSubtitle,
  IonCardTitle,
  IonContent,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonNote,
  IonSpinner,
} from '@ionic/angular/standalone';
import { MONTH_LABELS } from '../../core/models/report.model';
import { ReportsStore } from './reports.store';
import { YearBarChartComponent } from './year-bar-chart.component';

type ViewMode = 'monthly' | 'yearly';

@Component({
  selector: 'artha-reports',
  standalone: true,
  imports: [
    CurrencyPipe,
    IonCard,
    IonCardContent,
    IonCardHeader,
    IonCardSubtitle,
    IonCardTitle,
    IonContent,
    IonIcon,
    IonItem,
    IonLabel,
    IonList,
    IonListHeader,
    IonNote,
    IonSpinner,
    YearBarChartComponent,
  ],
  template: `
    <ion-content class="ion-padding">
      <div class="page">
        <header class="page-header">
          <h1 class="page-title">Reports</h1>
          <div class="view-switcher" role="tablist">
            <button
              type="button"
              role="tab"
              [class.active]="view() === 'monthly'"
              (click)="setView('monthly')"
            >
              <span>Monthly</span>
            </button>
            <button
              type="button"
              role="tab"
              [class.active]="view() === 'yearly'"
              (click)="setView('yearly')"
            >
              <span>Yearly</span>
            </button>
          </div>
          <div class="month-picker">
            <button
              type="button"
              class="month-nav"
              (click)="stepBack()"
              aria-label="Previous period"
            >
              <ion-icon name="chevron-back"></ion-icon>
            </button>
            <span class="range-label">{{ rangeLabel() }}</span>
            <button
              type="button"
              class="month-nav"
              (click)="stepForward()"
              [disabled]="!canStepForward()"
              aria-label="Next period"
            >
              <ion-icon name="chevron-forward"></ion-icon>
            </button>
          </div>
        </header>

      @if (store.loading()) {
        <div class="state"><ion-spinner></ion-spinner></div>
      } @else if (view() === 'monthly') {
        @if (store.monthly(); as report) {
          <ion-card>
            <ion-card-header>
              <ion-card-subtitle>{{ rangeLabel() }}</ion-card-subtitle>
              <ion-card-title>{{ report.total | currency: report.currency }}</ion-card-title>
            </ion-card-header>
            <ion-card-content>
              {{ report.count }} expense(s)
            </ion-card-content>
          </ion-card>

          @if (report.byCategory.length === 0) {
            <p class="empty">No spending recorded for this month.</p>
          } @else {
            <ion-list>
              <ion-list-header><ion-label>By category</ion-label></ion-list-header>
              @for (row of report.byCategory; track row.categoryId) {
                <ion-item lines="full">
                  <ion-label>
                    <h2>{{ row.categoryName }}</h2>
                    <p>{{ row.count }} expense(s)</p>
                    <div class="bar-track">
                      <div class="bar-fill"
                        [style.width.%]="percentage(row.total, report.total)"
                      ></div>
                    </div>
                  </ion-label>
                  <ion-note slot="end">
                    {{ row.total | currency: report.currency }}
                  </ion-note>
                </ion-item>
              }
            </ion-list>
          }
        }
      } @else {
        @if (store.yearly(); as report) {
          <ion-card>
            <ion-card-header>
              <ion-card-subtitle>{{ rangeLabel() }}</ion-card-subtitle>
              <ion-card-title>{{ report.yearTotal | currency: report.currency }}</ion-card-title>
            </ion-card-header>
            <ion-card-content>
              {{ report.yearCount }} expense(s) across the year
            </ion-card-content>
          </ion-card>

          <ion-card>
            <ion-card-header>
              <ion-card-subtitle>Monthly spend</ion-card-subtitle>
            </ion-card-header>
            <ion-card-content>
              <artha-year-bar-chart
                [months]="report.months"
                [currency]="report.currency"
              ></artha-year-bar-chart>
            </ion-card-content>
          </ion-card>

          @if (report.byCategory.length > 0) {
            <ion-list>
              <ion-list-header><ion-label>By category</ion-label></ion-list-header>
              @for (row of report.byCategory; track row.categoryId) {
                <ion-item lines="full">
                  <ion-label>
                    <h2>{{ row.categoryName }}</h2>
                    <p>{{ row.count }} expense(s)</p>
                    <div class="bar-track">
                      <div class="bar-fill"
                        [style.width.%]="percentage(row.total, report.yearTotal)"
                      ></div>
                    </div>
                  </ion-label>
                  <ion-note slot="end">
                    {{ row.total | currency: report.currency }}
                  </ion-note>
                </ion-item>
              }
            </ion-list>
          }
        }
      }
      </div>
    </ion-content>
  `,
  styles: [`
    .page-header {
      display: flex;
      align-items: center;
      gap: 16px;
      flex-wrap: wrap;
      margin-bottom: 20px;
    }
    .page-title {
      margin: 0;
      font-size: 20px;
      font-weight: 700;
      color: var(--artha-text);
    }
    .view-switcher {
      display: inline-flex;
      padding: 4px;
      background: var(--artha-surface);
      border: 1px solid var(--artha-border);
      border-radius: var(--artha-radius);
      box-shadow: var(--artha-shadow-sm);
    }
    .view-switcher button {
      border: 0; background: transparent;
      padding: 6px 14px;
      border-radius: 8px;
      cursor: pointer;
      color: var(--artha-text-muted);
      font-size: 13px; font-weight: 500;
      transition: background 120ms ease, color 120ms ease;
    }
    .view-switcher button:hover { color: var(--artha-text); }
    .view-switcher button.active {
      background: var(--artha-accent-tint);
      color: var(--artha-accent);
      font-weight: 600;
    }
    .month-picker {
      margin-left: auto;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px;
      background: var(--artha-surface);
      border: 1px solid var(--artha-border);
      border-radius: var(--artha-radius);
      box-shadow: var(--artha-shadow-sm);
    }
    .month-nav {
      width: 32px; height: 32px;
      border: 0; background: transparent;
      border-radius: 8px;
      cursor: pointer;
      color: var(--artha-text-muted);
      display: inline-flex; align-items: center; justify-content: center;
      transition: background 120ms ease, color 120ms ease;
    }
    .month-nav:hover { background: var(--artha-surface-2); color: var(--artha-text); }
    .month-nav:disabled { opacity: 0.4; cursor: not-allowed; }
    .month-nav ion-icon { font-size: 18px; }
    .range-label {
      min-width: 96px;
      text-align: center;
      font-size: 14px; font-weight: 600;
      color: var(--artha-text);
    }
    @media (max-width: 640px) {
      .month-picker { margin-left: 0; }
    }

    .state {
      display: flex; align-items: center; justify-content: center;
      padding: 64px; color: var(--ion-color-medium);
    }
    .empty {
      text-align: center; padding: 32px; color: var(--ion-color-medium);
    }
    .bar-track {
      background: var(--ion-color-step-150, #e2e8f0);
      height: 6px;
      border-radius: 3px;
      margin-top: 6px;
      overflow: hidden;
    }
    .bar-fill {
      height: 100%;
      background: var(--ion-color-primary);
      border-radius: 3px;
      transition: width 0.3s ease;
    }
  `],
})
export class ReportsPage implements OnInit {
  protected readonly store = inject(ReportsStore);

  protected readonly view = signal<ViewMode>('monthly');
  protected readonly year = signal<number>(new Date().getFullYear());
  protected readonly month = signal<number>(new Date().getMonth() + 1);

  protected readonly rangeLabel = computed(() => {
    if (this.view() === 'monthly') {
      return `${MONTH_LABELS[this.month() - 1]} ${this.year()}`;
    }
    return String(this.year());
  });

  protected readonly canStepForward = computed(() => {
    const now = new Date();
    if (this.view() === 'monthly') {
      const cursor = new Date(this.year(), this.month() - 1);
      const current = new Date(now.getFullYear(), now.getMonth());
      return cursor < current;
    }
    return this.year() < now.getFullYear();
  });

  ngOnInit(): void {
    void this.refresh();
  }

  async setView(value: ViewMode): Promise<void> {
    if (value !== this.view()) {
      this.view.set(value);
      await this.refresh();
    }
  }

  async stepBack(): Promise<void> {
    if (this.view() === 'monthly') {
      if (this.month() === 1) {
        this.year.update((y) => y - 1);
        this.month.set(12);
      } else {
        this.month.update((m) => m - 1);
      }
    } else {
      this.year.update((y) => y - 1);
    }
    await this.refresh();
  }

  async stepForward(): Promise<void> {
    if (!this.canStepForward()) return;
    if (this.view() === 'monthly') {
      if (this.month() === 12) {
        this.year.update((y) => y + 1);
        this.month.set(1);
      } else {
        this.month.update((m) => m + 1);
      }
    } else {
      this.year.update((y) => y + 1);
    }
    await this.refresh();
  }

  protected percentage(value: number, total: number): number {
    if (total <= 0) return 0;
    return Math.min(100, (value / total) * 100);
  }

  private async refresh(): Promise<void> {
    if (this.view() === 'monthly') {
      await this.store.loadMonthly(this.year(), this.month());
    } else {
      await this.store.loadYearly(this.year());
    }
  }
}
