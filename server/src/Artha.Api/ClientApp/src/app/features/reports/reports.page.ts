import { CurrencyPipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { IonContent, IonIcon, IonSpinner } from '@ionic/angular/standalone';
import { Expense } from '../../core/models/expense.model';
import { MONTH_LABELS, MonthSummary } from '../../core/models/report.model';
import { AccountsStore } from '../accounts/accounts.store';
import { CategoriesStore } from '../categories/categories.store';
import { ExpensesApi } from '../expenses/expenses.api';
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
    IonIcon,
    IonSpinner,
    DonutChartComponent,
    LineChartComponent,
    YearBarChartComponent,
  ],
  template: `
    <ion-content>
      <div class="page">
        <header class="top">
          <h1>Reports</h1>
          <div class="seg" role="tablist" aria-label="Period">
            <button type="button" role="tab" [attr.aria-selected]="view() === 'monthly'" [class.on]="view() === 'monthly'" (click)="setView('monthly')">Month</button>
            <button type="button" role="tab" [attr.aria-selected]="view() === 'yearly'" [class.on]="view() === 'yearly'" (click)="setView('yearly')">Year</button>
          </div>
        </header>

        <div class="stepper">
          <button type="button" class="step" (click)="stepBack()" aria-label="Previous period">
            <ion-icon name="chevron-back"></ion-icon>
          </button>
          <span class="range-label">{{ rangeLabel() }}</span>
          <button type="button" class="step" (click)="stepForward()" [disabled]="!canStepForward()" aria-label="Next period">
            <ion-icon name="chevron-forward"></ion-icon>
          </button>
        </div>

        @if (loading()) {
          <div class="state"><ion-spinner></ion-spinner></div>
        } @else if (count() === 0) {
          <div class="empty">
            <span class="empty-badge"><ion-icon name="stats-chart-outline"></ion-icon></span>
            <p>No spending recorded for {{ rangeLabel() }}.</p>
          </div>
        } @else {
          <!-- Donut + key stats -->
          <section class="card hero">
            <div class="donut-col">
              <artha-donut-chart
                class="donut"
                [segments]="donutSegments()"
                [currency]="currency()"
                [interactive]="true"
                (segmentSelect)="onDonutSelect($event)"
              ></artha-donut-chart>
              @if (donutRoot()) {
                <button type="button" class="link back" (click)="clearDonutDrill()">‹ {{ donutRootName() }}</button>
              }
            </div>
            <div class="stats">
              @if (deltaInfo(); as d) {
                <div class="stat">
                  <span class="stat-label">vs previous month</span>
                  <span class="stat-value num" [class.up]="d.up" [class.down]="!d.up">
                    {{ d.up ? '↑' : '↓' }} {{ d.amount | currency: currency() : 'symbol' : '1.0-0' }}
                  </span>
                </div>
              } @else {
                <div class="stat">
                  <span class="stat-label">Total spent</span>
                  <span class="stat-value num">{{ total() | currency: currency() : 'symbol' : '1.0-0' }}</span>
                </div>
              }
              <div class="stat">
                <span class="stat-label">{{ view() === 'monthly' ? 'Daily average' : 'Monthly average' }}</span>
                <span class="stat-value num">{{ averageSpend() | currency: currency() : 'symbol' : '1.0-0' }}</span>
              </div>
              <div class="stat">
                <span class="stat-label">Transactions</span>
                <span class="stat-value num">{{ count() }}</span>
              </div>
            </div>
            <ul class="legend">
              @for (seg of donutSegments(); track seg.label) {
                <li>
                  <span class="dot" [style.background]="seg.color"></span>
                  <span class="legend-name">{{ seg.label }}</span>
                  <span class="legend-pct">{{ percent(seg.value) }}%</span>
                </li>
              }
            </ul>
          </section>

          <!-- Month bars -->
          <section class="card">
            @if (view() === 'monthly') {
              <h2>Last 6 months</h2>
              <div class="mbars">
                @for (m of lastSixMonths(); track m.key) {
                  <div class="mbar">
                    <span class="mbar-fill" [class.current]="m.current" [style.height.%]="m.pct"
                      [attr.aria-label]="m.label + ' ' + (m.total | currency: currency() : 'symbol' : '1.0-0')"></span>
                    <span class="mbar-label" [class.current]="m.current">{{ m.label }}</span>
                  </div>
                }
              </div>
            } @else {
              <h2>Monthly spend · {{ rangeLabel() }}</h2>
              <artha-year-bar-chart [months]="monthSummaries()" [currency]="currency()"></artha-year-bar-chart>
            }
          </section>

          @if (view() === 'monthly') {
            <section class="card">
              <h2>Daily spending</h2>
              <artha-line-chart [series]="dailySeries()" [currency]="currency()"></artha-line-chart>
            </section>
          }

          <!-- Category breakdown -->
          <section class="card list-card">
            <div class="card-head">
              <h2>Categories</h2>
              <span class="card-sub">Tap to see expenses</span>
            </div>
            <ul class="cats">
              @for (row of byCategory(); track row.categoryId) {
                <li class="cat" (click)="openCategory(row.categoryId)">
                  <span class="dot lg" [style.background]="row.color"></span>
                  <div class="cat-body">
                    <div class="cat-top">
                      <span class="cat-name">
                        {{ row.name }}
                        @if (row.children) {
                          <button
                            type="button"
                            class="expand-btn"
                            [attr.aria-label]="'Toggle subcategories of ' + row.name"
                            [attr.aria-expanded]="expandedCategories().has(row.categoryId)"
                            (click)="toggleCategory($event, row.categoryId)"
                          >
                            <ion-icon [name]="expandedCategories().has(row.categoryId) ? 'chevron-down' : 'chevron-forward'"></ion-icon>
                          </button>
                        }
                      </span>
                      <span class="cat-amt num">{{ row.total | currency: currency() : 'symbol' : '1.0-0' }}</span>
                    </div>
                    <div class="track"><div class="fill" [style.width.%]="share(row.total)" [style.background]="row.color"></div></div>
                  </div>
                </li>
                @if (row.children && expandedCategories().has(row.categoryId)) {
                  @for (child of row.children; track child.categoryId) {
                    <li class="cat child" (click)="openCategory(child.categoryId)">
                      <span class="dot" [style.background]="child.color"></span>
                      <div class="cat-body">
                        <div class="cat-top">
                          <span class="cat-name">{{ child.name }}</span>
                          <span class="cat-amt num">{{ child.total | currency: currency() : 'symbol' : '1.0-0' }}</span>
                        </div>
                        <div class="track"><div class="fill" [style.width.%]="share(child.total)" [style.background]="child.color"></div></div>
                      </div>
                    </li>
                  }
                }
              }
            </ul>
          </section>

          <div class="two-col">
            <section class="card list-card">
              <h2>Top merchants</h2>
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
            </section>

            <section class="card list-card">
              <h2>By account</h2>
              <ul class="cats">
                @for (a of byAccount(); track a.id) {
                  <li class="cat static">
                    <span class="dot lg" [style.background]="a.color"></span>
                    <div class="cat-body">
                      <div class="cat-top">
                        <span class="cat-name">{{ a.name }}</span>
                        <span class="cat-amt num">{{ percent(a.total) }}%</span>
                      </div>
                      <div class="track"><div class="fill" [style.width.%]="percent(a.total)" [style.background]="a.color"></div></div>
                    </div>
                  </li>
                }
              </ul>
            </section>
          </div>
        }
      </div>
    </ion-content>
  `,
  styles: [`
    .page {
      display: flex; flex-direction: column; gap: 14px;
      padding: calc(16px + var(--ion-safe-area-top, 0px)) 20px 24px;
      max-width: 960px; margin: 0 auto;
    }
    .top { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    h1 { margin: 0; font-size: 26px; font-weight: 800; letter-spacing: -0.03em; color: var(--artha-text); }
    .seg { display: inline-flex; padding: 4px; border-radius: 999px; background: var(--artha-surface-2); }
    .seg button {
      height: 32px; padding: 0 14px; border: 0; border-radius: 999px; cursor: pointer;
      background: transparent; color: var(--artha-text-muted); font: inherit; font-size: 12.5px; font-weight: 600;
    }
    .seg button.on { background: var(--artha-surface); color: var(--artha-text); font-weight: 700; box-shadow: var(--artha-shadow); }

    .stepper {
      align-self: center; display: inline-flex; align-items: center; gap: 4px; padding: 4px;
      border-radius: 999px; background: var(--artha-surface); border: 1px solid var(--artha-border);
    }
    .step {
      width: 36px; height: 36px; border: 0; border-radius: 50%; background: transparent; cursor: pointer;
      color: var(--artha-text-muted); display: inline-flex; align-items: center; justify-content: center;
    }
    .step:hover { background: var(--artha-surface-2); color: var(--artha-text); }
    .step:disabled { opacity: 0.35; cursor: default; }
    .step ion-icon { font-size: 18px; }
    .range-label { min-width: 110px; text-align: center; font-size: 14px; font-weight: 700; color: var(--artha-text); }

    .num { font-variant-numeric: tabular-nums; }
    .muted { color: var(--artha-text-muted); }
    .small { font-size: 13px; }

    .card { padding: 16px 18px; border-radius: var(--artha-radius-2xl, 24px); background: var(--artha-surface); }
    .card h2 { margin: 0 0 12px; font-size: 15px; font-weight: 800; color: var(--artha-text); }
    .card-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
    .card-sub { font-size: 12px; color: var(--artha-text-subtle); }
    .list-card { padding-bottom: 8px; }

    /* Donut hero */
    .hero { display: flex; flex-wrap: wrap; align-items: center; gap: 16px; }
    .donut-col { display: flex; flex-direction: column; align-items: center; gap: 6px; flex: 0 0 auto; }
    .donut { width: 150px; }
    .link { border: 0; background: none; padding: 4px 6px; cursor: pointer; color: var(--artha-accent); font: inherit; font-size: 12.5px; font-weight: 700; }
    .stats { flex: 1; min-width: 140px; display: flex; flex-direction: column; gap: 12px; }
    .stat { display: flex; flex-direction: column; gap: 2px; }
    .stat-label { font-size: 12px; font-weight: 600; color: var(--artha-text-subtle); }
    .stat-value { font-size: 17px; font-weight: 800; color: var(--artha-text); }
    .stat-value.up { color: var(--artha-negative); }
    .stat-value.down { color: var(--artha-positive); }
    .legend {
      flex-basis: 100%; list-style: none; margin: 0; padding: 0;
      display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 16px;
    }
    .legend li { display: flex; align-items: center; gap: 6px; font-size: 12.5px; min-width: 0; }
    .legend-name { flex: 1; min-width: 0; color: var(--artha-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .legend-pct { color: var(--artha-text-muted); font-weight: 700; }
    .dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    .dot.lg { width: 10px; height: 10px; }

    /* Last-6-months bars */
    .mbars { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 10px; align-items: end; height: 130px; }
    .mbar { display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 6px; height: 100%; }
    .mbar-fill {
      width: 100%; min-height: 4px; border-radius: 8px; max-height: calc(100% - 22px);
      background: var(--artha-accent-tint); transition: height 0.3s ease;
    }
    .mbar-fill.current { background: var(--artha-accent); }
    .mbar-label { font-size: 11.5px; font-weight: 600; color: var(--artha-text-subtle); }
    .mbar-label.current { color: var(--artha-text); font-weight: 800; }

    /* Category / account rows */
    .cats { list-style: none; margin: 0; padding: 0; }
    .cat { display: flex; align-items: center; gap: 12px; padding: 10px 6px; margin: 0 -6px; border-radius: 12px; cursor: pointer; }
    .cat:hover:not(.static) { background: var(--artha-surface-2); }
    .cat.static { cursor: default; }
    .cat.child { padding-left: 28px; }
    .cat.child .cat-name { font-weight: 600; color: var(--artha-text-muted); }
    .cat-body { flex: 1; min-width: 0; }
    .cat-top { display: flex; justify-content: space-between; gap: 10px; font-size: 14px; }
    .cat-name { display: inline-flex; align-items: center; gap: 4px; min-width: 0; font-weight: 700; color: var(--artha-text); }
    .cat-amt { font-weight: 700; color: var(--artha-text); flex-shrink: 0; }
    .track { margin-top: 6px; height: 6px; border-radius: 999px; background: var(--artha-surface-2); overflow: hidden; }
    .fill { height: 100%; border-radius: 999px; transition: width 0.3s ease; }
    .expand-btn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 28px; height: 28px; margin: -6px 0; border: 0; border-radius: 8px; background: transparent;
      color: var(--artha-text-subtle); cursor: pointer; font-size: 15px;
    }

    .two-col { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
    .merchants { list-style: none; margin: 0; padding: 0; }
    .merchants li { display: flex; justify-content: space-between; gap: 10px; padding: 10px 0; border-top: 1px solid var(--artha-border); }
    .merchants li:first-child { border-top: 0; }
    .m-name { font-size: 14px; color: var(--artha-text); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .m-amt { font-size: 14px; font-weight: 700; color: var(--artha-text); flex-shrink: 0; }

    .state, .empty {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 12px; padding: 64px 16px; color: var(--artha-text-muted); text-align: center;
    }
    .empty-badge {
      width: 64px; height: 64px; border-radius: 22px; display: grid; place-items: center;
      background: var(--artha-accent-tint); color: var(--artha-accent); font-size: 30px;
    }
    .empty p { margin: 0; }

    @media (max-width: 720px) {
      .two-col { grid-template-columns: minmax(0, 1fr); }
    }
  `],
})
export class ReportsPage implements OnInit {
  private readonly api = inject(ExpensesApi);
  private readonly categoriesStore = inject(CategoriesStore);
  private readonly accountsStore = inject(AccountsStore);
  private readonly router = inject(Router);

