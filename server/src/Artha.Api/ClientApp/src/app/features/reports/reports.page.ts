import { CurrencyPipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { IonContent, IonIcon, IonSpinner } from '@ionic/angular/standalone';
import { Expense } from '../../core/models/expense.model';
import { MONTH_LABELS, MonthSummary } from '../../core/models/report.model';
import { AccountsStore } from '../accounts/accounts.store';
import { CategoriesStore } from '../categories/categories.store';
import { ExpensesApi } from '../expenses/expenses.api';
import { SectionSwitchComponent } from '../expenses/section-switch.component';
import { compactMoney, countsAsSpend, merchantOf } from './report-utils';
import { DailyBarsComponent } from './daily-bars.component';
import { YearBarChartComponent } from './year-bar-chart.component';

type ViewMode = 'daily' | 'monthly' | 'yearly';

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
    SectionSwitchComponent,
    DailyBarsComponent,
    YearBarChartComponent,
  ],
  template: `
    <ion-content>
      <div class="page">
        <header class="top">
          <artha-section-switch active="reports"></artha-section-switch>
        </header>

        <div class="period-row">
          <div class="periods" role="tablist" aria-label="Period">
            <button type="button" role="tab" [attr.aria-selected]="view() === 'daily'" [class.on]="view() === 'daily'" (click)="setView('daily')">Day</button>
            <button type="button" role="tab" [attr.aria-selected]="view() === 'monthly'" [class.on]="view() === 'monthly'" (click)="setView('monthly')">Month</button>
            <button type="button" role="tab" [attr.aria-selected]="view() === 'yearly'" [class.on]="view() === 'yearly'" (click)="setView('yearly')">Year</button>
          </div>
          <div class="stepper">
            <button type="button" class="step" (click)="stepBack()" aria-label="Previous period">
              <ion-icon name="chevron-back"></ion-icon>
            </button>
            <span class="range-label">{{ shortRangeLabel() }}</span>
            <button type="button" class="step" (click)="stepForward()" [disabled]="!canStepForward()" aria-label="Next period">
              <ion-icon name="chevron-forward"></ion-icon>
            </button>
          </div>
        </div>

        @if (loading()) {
          <div class="state"><ion-spinner></ion-spinner></div>
        } @else if (count() === 0) {
          <div class="empty">
            <span class="empty-badge"><ion-icon name="stats-chart-outline"></ion-icon></span>
            <p>No spending recorded for {{ rangeLabel() }}.</p>
          </div>
          @if (view() === 'daily') {
            <section class="card">
              <h2>Last 7 days</h2>
              <div class="mbars seven">
                @for (d of lastSevenDays(); track d.iso) {
                  <button type="button" class="mbar" (click)="openDay(d.iso)"
                    [attr.aria-label]="d.label + ' ' + (d.total | currency: currency() : 'symbol' : '1.0-0')">
                    <span class="mbar-amt num" [class.current]="d.current">{{ d.total > 0 ? (d.total | currency: currency() : 'symbol' : '1.0-0') : '' }}</span>
                    <span class="mbar-fill" [class.current]="d.current" [style.height.%]="d.pct"></span>
                    <span class="mbar-label" [class.current]="d.current">{{ d.label }}</span>
                  </button>
                }
              </div>
            </section>
          }
        } @else {
          <!-- Total, change, category split, key numbers -->
          <section class="card hero">
            <div class="hero-top">
              <div>
                <p class="hero-label">Spent {{ heroPeriod() }}</p>
                <p class="hero-value num">{{ total() | currency: currency() : 'symbol' : '1.0-0' }}</p>
              </div>
              @if (deltaPill(); as d) {
                <span class="pill" [class.up]="d.up">{{ d.up ? '↑' : '↓' }} {{ d.pct }}% vs {{ d.label }}</span>
              }
            </div>
            <div class="stack" aria-hidden="true">
              @for (seg of stackSegments(); track seg.label) {
                <span [style.flex-grow]="seg.value" [style.background]="seg.color"></span>
              }
            </div>
            <ul class="stack-legend">
              @for (seg of stackSegments(); track seg.label) {
                <li><span class="dot" [style.background]="seg.color"></span>{{ seg.label }} <b class="num">{{ percent(seg.value) }}%</b></li>
              }
            </ul>
            <div class="tiles">
              <div class="tile">
                <span class="tile-k">{{ view() === 'daily' ? 'Largest' : view() === 'monthly' ? 'Daily avg' : 'Monthly avg' }}</span>
                <span class="tile-v num">{{ (view() === 'daily' ? largest() : averageSpend()) | currency: currency() : 'symbol' : '1.0-0' }}</span>
              </div>
              <div class="tile">
                <span class="tile-k">Transactions</span>
                <span class="tile-v num">{{ count() }}</span>
              </div>
              <div class="tile">
                <span class="tile-k">Received</span>
                <span class="tile-v num pos">{{ received() > 0 ? compact(received()) : '—' }}</span>
              </div>
            </div>
          </section>

          <!-- Day: the day's transactions -->
          @if (view() === 'daily') {
            <section class="card list-card">
              <div class="card-head">
                <h2>Transactions</h2>
                <span class="card-sub">Tap to edit</span>
              </div>
              <ul class="txns">
                @for (t of dayTransactions(); track t.id) {
                  <li class="txn" (click)="openExpense(t.id)">
                    <span class="txn-dot" [style.background]="t.color"></span>
                    <div class="txn-body">
                      <span class="txn-title">{{ t.title }}</span>
                      <span class="txn-sub">{{ t.category }} · {{ t.account }}@if (t.excluded) { · not counted }</span>
                    </div>
                    <span class="txn-amt num" [class.income]="t.income" [class.excluded]="t.excluded">
                      {{ t.income ? '+' : '' }}{{ t.amount | currency: currency() : 'symbol' : '1.0-2' }}
                    </span>
                  </li>
                }
              </ul>
            </section>
          }

          <!-- Period bars (Day / Year; the month's six-month bars sit lower down) -->
          @if (view() !== 'monthly') {
          <section class="card">
            @if (view() === 'daily') {
              <h2>Last 7 days</h2>
              <div class="mbars seven">
                @for (d of lastSevenDays(); track d.iso) {
                  <button type="button" class="mbar" (click)="openDay(d.iso)"
                    [attr.aria-label]="d.label + ' ' + (d.total | currency: currency() : 'symbol' : '1.0-0')">
                    <span class="mbar-amt num" [class.current]="d.current">{{ d.total > 0 ? (d.total | currency: currency() : 'symbol' : '1.0-0') : '' }}</span>
                    <span class="mbar-fill" [class.current]="d.current" [style.height.%]="d.pct"></span>
                    <span class="mbar-label" [class.current]="d.current">{{ d.label }}</span>
                  </button>
                }
              </div>
            } @else {
              <h2>Monthly spend · {{ rangeLabel() }}</h2>
              <artha-year-bar-chart [months]="monthSummaries()" [currency]="currency()"></artha-year-bar-chart>
            }
          </section>
          }

          @if (view() === 'monthly') {
            <section class="card">
              <div class="card-head">
                <h2>Daily spending</h2>
                <span class="card-sub">Tap a bar</span>
              </div>
              <artha-daily-bars
                [series]="dailySeries()"
                [counts]="dailyCounts()"
                [year]="year()"
                [month]="month()"
                [currency]="currency()"
                (openDay)="openDay($event)"
              ></artha-daily-bars>
            </section>

            @if (insights().length > 0) {
              <section class="card insights">
                <h2>
                  <ion-icon name="sparkles-outline" aria-hidden="true"></ion-icon>
                  What changed
                </h2>
                <ul>
                  @for (i of insights(); track i.key) {
                    <li>
                      <span class="ins-mark" [class.up]="i.kind === 'up'" [class.down]="i.kind === 'down'">{{ i.kind === 'up' ? '↑' : i.kind === 'down' ? '↓' : '●' }}</span>
                      <span><b>{{ i.strong }}</b> {{ i.text }}</span>
                    </li>
                  }
                </ul>
              </section>
            }

            <section class="card list-card">
              <div class="card-head">
                <h2>Day by day</h2>
                <span class="card-sub">Tap a day for its report</span>
              </div>
              <ul class="days">
                @for (d of dayByDay(); track d.iso) {
                  <li class="day" (click)="openDay(d.iso)">
                    <div class="day-date">
                      <span class="day-num num">{{ d.dayNum }}</span>
                      <span class="day-wd">{{ d.weekday }}</span>
                    </div>
                    <div class="cat-body">
                      <div class="cat-top">
                        <span class="day-count">{{ d.count }} {{ d.count === 1 ? 'transaction' : 'transactions' }}</span>
                        <span class="cat-amt num">{{ d.total | currency: currency() : 'symbol' : '1.0-0' }}</span>
                      </div>
                      <div class="track"><div class="fill" [style.width.%]="d.pct" [style.background]="'var(--artha-accent)'"></div></div>
                    </div>
                  </li>
                }
              </ul>
            </section>
          }

          <!-- Category breakdown -->
          <section class="card list-card">
            <div class="card-head">
              <h2>Categories</h2>
              <span class="card-sub">{{ view() === 'monthly' && hasPrevMonth() ? 'vs ' + prevLabel() : 'Tap for details' }}</span>
            </div>
            <ul class="cats">
              @for (row of byCategory(); track row.categoryId) {
                <li class="cat" (click)="openCategory(row.categoryId)">
                  <span class="share-badge num" [style.background]="row.color + '22'" [style.color]="row.color">{{ percent(row.total) }}%</span>
                  <div class="cat-body">
                    <div class="cat-top">
                      <span class="cat-name">
                        {{ row.name }}
                        @if (row.children) {
                          <button
                            type="button"
                            class="expand-btn"
                            [attr.aria-label]="'Show subcategories of ' + row.name"
                            [attr.aria-expanded]="expandedCategories().has(row.categoryId)"
                            (click)="toggleCategory($event, row.categoryId)"
                          >
                            <ion-icon [name]="expandedCategories().has(row.categoryId) ? 'chevron-up' : 'chevron-down'"></ion-icon>
                          </button>
                        }
                      </span>
                      <span class="cat-amt num">{{ row.total | currency: currency() : 'symbol' : '1.0-0' }}</span>
                    </div>
                    <div class="cat-sub">
                      <span>{{ row.count }} {{ row.count === 1 ? 'transaction' : 'transactions' }}</span>
                      @if (categoryDelta(row.categoryId); as d) {
                        <span class="num" [class.up]="d > 0" [class.down]="d < 0">{{ d > 0 ? '+' : '−' }}{{ abs(d) | currency: currency() : 'symbol' : '1.0-0' }}</span>
                      }
                    </div>
                  </div>
                  <ion-icon class="cat-go" name="chevron-forward" aria-hidden="true"></ion-icon>
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
                        <div class="cat-sub"><span>{{ child.count }} {{ child.count === 1 ? 'transaction' : 'transactions' }}</span></div>
                      </div>
                      <ion-icon class="cat-go" name="chevron-forward" aria-hidden="true"></ion-icon>
                    </li>
                  }
                }
              }
            </ul>
          </section>

          @if (view() === 'monthly') {
            <section class="card">
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
            </section>
          }

          <div class="two-col">
            <section class="card list-card">
              <h2>Top merchants</h2>
              @if (topMerchants().length === 0) {
                <p class="muted small">No merchant info.</p>
              } @else {
                <ul class="merchants">
                  @for (m of topMerchants(); track m.name) {
                    <li>
                      <span class="m-name">{{ m.name }} <span class="m-count">· {{ m.count }}×</span></span>
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
    .top { display: flex; align-items: center; justify-content: space-between; gap: 10px 12px; flex-wrap: wrap; }
    h1 { margin: 0; font-size: 26px; font-weight: 800; letter-spacing: -0.03em; color: var(--artha-text); }
    .period-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
    .periods { display: flex; gap: 6px; }
    .periods button {
      height: 34px; padding: 0 14px; border-radius: 999px; cursor: pointer;
      border: 1px solid var(--artha-border); background: var(--artha-surface);
      color: var(--artha-text-muted); font: inherit; font-size: 13px; font-weight: 600;
    }
    .periods button.on { background: var(--artha-text); border-color: var(--artha-text); color: var(--artha-bg); font-weight: 700; }
    .stepper { display: inline-flex; align-items: center; gap: 2px; }
    .step {
      width: 36px; height: 36px; border: 0; border-radius: 50%; background: transparent; cursor: pointer;
      color: var(--artha-text-muted); display: inline-flex; align-items: center; justify-content: center;
    }
    .step:hover:not(:disabled) { background: var(--artha-surface-2); color: var(--artha-text); }
    .step:disabled { opacity: 0.3; cursor: default; }
    .step ion-icon { font-size: 18px; }
    .range-label { text-align: center; font-size: 14px; font-weight: 800; color: var(--artha-text); white-space: nowrap; }

    .num { font-variant-numeric: tabular-nums; }
    .muted { color: var(--artha-text-muted); }
    .small { font-size: 13px; }

    .card { padding: 16px 18px; border-radius: var(--artha-radius-2xl, 24px); background: var(--artha-surface); }
    .card h2 { margin: 0 0 12px; font-size: 15px; font-weight: 800; color: var(--artha-text); }
    .card-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
    .card-sub { font-size: 12px; color: var(--artha-text-subtle); }
    .list-card { padding-bottom: 8px; }

    /* Hero */
    .hero-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
    .hero-label { margin: 0; font-size: 12.5px; font-weight: 600; color: var(--artha-text-subtle); }
    .hero-value { margin: 0; font-size: 34px; font-weight: 800; letter-spacing: -0.03em; color: var(--artha-text); }
    .pill {
      flex: none; margin-top: 6px; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 700;
      background: var(--artha-positive-tint, rgba(16, 185, 129, 0.14)); color: var(--artha-positive);
    }
    .pill.up { background: var(--artha-negative-tint); color: var(--artha-negative); }
    .stack { display: flex; gap: 2px; height: 12px; margin-top: 14px; border-radius: 999px; overflow: hidden; }
    .stack span { flex-basis: 0; min-width: 3px; }
    .stack-legend { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 4px 12px; }
    .stack-legend li { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--artha-text-muted); }
    .stack-legend b { color: var(--artha-text); font-weight: 700; }
    .tiles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-top: 14px; }
    .tile { padding: 10px; border-radius: 14px; background: var(--artha-surface-2); display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .tile-k { font-size: 11.5px; font-weight: 600; color: var(--artha-text-subtle); }
    .tile-v { font-size: 15px; font-weight: 800; color: var(--artha-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .tile-v.pos { color: var(--artha-positive); }

    /* What changed */
    .insights { background: #1e1b4b; color: #e0e7ff; }
    .insights h2 { display: flex; align-items: center; gap: 8px; color: #ffffff; }
    .insights h2 ion-icon { color: #fbbf24; font-size: 18px; }
    .insights ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
    .insights li { display: flex; gap: 10px; font-size: 13.5px; line-height: 1.4; }
    .insights b { color: #ffffff; }
    .ins-mark { flex: none; width: 14px; font-weight: 800; color: #fbbf24; }
    .ins-mark.up { color: #fda4af; }
    .ins-mark.down { color: #6ee7b7; }

    /* Category rows */
    .share-badge {
      flex: none; width: 40px; height: 40px; border-radius: 12px;
      display: inline-flex; align-items: center; justify-content: center; font-size: 12.5px; font-weight: 800;
    }
    .cat-sub { display: flex; justify-content: space-between; gap: 8px; margin-top: 2px; font-size: 12px; color: var(--artha-text-subtle); }
    .cat-sub .up { color: var(--artha-negative); font-weight: 700; }
    .cat-sub .down { color: var(--artha-positive); font-weight: 700; }
    .cat-go { flex: none; font-size: 16px; color: var(--artha-text-subtle); }
    .m-count { font-weight: 500; color: var(--artha-text-subtle); }
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

    .mbars.seven { grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 6px; height: 150px; }
    button.mbar { border: 0; background: none; padding: 0; font: inherit; cursor: pointer; }
    .mbar-amt { font-size: 10px; font-weight: 700; color: var(--artha-text-subtle); white-space: nowrap; }
    .mbar-amt.current { color: var(--artha-text); }
    .mbars.seven .mbar-fill { max-height: calc(100% - 40px); }

    /* Day transactions */
    .txns, .days { list-style: none; margin: 0; padding: 0; }
    .txn { display: flex; align-items: center; gap: 12px; padding: 10px 6px; margin: 0 -6px; border-radius: 12px; cursor: pointer; }
    .txn:hover { background: var(--artha-surface-2); }
    .txn-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
    .txn-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .txn-title { font-size: 14px; font-weight: 700; color: var(--artha-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .txn-sub { font-size: 12px; color: var(--artha-text-subtle); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .txn-amt { font-size: 14px; font-weight: 800; color: var(--artha-text); flex-shrink: 0; }
    .txn-amt.income { color: var(--artha-positive); }
    .txn-amt.excluded { color: var(--artha-text-subtle); text-decoration: line-through; }

    /* Day-by-day rows */
    .day { display: flex; align-items: center; gap: 12px; padding: 9px 6px; margin: 0 -6px; border-radius: 12px; cursor: pointer; }
    .day:hover { background: var(--artha-surface-2); }
    .day-date {
      width: 44px; flex-shrink: 0; display: flex; flex-direction: column; align-items: center;
      padding: 4px 0; border-radius: 12px; background: var(--artha-surface-2);
    }
    .day-num { font-size: 16px; font-weight: 800; line-height: 1.1; color: var(--artha-text); }
    .day-wd { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--artha-text-subtle); }
    .day-count { font-size: 13px; font-weight: 600; color: var(--artha-text-muted); }

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
  protected readonly day = signal<number>(new Date().getDate());

  protected readonly loading = signal<boolean>(false);
  protected readonly currency = signal<string>('USD');
  private readonly periodExpenses = signal<Expense[]>([]);
  private readonly prevTotal = signal<number>(0);
  /** Monthly view: the six months ending at the selected month (for the bars). */
  private readonly recentExpenses = signal<Expense[]>([]);

  /** Day view: the selected date as 'YYYY-MM-DD'. */
  private readonly dayIso = computed(() => isoDate(new Date(this.year(), this.month() - 1, this.day())));

  protected readonly rangeLabel = computed(() => {
    if (this.view() === 'daily') {
      const d = new Date(this.year(), this.month() - 1, this.day());
      const today = isoDate(new Date());
      const yesterday = isoDate(addDays(new Date(), -1));
      const full = `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTH_LABELS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`;
      if (this.dayIso() === today) return `Today · ${d.getDate()} ${MONTH_LABELS[d.getMonth()].slice(0, 3)}`;
      if (this.dayIso() === yesterday) return `Yesterday · ${d.getDate()} ${MONTH_LABELS[d.getMonth()].slice(0, 3)}`;
      return full;
    }
    return this.view() === 'monthly' ? `${MONTH_LABELS[this.month() - 1]} ${this.year()}` : String(this.year());
  });

  protected readonly canStepForward = computed(() => {
    const now = new Date();
    if (this.view() === 'daily') {
      return this.dayIso() < isoDate(now);
    }
    if (this.view() === 'monthly') {
      return new Date(this.year(), this.month() - 1) < new Date(now.getFullYear(), now.getMonth());
    }
    return this.year() < now.getFullYear();
  });

  /** Spending only — excluded items (refunds/transfers) are dropped. */
  private readonly counted = computed(() => this.periodExpenses().filter(countsAsSpend));

  /** Money received in the period (income, not excluded). */
  protected readonly received = computed(() =>
    this.periodExpenses().filter((e) => !e.excluded && e.type === 'income').reduce((s, e) => s + e.amount, 0),
  );

  protected readonly total = computed(() =>
    this.counted().reduce((s, e) => s + e.amount, 0),
  );
  protected readonly count = computed(() => this.counted().length);
  protected readonly largest = computed(() => Math.max(0, ...this.counted().map((e) => e.amount)));

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
    if (this.view() === 'yearly') return null;
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
      if (!countsAsSpend(e)) continue;
      const bucket = months.find((b) => e.date.startsWith(b.key));
      if (bucket) bucket.total += e.amount;
    }
    const max = Math.max(...months.map((b) => b.total), 0);
    for (const b of months) b.pct = max > 0 ? Math.max(3, (b.total / max) * 100) : 3;
    return months;
  });

  /** Day view: the seven days ending at the selected one (bars). */
  protected readonly lastSevenDays = computed(() => {
    const end = new Date(this.year(), this.month() - 1, this.day());
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = addDays(end, i - 6);
      return { iso: isoDate(d), label: WEEKDAYS[d.getDay()].slice(0, 2) + ' ' + d.getDate(), total: 0, current: i === 6, pct: 0 };
    });
    for (const e of this.recentExpenses()) {
      if (!countsAsSpend(e)) continue;
      const bucket = days.find((b) => b.iso === e.date);
      if (bucket) bucket.total += e.amount;
    }
    const max = Math.max(...days.map((b) => b.total), 0);
    for (const b of days) b.pct = max > 0 ? Math.max(3, (b.total / max) * 100) : 3;
    return days;
  });

  /** Day view: that day's transactions, biggest first (excluded ones last). */
  protected readonly dayTransactions = computed(() => {
    const cats = this.categoriesStore.byId();
    const accs = this.accountsStore.byId();
    return [...this.periodExpenses()]
      .sort((a, b) => Number(a.excluded) - Number(b.excluded) || b.amount - a.amount)
      .map((e) => {
        const cat = cats[e.categoryId];
        return {
          id: e.id,
          title: e.note?.trim() ? merchantOf(e.note) : cat?.name ?? 'Expense',
          category: cat?.name ?? 'Uncategorized',
          account: accs[e.accountId]?.name ?? 'Account',
          color: cat?.color ?? OTHER_COLOR,
          amount: e.amount,
          income: e.type === 'income',
          excluded: e.excluded,
        };
      });
  });

  /** Month view: every day with spending, newest first. */
  protected readonly dayByDay = computed(() => {
    const map = new Map<string, { total: number; count: number }>();
    for (const e of this.counted()) {
      const cur = map.get(e.date) ?? { total: 0, count: 0 };
      cur.total += e.amount;
      cur.count += 1;
      map.set(e.date, cur);
    }
    const max = Math.max(...[...map.values()].map((v) => v.total), 0);
    return [...map.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([iso, v]) => {
        const d = new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
        return {
          iso,
          dayNum: d.getDate(),
          weekday: WEEKDAYS[d.getDay()].slice(0, 3),
          total: v.total,
          count: v.count,
          pct: max > 0 ? Math.max(3, (v.total / max) * 100) : 0,
        };
      });
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

  /** Top five categories plus "Other", for the split bar. */
  protected readonly stackSegments = computed(() => {
    const cats = this.byCategory();
    const top = cats.slice(0, 5).map((c) => ({ label: c.name, value: c.total, color: c.color }));
    const rest = cats.slice(5).reduce((s, c) => s + c.total, 0);
    if (rest > 0) top.push({ label: 'Other', value: rest, color: OTHER_COLOR });
    return top;
  });

  /** "in October", "on Mon 10 Nov", "in 2026". */
  protected readonly heroPeriod = computed(() => {
    if (this.view() === 'daily') return 'on ' + this.rangeLabel().replace(/^(Today|Yesterday) · /, '$1, ');
    if (this.view() === 'monthly') return 'in ' + MONTH_LABELS[this.month() - 1];
    return 'in ' + this.year();
  });

  /** Compact label for the stepper next to the period chips. */
  protected readonly shortRangeLabel = computed(() => {
    if (this.view() === 'daily') {
      const d = new Date(this.year(), this.month() - 1, this.day());
      return `${d.getDate()} ${MONTH_LABELS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`;
    }
    return this.view() === 'monthly' ? `${MONTH_LABELS[this.month() - 1].slice(0, 3)} ${this.year()}` : String(this.year());
  });

  /** Change vs the previous day / month, as a percentage. */
  protected readonly deltaPill = computed(() => {
    if (this.view() === 'yearly') return null;
    const prev = this.prevTotal();
    if (prev <= 0) return null;
    const diff = this.total() - prev;
    return {
      up: diff > 0,
      pct: Math.round((Math.abs(diff) / prev) * 100),
      label: this.view() === 'daily' ? 'day before' : this.prevLabel(),
    };
  });

  protected readonly prevMonthShort = computed(() => MONTH_LABELS[(this.month() + 10) % 12].slice(0, 3));

  /** For the current month, compare with the same days of last month (day of month cut-off). */
  private readonly sameDaysCutoff = computed(() => {
    const now = new Date();
    return this.view() === 'monthly' && this.year() === now.getFullYear() && this.month() === now.getMonth() + 1
      ? now.getDate()
      : 99;
  });

  /** "Oct" or "Oct, same days". */
  protected readonly prevLabel = computed(() => this.prevMonthShort() + (this.sameDaysCutoff() < 99 ? ', same days' : ''));

  /** Previous month's spend per top-level category (Month view). */
  private readonly prevByRoot = computed(() => {
    const map = new Map<string, number>();
    if (this.view() !== 'monthly') return map;
    const byId = this.categoriesStore.byId();
    const prev = prevMonthPrefix(this.year(), this.month());
    for (const e of this.recentExpenses()) {
      if (!e.date.startsWith(prev) || !countsAsSpend(e) || Number(e.date.slice(8, 10)) > this.sameDaysCutoff()) continue;
      const root = byId[e.categoryId]?.parentId ?? e.categoryId;
      map.set(root, (map.get(root) ?? 0) + e.amount);
    }
    return map;
  });

  protected readonly hasPrevMonth = computed(() => this.prevByRoot().size > 0);

  /** Spend change for a top-level category vs last month (Month view), or null. */
  protected categoryDelta(id: string): number | null {
    if (this.view() !== 'monthly' || !this.hasPrevMonth()) return null;
    const now = this.byCategory().find((c) => c.categoryId === id)?.total ?? 0;
    const diff = now - (this.prevByRoot().get(id) ?? 0);
    return Math.abs(diff) >= 1 ? diff : null;
  }

  /** "What changed": biggest rise and fall vs last month, and the weekend share. */
  protected readonly insights = computed(() => {
    if (this.view() !== 'monthly') return [] as { key: string; kind: 'up' | 'down' | 'info'; strong: string; text: string }[];
    const out: { key: string; kind: 'up' | 'down' | 'info'; strong: string; text: string }[] = [];
    const cur = this.currency();
    const byId = this.categoriesStore.byId();
    if (this.hasPrevMonth()) {
      const prev = this.prevByRoot();
      const ids = new Set([...this.byCategory().map((c) => c.categoryId), ...prev.keys()]);
      let up: { id: string; d: number } | null = null;
      let down: { id: string; d: number } | null = null;
      for (const id of ids) {
        const d = (this.byCategory().find((c) => c.categoryId === id)?.total ?? 0) - (prev.get(id) ?? 0);
        if (d > 0 && (!up || d > up.d)) up = { id, d };
        if (d < 0 && (!down || d < down.d)) down = { id, d };
      }
      if (up && up.d >= 1) {
        // The merchant that drove most of the category this month.
        const merchants = new Map<string, { total: number; count: number }>();
        for (const e of this.counted()) {
          if ((byId[e.categoryId]?.parentId ?? e.categoryId) !== up.id) continue;
          const m = merchants.get(merchantOf(e.note)) ?? { total: 0, count: 0 };
          m.total += e.amount;
          m.count += 1;
          merchants.set(merchantOf(e.note), m);
        }
        const top = [...merchants.entries()].filter(([n]) => n !== 'Unknown').sort((a, b) => b[1].total - a[1].total)[0];
        out.push({
          key: 'up',
          kind: 'up',
          strong: byId[up.id]?.name ?? 'Other',
          text: `up ${compactMoney(up.d, cur)} vs ${this.prevLabel()}` + (top ? `, mostly ${top[0]} (${top[1].count}×)` : ''),
        });
      }
      if (down && down.d <= -1) {
        out.push({ key: 'down', kind: 'down', strong: byId[down.id]?.name ?? 'Other', text: `down ${compactMoney(-down.d, cur)} vs ${this.prevLabel()}` });
      }
    }
    const total = this.total();
    if (total > 0) {
      const weekend = this.counted()
        .filter((e) => [0, 6].includes(new Date(`${e.date}T00:00:00`).getDay()))
        .reduce((s, e) => s + e.amount, 0);
      out.push({ key: 'weekend', kind: 'info', strong: `${Math.round((weekend / total) * 100)}%`, text: 'of your spending was on weekends' });
    }
    return out;
  });

  protected abs(n: number): number {
    return Math.abs(n);
  }

  protected compact(n: number): string {
    return compactMoney(n, this.currency());
  }

  protected readonly dailySeries = computed<number[]>(() => {
    const days = daysInMonth(this.year(), this.month());
    const arr = new Array(days).fill(0);
    for (const e of this.counted()) {
      const d = Number(e.date.slice(8, 10));
      if (d >= 1 && d <= days) arr[d - 1] += e.amount;
    }
    return arr;
  });

  /** Counted transactions per day of the month (for the daily chart). */
  protected readonly dailyCounts = computed<number[]>(() => {
    const arr = new Array(daysInMonth(this.year(), this.month())).fill(0);
    for (const e of this.counted()) {
      const d = Number(e.date.slice(8, 10));
      if (d >= 1 && d <= arr.length) arr[d - 1] += 1;
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
    const map = new Map<string, { total: number; count: number }>();
    for (const e of this.counted()) {
      const key = merchantOf(e.note);
      const m = map.get(key) ?? { total: 0, count: 0 };
      m.total += e.amount;
      m.count += 1;
      map.set(key, m);
    }
    return [...map.entries()]
      .map(([name, v]) => ({ name, total: v.total, count: v.count }))
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
      if (value === 'daily') {
        // Today when looking at this month (or a year); else that month's last day.
        const now = new Date();
        const thisMonth = this.year() === now.getFullYear() && this.month() === now.getMonth() + 1;
        if (this.view() === 'yearly' || thisMonth) {
          this.year.set(now.getFullYear());
          this.month.set(now.getMonth() + 1);
          this.day.set(now.getDate());
        } else {
          this.day.set(daysInMonth(this.year(), this.month()));
        }
      }
      this.view.set(value);
      await this.refresh();
    }
  }

  /** Open the Day view on a date ('YYYY-MM-DD'). */
  protected async openDay(iso: string): Promise<void> {
    this.setDate(new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))));
    this.view.set('daily');
    await this.refresh();
  }

  protected openExpense(id: string): void {
    void this.router.navigate(['/expenses', id]);
  }

  private setDate(d: Date): void {
    this.year.set(d.getFullYear());
    this.month.set(d.getMonth() + 1);
    this.day.set(d.getDate());
  }

  protected async stepBack(): Promise<void> {
    if (this.view() === 'daily') {
      this.setDate(addDays(new Date(this.year(), this.month() - 1, this.day()), -1));
    } else if (this.view() === 'monthly') {
      if (this.month() === 1) { this.year.update((y) => y - 1); this.month.set(12); }
      else { this.month.update((m) => m - 1); }
    } else {
      this.year.update((y) => y - 1);
    }
    await this.refresh();
  }

  protected async stepForward(): Promise<void> {
    if (!this.canStepForward()) return;
    if (this.view() === 'daily') {
      this.setDate(addDays(new Date(this.year(), this.month() - 1, this.day()), 1));
    } else if (this.view() === 'monthly') {
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

  /** Category detail for the month on screen (the selected day's month in Day view). */
  protected openCategory(categoryId: string): void {
    void this.router.navigate(['/reports/category', categoryId], {
      queryParams: { year: this.year(), month: this.month() },
    });
  }

  private async refresh(): Promise<void> {
    this.loading.set(true);
    try {
      if (this.view() === 'daily') {
        const day = new Date(this.year(), this.month() - 1, this.day());
        const from = addDays(day, -6);
        const iso = isoDate(day);
        const prevIso = isoDate(addDays(day, -1));
        const res = await this.api.list(
          monthPrefix(from.getFullYear(), from.getMonth() + 1),
          monthPrefix(day.getFullYear(), day.getMonth() + 1),
        );
        this.currency.set(res.currency || 'USD');
        this.recentExpenses.set(res.items);
        this.periodExpenses.set(res.items.filter((e) => e.date === iso));
        this.prevTotal.set(
          res.items.filter((e) => e.date === prevIso && countsAsSpend(e)).reduce((s, e) => s + e.amount, 0),
        );
      } else if (this.view() === 'monthly') {
        const cur = monthPrefix(this.year(), this.month());
        const prev = prevMonthPrefix(this.year(), this.month());
        const res = await this.api.list(monthsBackPrefix(this.year(), this.month(), 5), cur);
        this.currency.set(res.currency || 'USD');
        this.recentExpenses.set(res.items);
        this.periodExpenses.set(res.items.filter((e) => e.date.startsWith(cur)));
        const cutoff = this.sameDaysCutoff();
        this.prevTotal.set(
          res.items
            .filter((e) => e.date.startsWith(prev) && countsAsSpend(e) && Number(e.date.slice(8, 10)) <= cutoff)
            .reduce((s, e) => s + e.amount, 0),
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

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
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

