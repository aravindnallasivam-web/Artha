import { CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { Component, OnInit, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonSpinner,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';
import { SessionService } from '../../core/auth/session.service';
import { AccountsStore } from '../accounts/accounts.store';
import { CategoriesStore } from '../categories/categories.store';
import { ExpensesStore } from '../expenses/expenses.store';
import { SettingsStore } from '../settings/settings.store';
import { SmsCaptureService } from '../sms/sms-capture.service';

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
    IonButton,
    IonButtons,
    IonContent,
    IonHeader,
    IonIcon,
    IonSpinner,
    IonTitle,
    IonToolbar,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Home</ion-title>
        <ion-buttons slot="end">
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
          <div class="loading">
            <ion-spinner></ion-spinner>
          </div>
        } @else {
          <!-- Greeting -->
          <p class="greeting">
            @if (currentUser(); as user) {
              Hi, {{ firstName(user.name) }} 👋
            } @else {
              Welcome back 👋
            }
          </p>

          <!-- Pending SMS expenses -->
          @if (sms.isSupported() && sms.pendingCount() > 0) {
            <button type="button" class="pending-card" (click)="reviewPending()">
              <span class="pending-badge">{{ sms.pendingCount() }}</span>
              <span class="pending-text">
                <span class="pending-title">
                  {{ sms.pendingCount() === 1 ? 'expense' : 'expenses' }} from SMS waiting
                </span>
                <span class="pending-sub">Tap to review — save or dismiss each</span>
              </span>
              <ion-icon class="pending-chevron" name="chevron-forward" aria-hidden="true"></ion-icon>
            </button>
          }

          <!-- Balance hero -->
          <section class="balance">
            <div class="balance-top">
              <p class="balance-label">Total spent · {{ monthShort() }}</p>
              <a routerLink="/expenses/new" class="balance-add">
                <ion-icon name="add" aria-hidden="true"></ion-icon>
                Add
              </a>
            </div>
            <p class="balance-value num">
              {{ expensesStore.totalAmount() | currency: currency() : 'symbol' : '1.2-2' }}
            </p>
            <p class="balance-meta">
              {{ expenseCount() }} {{ expenseCount() === 1 ? 'expense' : 'expenses' }}
              @if (dailyAverage() > 0) {
                · {{ dailyAverage() | currency: currency() : 'symbol' : '1.0-0' }}/day avg
              }
            </p>
          </section>

          <!-- KPI tiles -->
          <section class="stats">
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
                      <span
                        class="activity-icon"
                        [style.background]="categoryTint(expense.categoryId)"
                        [style.color]="categoryColor(expense.categoryId)"
                      >
                        @if (categoryIcon(expense.categoryId); as ic) {
                          <ion-icon [name]="ic" aria-hidden="true"></ion-icon>
                        } @else {
                          {{ categoryName(expense.categoryId).charAt(0) }}
                        }
                      </span>
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

    .topbar-avatar {
      width: 30px; height: 30px;
      border-radius: 50%;
      object-fit: cover;
    }
    .topbar-avatar--initial {
      display: inline-flex; align-items: center; justify-content: center;
      background: linear-gradient(135deg, var(--artha-accent) 0%, var(--artha-accent-hover) 100%);
      color: white;
      font-size: 13px; font-weight: 700;
    }

    .page {
      padding: 32px 28px 64px;
      max-width: 1080px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 24px;
    }
    .loading { display: flex; justify-content: center; padding: 48px; }

    /* ====== Greeting ====== */
    .greeting {
      margin: 0;
      font-size: 14px;
      font-weight: 500;
      color: var(--artha-text-muted);
    }

    /* ====== Pending SMS card ====== */
    .pending-card {
      display: flex;
      align-items: center;
      gap: 14px;
      width: 100%;
      text-align: left;
      padding: 14px 16px;
      border: 1px solid var(--artha-accent);
      border-radius: var(--artha-radius);
      background: var(--artha-accent-tint, #eaf1ff);
      cursor: pointer;
      box-shadow: var(--artha-shadow-sm);
    }
    .pending-card:active { transform: translateY(1px); }
    .pending-badge {
      flex: none;
      min-width: 30px; height: 30px; padding: 0 8px;
      display: inline-flex; align-items: center; justify-content: center;
      border-radius: 999px;
      background: var(--artha-accent); color: #fff;
      font-size: 14px; font-weight: 800;
      font-variant-numeric: tabular-nums;
    }
    .pending-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
    .pending-title {
      font-size: 14px; font-weight: 700; color: var(--artha-text);
    }
    .pending-sub { font-size: 12px; color: var(--artha-text-muted); }
    .pending-chevron { flex: none; font-size: 18px; color: var(--artha-accent); }

    /* ====== Balance hero ====== */
    .balance {
      background: linear-gradient(135deg, var(--artha-accent) 0%, var(--artha-accent-hover) 100%);
      border-radius: var(--artha-radius-lg);
      padding: 20px 22px 22px;
      color: white;
      box-shadow: 0 10px 24px -10px rgba(79, 70, 229, 0.55);
    }
    .balance-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .balance-label {
      margin: 0;
      font-size: 11.5px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: rgba(255, 255, 255, 0.82);
    }
    .balance-add {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 7px 14px 7px 10px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.18);
      color: white;
      font-size: 13px;
      font-weight: 600;
      text-decoration: none;
      transition: background 120ms ease, transform 80ms ease;
    }
    .balance-add:hover { background: rgba(255, 255, 255, 0.28); }
    .balance-add:active { transform: translateY(1px); }
    .balance-add ion-icon { font-size: 17px; }
    .balance-value {
      margin: 14px 0 0;
      font-size: 38px;
      font-weight: 800;
      letter-spacing: -0.025em;
      line-height: 1.05;
    }
    .balance-meta {
      margin: 8px 0 0;
      font-size: 13px;
      color: rgba(255, 255, 255, 0.85);
    }

    /* ====== Stat tiles ====== */
    .stats {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;
    }
    .stat {
      background: var(--artha-surface);
      border: 1px solid var(--artha-border);
      border-radius: var(--artha-radius);
      padding: 16px 18px;
      box-shadow: var(--artha-shadow-sm);
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

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
      font-size: 20px;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: var(--artha-text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
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
      grid-template-columns: 38px 1fr auto;
      align-items: center;
      gap: 12px;
      padding: 10px 18px;
      border-top: 1px solid var(--artha-border);
    }
    .activity-row:first-child { border-top: none; }
    .activity-icon {
      width: 38px;
      height: 38px;
      border-radius: 11px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      font-weight: 700;
    }
    .activity-icon ion-icon { font-size: 19px; }
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
      .main { grid-template-columns: 1fr; }
    }
    @media (max-width: 600px) {
      .page { padding: 18px 16px 56px; gap: 18px; }
      .balance-value { font-size: 34px; }
    }
    /* Clear the fixed bottom tab bar (mobile-only, <768px) plus the
       home-indicator safe area so the last card isn't hidden. */
    @media (max-width: 767.98px) {
      .page { padding-bottom: calc(84px + env(safe-area-inset-bottom)); }
    }
  `],
})
export class DashboardComponent implements OnInit {
  protected readonly expensesStore = inject(ExpensesStore);
  private readonly categoriesStore = inject(CategoriesStore);
  private readonly accountsStore = inject(AccountsStore);
  protected readonly settingsStore = inject(SettingsStore);
  protected readonly sms = inject(SmsCaptureService);
  private readonly session = inject(SessionService);

  protected readonly currentUser = this.session.currentUser;

  protected readonly currency = computed(() =>
    this.expensesStore.currency() || this.settingsStore.currency() || 'USD',
  );

  protected readonly recent = computed(() =>
    this.expensesStore.items().slice(0, 8),
  );

  protected readonly expenseCount = computed(() =>
    this.expensesStore.items().filter((e) => !e.excluded).length,
  );

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
      if (e.excluded) continue;
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

  /** Open the persistent queue of detected-but-unattended SMS expenses. */
  protected async reviewPending(): Promise<void> {
    await this.sms.reviewPending();
  }

  protected categoryName(id: string): string {
    return this.categoriesStore.byId()[id]?.name ?? 'Unknown';
  }

  protected categoryColor(id: string): string {
    // Prefer the category's own colour; fall back to a deterministic colour
    // from a curated palette so uncoloured categories still stay consistent
    // across reloads.
    const real = this.categoriesStore.byId()[id]?.color;
    if (real) return real;
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

  protected categoryIcon(id: string): string | null {
    return this.categoriesStore.byId()[id]?.icon ?? null;
  }

  /** Translucent fill (12% alpha) of the category colour for the icon chip. */
  protected categoryTint(id: string): string {
    return `${this.categoryColor(id)}1f`;
  }

  protected monthLabel(): string {
    return new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }

  protected monthShort(): string {
    return new Date().toLocaleDateString(undefined, { month: 'long' });
  }

  protected firstName(name: string): string {
    return name.split(' ')[0] ?? name;
  }
}
