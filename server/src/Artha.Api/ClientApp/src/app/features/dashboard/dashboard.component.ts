import { CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonSkeletonText,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';
import { SessionService } from '../../core/auth/session.service';
import { AccountBalancesService } from '../accounts/account-balances.service';
import { AccountsStore } from '../accounts/accounts.store';
import { CategoriesStore } from '../categories/categories.store';
import { ExpensesStore } from '../expenses/expenses.store';
import { PlannedExpensesStore } from '../planned-expenses/planned-expenses.store';
import { ReportsApi } from '../reports/reports.api';
import { SettingsStore } from '../settings/settings.store';
import { SmsCaptureService } from '../sms/sms-capture.service';

interface CategorySlice {
  id: string;
  name: string;
  amount: number;
  share: number; // 0..1
}

interface AccountBalance {
  id: string;
  name: string;
  color: string;
  balance: number;
}

@Component({
  selector: 'artha-dashboard',
  standalone: true,
  imports: [
    CurrencyPipe,
    DatePipe,
    DecimalPipe,
    RouterLink,
    IonButton,
    IonButtons,
    IonContent,
    IonHeader,
    IonIcon,
    IonSkeletonText,
    IonTitle,
    IonToolbar,
  ],
  template: `
    <ion-header class="ion-no-border">
      <ion-toolbar>
        <ion-title>Dashboard</ion-title>
        <ion-buttons slot="end">
          <ion-button routerLink="/expenses/new" aria-label="Add expense">
            <ion-icon slot="icon-only" name="add"></ion-icon>
          </ion-button>
          <ion-button routerLink="/more" aria-label="Profile and more">
            @if (currentUser(); as u) {
              @if (u.pictureUrl) {
                <img class="topbar-avatar" [src]="u.pictureUrl" [alt]="u.name" referrerpolicy="no-referrer" />
              } @else {
                <span class="topbar-avatar topbar-avatar--initial">{{ firstName(u.name).charAt(0) }}</span>
              }
            }
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <div class="page">
        @if (loading()) {
          <div class="skeleton" aria-busy="true" aria-label="Loading">
            <ion-skeleton-text [animated]="true" class="sk-hero"></ion-skeleton-text>
            <div class="sk-stats">
              <ion-skeleton-text [animated]="true" class="sk-tile"></ion-skeleton-text>
              <ion-skeleton-text [animated]="true" class="sk-tile"></ion-skeleton-text>
              <ion-skeleton-text [animated]="true" class="sk-tile"></ion-skeleton-text>
            </div>
            <ion-skeleton-text [animated]="true" class="sk-card"></ion-skeleton-text>
            <ion-skeleton-text [animated]="true" class="sk-card"></ion-skeleton-text>
          </div>
        } @else {
          <p class="greeting">
            @if (currentUser(); as user) { Hello, {{ firstName(user.name) }} 👋 }
            @else { Welcome back 👋 }
          </p>

          <!-- Pending SMS expenses -->
          @if (sms.isSupported() && sms.pendingCount() > 0) {
            <button type="button" class="pending-card" (click)="reviewPending()">
              <span class="pending-badge">{{ sms.pendingCount() }}</span>
              <span class="pending-text">
                <span class="pending-title">
                  {{ sms.pendingCount() }} {{ sms.pendingCount() === 1 ? 'expense' : 'expenses' }} from SMS waiting
                </span>
                <span class="pending-sub">Tap to review — save or dismiss each</span>
              </span>
              <ion-icon class="pending-chevron" name="chevron-forward" aria-hidden="true"></ion-icon>
            </button>
          }

          <!-- 1 · Hero: spend + budget -->
          <section class="hero">
            <div class="hero-top">
              <p class="hero-label">Spent in {{ monthShort() }}</p>
              @if (momTrend(); as t) {
                <span class="trend" [class.trend--up]="t.up">
                  {{ t.up ? '↑' : '↓' }} {{ t.pct }}% MoM
                </span>
              }
            </div>
            <p class="hero-value num">{{ totalSpent() | currency: currency() : 'symbol' : '1.0-0' }}</p>
            @if (plannedTotal() > 0) {
              <div class="bar bar--lg">
                <div class="bar-fill" [class.bar-fill--over]="overBudget()" [style.width.%]="budgetPct()"></div>
              </div>
              <p class="hero-meta">
                @if (overBudget()) {
                  <span class="over">{{ -budgetLeft() | currency: currency() : 'symbol' : '1.0-0' }} over</span>
                  your {{ plannedTotal() | currency: currency() : 'symbol' : '1.0-0' }} plan
                } @else {
                  {{ budgetLeft() | currency: currency() : 'symbol' : '1.0-0' }} left of
                  {{ plannedTotal() | currency: currency() : 'symbol' : '1.0-0' }} planned
                }
              </p>
            } @else {
              <p class="hero-meta">
                {{ expenseCount() }} {{ expenseCount() === 1 ? 'expense' : 'expenses' }}
                @if (dailyAverage() > 0) { · {{ dailyAverage() | currency: currency() : 'symbol' : '1.0-0' }}/day }
              </p>
            }
          </section>

          <!-- 2 · Quick stats -->
          <section class="stats">
            <article class="stat">
              <p class="stat-label">Today</p>
              <p class="stat-value num">{{ todaySpent() | currency: currency() : 'symbol' : '1.0-0' }}</p>
            </article>
            <article class="stat">
              <p class="stat-label">Avg / day</p>
              <p class="stat-value num">{{ dailyAverage() | currency: currency() : 'symbol' : '1.0-0' }}</p>
            </article>
            <article class="stat">
              <p class="stat-label">Txns</p>
              <p class="stat-value num">{{ expenseCount() }}</p>
            </article>
          </section>

          <!-- 3 · Net worth + balances -->
          <section class="networth">
            <div class="nw-top">
              <p class="nw-label">Net worth</p>
              <span class="nw-count">{{ accountCount() }} {{ accountCount() === 1 ? 'account' : 'accounts' }}</span>
            </div>
            @if (balancesLoading()) {
              <ion-skeleton-text [animated]="true" style="width: 45%; height: 24px; margin: 6px 0 0"></ion-skeleton-text>
            } @else {
              <p class="nw-value num">{{ netWorth() | currency: currency() : 'symbol' : '1.0-0' }}</p>
              <div class="nw-pills">
                @for (b of accountBalances(); track b.id) {
                  <span class="nw-pill">
                    <span class="dot" [style.background]="b.color"></span>
                    {{ b.name }}
                    <strong class="num">{{ b.balance | currency: currency() : 'symbol' : '1.0-0' }}</strong>
                  </span>
                }
              </div>
            }
          </section>

          <!-- 4 + 5 · Top categories & recent (two columns on desktop) -->
          <section class="main">
            <div class="card breakdown">
              <div class="card-header">
                <h2 class="card-title">Top categories</h2>
                <a routerLink="/reports" class="card-link">Reports <ion-icon name="chevron-forward"></ion-icon></a>
              </div>
              @if (breakdown().length === 0) {
                <div class="empty empty--compact"><p>No spending yet this month.</p></div>
              } @else {
                <ul class="breakdown-list">
                  @for (slice of breakdown(); track slice.id) {
                    <li class="breakdown-row">
                      <div class="breakdown-head">
                        <span class="breakdown-name">
                          <span class="breakdown-dot" [style.background]="categoryColor(slice.id)"></span>
                          {{ slice.name }}
                        </span>
                        <span class="breakdown-amount num">
                          {{ slice.amount | currency: currency() : 'symbol' : '1.0-0' }}
                        </span>
                      </div>
                      <div class="bar">
                        <div class="bar-fill" [style.width.%]="slice.share * 100"
                          [style.background]="categoryColor(slice.id)"></div>
                      </div>
                    </li>
                  }
                </ul>
              }
            </div>

            <div class="card recent">
              <div class="card-header">
                <h2 class="card-title">Recent</h2>
                <a routerLink="/expenses" class="card-link">See all <ion-icon name="chevron-forward"></ion-icon></a>
              </div>
              @if (recent().length === 0) {
                <div class="empty">
                  <ion-icon name="receipt-outline" aria-hidden="true"></ion-icon>
                  <p>No expenses yet this month.</p>
                  <a routerLink="/expenses/new" class="empty-cta">Add your first expense</a>
                </div>
              } @else {
                <ul class="activity">
                  @for (expense of recent(); track expense.id) {
                    <li class="activity-row">
                      <span class="activity-icon"
                        [style.background]="categoryTint(expense.categoryId)"
                        [style.color]="categoryColor(expense.categoryId)">
                        @if (categoryIcon(expense.categoryId); as ic) {
                          <ion-icon [name]="ic" aria-hidden="true"></ion-icon>
                        } @else { {{ categoryName(expense.categoryId).charAt(0) }} }
                      </span>
                      <div class="activity-text">
                        <p class="activity-name">{{ categoryName(expense.categoryId) }}</p>
                        <p class="activity-meta">
                          {{ expense.date | date: 'EEE, MMM d' }}@if (expense.note) { · {{ expense.note }} }
                        </p>
                      </div>
                      <span class="activity-amount num">
                        {{ expense.amount | currency: expense.currency : 'symbol' : '1.0-0' }}
                      </span>
                    </li>
                  }
                </ul>
              }
            </div>
          </section>
        }
      </div>
    </ion-content>
  `,
  styles: [`
    :host { display: contents; }
    ion-content { --background: var(--artha-bg); }

    .topbar-avatar { width: 30px; height: 30px; border-radius: 50%; object-fit: cover; }
    .topbar-avatar--initial {
      display: inline-flex; align-items: center; justify-content: center;
      background: linear-gradient(135deg, var(--artha-accent), var(--artha-accent-hover));
      color: #fff; font-size: 13px; font-weight: 700;
    }

    .page {
      padding: 20px 16px 64px; max-width: 1080px; margin: 0 auto;
      display: flex; flex-direction: column; gap: 16px;
    }

    /* Skeleton */
    .skeleton { display: flex; flex-direction: column; gap: 16px; }
    .skeleton ion-skeleton-text { --border-radius: 14px; margin: 0; }
    .sk-hero { height: 134px; }
    .sk-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
    .sk-tile { height: 64px; }
    .sk-card { height: 180px; }

    .greeting { margin: 0; font-size: 14px; font-weight: 500; color: var(--artha-text-muted); }

    /* Pending SMS card */
    .pending-card {
      display: flex; align-items: center; gap: 14px; width: 100%; text-align: left;
      padding: 14px 16px; border: 1px solid var(--artha-accent); border-radius: var(--artha-radius);
      background: var(--artha-accent-tint, #eaf1ff); cursor: pointer; box-shadow: var(--artha-shadow-sm);
    }
    .pending-card:active { transform: translateY(1px); }
    .pending-badge {
      flex: none; min-width: 30px; height: 30px; padding: 0 8px;
      display: inline-flex; align-items: center; justify-content: center; border-radius: 999px;
      background: var(--artha-accent); color: #fff; font-size: 14px; font-weight: 800; font-variant-numeric: tabular-nums;
    }
    .pending-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
    .pending-title { font-size: 14px; font-weight: 700; color: var(--artha-text); }
    .pending-sub { font-size: 12px; color: var(--artha-text-muted); }
    .pending-chevron { flex: none; font-size: 18px; color: var(--artha-accent); }

    /* Cards (shared) */
    .hero, .networth, .card {
      background: var(--artha-surface); border: 1px solid var(--artha-border);
      border-radius: var(--artha-radius-lg); box-shadow: var(--artha-shadow-sm);
    }

    /* 1 · Hero */
    .hero { padding: 18px 20px 20px; }
    .hero-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .hero-label {
      margin: 0; font-size: 11px; font-weight: 700; letter-spacing: 0.06em;
      text-transform: uppercase; color: var(--artha-text-subtle);
    }
    .trend {
      font-size: 11.5px; font-weight: 700; padding: 3px 9px; border-radius: 999px;
      background: var(--artha-positive-tint); color: var(--artha-positive);
    }
    .trend--up { background: var(--artha-negative-tint); color: var(--artha-negative); }
    .hero-value { margin: 8px 0 0; font-size: 34px; font-weight: 800; letter-spacing: -0.025em; color: var(--artha-text); }
    .hero-meta { margin: 12px 0 0; font-size: 12.5px; color: var(--artha-text-muted); }
    .hero-meta .over { color: var(--artha-negative); font-weight: 700; }

    /* progress bar */
    .bar { width: 100%; height: 6px; border-radius: 999px; background: var(--artha-surface-2); overflow: hidden; }
    .bar--lg { height: 10px; margin-top: 14px; background: var(--artha-accent-tint); }
    .bar-fill { height: 100%; border-radius: 999px; background: var(--artha-accent); transition: width 280ms ease; }
    .bar-fill--over { background: var(--artha-negative); }

    /* 2 · Stats */
    .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
    .stat {
      background: var(--artha-surface); border: 1px solid var(--artha-border);
      border-radius: var(--artha-radius); padding: 12px 14px; box-shadow: var(--artha-shadow-sm);
    }
    .stat-label {
      margin: 0; font-size: 10px; font-weight: 600; letter-spacing: 0.05em;
      text-transform: uppercase; color: var(--artha-text-subtle);
    }
    .stat-value { margin: 6px 0 0; font-size: 18px; font-weight: 800; letter-spacing: -0.02em; color: var(--artha-text); }

    /* 3 · Net worth */
    .networth { padding: 16px 20px 18px; }
    .nw-top { display: flex; align-items: baseline; justify-content: space-between; }
    .nw-label {
      margin: 0; font-size: 10px; font-weight: 700; letter-spacing: 0.06em;
      text-transform: uppercase; color: var(--artha-text-subtle);
    }
    .nw-count { font-size: 11px; color: var(--artha-text-subtle); }
    .nw-value { margin: 6px 0 0; font-size: 22px; font-weight: 800; letter-spacing: -0.02em; color: var(--artha-text); }
    .nw-pills { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    .nw-pill {
      display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px; border-radius: 999px;
      background: var(--artha-surface-2); font-size: 11.5px; color: var(--artha-text-muted);
    }
    .nw-pill .dot { width: 7px; height: 7px; border-radius: 50%; }
    .nw-pill strong { color: var(--artha-text); font-weight: 700; }

    /* 4 + 5 · main grid */
    .main { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .card { padding: 4px 4px 12px; display: flex; flex-direction: column; }
    .card-header { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px 10px; }
    .card-title { margin: 0; font-size: 13px; font-weight: 700; color: var(--artha-text); }
    .card-link {
      display: inline-flex; align-items: center; gap: 2px; font-size: 12px; font-weight: 600;
      color: var(--artha-accent); text-decoration: none; padding: 4px 6px; border-radius: 6px;
    }
    .card-link:hover { background: var(--artha-accent-tint); }
    .card-link ion-icon { font-size: 14px; }

    /* breakdown */
    .breakdown-list { list-style: none; margin: 0; padding: 4px 16px 0; display: flex; flex-direction: column; gap: 14px; }
    .breakdown-row { display: flex; flex-direction: column; gap: 7px; }
    .breakdown-head { display: flex; justify-content: space-between; align-items: center; font-size: 13px; }
    .breakdown-name { display: inline-flex; align-items: center; gap: 8px; color: var(--artha-text); font-weight: 500; }
    .breakdown-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--artha-accent); }
    .breakdown-amount { font-size: 13px; font-weight: 700; color: var(--artha-text); }

    /* activity */
    .activity { list-style: none; margin: 0; padding: 0; }
    .activity-row {
      display: grid; grid-template-columns: 36px 1fr auto; align-items: center; gap: 12px;
      padding: 9px 16px; border-top: 1px solid var(--artha-border);
    }
    .activity-row:first-child { border-top: none; }
    .activity-icon {
      width: 36px; height: 36px; border-radius: 10px; display: inline-flex;
      align-items: center; justify-content: center; font-size: 13px; font-weight: 700;
    }
    .activity-icon ion-icon { font-size: 18px; }
    .activity-text { min-width: 0; }
    .activity-name { margin: 0; font-size: 13.5px; font-weight: 600; color: var(--artha-text);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .activity-meta { margin: 2px 0 0; font-size: 11.5px; color: var(--artha-text-muted);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .activity-amount { font-size: 13.5px; font-weight: 700; color: var(--artha-text); }

    /* empty states */
    .empty {
      flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 8px; padding: 32px 24px; color: var(--artha-text-subtle); text-align: center;
    }
    .empty ion-icon { font-size: 34px; }
    .empty p { margin: 0; font-size: 13.5px; }
    .empty-cta { margin-top: 2px; font-size: 13px; font-weight: 600; color: var(--artha-accent); text-decoration: none; }
    .empty--compact { padding: 22px; }

    @media (max-width: 720px) {
      .main { grid-template-columns: 1fr; }
    }
    @media (max-width: 767.98px) {
      .page { padding-bottom: calc(84px + env(safe-area-inset-bottom)); }
    }
  `],
})
export class DashboardComponent implements OnInit {
  protected readonly expensesStore = inject(ExpensesStore);
  private readonly categoriesStore = inject(CategoriesStore);
  private readonly accountsStore = inject(AccountsStore);
  private readonly plannedStore = inject(PlannedExpensesStore);
  protected readonly settingsStore = inject(SettingsStore);
  protected readonly sms = inject(SmsCaptureService);
  private readonly session = inject(SessionService);
  private readonly reportsApi = inject(ReportsApi);
  private readonly balancesService = inject(AccountBalancesService);

  protected readonly currentUser = this.session.currentUser;

  /** Previous-month total (for the trend chip); null until fetched. */
  private readonly prevMonthTotal = signal<number | null>(null);
  /** All-time spend per account; null until the lazy balances load resolves. */
  private readonly accountSpend = signal<Map<string, number> | null>(null);

  protected readonly currency = computed(() =>
    this.expensesStore.currency() || this.settingsStore.currency() || 'USD',
  );

  protected readonly recent = computed(() => this.expensesStore.items().slice(0, 6));

  private readonly excludedCategoryIds = computed(
    () => new Set(this.categoriesStore.items().filter((c) => c.excludeFromReports).map((c) => c.id)),
  );

  private readonly counted = computed(() => {
    const excludedCats = this.excludedCategoryIds();
    return this.expensesStore.items().filter((e) => !e.excluded && !excludedCats.has(e.categoryId));
  });

  protected readonly totalSpent = computed(() => this.counted().reduce((s, e) => s + e.amount, 0));
  protected readonly expenseCount = computed(() => this.counted().length);
  protected readonly accountCount = computed(() => this.accountsStore.active().length);

  protected readonly todaySpent = computed(() => {
    const today = isoToday();
    return this.counted().filter((e) => e.date === today).reduce((s, e) => s + e.amount, 0);
  });

  protected readonly dailyAverage = computed(() => {
    const total = this.totalSpent();
    if (total <= 0) return 0;
    return total / Math.max(1, new Date().getDate());
  });

  protected readonly plannedTotal = computed(() => this.plannedStore.plannedTotal());
  protected readonly budgetLeft = computed(() => this.plannedTotal() - this.totalSpent());
  protected readonly overBudget = computed(() => this.plannedTotal() > 0 && this.budgetLeft() < 0);
  protected readonly budgetPct = computed(() => {
    const planned = this.plannedTotal();
    if (planned <= 0) return 0;
    return Math.min(100, (this.totalSpent() / planned) * 100);
  });

  protected readonly momTrend = computed(() => {
    const prev = this.prevMonthTotal();
    if (prev === null || prev <= 0) return null;
    const cur = this.totalSpent();
    return { up: cur >= prev, pct: Math.round(Math.abs((cur - prev) / prev) * 100) };
  });

  protected readonly balancesLoading = computed(() => this.accountSpend() === null);

  protected readonly netWorth = computed(() => {
    const spend = this.accountSpend();
    if (!spend) return 0;
    return this.accountsStore
      .active()
      .reduce((sum, a) => sum + (a.openingBalance ?? 0) - (spend.get(a.id) ?? 0), 0);
  });

  protected readonly accountBalances = computed<AccountBalance[]>(() => {
    const spend = this.accountSpend();
    if (!spend) return [];
    return this.accountsStore
      .active()
      .map((a) => ({
        id: a.id,
        name: a.name,
        color: a.color ?? '#6366f1',
        balance: (a.openingBalance ?? 0) - (spend.get(a.id) ?? 0),
      }))
      .sort((x, y) => y.balance - x.balance)
      .slice(0, 4);
  });

  protected readonly breakdown = computed<CategorySlice[]>(() => {
    const total = this.totalSpent();
    if (total <= 0) return [];
    const byCat = new Map<string, number>();
    for (const e of this.counted()) {
      byCat.set(e.categoryId, (byCat.get(e.categoryId) ?? 0) + e.amount);
    }
    return [...byCat.entries()]
      .map(([id, amount]) => ({ id, name: this.categoryName(id), amount, share: amount / total }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);
  });

  protected readonly loading = computed(() =>
    this.expensesStore.loading() || this.settingsStore.loading(),
  );

  ngOnInit(): void {
    const now = new Date();
    const yyyyMm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    void this.expensesStore.load(yyyyMm, yyyyMm);
    if (this.categoriesStore.items().length === 0) {
      void this.categoriesStore.load(/* includeArchived */ true);
    }
    if (this.accountsStore.items().length === 0) {
      void this.accountsStore.load(/* includeArchived */ false);
    }
    void this.plannedStore.load();
    if (!this.settingsStore.settings()) {
      void this.settingsStore.load();
    }

    // Trend vs last month — one extra shard read.
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    this.reportsApi
      .monthly(prev.getFullYear(), prev.getMonth() + 1)
      .then((r) => this.prevMonthTotal.set(r.total))
      .catch(() => this.prevMonthTotal.set(null));

    // Account balances — lazy (walks all shards) so it doesn't block the screen.
    this.balancesService
      .spendByAccount()
      .then((map) => this.accountSpend.set(map))
      .catch(() => this.accountSpend.set(new Map()));
  }

  protected async reviewPending(): Promise<void> {
    await this.sms.reviewPending();
  }

  protected categoryName(id: string): string {
    return this.categoriesStore.byId()[id]?.name ?? 'Unknown';
  }

  protected categoryColor(id: string): string {
    const real = this.categoriesStore.byId()[id]?.color;
    if (real) return real;
    const palette = [
      '#6366f1', '#10b981', '#f59e0b', '#f43f5e',
      '#06b6d4', '#8b5cf6', '#ec4899', '#84cc16', '#0ea5e9', '#f97316',
    ];
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
    }
    return palette[hash % palette.length];
  }

  protected categoryIcon(id: string): string | null {
    return this.categoriesStore.byId()[id]?.icon ?? null;
  }

  protected categoryTint(id: string): string {
    return `${this.categoryColor(id)}1f`;
  }

  protected monthShort(): string {
    return new Date().toLocaleDateString(undefined, { month: 'long' });
  }

  protected firstName(name: string): string {
    return name.split(' ')[0] ?? name;
  }
}

/** Local 'YYYY-MM-DD' for today (matches how expense.date is stored). */
function isoToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
