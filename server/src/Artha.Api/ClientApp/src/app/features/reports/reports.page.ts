import { CurrencyPipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import {
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardSubtitle,
  IonCardTitle,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonNote,
  IonSegment,
  IonSegmentButton,
  IonSpinner,
  IonTitle,
  IonToolbar,
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
    IonButton,
    IonButtons,
    IonCard,
    IonCardContent,
    IonCardHeader,
    IonCardSubtitle,
    IonCardTitle,
    IonContent,
    IonHeader,
    IonIcon,
    IonItem,
    IonLabel,
    IonList,
    IonListHeader,
    IonNote,
    IonSegment,
    IonSegmentButton,
    IonSpinner,
    IonTitle,
    IonToolbar,
    YearBarChartComponent,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Reports</ion-title>
      </ion-toolbar>
      <ion-toolbar>
        <ion-segment [value]="view()" (ionChange)="onViewChange($event)">
          <ion-segment-button value="monthly"><ion-label>Monthly</ion-label></ion-segment-button>
          <ion-segment-button value="yearly"><ion-label>Yearly</ion-label></ion-segment-button>
        </ion-segment>
      </ion-toolbar>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-button (click)="stepBack()" fill="clear">
            <ion-icon name="chevron-forward" style="transform: rotate(180deg)"></ion-icon>
          </ion-button>
        </ion-buttons>
        <ion-title size="small" class="ion-text-center">{{ rangeLabel() }}</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="stepForward()" fill="clear" [disabled]="!canStepForward()">
            <ion-icon name="chevron-forward"></ion-icon>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
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

          @if (report.plannedCount > 0) {
            <ion-card>
              <ion-card-header>
                <ion-card-subtitle>Planned vs actual</ion-card-subtitle>
              </ion-card-header>
              <ion-card-content>
                <div class="pva-row">
                  <span>Planned ({{ report.plannedCount }})</span>
                  <span>{{ report.plannedTotal | currency: report.currency }}</span>
                </div>
                <div class="pva-row">
                  <span>Actual</span>
                  <span>{{ report.total | currency: report.currency }}</span>
                </div>
                <div class="bar-track">
                  <div
                    class="bar-fill"
                    [class.over]="report.total > report.plannedTotal"
                    [style.width.%]="percentage(report.total, report.plannedTotal)"
                  ></div>
                </div>
                <div class="pva-row pva-delta" [class.over]="report.total > report.plannedTotal">
                  <span>{{ report.total > report.plannedTotal ? 'Over budget' : 'Remaining' }}</span>
                  <span>{{ delta(report.plannedTotal, report.total) | currency: report.currency }}</span>
                </div>
              </ion-card-content>
            </ion-card>
          }

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
    </ion-content>
  `,
  styles: [`
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
    .bar-fill.over { background: var(--ion-color-danger); }
    .pva-row {
      display: flex; justify-content: space-between;
      padding: 4px 0; font-size: 14px;
    }
    .pva-row span:last-child { font-weight: 600; }
    .pva-delta { margin-top: 8px; color: var(--ion-color-success); }
    .pva-delta.over { color: var(--ion-color-danger); }
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

  async onViewChange(event: Event): Promise<void> {
    const value = (event as CustomEvent<{ value: ViewMode }>).detail?.value;
    if (value && value !== this.view()) {
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

  /** Absolute gap between planned and actual, for the remaining/over figure. */
  protected delta(planned: number, actual: number): number {
    return Math.abs(planned - actual);
  }

  private async refresh(): Promise<void> {
    if (this.view() === 'monthly') {
      await this.store.loadMonthly(this.year(), this.month());
    } else {
      await this.store.loadYearly(this.year());
    }
  }
}
