import { CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { Component, OnInit, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  IonContent,
  IonIcon,
  IonSpinner,
} from '@ionic/angular/standalone';
import { SessionService } from '../../core/auth/session.service';
import { AccountsStore } from '../accounts/accounts.store';
import { CategoriesStore } from '../categories/categories.store';
import { ExpensesStore } from '../expenses/expenses.store';
import { SettingsStore } from '../settings/settings.store';

interface CategorySlice {
  id: string;
  name: string;
  amount: number;
  share: number; // 0..1
}

@Component({
  selector: 'artha-dashboard',
  standalone: true,
  imports: [
    CurrencyPipe,
    DatePipe,
    DecimalPipe,
    RouterLink,
    IonContent,
    IonIcon,
    IonSpinner,
  ],
  template: `
    <ion-content>
      <div class="page">
        @if (loading()) {
          <div class="loading">
            <ion-spinner></ion-spinner>
          </div>
        } @else {
          <!-- Hero greeting -->
          <header class="hero">
            <div>
              <p class="hero-eyebrow">{{ monthLabel() }}</p>
              <h1 class="hero-title">
                @if (currentUser(); as user) {
                  Hi, {{ firstName(user.name) }}
                } @else {
                  Welcome back
                }
              </h1>
              <p class="hero-sub">Here's how your month is shaping up.</p>
            </div>
            <a routerLink="/expenses" class="hero-cta">
              <ion-icon name="add" aria-hidden="true"></ion-icon>
              Add expense
            </a>
          </header>

          <!-- KPI tiles -->
          <section class="stats">
            <article class="stat stat--primary">
              <p class="stat-label">Spent this month</p>
              <p class="stat-value num">
                {{ expensesStore.totalAmount() | currency: currency() : 'symbol' : '1.2-2' }}
              </p>
              <p class="stat-meta">
                {{ expenseCount() }} {{ expenseCount() === 1 ? 'expense' : 'expenses' }}
                @if (dailyAverage() > 0) {
                  · {{ dailyAverage() | currency: currency() : 'symbol' : '1.0-0' }}/day avg
                }
              </p>
            </article>

            <article class="stat">
              <p class="stat-label">Top category</p>
              @if (topCategory(); as tc) {
                <p class="stat-value">{{ tc.name }}</p>
                <p class="stat-meta">
                  <span class="num">{{ tc.amount | currency: currency() : 'symbol' : '1.0-0' }}</span>
                  <span class="stat-pill">{{ (tc.share * 100) | number: '1.0-0' }}%</span>
                </p>
              } @else {
                <p class="stat-value stat-value--empty">—</p>
                <p class="stat-meta">No spending yet</p>
              }
            </article>

            <article class="stat">
              <p class="stat-label">Accounts</p>
              <p class="stat-value num">{{ accountCount() }}</p>
              <p class="stat-meta">
                {{ accountCount() === 1 ? 'account' : 'accounts' }} linked
              </p>
            </article>
          </section>

          <!-- Two-column main row -->
          <section class="main">
            <div class="card recent">
              <div class="card-header">
                <h2 class="card-title">Recent activity</h2>
                <a routerLink="/expenses" class="card-link">
                  View all
                  <ion-icon name="chevron-forward" aria-hidden="true"></ion-icon>
                </a>
              </div>
              @if (recent().length === 0) {
                <div class="empty">
                  <ion-icon name="receipt-outline" aria-hidden="true"></ion-icon>
                  <p>No expenses yet this month.</p>
                  <a routerLink="/expenses" class="empty-cta">Add your first expense</a>
                </div>
              } @else {
                <ul class="activity">
                  @for (expense of recent(); track expense.id) {
                    <li class="activity-row">
                      <span class="activity-dot" [style.background]="categoryColor(expense.categoryId)"></span>
                      <div class="activity-text">
                        <p class="activity-name">{{ categoryName(expense.categoryId) }}</p>
                        <p class="activity-meta">
                          {{ expense.date | date: 'EEE, MMM d' }}
                          @if (expense.note) { · {{ expense.note }} }
                        </p>
                      </div>
                      <span class="activity-amount num">
                        {{ expense.amount | currency: expense.currency : 'symbol' : '1.2-2' }}
                      </span>
                    </li>
                  }
                </ul>
              }
            </div>

            <div class="card breakdown">
              <div class="card-header">
                <h2 class="card-title">By category</h2>
                <a routerLink="/reports" class="card-link">
                  Reports
                  <ion-icon name="chevron-forward" aria-hidden="true"></ion-icon>
                </a>
              </div>
              @if (breakdown().length === 0) {
                <div class="empty empty--compact">
                  <p>No data yet.</p>
                </div>
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
                        <div
                          class="bar-fill"
                          [style.width.%]="slice.share * 100"
                          [style.background]="categoryColor(slice.id)"
                        ></div>
                      </div>
                      <p class="breakdown-share">{{ (slice.share * 100) | number: '1.0-0' }}%</p>
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

    .page {
      padding: 32px 28px 64px;
      max-width: 1080px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 24px;
    }
    .loading { display: flex; justify-content: center; padding: 48px; }

    /* ====== Hero ====== */
    .hero {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 24px;
      flex-wrap: wrap;
    }
    .hero-eyebrow {
      margin: 0 0 4px;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--artha-accent);
    }
    .hero-title {
      margin: 0 0 4px;
      font-size: 28px;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: var(--artha-text);
    }
    .hero-sub {
      margin: 0;
      font-size: 14px;
      color: var(--artha-text-muted);
    }
    .hero-cta {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 10px 16px;
      border-radius: var(--artha-radius-sm);
      background: var(--artha-accent);
      color: white;
      font-size: 14px;
      font-weight: 600;
      text-decoration: none;
      box-shadow: var(--artha-shadow-sm);
      transition: background 120ms ease, transform 80ms ease;
    }
    .hero-cta:hover { background: var(--artha-accent-hover); }
    .hero-cta:active { transform: translateY(1px); }
    .hero-cta ion-icon { font-size: 18px; }

    /* ====== Stat tiles ====== */
    .stats {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;
    }
    .stat {
      background: var(--artha-surface);
      border: 1px solid var(--artha-border);
      border-radius: var(--artha-radius);
      padding: 20px 22px;
      box-shadow: var(--artha-shadow-sm);
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .stat--primary {
      background: linear-gradient(135deg, var(--artha-accent) 0%, var(--artha-accent-hover) 100%);
      border-color: transparent;
      color: white;
      box-shadow: var(--artha-shadow);
    }
    .stat--primary .stat-label,
    .stat--primary .stat-meta { color: rgba(255, 255, 255, 0.78); }
    .stat--primary .stat-value { color: white; }

    .stat-label {
      margin: 0;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--artha-text-subtle);
    }
    .stat-value {
      margin: 4px 0 0;
      font-size: 28px;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: var(--artha-text);
    }
    .stat-value--empty { color: var(--artha-text-subtle); }
    .stat-meta {
      margin: 2px 0 0;
      font-size: 13px;
      color: var(--artha-text-muted);
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .stat-pill {
      display: inline-flex;
      align-items: center;
      padding: 2px 8px;
      border-radius: 999px;
      background: var(--artha-surface-2);
      color: var(--artha-text-muted);
      font-size: 11px;
      font-weight: 600;
    }
    .stat--primary .stat-pill {
      background: rgba(255, 255, 255, 0.18);
      color: white;
    }

    /* ====== Main row ====== */
    .main {
      display: grid;
      grid-template-columns: 1.5fr 1fr;
      gap: 16px;
    }
    .card {
      background: var(--artha-surface);
      border: 1px solid var(--artha-border);
      border-radius: var(--artha-radius);
      padding: 4px 4px 12px;
      box-shadow: var(--artha-shadow-sm);
      display: flex;
      flex-direction: column;
      min-height: 280px;
    }
    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 18px 12px;
    }
    .card-title {
      margin: 0;
      font-size: 14px;
      font-weight: 600;
      color: var(--artha-text);
      letter-spacing: -0.005em;
    }
    .card-link {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      font-size: 12px;
      font-weight: 600;
      color: var(--artha-accent);
      text-decoration: none;
      padding: 4px 6px;
      border-radius: 6px;
    }
    .card-link:hover { background: var(--artha-accent-tint); }
    .card-link ion-icon { font-size: 14px; }

    /* ====== Activity list ====== */
    .activity {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .activity-row {
      display: grid;
      grid-template-columns: 10px 1fr auto;
      align-items: center;
      gap: 14px;
      padding: 12px 18px;
      border-top: 1px solid var(--artha-border);
    }
    .activity-row:first-child { border-top: none; }
    .activity-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--artha-accent);
    }
    .activity-text { min-width: 0; }
    .activity-name {
      margin: 0;
      font-size: 14px;
      font-weight: 600;
      color: var(--artha-text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .activity-meta {
      margin: 2px 0 0;
      font-size: 12px;
      color: var(--artha-text-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .activity-amount {
      font-size: 14px;
      font-weight: 600;
      color: var(--artha-text);
    }

    /* ====== Breakdown ====== */
    .breakdown-list {
      list-style: none;
      margin: 0;
      padding: 0 18px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .breakdown-row { display: flex; flex-direction: column; gap: 6px; }
    .breakdown-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 13px;
    }
    .breakdown-name {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: var(--artha-text);
      font-weight: 500;
    }
    .breakdown-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--artha-accent);
    }
    .breakdown-amount {
      font-size: 13px;
      font-weight: 600;
      color: var(--artha-text);
    }
    .bar {
      width: 100%;
      height: 6px;
      border-radius: 999px;
      background: var(--artha-surface-2);
      overflow: hidden;
    }
    .bar-fill {
      height: 100%;
      border-radius: 999px;
      background: var(--artha-accent);
      transition: width 280ms ease;
    }
    .breakdown-share {
      margin: 0;
      font-size: 11px;
      color: var(--artha-text-subtle);
      text-align: right;
    }

    /* ====== Empty states ====== */
    .empty {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 36px 24px;
      color: var(--artha-text-subtle);
    }
    .empty ion-icon { font-size: 36px; color: var(--artha-text-subtle); }
    .empty p { margin: 0; font-size: 14px; }
    .empty-cta {
      margin-top: 4px;
      font-size: 13px;
      font-weight: 600;
      color: var(--artha-accent);
      text-decoration: none;
    }
    .empty-cta:hover { text-decoration: underline; }
    .empty--compact { padding: 18px; }

    /* ====== Responsive ====== */
    @media (max-width: 900px) {
      .stats { grid-template-columns: 1fr; }
      .main { grid-template-columns: 1fr; }
    }
    @media (max-width: 600px) {
      .page { padding: 20px 16px 56px; }
      .hero-title { font-size: 22px; }
      .stat-value { font-size: 24px; }
    }
  `],
})
export class DashboardComponent implements OnInit {
  protected readonly expensesStore = inject(ExpensesStore);
  private readonly categoriesStore = inject(CategoriesStore);
  private readonly accountsStore = inject(AccountsStore);
  protected readonly settingsStore = inject(SettingsStore);
  private readonly session = inject(SessionService);

