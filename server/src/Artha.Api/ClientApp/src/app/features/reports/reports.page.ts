import { CurrencyPipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  IonContent,
  IonHeader,
  IonIcon,
  IonSpinner,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';
import { Expense } from '../../core/models/expense.model';
import { MONTH_LABELS, MonthSummary } from '../../core/models/report.model';
import { AccountsStore } from '../accounts/accounts.store';
import { CategoriesStore } from '../categories/categories.store';
import { ExpensesApi } from '../expenses/expenses.api';
import { PlannedExpensesStore } from '../planned-expenses/planned-expenses.store';
import { DonutChartComponent, DonutSegment } from './donut-chart.component';
import { LineChartComponent } from './line-chart.component';
import { YearBarChartComponent } from './year-bar-chart.component';

type ViewMode = 'monthly' | 'yearly';

const PALETTE = [
  '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ec4899',
  '#06b6d4', '#ef4444', '#84cc16', '#f97316', '#6366f1',
];
const OTHER_COLOR = '#cbd5e1';

interface CatRow {
  categoryId: string;
  name: string;
  color: string;
  total: number;
  count: number;
  /** Per-subcategory split for a top-level row (absent when there's none). */
  children?: CatRow[];
}

@Component({
  selector: 'artha-reports',
  standalone: true,
  imports: [
    CurrencyPipe,
    IonContent,
    IonHeader,
    IonIcon,
    IonSpinner,
    IonTitle,
    IonToolbar,
    DonutChartComponent,
    LineChartComponent,
    YearBarChartComponent,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Reports</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <div class="page">
        <!-- Header -->
        <header class="page-header">
          <div class="view-switcher" role="tablist">
            <button type="button" role="tab" [class.active]="view() === 'monthly'" (click)="setView('monthly')">
              <span>Monthly</span>
            </button>
            <button type="button" role="tab" [class.active]="view() === 'yearly'" (click)="setView('yearly')">
              <span>Yearly</span>
            </button>
          </div>
          <div class="month-picker">
            <button type="button" class="month-nav" (click)="stepBack()" aria-label="Previous period">
              <ion-icon name="chevron-back"></ion-icon>
            </button>
            <span class="range-label">{{ rangeLabel() }}</span>
            <button type="button" class="month-nav" (click)="stepForward()" [disabled]="!canStepForward()" aria-label="Next period">
              <ion-icon name="chevron-forward"></ion-icon>
            </button>
          </div>
        </header>

        @if (loading()) {
          <div class="state"><ion-spinner></ion-spinner></div>
        } @else {
          <!-- KPI cards -->
          <section class="kpis">
            <div class="kpi">
              <p class="kpi-label">Total spent</p>
              <p class="kpi-value num">{{ total() | currency: currency() : 'symbol' : '1.0-0' }}</p>
              @if (deltaInfo(); as d) {
                <p class="kpi-sub" [class.up]="d.up" [class.down]="!d.up">{{ d.text }}</p>
              } @else {
                <p class="kpi-sub muted">{{ count() }} transactions</p>
              }
            </div>
            <div class="kpi">
              <p class="kpi-label">{{ view() === 'monthly' ? 'Daily average' : 'Monthly average' }}</p>
              <p class="kpi-value num">{{ averageSpend() | currency: currency() : 'symbol' : '1.0-0' }}</p>
              <p class="kpi-sub muted">{{ view() === 'monthly' ? 'per day' : 'per month' }}</p>
            </div>
            <div class="kpi">
              <p class="kpi-label">Transactions</p>
              <p class="kpi-value num">{{ count() }}</p>
              <p class="kpi-sub muted">in {{ rangeLabel() }}</p>
            </div>
            <div class="kpi">
              <p class="kpi-label">Top category</p>
              @if (topCategory(); as tc) {
                <p class="kpi-value sm">{{ tc.name }}</p>
                <p class="kpi-sub muted">
                  {{ tc.total | currency: currency() : 'symbol' : '1.0-0' }} · {{ percent(tc.total) }}%
                </p>
              } @else {
                <p class="kpi-value sm">—</p>
                <p class="kpi-sub muted">no spend</p>
              }
            </div>
          </section>

          <!-- Planned vs actual: compares fixed monthly bills (rent, broadband)
               against this month's actual spend. Monthly view only. -->
          @if (view() === 'monthly' && plannedCount() > 0) {
            <section class="card">
              <div class="card-head">
                <h2>Planned vs actual</h2>
                <span class="card-sub">{{ plannedCount() }} predefined / month</span>
              </div>
              <div class="pva-line">
                <span class="bar-name">Planned</span>
                <span class="bar-amt num">{{ plannedTotal() | currency: currency() : 'symbol' : '1.0-0' }}</span>
              </div>
              <div class="pva-line">
                <span class="bar-name">Actual</span>
                <span class="bar-amt num">{{ total() | currency: currency() : 'symbol' : '1.0-0' }}</span>
              </div>
              <div class="bar-track">
                <div
                  class="bar-fill"
                  [style.width.%]="plannedPercent()"
                  [style.background]="total() > plannedTotal() ? 'var(--artha-negative, #dc2626)' : 'var(--artha-accent)'"
                ></div>
              </div>
              <div class="pva-line pva-delta" [class.over]="total() > plannedTotal()">
                <span>{{ total() > plannedTotal() ? 'Over budget' : 'Remaining' }}</span>
                <span class="num">{{ plannedDelta() | currency: currency() : 'symbol' : '1.0-0' }}</span>
              </div>
            </section>
          }

          @if (count() === 0) {
            <div class="empty">
              <ion-icon name="stats-chart-outline"></ion-icon>
              <p>No spending recorded for {{ rangeLabel() }}.</p>
            </div>
          } @else {
            <!-- Trend + donut -->
            <section class="charts-row">
              <div class="card trend-card">
                <div class="card-head">
                  <h2>{{ view() === 'monthly' ? 'Spending trend' : 'Monthly spend' }}</h2>
                  <span class="card-sub">{{ view() === 'monthly' ? 'Daily spend across the month' : rangeLabel() }}</span>
                </div>
                @if (view() === 'monthly') {
                  <artha-line-chart [series]="dailySeries()" [currency]="currency()"></artha-line-chart>
                } @else {
                  <artha-year-bar-chart [months]="monthSummaries()" [currency]="currency()"></artha-year-bar-chart>
                }
              </div>

              <div class="card donut-card">
                <div class="card-head">
                  <h2>By category</h2>
                  <span class="card-sub">Share of spend</span>
                </div>
                <div class="donut-body">
                  <artha-donut-chart class="donut" [segments]="donutSegments()" [currency]="currency()"></artha-donut-chart>
                  <ul class="legend">
                    @for (seg of donutSegments(); track seg.label) {
                      <li>
                        <span class="dot" [style.background]="seg.color"></span>
                        <span class="legend-name">{{ seg.label }}</span>
                        <span class="legend-pct">{{ percent(seg.value) }}%</span>
                      </li>
                    }
                  </ul>
                </div>
              </div>
            </section>

            <!-- Category breakdown -->
            <section class="card">
              <div class="card-head">
                <h2>Category breakdown</h2>
                <span class="card-sub">tap a row → filtered expenses</span>
              </div>
              <ul class="bars">
                @for (row of byCategory(); track row.categoryId) {
                  <li class="bar-row" (click)="openCategory(row.categoryId)">
                    <div class="bar-top">
                      <span class="bar-name">
                        @if (row.children) {
                          <button
                            class="expand-btn"
                            [attr.aria-label]="'Toggle subcategories of ' + row.name"
                            (click)="toggleCategory($event, row.categoryId)"
                          >
                            <ion-icon
                              [name]="expandedCategories().has(row.categoryId) ? 'chevron-down' : 'chevron-forward'"
                            ></ion-icon>
                          </button>
                        }
                        {{ row.name }}
                      </span>
                      <span class="bar-amt num">{{ row.total | currency: currency() : 'symbol' : '1.0-0' }}</span>
                    </div>
                    <div class="bar-track">
                      <div class="bar-fill" [style.width.%]="percent(row.total)" [style.background]="row.color"></div>
                    </div>
                  </li>
                  @if (row.children && expandedCategories().has(row.categoryId)) {
                    @for (child of row.children; track child.categoryId) {
                      <li class="bar-row bar-row--child" (click)="openCategory(child.categoryId)">
                        <div class="bar-top">
                          <span class="bar-name">{{ child.name }}</span>
                          <span class="bar-amt num">{{ child.total | currency: currency() : 'symbol' : '1.0-0' }}</span>
                        </div>
                        <div class="bar-track">
                          <div class="bar-fill" [style.width.%]="percent(child.total)" [style.background]="child.color"></div>
                        </div>
                      </li>
                    }
                  }
                }
              </ul>
            </section>

            <!-- Top merchants + by account -->
            <section class="charts-row">
              <div class="card">
                <div class="card-head"><h2>Top merchants</h2></div>
                @if (topMerchants().length === 0) {
                  <p class="muted small">No merchant info.</p>
                } @else {
                  <ul class="merchants">
                    @for (m of topMerchants(); track m.name) {
                      <li>
                        <span class="m-name">{{ m.name }}</span>
                        <span class="m-amt num">{{ m.total | currency: currency() : 'symbol' : '1.0-0' }}</span>
                      </li>
                    }
                  </ul>
                }
              </div>

              <div class="card">
                <div class="card-head"><h2>By account</h2></div>
                <ul class="bars">
                  @for (a of byAccount(); track a.id) {
                    <li class="bar-row static">
                      <div class="bar-top">
                        <span class="bar-name">{{ a.name }}</span>
                        <span class="bar-amt num">{{ percent(a.total) }}%</span>
                      </div>
                      <div class="bar-track">
                        <div class="bar-fill" [style.width.%]="percent(a.total)" [style.background]="a.color"></div>
                      </div>
                    </li>
                  }
                </ul>
              </div>
            </section>
          }
        }
      </div>
    </ion-content>
  `,
  styles: [`
    .page-header {
      display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 18px;
    }
    .view-switcher {
      display: inline-flex; padding: 4px;
      background: var(--artha-surface); border: 1px solid var(--artha-border);
      border-radius: var(--artha-radius); box-shadow: var(--artha-shadow-sm);
    }
    .view-switcher button {
      border: 0; background: transparent; padding: 6px 14px; border-radius: 8px;
      cursor: pointer; color: var(--artha-text-muted); font-size: 13px; font-weight: 500;
      transition: background 120ms ease, color 120ms ease;
    }
    .view-switcher button:hover { color: var(--artha-text); }
    .view-switcher button.active { background: var(--artha-accent-tint); color: var(--artha-accent); font-weight: 600; }
    .month-picker {
      margin-left: auto; display: inline-flex; align-items: center; gap: 4px; padding: 4px;
      background: var(--artha-surface); border: 1px solid var(--artha-border);
      border-radius: var(--artha-radius); box-shadow: var(--artha-shadow-sm);
    }
    .month-nav {
      width: 32px; height: 32px; border: 0; background: transparent; border-radius: 8px;
      cursor: pointer; color: var(--artha-text-muted);
      display: inline-flex; align-items: center; justify-content: center;
    }
    .month-nav:hover { background: var(--artha-surface-2); color: var(--artha-text); }
    .month-nav:disabled { opacity: 0.4; cursor: not-allowed; }
    .month-nav ion-icon { font-size: 18px; }
    .range-label { min-width: 96px; text-align: center; font-size: 14px; font-weight: 600; color: var(--artha-text); }

    .num { font-variant-numeric: tabular-nums; }
    .muted { color: var(--artha-text-muted); }
    .small { font-size: 13px; }

    /* KPI cards */
    .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 18px; }
    .kpi {
      background: var(--artha-surface); border: 1px solid var(--artha-border);
      border-radius: var(--artha-radius); padding: 14px 16px; box-shadow: var(--artha-shadow-sm);
    }
    .kpi-label { margin: 0 0 8px; font-size: 12px; font-weight: 600; color: var(--artha-text-muted); }
    .kpi-value { margin: 0; font-size: 21px; font-weight: 700; color: var(--artha-text); }
    .kpi-value.sm { font-size: 16px; }
    .kpi-sub { margin: 6px 0 0; font-size: 11.5px; font-weight: 600; }
    .kpi-sub.muted { color: var(--artha-text-subtle); font-weight: 500; }
    .kpi-sub.up { color: var(--artha-negative, #dc2626); }
    .kpi-sub.down { color: var(--artha-positive, #16a34a); }

    /* Cards + layout */
    .card {
      background: var(--artha-surface); border: 1px solid var(--artha-border);
      border-radius: var(--artha-radius); padding: 16px 18px; box-shadow: var(--artha-shadow-sm);
      margin-bottom: 18px; flex: 1; min-width: 0;
    }
    .card-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 14px; }
    .card-head h2 { margin: 0; font-size: 14px; font-weight: 700; color: var(--artha-text); }
    .card-sub { font-size: 11.5px; color: var(--artha-text-subtle); }
    .charts-row { display: flex; gap: 18px; align-items: stretch; }
    .trend-card { flex: 1.7; }
    .donut-card { flex: 1; }

    .donut-body { display: flex; align-items: center; gap: 16px; }
    .donut { width: 130px; flex-shrink: 0; }
    .legend { list-style: none; margin: 0; padding: 0; flex: 1; min-width: 0; }
    .legend li { display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: 12.5px; }
    .legend .dot { width: 11px; height: 11px; border-radius: 3px; flex-shrink: 0; }
    .legend-name { color: var(--artha-text); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .legend-pct { color: var(--artha-text-muted); font-weight: 600; }

    /* Bars */
    .bars { list-style: none; margin: 0; padding: 0; }
    .bar-row { padding: 9px 6px; border-radius: 8px; }
    .bar-row:not(.static) { cursor: pointer; }
    .bar-row:not(.static):hover { background: var(--artha-surface-2); }
    .bar-top { display: flex; justify-content: space-between; margin-bottom: 6px; }
    .bar-name { font-size: 13px; font-weight: 600; color: var(--artha-text); display: inline-flex; align-items: center; gap: 4px; }
    .bar-amt { font-size: 13px; font-weight: 700; color: var(--artha-text); }
    .bar-track { height: 8px; border-radius: 4px; background: var(--artha-surface-2, #eef2f7); overflow: hidden; }
    .bar-fill { height: 100%; border-radius: 4px; transition: width 0.3s ease; }
    .expand-btn {
      display: inline-flex; align-items: center; justify-content: center;
      background: transparent; border: 0; padding: 0; margin: 0;
      color: var(--artha-text-subtle); cursor: pointer; font-size: 14px;
    }
    .bar-row--child { margin-left: 18px; }
    .bar-row--child .bar-name { font-weight: 500; color: var(--artha-text-muted); }

    /* Planned vs actual */
    .pva-line { display: flex; justify-content: space-between; align-items: baseline; padding: 5px 0; font-size: 13px; }
    .pva-line .bar-name { color: var(--artha-text-muted); }
    .pva-delta { margin-top: 8px; font-weight: 700; color: var(--artha-positive, #16a34a); }
    .pva-delta.over { color: var(--artha-negative, #dc2626); }

    /* Merchants */
    .merchants { list-style: none; margin: 0; padding: 0; }
    .merchants li {
      display: flex; justify-content: space-between; align-items: center;
      padding: 10px 4px; border-bottom: 1px solid var(--artha-border);
    }
    .merchants li:last-child { border-bottom: 0; }
    .m-name { font-size: 13px; color: var(--artha-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .m-amt { font-size: 13px; font-weight: 700; color: var(--artha-text); }

    .state, .empty {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 10px; padding: 56px 16px; color: var(--artha-text-muted);
    }
    .empty ion-icon { font-size: 40px; color: var(--artha-text-subtle); }

    @media (max-width: 820px) {
      .kpis { grid-template-columns: repeat(2, 1fr); }
      .charts-row { flex-direction: column; }
    }
    /* Clear the fixed bottom tab bar (mobile-only, <768px) plus the
       home-indicator safe area so the last card isn't hidden. */
    @media (max-width: 767.98px) {
      .page { padding-bottom: calc(84px + env(safe-area-inset-bottom)); }
    }
  `],
})
export class ReportsPage implements OnInit {
  private readonly api = inject(ExpensesApi);
  private readonly categoriesStore = inject(CategoriesStore);
  private readonly accountsStore = inject(AccountsStore);
  private readonly plannedStore = inject(PlannedExpensesStore);
  private readonly router = inject(Router);

  protected readonly view = signal<ViewMode>('monthly');
  protected readonly year = signal<number>(new Date().getFullYear());
  protected readonly month = signal<number>(new Date().getMonth() + 1);

  protected readonly loading = signal<boolean>(false);
  protected readonly currency = signal<string>('USD');
  private readonly periodExpenses = signal<Expense[]>([]);
  private readonly prevTotal = signal<number>(0);

  protected readonly rangeLabel = computed(() =>
    this.view() === 'monthly' ? `${MONTH_LABELS[this.month() - 1]} ${this.year()}` : String(this.year()),
  );

  protected readonly canStepForward = computed(() => {
    const now = new Date();
    if (this.view() === 'monthly') {
      return new Date(this.year(), this.month() - 1) < new Date(now.getFullYear(), now.getMonth());
    }
    return this.year() < now.getFullYear();
  });

  /** Spending only — excluded items (refunds/transfers) are dropped. */
  private readonly counted = computed(() => this.periodExpenses().filter((e) => !e.excluded));

  protected readonly total = computed(() =>
    this.counted().reduce((s, e) => s + e.amount, 0),
  );
  protected readonly count = computed(() => this.counted().length);

  protected readonly averageSpend = computed(() => {
    const total = this.total();
    if (total <= 0) return 0;
    if (this.view() === 'monthly') {
      const now = new Date();
      const isCurrent = this.year() === now.getFullYear() && this.month() === now.getMonth() + 1;
      const days = isCurrent ? now.getDate() : daysInMonth(this.year(), this.month());
      return total / Math.max(1, days);
    }
    const monthsWithSpend = this.monthSummaries().filter((m) => m.total > 0).length;
    return total / Math.max(1, monthsWithSpend);
  });

  protected readonly deltaInfo = computed(() => {
    if (this.view() !== 'monthly') return null;
    const prev = this.prevTotal();
    if (prev <= 0) return null;
    const d = (this.total() - prev) / prev;
    return { up: d >= 0, text: `${d >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(d * 100))}% vs prev` };
  });

  protected readonly byCategory = computed<CatRow[]>(() => {
    const byId = this.categoriesStore.byId();

    // 1. Per-category (leaf) totals.
    const leaf = new Map<string, { total: number; count: number }>();
    for (const e of this.counted()) {
      const cur = leaf.get(e.categoryId) ?? { total: 0, count: 0 };
      cur.total += e.amount;
      cur.count += 1;
      leaf.set(e.categoryId, cur);
    }

    // 2. Roll up into top-level categories, keeping the subcategory split.
    const roots = new Map<
      string,
      { total: number; count: number; children: Map<string, { total: number; count: number }> }
    >();
    for (const [id, v] of leaf) {
      const rootId = byId[id]?.parentId ?? id;
      const root = roots.get(rootId) ?? { total: 0, count: 0, children: new Map() };
      root.total += v.total;
      root.count += v.count;
      if (byId[id]?.parentId) {
        const cv = root.children.get(id) ?? { total: 0, count: 0 };
        cv.total += v.total;
        cv.count += v.count;
        root.children.set(id, cv);
      }
      roots.set(rootId, root);
    }

    const nameOf = (id: string): string => byId[id]?.name ?? 'Uncategorized';
    return [...roots.entries()]
      .sort((a, b) => b[1].total - a[1].total)
      .map(([id, r], i) => {
        const color = byId[id]?.color ?? PALETTE[i % PALETTE.length];
        const children = [...r.children.entries()]
          .sort((a, b) => b[1].total - a[1].total)
          .map(([cid, cv]) => ({
            categoryId: cid,
            name: nameOf(cid),
            color: byId[cid]?.color ?? color,
            total: cv.total,
            count: cv.count,
          }));
        return {
          categoryId: id,
          name: nameOf(id),
          color,
          total: r.total,
          count: r.count,
          children: children.length ? children : undefined,
        };
      });
  });

  /** Top-level category ids whose subcategory split is expanded in the list. */
  protected readonly expandedCategories = signal<Set<string>>(new Set());

  protected toggleCategory(event: Event, categoryId: string): void {
    event.stopPropagation();
    const next = new Set(this.expandedCategories());
    next.has(categoryId) ? next.delete(categoryId) : next.add(categoryId);
    this.expandedCategories.set(next);
  }

  protected readonly topCategory = computed(() => this.byCategory()[0] ?? null);

  // Planned (predefined) monthly bills — a fixed budget compared against actual.
  protected readonly plannedTotal = computed(() => this.plannedStore.plannedTotal());
  protected readonly plannedCount = computed(() => this.plannedStore.active().length);
  protected readonly plannedDelta = computed(() => Math.abs(this.plannedTotal() - this.total()));

  protected readonly donutSegments = computed<DonutSegment[]>(() => {
    const cats = this.byCategory();
    const top = cats.slice(0, 5).map((c) => ({ label: c.name, value: c.total, color: c.color }));
    const rest = cats.slice(5).reduce((s, c) => s + c.total, 0);
    if (rest > 0) top.push({ label: 'Other', value: rest, color: OTHER_COLOR });
    return top;
  });

  protected readonly dailySeries = computed<number[]>(() => {
    const days = daysInMonth(this.year(), this.month());
    const arr = new Array(days).fill(0);
    for (const e of this.counted()) {
      const d = Number(e.date.slice(8, 10));
      if (d >= 1 && d <= days) arr[d - 1] += e.amount;
    }
    return arr;
  });

  protected readonly monthSummaries = computed<MonthSummary[]>(() => {
    const arr: MonthSummary[] = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, total: 0, count: 0 }));
    for (const e of this.counted()) {
      const m = Number(e.date.slice(5, 7));
      if (m >= 1 && m <= 12) { arr[m - 1].total += e.amount; arr[m - 1].count += 1; }
    }
    return arr;
  });

  protected readonly topMerchants = computed(() => {
    const map = new Map<string, number>();
    for (const e of this.counted()) {
      const key = merchantOf(e.note);
      map.set(key, (map.get(key) ?? 0) + e.amount);
    }
    return [...map.entries()]
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
  });

  protected readonly byAccount = computed(() => {
    const map = new Map<string, number>();
    for (const e of this.counted()) {
      map.set(e.accountId, (map.get(e.accountId) ?? 0) + e.amount);
    }
    const byId = this.accountsStore.byId();
    return [...map.entries()]
      .map(([id, total], i) => ({
        id,
        name: byId[id]?.name ?? 'Account',
        color: PALETTE[i % PALETTE.length],
        total,
      }))
      .sort((a, b) => b.total - a.total);
  });

  ngOnInit(): void {
    if (this.categoriesStore.items().length === 0) {
      void this.categoriesStore.load(/* includeArchived */ true);
    }
    if (this.accountsStore.items().length === 0) {
      void this.accountsStore.load(/* includeArchived */ true);
    }
    void this.plannedStore.load();
    void this.refresh();
  }

  protected async setView(value: ViewMode): Promise<void> {
    if (value !== this.view()) {
      this.view.set(value);
      await this.refresh();
    }
  }

  protected async stepBack(): Promise<void> {
    if (this.view() === 'monthly') {
      if (this.month() === 1) { this.year.update((y) => y - 1); this.month.set(12); }
      else { this.month.update((m) => m - 1); }
    } else {
      this.year.update((y) => y - 1);
    }
    await this.refresh();
  }

  protected async stepForward(): Promise<void> {
    if (!this.canStepForward()) return;
    if (this.view() === 'monthly') {
      if (this.month() === 12) { this.year.update((y) => y + 1); this.month.set(1); }
      else { this.month.update((m) => m + 1); }
    } else {
      this.year.update((y) => y + 1);
    }
    await this.refresh();
  }

  protected percent(value: number): number {
    const total = this.total();
    if (total <= 0) return 0;
    return Math.round((value / total) * 100);
  }

  /** Actual spend as a share of the planned budget, capped at 100% for the bar. */
  protected plannedPercent(): number {
    const planned = this.plannedTotal();
    if (planned <= 0) return 0;
    return Math.min(100, (this.total() / planned) * 100);
  }

  protected openCategory(categoryId: string): void {
    const queryParams: Record<string, string | number> = { category: categoryId };
    if (this.view() === 'monthly') {
      queryParams['year'] = this.year();
      queryParams['month'] = this.month();
    }
    void this.router.navigate(['/expenses'], { queryParams });
  }

  private async refresh(): Promise<void> {
    this.loading.set(true);
    try {
      if (this.view() === 'monthly') {
        const cur = monthPrefix(this.year(), this.month());
        const prev = prevMonthPrefix(this.year(), this.month());
        const res = await this.api.list(prev, cur);
        this.currency.set(res.currency || 'USD');
        this.periodExpenses.set(res.items.filter((e) => e.date.startsWith(cur)));
        this.prevTotal.set(
          res.items.filter((e) => e.date.startsWith(prev)).reduce((s, e) => s + e.amount, 0),
        );
      } else {
        const res = await this.api.list(`${this.year()}-01`, `${this.year()}-12`);
        this.currency.set(res.currency || 'USD');
        this.periodExpenses.set(res.items);
        this.prevTotal.set(0);
      }
    } catch {
      this.periodExpenses.set([]);
    } finally {
      this.loading.set(false);
    }
  }
}

function monthPrefix(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function prevMonthPrefix(year: number, month: number): string {
  return month === 1 ? monthPrefix(year - 1, 12) : monthPrefix(year, month - 1);
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** Derive a readable merchant/payee from a transaction note. */
function merchantOf(note: string | null): string {
  const n = (note ?? '').trim();
  if (!n) return 'Unknown';
  if (/^UPI-/i.test(n)) {
    const parts = n.split('-');
    return (parts[1] || n).trim().slice(0, 28);
  }
  // Strip trailing reference numbers / "Value Dt ..." tails.
  const cleaned = n.replace(/\s+(value dt|ref).*$/i, '').replace(/\s+\d{6,}.*$/, '');
  return (cleaned || n).slice(0, 28).trim();
}
