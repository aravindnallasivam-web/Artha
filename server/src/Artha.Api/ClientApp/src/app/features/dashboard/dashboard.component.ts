import { CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonContent, IonIcon, IonSkeletonText } from '@ionic/angular/standalone';
import { SessionService } from '../../core/auth/session.service';
import { cardOwed, daysUntil, dueLabel, nextDueDate } from '../../core/models/card-cycle';
import { BillsService } from '../bills/bills.service';
import { AccountsStore } from '../accounts/accounts.store';
import { InvestmentsStore } from '../investments/investments.store';
import { CategoriesStore } from '../categories/categories.store';
import { ExpensesStore } from '../expenses/expenses.store';
import { LoansStore } from '../loans/loans.store';
import { monthlyEquivalent } from '../../core/models/planned-expense.model';
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
    IonSkeletonText,
  ],
  template: `
    <ion-content>
      <div class="page">
        <!-- Top bar -->
        <header class="topbar">
          <a routerLink="/more" class="avatar" aria-label="Profile and more">
            @if (currentUser(); as u) {
              @if (u.pictureUrl) {
                <img [src]="u.pictureUrl" [alt]="u.name" referrerpolicy="no-referrer" />
              } @else {
                <span>{{ firstName(u.name).charAt(0) }}</span>
              }
            } @else {
              <span>A</span>
            }
          </a>
          <div class="hello">
            <span class="hello-sub">{{ greeting() }}</span>
            <span class="hello-name">{{ currentUser() ? firstName(currentUser()!.name) : 'Welcome back' }}</span>
          </div>
          <span class="month-pill">{{ monthShort() }}</span>
          <a routerLink="/expenses/new" class="desk-add" aria-label="Add expense">
            <ion-icon name="add" aria-hidden="true"></ion-icon><span>Add expense</span>
          </a>
        </header>

        @if (loading()) {
          <div class="skeleton" aria-busy="true" aria-label="Loading">
            <ion-skeleton-text [animated]="true" class="sk-hero"></ion-skeleton-text>
            <div class="sk-actions">
              <ion-skeleton-text [animated]="true" class="sk-tile"></ion-skeleton-text>
              <ion-skeleton-text [animated]="true" class="sk-tile"></ion-skeleton-text>
              <ion-skeleton-text [animated]="true" class="sk-tile"></ion-skeleton-text>
              <ion-skeleton-text [animated]="true" class="sk-tile"></ion-skeleton-text>
            </div>
            <ion-skeleton-text [animated]="true" class="sk-card"></ion-skeleton-text>
            <ion-skeleton-text [animated]="true" class="sk-card"></ion-skeleton-text>
          </div>
        } @else {
          <!-- Spend hero -->
          <section class="hero">
            <div class="hero-top">
              <span class="hero-label">Spent this month</span>
              @if (momTrend(); as t) {
                <span class="trend">{{ t.up ? '↑' : '↓' }} {{ t.pct }}% vs last month</span>
              }
            </div>
            <p class="hero-value num">{{ totalSpent() | currency: currency() : 'symbol' : '1.0-0' }}</p>
            <div class="hero-stats">
              <div>
                <span class="hs-label">Today</span>
                <span class="hs-value num">{{ todaySpent() | currency: currency() : 'symbol' : '1.0-0' }}</span>
              </div>
              <div>
                <span class="hs-label">Avg / day</span>
                <span class="hs-value num">{{ dailyAverage() | currency: currency() : 'symbol' : '1.0-0' }}</span>
              </div>
              <div>
                <span class="hs-label">{{ expenseCount() === 1 ? 'Expense' : 'Expenses' }}</span>
                <span class="hs-value num">{{ expenseCount() }}</span>
              </div>
            </div>
            @if (expensesStore.incomeTotal() > 0) {
              <p class="hero-income">
                + {{ expensesStore.incomeTotal() | currency: currency() : 'symbol' : '1.0-0' }} received this month
              </p>
            }
          </section>

          <!-- Quick actions -->
          <nav class="actions" aria-label="Quick actions">
            <a routerLink="/expenses/new" class="action">
              <span class="action-ic ic-accent"><ion-icon name="add" aria-hidden="true"></ion-icon></span>Add
            </a>
            @if (sms.isSupported()) {
              <button type="button" class="action" [disabled]="scanning()" (click)="scanSms()">
                <span class="action-ic ic-green"><ion-icon name="mail" aria-hidden="true"></ion-icon></span>
                {{ scanning() ? 'Scanning…' : 'Scan SMS' }}
              </button>
            } @else {
              <a routerLink="/categories" class="action">
                <span class="action-ic ic-green"><ion-icon name="pricetag-outline" aria-hidden="true"></ion-icon></span>Categories
              </a>
            }
            <a routerLink="/planned-expenses" class="action">
              <span class="action-ic ic-orange"><ion-icon name="calendar-outline" aria-hidden="true"></ion-icon></span>Planned
            </a>
            <a routerLink="/loans" class="action">
              <span class="action-ic ic-blue"><ion-icon name="cash-outline" aria-hidden="true"></ion-icon></span>Loans
            </a>
          </nav>

          <!-- Pending SMS expenses -->
          @if (investments.rows().length > 0) {
            @let inv = investments.totals();
            <a class="card inv" routerLink="/investments">
              <div class="card-head">
                <h2>Investments</h2>
                <span class="more">{{ inv.count }} {{ inv.count === 1 ? 'holding' : 'holdings' }} <ion-icon name="chevron-forward" aria-hidden="true"></ion-icon></span>
              </div>
              <p class="inv-value num">{{ inv.value | currency: 'INR' : 'symbol' : '1.0-0' }}</p>
              <div class="inv-stats">
                <div>
                  <span class="inv-k">Total P&amp;L</span>
                  <span class="inv-v num" [class.inv-up]="inv.pnl >= 0" [class.inv-down]="inv.pnl < 0">
                    {{ signOf(inv.pnl) }}{{ abs(inv.pnl) | currency: 'INR' : 'symbol' : '1.0-0' }}
                    @if (inv.pnlPct != null) { <small>({{ signOf(inv.pnl) }}{{ abs(inv.pnlPct) | number: '1.1-1' }}%)</small> }
                  </span>
                </div>
                @if (inv.dayChange != null) {
                  <div>
                    <span class="inv-k">Today</span>
                    <span class="inv-v num" [class.inv-up]="inv.dayChange >= 0" [class.inv-down]="inv.dayChange < 0">
                      {{ signOf(inv.dayChange) }}{{ abs(inv.dayChange) | currency: 'INR' : 'symbol' : '1.0-0' }}
                      @if (inv.dayChangePct != null) { <small>({{ signOf(inv.dayChange) }}{{ abs(inv.dayChangePct) | number: '1.1-1' }}%)</small> }
                    </span>
                  </div>
                }
                <div>
                  <span class="inv-k">Invested</span>
                  <span class="inv-v num">{{ inv.invested | currency: 'INR' : 'symbol' : '1.0-0' }}</span>
                </div>
              </div>
            </a>
          }

          @if (sms.isSupported() && sms.pendingCount() > 0) {
            <button type="button" class="pending" (click)="reviewPending()">
              <span class="pending-badge">{{ sms.pendingCount() }}</span>
              <span class="pending-text">
                {{ sms.pendingCount() === 1 ? 'expense' : 'expenses' }} from SMS waiting for review
              </span>
              <ion-icon name="chevron-forward" aria-hidden="true"></ion-icon>
            </button>
          }

          @for (bill of cardBillsDue(); track bill.id) {
            <a class="pending card-due" routerLink="/accounts">
              <span class="pending-badge card-due-badge"><ion-icon name="card" aria-hidden="true"></ion-icon></span>
              <span class="pending-text">
                {{ bill.name }} bill due {{ bill.when }}
                @if (bill.owed > 0) { · <span class="num">{{ bill.owed | currency: bill.currency : 'symbol' : '1.0-0' }}</span> owed }
              </span>
              <ion-icon name="chevron-forward" aria-hidden="true"></ion-icon>
            </a>
          }

          <!-- Bills found in SMS (statements, "due on" reminders) -->
          @for (b of bills.upcoming(); track b.id) {
            <a class="pending" [class.card-due]="b.daysLeft <= 2" routerLink="/bills">
              <span class="pending-badge" [class.card-due-badge]="b.daysLeft <= 2">
                <ion-icon [name]="b.kind === 'card' ? 'card' : 'receipt-outline'" aria-hidden="true"></ion-icon>
              </span>
              <span class="pending-text">
                {{ b.title }} · <span class="num">{{ b.amount | currency: 'INR' : 'symbol' : '1.0-0' }}</span>
                {{ b.daysLeft < 0 ? 'was due ' + b.when : 'due ' + b.when }}
              </span>
              <ion-icon name="chevron-forward" aria-hidden="true"></ion-icon>
            </a>
          }

          <div class="grid">
            <!-- Where it went -->
            <section class="card">
              <div class="card-head">
                <h2>Where it went</h2>
                <a routerLink="/reports">Reports</a>
              </div>
              @if (breakdown().length === 0) {
                <p class="empty-line">No spending yet this month.</p>
              } @else {
                <div class="stack" role="img" [attr.aria-label]="breakdownLabel()">
                  @for (slice of breakdown(); track slice.id) {
                    <span [style.flex]="slice.share" [style.background]="categoryColor(slice.id)"></span>
                  }
                  @if (otherShare() > 0.005) {
                    <span class="stack-other" [style.flex]="otherShare()"></span>
                  }
                </div>
                <ul class="legend">
                  @for (slice of breakdown(); track slice.id) {
                    <li>
                      <span class="dot" [style.background]="categoryColor(slice.id)"></span>
                      <span class="legend-name">{{ slice.name }}</span>
                      <b class="num">{{ slice.amount | currency: currency() : 'symbol' : '1.0-0' }}</b>
                    </li>
                  }
                </ul>
              }
            </section>

            <!-- Recent -->
            <section class="card">
              <div class="card-head">
                <h2>Recent</h2>
                <a routerLink="/expenses">See all</a>
              </div>
              @if (recent().length === 0) {
                <div class="empty">
                  <ion-icon name="receipt-outline" aria-hidden="true"></ion-icon>
                  <p>No expenses yet this month.</p>
                  <a routerLink="/expenses/new">Add your first expense</a>
                </div>
              } @else {
                <ul class="rows">
                  @for (expense of recent(); track expense.id) {
                    <li class="row">
                      <span class="row-ic"
                        [style.background]="categoryTint(expense.categoryId)"
                        [style.color]="categoryColor(expense.categoryId)">
                        @if (categoryIcon(expense.categoryId); as ic) {
                          <ion-icon [name]="ic" aria-hidden="true"></ion-icon>
                        } @else { {{ categoryName(expense.categoryId).charAt(0) }} }
                      </span>
                      <div class="row-text">
                        <p class="row-name">{{ expense.note || categoryName(expense.categoryId) }}</p>
                        <p class="row-meta">{{ categoryName(expense.categoryId) }} · {{ expense.date | date: 'EEE, MMM d' }}</p>
                      </div>
                      <span class="row-amt num" [class.income]="expense.type === 'income'">
                        {{ expense.type === 'income' ? '+' : '−' }}{{ expense.amount | currency: expense.currency : 'symbol' : '1.0-0' }}
                      </span>
                    </li>
                  }
                </ul>
              }
            </section>

            <!-- Loans -->
            @if (activeLoans().length > 0) {
              <a class="card card-link" routerLink="/loans">
                <div class="card-head">
                  <h2>Loans</h2>
                  <span class="more">{{ activeLoans().length }} active <ion-icon name="chevron-forward" aria-hidden="true"></ion-icon></span>
                </div>
                <div class="figs">
                  <div>
                    <span class="hs-label muted">Outstanding</span>
                    <span class="fig num">{{ totalOutstanding() | currency: currency() : 'symbol' : '1.0-0' }}</span>
                  </div>
                  <div>
                    <span class="hs-label muted">Monthly EMI</span>
                    <span class="fig num">{{ totalEmi() | currency: currency() : 'symbol' : '1.0-0' }}</span>
                  </div>
                </div>
              </a>
            }

            <!-- Planned -->
            @if (plannedItems().length > 0) {
              <a class="card card-link" routerLink="/planned-expenses">
                <div class="card-head">
                  <h2>Planned this month</h2>
                  <span class="fig-sm num">{{ plannedTotal() | currency: currency() : 'symbol' : '1.0-0' }}</span>
                </div>
                <ul class="planned">
                  @for (p of plannedPreview(); track p.id) {
                    <li>
                      <span class="planned-name">{{ p.name }}</span>
                      <span class="num">{{ p.monthly | currency: currency() : 'symbol' : '1.0-0' }}</span>
                    </li>
                  }
                </ul>
                @if (plannedItems().length > plannedPreview().length) {
                  <p class="planned-more">+{{ plannedItems().length - plannedPreview().length }} more</p>
                }
              </a>
            }
          </div>
        }
      </div>
    </ion-content>
  `,
  styles: [`
    :host { display: contents; }
    ion-content { --background: var(--artha-bg); }
    .num { font-variant-numeric: tabular-nums; }

    .page {
      max-width: 1080px; margin: 0 auto;
      padding: calc(16px + var(--ion-safe-area-top, 0px)) 20px 32px;
      display: flex; flex-direction: column; gap: 16px;
    }

    /* Top bar */
    .topbar { display: flex; align-items: center; gap: 12px; }
    .avatar {
      width: 44px; height: 44px; flex: none; border-radius: 50%; overflow: hidden;
      display: grid; place-items: center; text-decoration: none;
      background: var(--artha-accent-tint); color: var(--artha-accent);
      font-size: 16px; font-weight: 800;
    }
    .avatar img { width: 100%; height: 100%; object-fit: cover; }
    .hello { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .hello-sub { font-size: 13px; font-weight: 500; color: var(--artha-text-subtle); }
    .hello-name {
      font-size: 18px; font-weight: 800; letter-spacing: -0.02em; color: var(--artha-text);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .month-pill {
      flex: none; height: 40px; padding: 0 14px; display: inline-flex; align-items: center;
      border: 1px solid var(--artha-border); border-radius: 999px;
      background: var(--artha-surface); color: var(--artha-text); font-size: 13.5px; font-weight: 700;
    }
    .desk-add {
      display: none; align-items: center; gap: 6px; height: 40px; padding: 0 16px;
      border-radius: 999px; background: var(--artha-accent); color: #fff;
      font-size: 13.5px; font-weight: 700; text-decoration: none;
    }
    .desk-add ion-icon { font-size: 18px; }
    @media (min-width: 768px) { .desk-add { display: inline-flex; } }

    /* Skeleton */
    .skeleton { display: flex; flex-direction: column; gap: 16px; }
    .skeleton ion-skeleton-text { --border-radius: 22px; margin: 0; }
    .sk-hero { height: 168px; }
    .sk-actions { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
    .sk-tile { height: 84px; }
    .sk-card { height: 180px; }

    /* Hero */
    .hero { padding: 20px; border-radius: var(--artha-radius-2xl, 24px); background: var(--artha-accent); color: #fff; }
    .hero-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .hero-label { font-size: 13px; font-weight: 600; opacity: 0.88; }
    .trend {
      padding: 4px 10px; border-radius: 999px; background: rgba(255, 255, 255, 0.18);
      font-size: 12px; font-weight: 700; white-space: nowrap;
    }
    .hero-value { margin: 6px 0 0; font-size: 38px; font-weight: 800; letter-spacing: -0.03em; }
    .hero-stats {
      display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px;
      margin-top: 14px; padding-top: 14px; border-top: 1px solid rgba(255, 255, 255, 0.2);
    }
    .hero-stats div { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .hs-label { font-size: 11.5px; font-weight: 600; opacity: 0.85; }
    .hs-label.muted { opacity: 1; color: var(--artha-text-subtle); }
    .hs-value { font-size: 16px; font-weight: 800; letter-spacing: -0.01em; }
    .hero-income { margin: 10px 0 0; font-size: 12.5px; font-weight: 700; opacity: 0.95; }

    /* Quick actions */
    .actions { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
    .action {
      display: flex; flex-direction: column; align-items: center; gap: 8px;
      padding: 12px 4px; border: 0; border-radius: 18px; cursor: pointer;
      background: var(--artha-surface); color: var(--artha-text);
      font: inherit; font-size: 12px; font-weight: 600; text-decoration: none;
      transition: transform 120ms ease;
    }
    .action:active { transform: scale(0.97); }
    .action[disabled] { opacity: 0.6; }
    .action-ic { width: 40px; height: 40px; border-radius: 14px; display: grid; place-items: center; font-size: 20px; }
    .ic-accent { background: var(--artha-accent-tint); color: var(--artha-accent); }
    .ic-green { background: rgba(16, 185, 129, 0.14); color: #059669; }
    .ic-orange { background: rgba(249, 115, 22, 0.14); color: #ea580c; }
    .ic-blue { background: rgba(14, 165, 233, 0.14); color: #0284c7; }
    :host-context(.ion-palette-dark) .ic-green { color: #6ee7b7; }
    :host-context(.ion-palette-dark) .ic-orange { color: #fdba74; }
    :host-context(.ion-palette-dark) .ic-blue { color: #7dd3fc; }

    /* Pending SMS */
    .pending {
      display: flex; align-items: center; gap: 12px; width: 100%; text-align: left;
      padding: 12px 14px; border-radius: 18px; cursor: pointer; font: inherit;
      background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.45);
      color: var(--artha-text);
    }
    .pending-badge {
      flex: none; min-width: 28px; height: 28px; padding: 0 8px; border-radius: 999px;
      display: grid; place-items: center; background: #f59e0b; color: #fff;
      font-size: 13px; font-weight: 800;
    }
    .pending-text { flex: 1; font-size: 13.5px; font-weight: 600; }
    .pending ion-icon { flex: none; font-size: 18px; color: var(--artha-text-muted); }
    .card-due { text-decoration: none; background: var(--artha-negative-tint); border-color: color-mix(in srgb, var(--artha-negative) 40%, transparent); }
    .card-due-badge { background: var(--artha-negative); }
    .card-due-badge ion-icon { font-size: 15px; color: #fff; }

    /* Investments summary */
    .inv { display: flex; flex-direction: column; gap: 8px; }
    .inv-value { margin: 0; font-size: 24px; font-weight: 800; letter-spacing: -0.02em; color: var(--artha-text); }
    .inv-stats { display: flex; flex-wrap: wrap; gap: 8px 22px; }
    .inv-stats > div { display: flex; flex-direction: column; gap: 2px; }
    .inv-k { font-size: 11.5px; font-weight: 600; color: var(--artha-text-subtle); }
    .inv-v { font-size: 14px; font-weight: 800; color: var(--artha-text); }
    .inv-v small { font-size: 11.5px; font-weight: 700; opacity: 0.85; }
    .inv-up { color: var(--artha-positive); }
    .inv-down { color: var(--artha-negative); }

    /* Cards */
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; align-items: start; }
    .card {
      display: block; padding: 16px; border-radius: var(--artha-radius-xl, 22px);
      background: var(--artha-surface); color: var(--artha-text); text-decoration: none;
    }
    .card-head { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
    .card-head h2 { margin: 0; font-size: 15px; font-weight: 800; letter-spacing: -0.01em; }
    .card-head a { font-size: 13px; font-weight: 700; color: var(--artha-accent); text-decoration: none; }
    .more { display: inline-flex; align-items: center; gap: 2px; font-size: 12.5px; font-weight: 600; color: var(--artha-text-muted); }
    .more ion-icon { font-size: 14px; }
    .empty-line { margin: 12px 0 0; font-size: 13.5px; color: var(--artha-text-subtle); }

    /* Where it went */
    .stack { display: flex; gap: 3px; height: 10px; margin-top: 12px; border-radius: 999px; overflow: hidden; }
    .stack span { min-width: 4px; }
    .stack-other { background: var(--artha-border-strong); }
    .legend {
      list-style: none; margin: 12px 0 0; padding: 0;
      display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 16px; font-size: 12.5px;
    }
    .legend li { display: flex; align-items: center; gap: 6px; min-width: 0; }
    .dot { width: 8px; height: 8px; flex: none; border-radius: 50%; }
    .legend-name { flex: 1; min-width: 0; color: var(--artha-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .legend b { font-weight: 700; }

    /* Recent */
    .rows { list-style: none; margin: 4px 0 0; padding: 0; }
    .row { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-top: 1px solid var(--artha-border); }
    .row:first-child { border-top: 0; }
    .row-ic {
      width: 40px; height: 40px; flex: none; border-radius: 14px;
      display: grid; place-items: center; font-size: 14px; font-weight: 800;
    }
    .row-ic ion-icon { font-size: 18px; }
    .row-text { flex: 1; min-width: 0; }
    .row-name, .row-meta { margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .row-name { font-size: 14.5px; font-weight: 700; }
    .row-meta { margin-top: 1px; font-size: 12px; color: var(--artha-text-subtle); }
    .row-amt { flex: none; font-size: 15px; font-weight: 800; }
    .row-amt.income { color: var(--artha-positive); }

    .empty { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 24px 12px; text-align: center; color: var(--artha-text-subtle); }
    .empty ion-icon { font-size: 32px; }
    .empty p { margin: 0; font-size: 13.5px; }
    .empty a { font-size: 13px; font-weight: 700; color: var(--artha-accent); text-decoration: none; }

    /* Loans + planned */
    .figs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 12px; }
    .figs div { display: flex; flex-direction: column; gap: 2px; }
    .fig { font-size: 20px; font-weight: 800; letter-spacing: -0.02em; }
    .fig-sm { font-size: 15px; font-weight: 800; }
    .planned { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-direction: column; gap: 8px; font-size: 13px; }
    .planned li { display: flex; justify-content: space-between; gap: 12px; }
    .planned-name { min-width: 0; color: var(--artha-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .planned li .num { font-weight: 700; }
    .planned-more { margin: 10px 0 0; font-size: 12px; color: var(--artha-text-subtle); }

    @media (max-width: 720px) {
      .grid { grid-template-columns: minmax(0, 1fr); }
    }
  `],
})
export class DashboardComponent implements OnInit {
  protected readonly expensesStore = inject(ExpensesStore);
  private readonly categoriesStore = inject(CategoriesStore);
  private readonly loansStore = inject(LoansStore);
  private readonly plannedStore = inject(PlannedExpensesStore);
  protected readonly settingsStore = inject(SettingsStore);
  protected readonly sms = inject(SmsCaptureService);
  protected readonly bills = inject(BillsService);
  private readonly session = inject(SessionService);
  private readonly reportsApi = inject(ReportsApi);
  private readonly accountsStore = inject(AccountsStore);
  protected readonly investments = inject(InvestmentsStore);