  protected readonly view = signal<ViewMode>('monthly');
  protected readonly year = signal<number>(new Date().getFullYear());
  protected readonly month = signal<number>(new Date().getMonth() + 1);

  protected readonly loading = signal<boolean>(false);
  protected readonly currency = signal<string>('USD');
  private readonly periodExpenses = signal<Expense[]>([]);
  private readonly prevTotal = signal<number>(0);
  /** Monthly view: the six months ending at the selected month (for the bars). */
  private readonly recentExpenses = signal<Expense[]>([]);

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
    const diff = this.total() - prev;
    return { up: diff >= 0, amount: Math.abs(diff) };
  });

  /** Spend per month for the six months ending at the selected one. */
  protected readonly lastSixMonths = computed(() => {
    const months: { key: string; label: string; total: number; current: boolean; pct: number }[] = [];
    let y = this.year();
    let m = this.month();
    for (let i = 0; i < 6; i++) {
      months.unshift({ key: monthPrefix(y, m), label: MONTH_LABELS[m - 1].slice(0, 3), total: 0, current: i === 0, pct: 0 });
      if (m === 1) { y -= 1; m = 12; } else { m -= 1; }
    }
    for (const e of this.recentExpenses()) {
      if (e.excluded) continue;
      const bucket = months.find((b) => e.date.startsWith(b.key));
      if (bucket) bucket.total += e.amount;
    }
    const max = Math.max(...months.map((b) => b.total), 0);
    for (const b of months) b.pct = max > 0 ? Math.max(3, (b.total / max) * 100) : 3;
    return months;
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

  /** Drilled-into root category id (donut shows its subcategory split), or null. */
  protected readonly donutRoot = signal<string | null>(null);
  protected readonly donutRootName = computed(() => {
    const r = this.donutRoot();
    return r ? this.byCategory().find((c) => c.categoryId === r)?.name ?? '' : '';
  });

  protected readonly donutSegments = computed<DonutSegment[]>(() => {
    const cats = this.byCategory();
    const root = this.donutRoot();
    if (root) {
      const kids = cats.find((c) => c.categoryId === root)?.children ?? [];
      if (kids.length) {
        return kids.map((c) => ({ id: c.categoryId, label: c.name, value: c.total, color: c.color }));
      }
    }
    const top: DonutSegment[] = cats
      .slice(0, 5)
      .map((c) => ({ id: c.categoryId, label: c.name, value: c.total, color: c.color }));
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

  /** Click a root slice to drill into its subcategories (when it has >1). */
  protected onDonutSelect(seg: DonutSegment): void {
    if (this.donutRoot() || !seg.id) {
      return;
    }
    const kids = this.byCategory().find((c) => c.categoryId === seg.id)?.children;
    if (kids && kids.length > 1) {
      this.donutRoot.set(seg.id);
    }
  }

  protected clearDonutDrill(): void {
    this.donutRoot.set(null);
  }

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

  /** Width of a row's bar relative to the biggest category. */
  protected share(value: number): number {
    const top = this.byCategory()[0]?.total ?? 0;
    return top > 0 ? Math.round((value / top) * 100) : 0;
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
    // Changing period exits any donut drill-down.
    this.donutRoot.set(null);
    this.loading.set(true);
    try {
      if (this.view() === 'monthly') {
        const cur = monthPrefix(this.year(), this.month());
        const prev = prevMonthPrefix(this.year(), this.month());
        const res = await this.api.list(monthsBackPrefix(this.year(), this.month(), 5), cur);
        this.currency.set(res.currency || 'USD');
        this.recentExpenses.set(res.items);
        this.periodExpenses.set(res.items.filter((e) => e.date.startsWith(cur)));
        this.prevTotal.set(
          res.items.filter((e) => e.date.startsWith(prev) && !e.excluded).reduce((s, e) => s + e.amount, 0),
        );
      } else {
        const res = await this.api.list(`${this.year()}-01`, `${this.year()}-12`);
        this.currency.set(res.currency || 'USD');
        this.periodExpenses.set(res.items);
        this.recentExpenses.set([]);
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

function monthsBackPrefix(year: number, month: number, back: number): string {
  const d = new Date(year, month - 1 - back, 1);
  return monthPrefix(d.getFullYear(), d.getMonth() + 1);
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
