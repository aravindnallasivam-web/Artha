import { CurrencyPipe, Location } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { IonContent, IonIcon, IonSpinner } from '@ionic/angular/standalone';
import { Expense } from '../../core/models/expense.model';
import { MONTH_LABELS } from '../../core/models/report.model';
import { CategoriesStore } from '../categories/categories.store';
import { ExpensesApi } from '../expenses/expenses.api';
import { compactMoney, countsAsSpend, merchantOf, monthPrefix, MONTH_SHORT } from './report-utils';

/**
 * One category for one month (opened from Reports): its total and change,
 * a six-month trend, the split across its subcategories, and the merchants
 * the money went to, with a link to the matching expenses.
 */
@Component({
  selector: 'artha-category-detail',
  standalone: true,
  imports: [CurrencyPipe, IonContent, IonIcon, IonSpinner],
  template: `
    <ion-content>
      <div class="page">
        <header class="top">
          <button type="button" class="back" (click)="back()" aria-label="Back to reports">
            <ion-icon name="chevron-back" aria-hidden="true"></ion-icon>
          </button>
          <span class="cat-icon" [style.background]="color() + '22'" [style.color]="color()">
            @if (category()?.icon; as ic) { <ion-icon [name]="ic" aria-hidden="true"></ion-icon> } @else { {{ name().charAt(0) }} }
          </span>
          <div class="titles">
            <h1>{{ name() }}</h1>
            <p>{{ monthLabel() }}@if (share() !== null) { · {{ share() }}% of spending }</p>
          </div>
        </header>

        @if (loading()) {
          <div class="state"><ion-spinner></ion-spinner></div>
        } @else {
          <!-- Total + six-month trend -->
          <section class="card">
            <div class="hero-top">
              <div>
                <p class="hero-value num">{{ total() | currency: currency() : 'symbol' : '1.0-0' }}</p>
                <p class="hero-sub">
                  {{ count() }} {{ count() === 1 ? 'transaction' : 'transactions' }}@if (count() > 0) { · avg {{ (total() / count()) | currency: currency() : 'symbol' : '1.0-0' }} }
                </p>
              </div>
              @if (delta(); as d) {
                <span class="pill num" [class.up]="d > 0">{{ d > 0 ? '↑' : '↓' }} {{ compact(abs(d)) }}</span>
              }
            </div>
            <div class="trend" role="group" aria-label="Last six months">
              @for (m of trend(); track m.key) {
                <button type="button" class="tbar" [class.cur]="m.current" (click)="goMonth(m.year, m.month)"
                  [attr.aria-label]="m.label + ' ' + compact(m.total)" [attr.aria-pressed]="m.current">
                  <span class="tval num">{{ m.total > 0 ? compact(m.total) : '' }}</span>
                  <span class="tfill" [style.height.%]="m.pct" [style.background]="m.current ? color() : color() + '55'"></span>
                  <span class="tlabel">{{ m.label }}</span>
                </button>
              }
            </div>
          </section>

          @if (subcategories().length > 0) {
            <section class="card">
              <h2>Subcategories</h2>
              <div class="subs">
                @for (s of subcategories(); track s.id) {
                  <div class="sub">
                    <div class="sub-top"><span>{{ s.name }}</span><b class="num">{{ s.total | currency: currency() : 'symbol' : '1.0-0' }}</b></div>
                    <div class="track"><div class="fill" [style.width.%]="s.pct" [style.background]="color()"></div></div>
                  </div>
                }
              </div>
            </section>
          }

          <section class="card">
            <div class="card-head">
              <h2>Where it went</h2>
              @if (count() > 0) { <button type="button" class="link" (click)="openExpenses()">All {{ count() }} ›</button> }
            </div>
            @if (merchants().length === 0) {
              <p class="muted">No spending in {{ name() }} this month.</p>
            } @else {
              <ul class="merchants">
                @for (m of merchants(); track m.name) {
                  <li>
                    <span class="m-name">{{ m.name }} <span class="m-count">· {{ m.count }}×</span></span>
                    <span class="m-amt num">{{ m.total | currency: currency() : 'symbol' : '1.0-0' }}</span>
                  </li>
                }
              </ul>
            }
          </section>
        }
      </div>
    </ion-content>
  `,
  styles: [`
    .page {
      display: flex; flex-direction: column; gap: 14px;
      padding: calc(12px + var(--ion-safe-area-top, 0px)) 20px 24px;
      max-width: 720px; margin: 0 auto;
    }
    .num { font-variant-numeric: tabular-nums; }
    .muted { margin: 0; font-size: 13.5px; color: var(--artha-text-muted); }
    .top { display: flex; align-items: center; gap: 10px; }
    .back {
      width: 44px; height: 44px; margin-left: -8px; border: 0; border-radius: 14px; background: transparent; cursor: pointer;
      color: var(--artha-text); display: inline-flex; align-items: center; justify-content: center;
    }
    .back ion-icon { font-size: 22px; }
    .cat-icon {
      flex: none; width: 40px; height: 40px; border-radius: 13px; font-weight: 800;
      display: inline-flex; align-items: center; justify-content: center;
    }
    .cat-icon ion-icon { font-size: 19px; }
    .titles { min-width: 0; }
    h1 { margin: 0; font-size: 20px; font-weight: 800; letter-spacing: -0.02em; color: var(--artha-text); }
    .titles p { margin: 2px 0 0; font-size: 12.5px; color: var(--artha-text-subtle); }
    .state { display: flex; justify-content: center; padding: 64px; }

    .card { padding: 16px 18px; border-radius: var(--artha-radius-2xl, 24px); background: var(--artha-surface); }
    .card h2 { margin: 0 0 12px; font-size: 15px; font-weight: 800; color: var(--artha-text); }
    .card-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
    .link { border: 0; background: none; padding: 4px 0; cursor: pointer; font: inherit; font-size: 13px; font-weight: 700; color: var(--artha-accent); }

    .hero-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
    .hero-value { margin: 0; font-size: 30px; font-weight: 800; letter-spacing: -0.03em; color: var(--artha-text); }
    .hero-sub { margin: 2px 0 0; font-size: 12.5px; color: var(--artha-text-subtle); }
    .pill {
      flex: none; margin-top: 6px; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 700;
      background: var(--artha-positive-tint, rgba(16, 185, 129, 0.14)); color: var(--artha-positive);
    }
    .pill.up { background: var(--artha-negative-tint); color: var(--artha-negative); }

    .trend { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 10px; align-items: end; height: 130px; margin-top: 16px; }
    .tbar {
      height: 100%; border: 0; background: none; padding: 0; cursor: pointer; font: inherit;
      display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 6px; min-width: 0;
    }
    .tfill { width: 100%; min-height: 4px; max-height: calc(100% - 40px); border-radius: 8px; transition: height 0.25s ease; }
    .tval { font-size: 10px; font-weight: 600; color: var(--artha-text-subtle); white-space: nowrap; }
    .tlabel { font-size: 11.5px; font-weight: 600; color: var(--artha-text-subtle); }
    .tbar.cur .tval, .tbar.cur .tlabel { color: var(--artha-text); font-weight: 800; }

    .subs { display: flex; flex-direction: column; gap: 12px; }
    .sub-top { display: flex; justify-content: space-between; gap: 10px; font-size: 13.5px; font-weight: 600; color: var(--artha-text); }
    .sub-top b { font-weight: 800; }
    .track { margin-top: 6px; height: 6px; border-radius: 999px; background: var(--artha-surface-2); overflow: hidden; }
    .fill { height: 100%; border-radius: 999px; }

    .merchants { list-style: none; margin: 0; padding: 0; }
    .merchants li { display: flex; justify-content: space-between; gap: 10px; padding: 10px 0; border-top: 1px solid var(--artha-border); }
    .merchants li:first-child { border-top: 0; }
    .m-name { font-size: 14px; font-weight: 600; color: var(--artha-text); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .m-count { font-weight: 500; color: var(--artha-text-subtle); }
    .m-amt { font-size: 14px; font-weight: 800; color: var(--artha-text); flex-shrink: 0; }
  `],
})
export class CategoryDetailPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly api = inject(ExpensesApi);
  private readonly categoriesStore = inject(CategoriesStore);

  protected readonly loading = signal(true);
  protected readonly currency = signal('INR');
  private readonly categoryId = signal('');
  protected readonly year = signal(new Date().getFullYear());
  protected readonly month = signal(new Date().getMonth() + 1);
  /** Six months of expenses ending at the selected month. */
  private readonly items = signal<Expense[]>([]);

  protected readonly category = computed(() => this.categoriesStore.byId()[this.categoryId()] ?? null);
  protected readonly name = computed(() => this.category()?.name ?? 'Category');
  protected readonly color = computed(() => this.category()?.color ?? '#6366f1');

  /** The category and, for a group, its subcategories. */
  private readonly ids = computed(() => {
    const id = this.categoryId();
    const set = new Set([id]);
    for (const c of this.categoriesStore.items()) {
      if (c.parentId === id) set.add(c.id);
    }
    return set;
  });

  private readonly monthKey = computed(() => monthPrefix(this.year(), this.month()));

  private readonly monthItems = computed(() =>
    this.items().filter((e) => e.date.startsWith(this.monthKey()) && countsAsSpend(e) && this.ids().has(e.categoryId)),
  );

  protected readonly total = computed(() => this.monthItems().reduce((s, e) => s + e.amount, 0));
  protected readonly count = computed(() => this.monthItems().length);

  protected readonly monthLabel = computed(() => `${MONTH_LABELS[this.month() - 1]} ${this.year()}`);

  /** This category's share of all spending in the month. */
  protected readonly share = computed(() => {
    const all = this.items().filter((e) => e.date.startsWith(this.monthKey()) && countsAsSpend(e)).reduce((s, e) => s + e.amount, 0);
    return all > 0 ? Math.round((this.total() / all) * 100) : null;
  });

  /** Six months, oldest first, with the selected month last. */
  protected readonly trend = computed(() => {
    const months: { key: string; year: number; month: number; label: string; total: number; current: boolean; pct: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(this.year(), this.month() - 1 - i, 1);
      months.push({
        key: monthPrefix(d.getFullYear(), d.getMonth() + 1),
        year: d.getFullYear(),
        month: d.getMonth() + 1,
        label: MONTH_SHORT[d.getMonth()],
        total: 0,
        current: i === 0,
        pct: 0,
      });
    }
    for (const e of this.items()) {
      if (!countsAsSpend(e) || !this.ids().has(e.categoryId)) continue;
      const m = months.find((x) => e.date.startsWith(x.key));
      if (m) m.total += e.amount;
    }
    const max = Math.max(...months.map((m) => m.total), 0);
    for (const m of months) m.pct = max > 0 ? Math.max(4, (m.total / max) * 100) : 4;
    return months;
  });

  /** Change vs the month before (the same days of it, for the current month). */
  protected readonly delta = computed(() => {
    const now = new Date();
    const cutoff = this.year() === now.getFullYear() && this.month() === now.getMonth() + 1 ? now.getDate() : 99;
    const p = new Date(this.year(), this.month() - 2, 1);
    const key = monthPrefix(p.getFullYear(), p.getMonth() + 1);
    const prev = this.items()
      .filter((e) => e.date.startsWith(key) && countsAsSpend(e) && this.ids().has(e.categoryId) && Number(e.date.slice(8, 10)) <= cutoff)
      .reduce((s, e) => s + e.amount, 0);
    const diff = this.total() - prev;
    return prev > 0 && Math.abs(diff) >= 1 ? diff : null;
  });

  protected readonly subcategories = computed(() => {
    const id = this.categoryId();
    const byId = this.categoriesStore.byId();
    if (byId[id]?.parentId) return [];
    const totals = new Map<string, number>();
    for (const e of this.monthItems()) {
      totals.set(e.categoryId, (totals.get(e.categoryId) ?? 0) + e.amount);
    }
    if (totals.size <= 1 && totals.has(id)) return [];
    const max = Math.max(...totals.values(), 0);
    return [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([cid, total]) => ({
        id: cid,
        name: cid === id ? `Other ${byId[id]?.name ?? ''}`.trim() : byId[cid]?.name ?? 'Other',
        total,
        pct: max > 0 ? Math.max(3, (total / max) * 100) : 0,
      }));
  });

  protected readonly merchants = computed(() => {
    const map = new Map<string, { total: number; count: number }>();
    for (const e of this.monthItems()) {
      const key = merchantOf(e.note);
      const m = map.get(key) ?? { total: 0, count: 0 };
      m.total += e.amount;
      m.count += 1;
      map.set(key, m);
    }
    return [...map.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 6);
  });

  ngOnInit(): void {
    if (this.categoriesStore.items().length === 0) {
      void this.categoriesStore.load(/* includeArchived */ true);
    }
    this.route.paramMap.subscribe((p) => this.categoryId.set(p.get('id') ?? ''));
    this.route.queryParamMap.subscribe((q) => {
      const y = Number(q.get('year'));
      const m = Number(q.get('month'));
      if (y >= 2000 && m >= 1 && m <= 12) {
        this.year.set(y);
        this.month.set(m);
      }
      void this.load();
    });
  }

  protected goMonth(year: number, month: number): void {
    void this.router.navigate([], { queryParams: { year, month }, replaceUrl: true });
  }

  protected openExpenses(): void {
    void this.router.navigate(['/expenses'], {
      queryParams: { category: this.categoryId(), year: this.year(), month: this.month() },
    });
  }

  protected back(): void {
    if (window.history.length > 1) {
      this.location.back();
    } else {
      void this.router.navigate(['/reports']);
    }
  }

  protected abs(n: number): number {
    return Math.abs(n);
  }

  protected compact(n: number): string {
    return compactMoney(n, this.currency());
  }

  private async load(): Promise<void> {
    this.loading.set(this.items().length === 0);
    const from = new Date(this.year(), this.month() - 6, 1);
    try {
      const res = await this.api.list(monthPrefix(from.getFullYear(), from.getMonth() + 1), this.monthKey());
      this.currency.set(res.currency || 'INR');
      this.items.set(res.items);
    } catch {
      this.items.set([]);
    } finally {
      this.loading.set(false);
    }
  }
}