  protected signOf(n: number): string {
    return n > 0 ? '+' : n < 0 ? '−' : '';
  }

  protected abs(n: number): number {
    return Math.abs(n);
  }

  /** Credit cards whose bill is due within the next 5 days, soonest first. */
  protected readonly cardBillsDue = computed(() =>
    this.accountsStore
      .active()
      .filter((a) => a.type === 'credit_card' && a.dueDay)
      .map((a) => ({ acc: a, due: nextDueDate(a.dueDay!) }))
      // The same card's bill from SMS (same due date) is shown instead, with the real amount.
      .filter((x) => !this.bills.upcoming().some((b) => b.kind === 'card' && b.dueDate === ymd(x.due)))
      .map((x) => ({ acc: x.acc, days: daysUntil(x.due) }))
      .filter((x) => x.days <= 5)
      .sort((a, b) => a.days - b.days)
      .map(({ acc, days }) => ({
        id: acc.id,
        name: acc.name,
        when: dueLabel(days),
        owed: cardOwed(acc),
        currency: acc.currency,
      })),
  );

  protected readonly currentUser = this.session.currentUser;

  /** Previous-month total (for the trend chip); null until fetched. */
  private readonly prevMonthTotal = signal<number | null>(null);

  /** Active loans summary for the dashboard card. */
  protected readonly activeLoans = computed(() => this.loansStore.active());
  protected readonly totalOutstanding = computed(() => this.loansStore.totalOutstanding());
  protected readonly totalEmi = computed(() => this.loansStore.totalMonthlyEmi());

