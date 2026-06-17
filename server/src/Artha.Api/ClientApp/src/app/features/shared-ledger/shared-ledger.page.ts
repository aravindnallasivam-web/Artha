import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import {
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
  IonSpinner,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';
import { DonutChartComponent, DonutSegment } from '../reports/donut-chart.component';
import { SharedLedgerService } from './shared-ledger.service';

const PALETTE = [
  '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ec4899',
  '#06b6d4', '#ef4444', '#84cc16', '#f97316', '#6366f1',
];

@Component({
  selector: 'artha-shared-ledger',
  standalone: true,
  imports: [
    CurrencyPipe,
    DatePipe,
    DonutChartComponent,
    IonContent,
    IonHeader,
    IonIcon,
    IonItem,
    IonLabel,
    IonList,
    IonNote,
    IonSpinner,
    IonTitle,
    IonToolbar,
  ],
  template: `
    <ion-header class="ion-no-border">
      <ion-toolbar>
        <ion-title>{{ ownerName() || 'Shared expenses' }}</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      @if (loading()) {
        <div class="state"><ion-spinner></ion-spinner></div>
      } @else if (!service.connected()) {
        <div class="empty">
          <ion-icon name="people"></ion-icon>
          <p>No shared account connected. Connect one from Settings → Family sharing.</p>
        </div>
      } @else if (!snapshot()) {
        <div class="empty">
          <ion-icon name="cloud-offline-outline"></ion-icon>
          <p>Couldn't load the shared ledger. The owner may have stopped sharing.</p>
        </div>
      } @else {
        <div class="hero">
          <p class="hero-label">Total spent (read-only)</p>
          <p class="hero-value num">{{ total() | currency: currency() : 'symbol' : '1.0-0' }}</p>
          <p class="hero-meta">{{ counted().length }} expenses · shared by {{ ownerName() }}</p>
        </div>

        @if (donut().length > 0) {
          <div class="donut-wrap">
            <artha-donut-chart class="donut" [segments]="donut()" [currency]="currency()"></artha-donut-chart>
            <ul class="legend">
              @for (s of donut(); track s.label) {
                <li><span class="dot" [style.background]="s.color"></span>{{ s.label }}</li>
              }
            </ul>
          </div>
        }

        <ion-list inset="true">
          @for (e of recent(); track e.id) {
            <ion-item lines="full">
              <ion-label>
                <h2>{{ categoryName(e.categoryId) }}</h2>
                @if (e.note) { <p>{{ e.note }}</p> }
              </ion-label>
              <ion-note slot="end" class="num" [class.income]="e.type === 'income'">
                {{ e.amount | currency: currency() : 'symbol' : '1.0-0' }}
                <span class="d">{{ e.date | date: 'd MMM' }}</span>
              </ion-note>
            </ion-item>
          }
        </ion-list>
      }
    </ion-content>
  `,
  styles: [`
    .state, .empty { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 56px 24px; text-align: center; color: var(--artha-text-subtle); }
    .empty ion-icon { font-size: 40px; }
    .hero { text-align: center; padding: 8px 0 16px; }
    .hero-label { margin: 0; font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--artha-text-subtle); }
    .hero-value { margin: 6px 0 0; font-size: 30px; font-weight: 800; letter-spacing: -.02em; color: var(--artha-text); }
    .hero-meta { margin: 6px 0 0; font-size: 12.5px; color: var(--artha-text-muted); }
    .donut-wrap { display: flex; align-items: center; gap: 16px; padding: 8px 4px 16px; }
    .donut { width: 130px; flex-shrink: 0; }
    .legend { flex: 1; list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 7px; font-size: 13px; }
    .legend li { display: flex; align-items: center; gap: 8px; }
    .legend .dot { width: 9px; height: 9px; border-radius: 50%; }
    ion-note.income { color: var(--artha-positive); }
    ion-note .d { display: block; font-size: 11px; color: var(--artha-text-subtle); }
  `],
})
export class SharedLedgerPage implements OnInit {
  protected readonly service = inject(SharedLedgerService);
  protected readonly loading = signal(false);

  protected readonly snapshot = this.service.snapshot;
  protected readonly currency = computed(() => this.snapshot()?.currency ?? 'INR');
  protected readonly ownerName = computed(() => this.service.share()?.ownerName ?? this.snapshot()?.owner?.name ?? '');

  private readonly categoriesById = computed(() => {
    const map = new Map<string, { name: string; color: string | null }>();
    for (const c of this.snapshot()?.categories ?? []) {
      map.set(c.id, { name: c.name, color: c.color });
    }
    return map;
  });

  protected readonly counted = computed(() =>
    (this.snapshot()?.expenses ?? []).filter((e) => e.type !== 'income' && !e.excluded),
  );

  protected readonly total = computed(() => this.counted().reduce((s, e) => s + e.amount, 0));

  protected readonly recent = computed(() =>
    [...(this.snapshot()?.expenses ?? [])].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 100),
  );

  protected readonly donut = computed<DonutSegment[]>(() => {
    const byId = this.categoriesById();
    const totals = new Map<string, number>();
    for (const e of this.counted()) {
      totals.set(e.categoryId, (totals.get(e.categoryId) ?? 0) + e.amount);
    }
    return [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id, value], idx) => ({
        label: byId.get(id)?.name ?? 'Uncategorised',
        value,
        color: byId.get(id)?.color ?? PALETTE[idx % PALETTE.length],
      }));
  });

  protected categoryName(id: string): string {
    return this.categoriesById().get(id)?.name ?? 'Uncategorised';
  }

  async ngOnInit(): Promise<void> {
    if (!this.service.connected()) {
      return;
    }
    this.loading.set(true);
    try {
      await this.service.refresh();
    } catch {
      // Leave snapshot null; the template shows the load-failed state.
    } finally {
      this.loading.set(false);
    }
  }
}