  protected readonly currentUser = this.session.currentUser;

  protected readonly currency = computed(() =>
    this.expensesStore.currency() || this.settingsStore.currency() || 'USD',
  );

  protected readonly recent = computed(() =>
    this.expensesStore.items().slice(0, 8),
  );

  protected readonly expenseCount = computed(() => this.expensesStore.items().length);

  protected readonly accountCount = computed(() =>
    this.accountsStore.items().filter((a) => !a.archived).length,
  );

  protected readonly dailyAverage = computed(() => {
    const total = this.expensesStore.totalAmount();
    if (total <= 0) return 0;
    const now = new Date();
    const dayOfMonth = now.getDate();
    return total / Math.max(1, dayOfMonth);
  });

  protected readonly breakdown = computed<CategorySlice[]>(() => {
    const total = this.expensesStore.totalAmount();
    if (total <= 0) return [];

    const byCat = new Map<string, number>();
    for (const e of this.expensesStore.items()) {
      byCat.set(e.categoryId, (byCat.get(e.categoryId) ?? 0) + e.amount);
    }

    const slices: CategorySlice[] = [];
    for (const [id, amount] of byCat) {
      slices.push({
        id,
        name: this.categoryName(id),
        amount,
        share: amount / total,
      });
    }
    return slices.sort((a, b) => b.amount - a.amount).slice(0, 5);
  });

  protected readonly topCategory = computed(() => this.breakdown()[0] ?? null);

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
    if (!this.settingsStore.settings()) {
      void this.settingsStore.load();
    }
  }

  protected categoryName(id: string): string {
    return this.categoriesStore.byId()[id]?.name ?? 'Unknown';
  }

  protected categoryColor(id: string): string {
    // Deterministic colour per category from a curated palette so the
    // dashboard's activity dots, breakdown bars, and pills stay visually
    // consistent across reloads.
    const palette = [
      '#6366f1', '#10b981', '#f59e0b', '#f43f5e',
      '#06b6d4', '#8b5cf6', '#ec4899', '#84cc16',
      '#0ea5e9', '#f97316',
    ];
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
    }
    return palette[hash % palette.length];
  }

  protected monthLabel(): string {
    return new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }

  protected firstName(name: string): string {
    return name.split(' ')[0] ?? name;
  }
}