  protected readonly currency = computed(() =>
    this.expensesStore.currency() || this.settingsStore.currency() || 'USD',
  );

  protected readonly recent = computed(() => this.expensesStore.items().slice(0, 6));

  private readonly excludedCategoryIds = computed(() => {
    const items = this.categoriesStore.items();
    const excluded = new Set(items.filter((c) => c.excludeFromReports).map((c) => c.id));
    // Excluding a parent also excludes its subcategories.
    for (const c of items) {
      if (c.parentId && excluded.has(c.parentId)) {
        excluded.add(c.id);
      }
    }
    return excluded;
  });

  private readonly counted = computed(() => {
    const excludedCats = this.excludedCategoryIds();
    return this.expensesStore
      .items()
      .filter((e) => e.type !== 'income' && !e.excluded && !excludedCats.has(e.categoryId));
  });

  protected readonly totalSpent = computed(() => this.counted().reduce((s, e) => s + e.amount, 0));
  protected readonly expenseCount = computed(() => this.counted().length);

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
  protected readonly plannedItems = computed(() => this.plannedStore.active());
  /** Largest few planned bills (monthly-equivalent) for the dashboard card. */
  protected readonly plannedPreview = computed(() =>
    [...this.plannedItems()]
      .map((p) => ({ id: p.id, name: p.name, monthly: monthlyEquivalent(p) }))
      .sort((a, b) => b.monthly - a.monthly)
      .slice(0, 4),
  );

  protected readonly momTrend = computed(() => {
    const prev = this.prevMonthTotal();
    if (prev === null || prev <= 0) return null;
    const cur = this.totalSpent();
    return { up: cur >= prev, pct: Math.round(Math.abs((cur - prev) / prev) * 100) };
  });

  protected readonly breakdown = computed<CategorySlice[]>(() => {
    const total = this.totalSpent();
    if (total <= 0) return [];
    // Roll subcategory spend up into the top-level (parent) category.
    const byCat = new Map<string, number>();
    for (const e of this.counted()) {
      const root = this.categoriesStore.rootIdOf(e.categoryId);
      byCat.set(root, (byCat.get(root) ?? 0) + e.amount);
    }
    return [...byCat.entries()]
      .map(([id, amount]) => ({ id, name: this.categoryName(id), amount, share: amount / total }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);
  });

  /** Share of spend outside the top categories shown in the stacked bar. */
  protected readonly otherShare = computed(() =>
    Math.max(0, 1 - this.breakdown().reduce((sum, s) => sum + s.share, 0)),
  );

  protected readonly scanning = signal(false);

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
    void this.plannedStore.load();
    void this.loansStore.load();
    void this.accountsStore.load();
    // Investments summary card; refresh prices if they're over an hour old.
    void this.investments
      .load()
      .then(() => {
        const at = this.investments.pricesAt();
        if (this.investments.rows().length && (!at || Date.now() - Date.parse(at) > 3_600_000)) {
          void this.investments.refreshPrices();
        }
      })
      .catch(() => undefined);
    if (!this.settingsStore.settings()) {
      void this.settingsStore.load();
    }

    // Trend vs last month — one extra shard read.
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    this.reportsApi
      .monthly(prev.getFullYear(), prev.getMonth() + 1)
      .then((r) => this.prevMonthTotal.set(r.total))
      .catch(() => this.prevMonthTotal.set(null));
  }

  protected async reviewPending(): Promise<void> {
    await this.sms.reviewPending();
  }

  protected async scanSms(): Promise<void> {
    if (this.scanning()) return;
    this.scanning.set(true);
    try {
      await this.sms.scanInbox();
    } finally {
      this.scanning.set(false);
    }
  }

  protected breakdownLabel(): string {
    return this.breakdown()
      .map((s) => `${s.name} ${Math.round(s.share * 100)}%`)
      .join(', ');
  }

  protected greeting(): string {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
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

/** Local yyyy-MM-dd. */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
