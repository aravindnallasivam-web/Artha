import { CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AlertController, IonContent, IonIcon, IonSpinner } from '@ionic/angular/standalone';
import { ConflictNotifierService } from '../../core/feedback/conflict-notifier.service';
import { Expense } from '../../core/models/expense.model';
import { AccountsStore } from '../accounts/accounts.store';
import { CategoriesStore } from '../categories/categories.store';
import { compactMoney, countsAsSpend, daysInMonth, monthPrefix, MONTH_SHORT } from '../reports/report-utils';
import { ExpensesApi } from './expenses.api';
import { ExpensesStore } from './expenses.store';
import { SectionSwitchComponent } from './section-switch.component';

type ViewMode = 'list' | 'day' | 'month';

interface DayGroup {
  date: string;       // YYYY-MM-DD
  items: Expense[];
  total: number;
}

interface CalendarCell {
  date: string;       // YYYY-MM-DD
  day: number;        // 1..31
  inMonth: boolean;   // false for leading/trailing days from neighbouring months
  total: number;
  count: number;
  isToday: boolean;
  isSelected: boolean;
}

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const TODAY_ISO = toIsoDate(new Date());

@Component({
  selector: 'artha-expenses-list',
  standalone: true,
  imports: [
    CurrencyPipe,
    DatePipe,
    DecimalPipe,
    SectionSwitchComponent,
    IonContent,
    IonIcon,
    IonSpinner,
  ],
  template: `
    <ion-content class="page-content">
      <div class="page">
        <!-- Expenses | Reports, search, filters -->
        <header class="page-header">
          <artha-section-switch active="expenses"></artha-section-switch>
          <div class="head-actions">
            <button type="button" class="icon-btn" [class.on]="showSearch()" (click)="toggleSearch()" aria-label="Search expenses">
              <ion-icon name="search-outline" aria-hidden="true"></ion-icon>
            </button>
            <button type="button" class="icon-btn" [class.on]="showFilters()" (click)="showFilters.set(!showFilters())" aria-label="Filters and views">
              <ion-icon name="options-outline" aria-hidden="true"></ion-icon>
              @if (filterAccountId() || view() !== 'list') { <span class="icon-dot" aria-hidden="true"></span> }
            </button>
            <button type="button" class="add-cta desktop-only" (click)="add()">
              <ion-icon name="add" aria-hidden="true"></ion-icon>
              <span>Add expense</span>
            </button>
          </div>
        </header>

        <!-- Month stepper -->
        <div class="month-step">
          <button type="button" class="month-nav" (click)="shiftMonth(-1)" aria-label="Previous month">
            <ion-icon name="chevron-back"></ion-icon>
          </button>
          <button type="button" class="month-center" (click)="resetToCurrentMonth()" [attr.aria-label]="monthLabel() + ', go to this month'">
            <span class="mc-name">{{ monthLabel() }}</span>
            <span class="mc-sub">
              {{ monthSub() }}
              @if (!isCurrentMonth()) { <span class="month-jump">Today</span> }
            </span>
          </button>
          <button type="button" class="month-nav" (click)="shiftMonth(1)" [disabled]="isCurrentMonth()" aria-label="Next month">
            <ion-icon name="chevron-forward"></ion-icon>
          </button>
        </div>

        @if (showSearch() || search()) {
          <label class="search-bar">
            <ion-icon name="search-outline" aria-hidden="true"></ion-icon>
            <span class="sr-only">Search expenses</span>
            <input
              class="search-input"
              type="search"
              placeholder="Search note, category or account"
              [value]="search()"
              (input)="onSearch($event)"
            />
          </label>
        }

        @if (showFilters()) {
          <div class="filters-aux">
            <select
              class="filter-select"
              aria-label="Filter by account"
              [value]="filterAccountId() ?? ''"
              (change)="onAccountFilter($event)"
            >
              <option value="">All accounts</option>
              @for (a of filterableAccounts(); track a.id) {
                <option [value]="a.id">{{ a.name }}</option>
              }
            </select>
            @if (hasActiveFilters()) {
              <button type="button" class="filter-clear" (click)="clearFilters()">
                <ion-icon name="close-outline" aria-hidden="true"></ion-icon>
                <span>Clear</span>
              </button>
            }
            <div class="view-switcher" role="tablist" aria-label="View">
              @for (v of viewOptions; track v.value) {
                <button
                  type="button"
                  role="tab"
                  [attr.aria-selected]="view() === v.value"
                  [attr.aria-label]="v.label"
                  [class.active]="view() === v.value"
                  (click)="setView(v.value)"
                >
                  <ion-icon [name]="v.icon" aria-hidden="true"></ion-icon>
                  <span>{{ v.label }}</span>
                </button>
              }
            </div>
          </div>
        }

        <!-- Summary card -->
        <section class="hero">
          <div class="hero-top">
            <div>
              <p class="hero-label">{{ isCurrentMonth() ? 'Spent this month' : 'Spent in ' + monthShort() }}</p>
              <p class="hero-value num">{{ monthTotal() | currency: currency() : 'symbol' : '1.0-0' }}</p>
              @if (vsPrevious(); as v) {
                <span class="hero-delta" [class.up]="v.up">
                  {{ v.up ? '↑' : '↓' }} {{ v.pct }}% vs {{ v.label }}
                </span>
              }
            </div>
            <div class="hero-side">
              <p class="hero-label">Received</p>
              <p class="hero-income num">+{{ monthIncome() | currency: currency() : 'symbol' : '1.0-0' }}</p>
              <p class="hero-avg num">Avg {{ dailyAverage() | currency: currency() : 'symbol' : '1.0-0' }}/day</p>
            </div>
          </div>
          <div class="hero-bars" aria-hidden="true">
            @for (b of miniBars(); track b.day) {
              <span class="hb" [class.today]="b.today" [class.future]="b.future" [style.height.%]="b.pct"></span>
            }
          </div>
        </section>

        <!-- Category chips with this month's totals -->
        <div class="chips" role="tablist" aria-label="Filter by category">
          <button
            type="button"
            class="chip"
            [class.active]="filterCategoryId() === null"
            (click)="filterCategoryId.set(null)"
          >
            All
          </button>
          @for (c of categoryChips(); track c.id) {
            <button
              type="button"
              class="chip"
              [class.active]="filterCategoryId() === c.id"
              (click)="filterCategoryId.set(filterCategoryId() === c.id ? null : c.id)"
            >
              <span class="chip-dot" [style.background]="categoryColor(c.id)"></span>
              {{ c.name }}
              @if (c.total > 0) { <span class="chip-amt num">{{ c.label }}</span> }
            </button>
          }
        </div>

        @if (expensesStore.loading()) {
          <div class="state"><ion-spinner></ion-spinner></div>
        } @else if (monthCount() === 0 && monthIncome() === 0) {
          @if (hasActiveFilters()) {
            <div class="empty">
              <span class="empty-badge"><ion-icon name="receipt-outline"></ion-icon></span>
              <p>No expenses match your filters in {{ monthLabel() }}.</p>
              <button type="button" class="empty-cta" (click)="clearFilters()">Clear filters</button>
            </div>
          } @else {
            <div class="empty">
              <span class="empty-badge"><ion-icon name="receipt-outline"></ion-icon></span>
              <p>No expenses in {{ monthLabel() }}.</p>
              <button type="button" class="empty-cta" (click)="add()">Add your first one</button>
            </div>
          }
        } @else {
          @switch (view()) {
            @case ('list') {
              <section class="list-view">
                @for (group of dayGroups(); track group.date) {
                  <div class="day-group">
                    <div class="day-group-head">
                      <span>{{ dayHeader(group.date) }}</span>
                      @if (group.total > 0) { <span class="num">−{{ group.total | currency: currency() : 'symbol' : '1.0-0' }}</span> }
                    </div>
                    <ul class="row-list">
                      @for (expense of group.items; track expense.id) {
                        <li class="row" [class.row--off]="expense.excluded" (click)="edit(expense.id)">
                          <span
                            class="row-icon"
                            [style.background]="categoryTint(expense.categoryId)"
                            [style.color]="categoryColor(expense.categoryId)"
                          >
                            @if (categoryIcon(expense.categoryId); as ic) {
                              <ion-icon [name]="ic" aria-hidden="true"></ion-icon>
                            } @else {
                              {{ categoryName(expense.categoryId).charAt(0) }}
                            }
                          </span>
                          <div class="row-text">
                            <p class="row-title">{{ expense.note || categoryName(expense.categoryId) }}</p>
                            <p class="row-meta">
                              {{ categoryPath(expense.categoryId) }} · {{ accountName(expense.accountId) }}@if (expense.excluded) { · not counted }
                            </p>
                          </div>
                          <span class="row-amount num" [class.income]="expense.type === 'income'">
                            {{ expense.type === 'income' ? '+' : '−' }}{{ expense.amount | currency: expense.currency : 'symbol' : '1.0-2' }}
                          </span>
                          <button type="button" class="row-delete" aria-label="Delete" (click)="onDelete($event, expense.id)">
                            <ion-icon name="trash"></ion-icon>
                          </button>
                        </li>
                      }
                    </ul>
                  </div>
                }
              </section>
            }

            @case ('day') {
              <section class="day-view">
                <div class="day-nav">
                  <button type="button" class="day-nav-btn" (click)="shiftSelectedDay(-1)" aria-label="Previous day">
                    <ion-icon name="chevron-back"></ion-icon>
                  </button>
                  <div class="day-nav-label">
                    <p class="day-nav-eyebrow">{{ selectedDay() | date:'EEEE' }}</p>
                    <p class="day-nav-date">{{ selectedDay() | date:'MMMM d, y' }}</p>
                  </div>
                  <button type="button" class="day-nav-btn" (click)="shiftSelectedDay(1)" aria-label="Next day">
                    <ion-icon name="chevron-forward"></ion-icon>
                  </button>
                </div>

                <div class="day-summary">
                  <p class="day-summary-total num">{{ selectedDayTotal() | currency: currency() : 'symbol' : '1.0-2' }}</p>
                  <p class="day-summary-meta">
                    {{ selectedDayExpenses().length }}
                    {{ selectedDayExpenses().length === 1 ? 'expense' : 'expenses' }} on this day
                  </p>
                </div>

                @if (selectedDayExpenses().length === 0) {
                  <div class="empty empty--inline">
                    <p>Nothing logged on this day.</p>
                    <button type="button" class="empty-cta" (click)="add()">Add an expense</button>
                  </div>
                } @else {
                  <ul class="row-list row-list--card">
                    @for (expense of selectedDayExpenses(); track expense.id) {
                      <li class="row" (click)="edit(expense.id)">
                        <span
                          class="row-icon"
                          [style.background]="categoryTint(expense.categoryId)"
                          [style.color]="categoryColor(expense.categoryId)"
                        >
                          @if (categoryIcon(expense.categoryId); as ic) {
                            <ion-icon [name]="ic" aria-hidden="true"></ion-icon>
                          } @else {
                            {{ categoryName(expense.categoryId).charAt(0) }}
                          }
                        </span>
                        <div class="row-text">
                          <p class="row-title">
                            {{ expense.note || categoryName(expense.categoryId) }}
                            @if (expense.excluded) { <span class="excluded-badge">Excluded</span> }
                          </p>
                          <p class="row-meta">
                            @if (expense.note) { {{ categoryName(expense.categoryId) }} · }{{ accountName(expense.accountId) }}
                          </p>
                        </div>
                        <span class="row-amount num" [class.income]="expense.type === 'income'">
                          {{ expense.type === 'income' ? '+' : '' }}{{ expense.amount | currency: expense.currency : 'symbol' : '1.0-2' }}
                        </span>
                        <button type="button" class="row-delete" aria-label="Delete" (click)="onDelete($event, expense.id)">
                          <ion-icon name="trash"></ion-icon>
                        </button>
                      </li>
                    }
                  </ul>
                }
              </section>
            }

            @case ('month') {
              <section class="month-view">
                <div class="weekdays">
                  @for (w of weekdays; track $index) {
                    <span class="weekday">{{ w }}</span>
                  }
                </div>
                <div class="calendar">
                  @for (cell of calendar(); track cell.date) {
                    <button
                      type="button"
                      class="cell"
                      [class.cell--off]="!cell.inMonth"
                      [class.cell--today]="cell.isToday"
                      [class.cell--selected]="cell.isSelected"
                      [class.cell--has]="cell.total > 0"
                      [style.background]="cellBg(cell)"
                      (click)="selectDay(cell.date)"
                    >
                      <span class="cell-day">{{ cell.day }}</span>
                      @if (cell.total > 0) {
                        <span class="cell-total num">{{ cell.total | number: '1.0-0' }}</span>
                      }
                    </button>
                  }
                </div>
                <p class="month-legend">Cell tint scales with daily spend. Tap a day to drill in.</p>
              </section>
            }
          }
        }
      </div>
    </ion-content>
  `,
  styles: [`
    :host { display: contents; }
    .page-content { --background: var(--artha-bg); }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

    .page {
      padding: calc(20px + env(safe-area-inset-top)) 20px 64px;
      max-width: 1080px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    /* ====== Header ====== */
    .page-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .head-actions { display: flex; align-items: center; gap: 8px; }
    .icon-btn {
      position: relative; width: 44px; height: 44px; border-radius: 14px; cursor: pointer;
      border: 1px solid var(--artha-border); background: var(--artha-surface); color: var(--artha-text);
      display: inline-flex; align-items: center; justify-content: center;
    }
    .icon-btn ion-icon { font-size: 20px; }
    .icon-btn.on { background: var(--artha-text); border-color: var(--artha-text); color: var(--artha-bg); }
    .icon-dot { position: absolute; top: 8px; right: 8px; width: 8px; height: 8px; border-radius: 50%; background: var(--artha-accent); }
    .month-step { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .month-nav {
      width: 44px; height: 44px; border: 0; background: transparent; border-radius: 50%;
      cursor: pointer; color: var(--artha-text-muted);
      display: inline-flex; align-items: center; justify-content: center;
    }
    .month-nav:hover:not(:disabled) { background: var(--artha-surface-2); color: var(--artha-text); }
    .month-nav:disabled { opacity: 0.3; cursor: default; }
    .month-nav ion-icon { font-size: 20px; }
    .month-center {
      border: 0; background: transparent; cursor: pointer; padding: 2px 8px;
      display: flex; flex-direction: column; align-items: center; gap: 2px; color: var(--artha-text);
    }
    .mc-name { font-size: 17px; font-weight: 800; letter-spacing: -0.01em; }
    .mc-sub { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--artha-text-subtle); }
    .month-jump {
      font-size: 11px; font-weight: 700;
      color: var(--artha-accent); background: var(--artha-accent-tint);
      padding: 1px 8px; border-radius: 999px;
    }
    .add-cta {
      display: inline-flex; align-items: center; gap: 6px;
      height: 44px; padding: 0 16px;
      border: 0; border-radius: 14px;
      background: var(--artha-accent); color: #ffffff;
      font-size: 13.5px; font-weight: 700; cursor: pointer;
    }
    .add-cta:hover { background: var(--artha-accent-hover); }
    .add-cta ion-icon { font-size: 18px; }
    @media (max-width: 767.98px) { .desktop-only { display: none; } }

    /* ====== Summary card ====== */
    .hero { padding: 18px; border-radius: var(--artha-radius-2xl, 24px); background: #1e1b4b; color: #ffffff; }
    .hero-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
    .hero-label { margin: 0; font-size: 12.5px; font-weight: 600; color: #c7d2fe; }
    .hero-value { margin: 2px 0 0; font-size: 32px; font-weight: 800; letter-spacing: -0.03em; }
    .hero-delta {
      display: inline-block; margin-top: 6px; padding: 3px 9px; border-radius: 999px;
      background: rgba(52, 211, 153, 0.16); color: #6ee7b7; font-size: 12px; font-weight: 700;
    }
    .hero-delta.up { background: rgba(251, 113, 133, 0.18); color: #fda4af; }
    .hero-side { text-align: right; }
    .hero-income { margin: 2px 0 0; font-size: 17px; font-weight: 800; color: #6ee7b7; }
    .hero-avg { margin: 8px 0 0; font-size: 12px; color: #a5b4fc; }
    .hero-bars { display: flex; align-items: flex-end; gap: 3px; height: 44px; margin-top: 14px; }
    .hb { flex: 1; min-width: 0; min-height: 3px; border-radius: 3px; background: #4f46e5; }
    .hb.today { background: #fbbf24; }
    .hb.future { background: #312e81; }

    /* ====== Search + filters ====== */
    .search-bar {
      display: flex; align-items: center; gap: 10px;
      height: 48px; padding: 0 16px;
      border: 1px solid var(--artha-border);
      border-radius: 16px;
      background: var(--artha-surface);
    }
    .search-bar ion-icon { font-size: 18px; color: var(--artha-text-subtle); flex-shrink: 0; }
    .search-input {
      flex: 1; min-width: 0;
      border: 0; background: transparent;
      font-size: 14.5px; color: var(--artha-text);
    }
    .search-input:focus { outline: none; }
    .search-input::placeholder { color: var(--artha-text-subtle); }

    .chips {
      display: flex; gap: 8px;
      overflow-x: auto; scrollbar-width: none;
      margin: 0 -20px; padding: 0 20px 2px;
    }
    .chips::-webkit-scrollbar { display: none; }
    .chip {
      display: inline-flex; align-items: center; gap: 6px;
      flex-shrink: 0; height: 36px; padding: 0 14px;
      border: 1px solid var(--artha-border);
      border-radius: 999px;
      background: var(--artha-surface);
      color: var(--artha-text);
      font-size: 13px; font-weight: 600;
      cursor: pointer; white-space: nowrap;
    }
    .chip:hover { background: var(--artha-surface-2); }
    .chip.active {
      background: var(--artha-text);
      border-color: var(--artha-text);
      color: var(--artha-bg);
      font-weight: 700;
    }
    .chip-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    .chip-amt { font-weight: 700; color: var(--artha-text-muted); }
    .chip.active .chip-amt { color: inherit; opacity: 0.8; }

    .filters-aux { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .filter-select {
      height: 36px; padding: 0 12px;
      border: 1px solid var(--artha-border);
      border-radius: 999px;
      background: var(--artha-surface);
      color: var(--artha-text);
      font-size: 13px; font-weight: 600;
      cursor: pointer; min-width: 140px;
    }
    .filter-select:focus { outline: 2px solid var(--artha-accent); outline-offset: -1px; }
    .filter-clear {
      display: inline-flex; align-items: center; gap: 4px;
      height: 36px; padding: 0 12px;
      border: 1px solid var(--artha-border);
      border-radius: 999px;
      background: var(--artha-surface);
      color: var(--artha-text-muted);
      font-size: 13px; font-weight: 600; cursor: pointer;
    }
    .filter-clear ion-icon { font-size: 15px; }
    .view-switcher {
      margin-left: auto;
      display: inline-flex; padding: 3px;
      background: var(--artha-surface-2);
      border-radius: 999px;
    }
    .view-switcher button {
      border: 0; background: transparent;
      height: 30px; padding: 0 12px; border-radius: 999px;
      cursor: pointer; color: var(--artha-text-muted);
      display: inline-flex; align-items: center; gap: 6px;
      font-size: 12.5px; font-weight: 600;
    }
    .view-switcher button ion-icon { font-size: 15px; }
    .view-switcher button.active {
      background: var(--artha-surface);
      color: var(--artha-text);
      box-shadow: 0 1px 3px rgba(15, 23, 42, 0.12);
    }


    /* ====== Rows ====== */
    .row-list { list-style: none; padding: 2px 14px; margin: 0; }
    .row-list--card, .day-group .row-list {
      background: var(--artha-surface);
      border-radius: var(--artha-radius-xl, 22px);
    }
    .row {
      display: grid;
      grid-template-columns: 40px 1fr auto 28px;
      align-items: center;
      gap: 12px;
      padding: 12px 0;
      cursor: pointer;
      border-top: 1px solid var(--artha-surface-2);
    }
    .row:first-child { border-top: 0; }
    .row-icon {
      width: 40px; height: 40px;
      border-radius: 14px;
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 14px; font-weight: 700;
    }
    .row-icon ion-icon { font-size: 18px; }
    .row-text { min-width: 0; }
    .row-title {
      margin: 0;
      font-size: 14.5px; font-weight: 700;
      color: var(--artha-text);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .excluded-badge {
      display: inline-block; margin-left: 6px;
      padding: 1px 7px; border-radius: 999px;
      font-size: 10px; font-weight: 700;
      background: var(--artha-surface-2); color: var(--artha-text-muted);
      vertical-align: middle;
    }
    .row-meta {
      margin: 2px 0 0;
      font-size: 12px; color: var(--artha-text-subtle);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .row-amount { font-size: 15px; font-weight: 800; color: var(--artha-text); }
    .row-amount.income { color: var(--artha-positive); }
    .row--off .row-amount { color: var(--artha-text-subtle); }
    .row-delete {
      width: 28px; height: 28px;
      border: 0; background: transparent; border-radius: 8px;
      color: var(--artha-text-subtle); cursor: pointer;
      opacity: 0;
      transition: opacity 120ms ease, background 120ms ease, color 120ms ease;
      display: inline-flex; align-items: center; justify-content: center;
    }
    .row-delete ion-icon { font-size: 15px; }
    .row:hover .row-delete { opacity: 1; }
    /* Touch screens have no hover, so keep the button visible there. */
    @media (hover: none) { .row-delete { opacity: 1; } }
    .row-delete:hover { background: var(--artha-negative-tint); color: var(--artha-negative); }

    /* ====== List view ====== */
    .list-view { display: flex; flex-direction: column; gap: 14px; }
    .day-group-head {
      display: flex; justify-content: space-between; align-items: baseline;
      padding: 2px 4px 8px;
      font-size: 13px; font-weight: 800;
      color: var(--artha-text);
    }
    .day-group-head .num { font-weight: 700; color: var(--artha-text-muted); }

    /* ====== Day view ====== */
    .day-view { display: flex; flex-direction: column; gap: 14px; }
    .day-nav {
      display: flex; align-items: center; justify-content: space-between;
      padding: 8px 10px;
      background: var(--artha-surface);
      border-radius: 18px;
    }
    .day-nav-btn {
      width: 40px; height: 40px;
      border: 0; background: transparent; border-radius: 12px;
      cursor: pointer; color: var(--artha-text-muted);
      display: inline-flex; align-items: center; justify-content: center;
    }
    .day-nav-btn:hover { background: var(--artha-surface-2); color: var(--artha-text); }
    .day-nav-btn ion-icon { font-size: 20px; }
    .day-nav-label { text-align: center; }
    .day-nav-eyebrow {
      margin: 0 0 2px;
      font-size: 11px; font-weight: 700;
      letter-spacing: 0.08em; text-transform: uppercase;
      color: var(--artha-accent);
    }
    .day-nav-date { margin: 0; font-size: 16px; font-weight: 800; color: var(--artha-text); }
    .day-summary {
      text-align: center;
      padding: 24px 16px;
      background: var(--artha-accent);
      border-radius: var(--artha-radius-2xl, 24px);
      color: #ffffff;
    }
    .day-summary-total { margin: 0; font-size: 34px; font-weight: 800; letter-spacing: -0.03em; }
    .day-summary-meta { margin: 4px 0 0; font-size: 13px; color: rgba(255, 255, 255, 0.85); }

    /* ====== Month view ====== */
    .month-view {
      background: var(--artha-surface);
      border-radius: var(--artha-radius-xl, 22px);
      padding: 16px;
    }
    .weekdays { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; padding: 0 4px 8px; }
    .weekday {
      text-align: center;
      font-size: 11px; font-weight: 700;
      color: var(--artha-text-subtle);
      letter-spacing: 0.06em; text-transform: uppercase;
    }
    .calendar { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; }
    .cell {
      aspect-ratio: 1;
      border: 1px solid var(--artha-border);
      border-radius: 12px;
      padding: 8px 10px; cursor: pointer;
      display: flex; flex-direction: column;
      align-items: flex-start; justify-content: space-between;
      background: var(--artha-surface);
      position: relative; min-height: 76px;
    }
    .cell:hover { border-color: var(--artha-accent); }
    .cell--off { opacity: 0.35; }
    .cell--today { border-color: var(--artha-accent); }
    .cell--today .cell-day { color: var(--artha-accent); font-weight: 800; }
    .cell--selected { outline: 2px solid var(--artha-accent); outline-offset: -2px; }
    .cell-day { font-size: 13px; font-weight: 600; color: var(--artha-text-muted); }
    .cell--has .cell-day { color: var(--artha-text); }
    .cell-total { font-size: 12px; font-weight: 700; color: var(--artha-text); }
    .cell--has[style*='background'] .cell-day,
    .cell--has[style*='background'] .cell-total { color: var(--artha-accent-hover); }
    .month-legend { margin: 14px 4px 0; font-size: 11px; color: var(--artha-text-subtle); text-align: center; }

    /* ====== States ====== */
    .state { display: flex; justify-content: center; padding: 64px; }
    .empty {
      display: flex; flex-direction: column; align-items: center;
      gap: 10px; padding: 48px 24px;
      background: var(--artha-surface);
      border-radius: var(--artha-radius-xl, 22px);
      color: var(--artha-text-subtle);
      text-align: center;
    }
    .empty-badge {
      width: 56px; height: 56px; border-radius: 18px;
      display: grid; place-items: center;
      background: var(--artha-accent-tint); color: var(--artha-accent);
    }
    .empty-badge ion-icon { font-size: 26px; }
    .empty p { margin: 0; font-size: 14px; color: var(--artha-text-muted); }
    .empty-cta {
      margin-top: 4px; height: 40px; padding: 0 18px;
      border: 0; border-radius: 999px;
      background: var(--artha-accent); color: #ffffff;
      font-size: 13.5px; font-weight: 700; cursor: pointer;
    }
    .empty--inline { padding: 28px 16px; }

    /* ====== Responsive ====== */
    @media (max-width: 640px) {
      .view-switcher button span { display: none; }
      .view-switcher button { padding: 0 10px; }
      .calendar { gap: 4px; }
      .cell { min-height: 60px; padding: 5px 6px; }
      .cell-day { font-size: 12px; }
      .cell-total { font-size: 10px; }
    }
    @media (max-width: 767.98px) {
      .page { padding-bottom: 24px; }
    }
  `],
})
export class ExpensesListPage implements OnInit {
  protected readonly expensesStore = inject(ExpensesStore);
  protected readonly categoriesStore = inject(CategoriesStore);
  protected readonly accountsStore = inject(AccountsStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly notifier = inject(ConflictNotifierService);
  private readonly alertCtrl = inject(AlertController);
  private readonly api = inject(ExpensesApi);

  protected readonly showSearch = signal(false);
  protected readonly showFilters = signal(false);
  /** The month before the one shown, for "vs last month (same days)". */
  private readonly prevItems = signal<Expense[]>([]);

  protected readonly weekdays = WEEKDAYS;

  protected readonly viewOptions: { value: ViewMode; label: string; icon: string }[] = [
    { value: 'list',  label: 'List',  icon: 'list-outline' },
    { value: 'day',   label: 'Day',   icon: 'today-outline' },
    { value: 'month', label: 'Month', icon: 'calendar-outline' },
  ];

  // --- View / navigation state ---
  protected readonly view = signal<ViewMode>('list');
  // Year + month (1..12) — picked apart so we don't fight Date timezones.
  protected readonly viewYear = signal<number>(new Date().getFullYear());
  protected readonly viewMonth = signal<number>(new Date().getMonth() + 1);
  protected readonly selectedDay = signal<string>(TODAY_ISO);

  // --- Filters ---
  protected readonly filterCategoryId = signal<string | null>(null);
  protected readonly filterAccountId = signal<string | null>(null);
  protected readonly search = signal<string>('');

  protected readonly hasActiveFilters = computed(() =>
    this.filterCategoryId() !== null
    || this.filterAccountId() !== null
    || this.search().trim() !== '',
  );

  protected readonly filterableCategories = computed(() =>
    [...this.categoriesStore.items()].sort((a, b) => a.name.localeCompare(b.name)),
  );
  protected readonly filterableAccounts = computed(() =>
    [...this.accountsStore.items()].sort((a, b) => a.name.localeCompare(b.name)),
  );

  // --- Derived: filter the store's items to the visible month + active filters ---
  protected readonly monthExpenses = computed<Expense[]>(() => {
    const prefix = monthPrefix(this.viewYear(), this.viewMonth());
    const cat = this.filterCategoryId();
    const acc = this.filterAccountId();
    const q = this.search().trim().toLowerCase();
    return this.expensesStore.items().filter((e) => {
      if (!e.date.startsWith(prefix)) return false;
      return this.matches(e, cat, acc, q);
    });
  });

  /** Category (incl. its subcategories), account and search filters. */
  private matches(e: Expense, cat: string | null, acc: string | null, q: string): boolean {
    if (cat && e.categoryId !== cat && this.categoriesStore.byId()[e.categoryId]?.parentId !== cat) return false;
    if (acc && e.accountId !== acc) return false;
    if (q) {
      const hay = `${e.note ?? ''} ${this.categoryPath(e.categoryId)} ${this.accountName(e.accountId)}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }

  /** Days of the shown month that have happened (all of them for a past month). */
  private readonly daysSoFar = computed(() =>
    this.isCurrentMonth() ? new Date().getDate() : daysInMonth(this.viewYear(), this.viewMonth()),
  );

  protected readonly monthShort = computed(() => MONTH_SHORT[this.viewMonth() - 1]);

  /** "1 – 10 Nov · 38 transactions" for this month, "Whole month · 112 transactions" for a past one. */
  protected readonly monthSub = computed(() => {
    const n = this.monthCount();
    const count = `${n} ${n === 1 ? 'transaction' : 'transactions'}`;
    return this.isCurrentMonth() ? `1 – ${this.daysSoFar()} ${this.monthShort()} · ${count}` : `Whole month · ${count}`;
  });

  /** Spend change vs the previous month over the same days (filters applied to both). */
  protected readonly vsPrevious = computed(() => {
    const cat = this.filterCategoryId();
    const acc = this.filterAccountId();
    const q = this.search().trim().toLowerCase();
    const upTo = this.daysSoFar();
    const prev = this.prevItems()
      .filter((e) => countsAsSpend(e) && Number(e.date.slice(8, 10)) <= upTo && this.matches(e, cat, acc, q))
      .reduce((s, e) => s + e.amount, 0);
    if (prev <= 0) return null;
    const diff = this.monthTotal() - prev;
    const prevMonth = this.viewMonth() === 1 ? 12 : this.viewMonth() - 1;
    return {
      up: diff > 0,
      pct: Math.round((Math.abs(diff) / prev) * 100),
      label: MONTH_SHORT[prevMonth - 1] + (this.isCurrentMonth() ? ', same days' : ''),
    };
  });

  /** One mini bar per day: today in gold, days still to come dimmed. */
  protected readonly miniBars = computed(() => {
    const days = daysInMonth(this.viewYear(), this.viewMonth());
    const totals = new Array(days).fill(0);
    for (const e of this.monthExpenses()) {
      if (countsAsSpend(e)) totals[Number(e.date.slice(8, 10)) - 1] += e.amount;
    }
    const max = Math.max(...totals, 1);
    const today = this.isCurrentMonth() ? new Date().getDate() : 0;
    return totals.map((t, i) => ({
      day: i + 1,
      pct: Math.max(6, (t / max) * 100),
      today: i + 1 === today,
      future: today > 0 && i + 1 > today,
    }));
  });

  /** Top-level categories with spend this month (biggest first), for the chips. */
  protected readonly categoryChips = computed(() => {
    const byId = this.categoriesStore.byId();
    const acc = this.filterAccountId();
    const q = this.search().trim().toLowerCase();
    const prefix = monthPrefix(this.viewYear(), this.viewMonth());
    const totals = new Map<string, number>();
    for (const e of this.expensesStore.items()) {
      if (!e.date.startsWith(prefix) || !countsAsSpend(e) || !this.matches(e, null, acc, q)) continue;
      const root = byId[e.categoryId]?.parentId ?? e.categoryId;
      totals.set(root, (totals.get(root) ?? 0) + e.amount);
    }
    const sel = this.filterCategoryId();
    if (sel && !totals.has(sel)) totals.set(sel, 0);
    return [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id, total]) => ({ id, name: byId[id]?.name ?? 'Other', total, label: compactMoney(total, this.currency()) }));
  });


  protected readonly currency = computed(() =>
    this.monthExpenses()[0]?.currency
      ?? this.expensesStore.currency()
      ?? 'USD',
  );

  protected readonly monthTotal = computed(() =>
    this.monthExpenses().reduce((sum, e) => (countsAsSpend(e) ? sum + e.amount : sum), 0),
  );

  /** Money received this month (income entries, excluding excluded ones). */
  protected readonly monthIncome = computed(() =>
    this.monthExpenses().reduce(
      (sum, e) => (!e.excluded && e.type === 'income' ? sum + e.amount : sum),
      0,
    ),
  );

  protected readonly monthCount = computed(() =>
    this.monthExpenses().filter(countsAsSpend).length,
  );

  protected readonly dailyAverage = computed(() => {
    const total = this.monthTotal();
    return total > 0 ? total / Math.max(1, this.daysSoFar()) : 0;
  });

  protected readonly dayGroups = computed<DayGroup[]>(() => {
    const groups = new Map<string, DayGroup>();
    for (const e of this.monthExpenses()) {
      let g = groups.get(e.date);
      if (!g) {
        g = { date: e.date, items: [], total: 0 };
        groups.set(e.date, g);
      }
      g.items.push(e);
      if (countsAsSpend(e)) g.total += e.amount;
    }
    return Array.from(groups.values()).sort((a, b) => b.date.localeCompare(a.date));
  });

  protected readonly biggestDay = computed(() => this.dayGroups()
    .reduce<DayGroup | null>((max, g) => (!max || g.total > max.total ? g : max), null));

  protected readonly selectedDayExpenses = computed<Expense[]>(() =>
    this.expensesStore.items().filter((e) => e.date === this.selectedDay()),
  );

  protected readonly selectedDayTotal = computed(() =>
    this.selectedDayExpenses().reduce((sum, e) => (countsAsSpend(e) ? sum + e.amount : sum), 0),
  );

  protected readonly calendar = computed<CalendarCell[]>(() => {
    const year = this.viewYear();
    const month = this.viewMonth();
    const totals = new Map<string, { total: number; count: number }>();
    for (const g of this.dayGroups()) {
      totals.set(g.date, { total: g.total, count: g.items.filter(countsAsSpend).length });
    }

    // Build a 6-row grid starting on Sunday for visual consistency.
    const firstOfMonth = new Date(year, month - 1, 1);
    const startWeekday = firstOfMonth.getDay(); // 0 = Sun
    const start = new Date(year, month - 1, 1 - startWeekday);
    const cells: CalendarCell[] = [];
    const selected = this.selectedDay();
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const iso = toIsoDate(d);
      const cellMonth = d.getMonth() + 1;
      const t = totals.get(iso);
      cells.push({
        date: iso,
        day: d.getDate(),
        inMonth: cellMonth === month,
        total: t?.total ?? 0,
        count: t?.count ?? 0,
        isToday: iso === TODAY_ISO,
        isSelected: iso === selected,
      });
    }
    return cells;
  });

  protected readonly monthLabel = computed(() =>
    new Date(this.viewYear(), this.viewMonth() - 1, 1)
      .toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
  );

  protected isCurrentMonth(): boolean {
    const now = new Date();
    return this.viewYear() === now.getFullYear()
      && this.viewMonth() === now.getMonth() + 1;
  }

  ngOnInit(): void {
    // Deep-link support, e.g. from the Reports "by category" drill-down:
    // /expenses?category=<id>&year=YYYY&month=M
    const qp = this.route.snapshot.queryParamMap;
    const year = Number(qp.get('year'));
    const month = Number(qp.get('month'));
    if (year >= 2000 && month >= 1 && month <= 12) {
      this.viewYear.set(year);
      this.viewMonth.set(month);
    }
    const category = qp.get('category');
    if (category) {
      this.filterCategoryId.set(category);
    }
    const account = qp.get('account');
    if (account) {
      this.filterAccountId.set(account);
    }

    void this.loadMonth();
    if (this.categoriesStore.items().length === 0) {
      void this.categoriesStore.load(/* includeArchived */ true);
    }
    if (this.accountsStore.items().length === 0) {
      void this.accountsStore.load(/* includeArchived */ true);
    }
  }

  protected setView(v: ViewMode): void {
    this.view.set(v);
  }

  protected shiftMonth(delta: number): void {
    let y = this.viewYear();
    let m = this.viewMonth() + delta;
    if (m < 1) { m = 12; y--; }
    if (m > 12) { m = 1; y++; }
    this.viewYear.set(y);
    this.viewMonth.set(m);
    void this.loadMonth();
  }

  protected resetToCurrentMonth(): void {
    const now = new Date();
    this.viewYear.set(now.getFullYear());
    this.viewMonth.set(now.getMonth() + 1);
    this.selectedDay.set(TODAY_ISO);
    void this.loadMonth();
  }

  protected selectDay(date: string): void {
    this.selectedDay.set(date);
    // Sync the visible month to the selected day if the user clicked into a
    // leading/trailing day from a neighbouring month in the calendar grid.
    const [y, m] = date.split('-').map(Number);
    if (y !== this.viewYear() || m !== this.viewMonth()) {
      this.viewYear.set(y);
      this.viewMonth.set(m);
      void this.loadMonth();
    }
    this.view.set('day');
  }

  protected shiftSelectedDay(delta: number): void {
    const d = new Date(this.selectedDay() + 'T00:00:00');
    d.setDate(d.getDate() + delta);
    const iso = toIsoDate(d);
    this.selectedDay.set(iso);
    // Re-sync month if we crossed a boundary.
    const [y, m] = iso.split('-').map(Number);
    if (y !== this.viewYear() || m !== this.viewMonth()) {
      this.viewYear.set(y);
      this.viewMonth.set(m);
      void this.loadMonth();
    }
  }

  /** "Today · Mon 2 Nov", "Yesterday · Sun 1 Nov" or "Sat 31 Oct" for a YYYY-MM-DD day. */
  protected dayHeader(iso: string): string {
    const d = new Date(`${iso}T00:00:00`);
    if (Number.isNaN(d.getTime())) return iso;
    const label = `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]} ${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diff = Math.round((today.getTime() - d.getTime()) / 86_400_000);
    if (diff === 0) return `Today · ${label}`;
    if (diff === 1) return `Yesterday · ${label}`;
    return label;
  }

  /** "Food › Café" for a subcategory, else the category name. */
  protected categoryPath(id: string): string {
    const byId = this.categoriesStore.byId();
    const c = byId[id];
    if (!c) return 'Unknown';
    const parent = c.parentId ? byId[c.parentId] : null;
    return parent ? `${parent.name} › ${c.name}` : c.name;
  }

  protected toggleSearch(): void {
    const next = !this.showSearch();
    this.showSearch.set(next);
    if (!next) this.search.set('');
  }

  protected categoryName(id: string): string {
    return this.categoriesStore.byId()[id]?.name ?? 'Unknown';
  }

  protected accountName(id: string): string {
    return this.accountsStore.byId()[id]?.name ?? 'Cash';
  }

  protected categoryColor(id: string): string {
    // Prefer the category's own colour; fall back to the same deterministic
    // palette as the dashboard for visual continuity.
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

  protected cellBg(cell: CalendarCell): string | null {
    if (cell.total <= 0) return null;
    const maxToday = Math.max(
      ...this.calendar().filter((c) => c.inMonth).map((c) => c.total),
      1,
    );
    // 6 buckets of indigo tint: lighter for smaller days, deeper for bigger.
    const ratio = Math.min(1, cell.total / maxToday);
    const alpha = 0.08 + ratio * 0.32; // 0.08 .. 0.40
    return `rgba(99, 102, 241, ${alpha.toFixed(2)})`;
  }

  protected onCategoryFilter(event: Event): void {
    this.filterCategoryId.set((event.target as HTMLSelectElement).value || null);
  }

  protected onAccountFilter(event: Event): void {
    this.filterAccountId.set((event.target as HTMLSelectElement).value || null);
  }

  protected onSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }

  protected clearFilters(): void {
    this.filterCategoryId.set(null);
    this.filterAccountId.set(null);
    this.search.set('');
  }

  protected add(): void {
    void this.router.navigate(['/expenses', 'new']);
  }

  protected edit(id: string): void {
    void this.router.navigate(['/expenses', id]);
  }

  protected async onDelete(event: Event, id: string): Promise<void> {
    event.stopPropagation();
    const alert = await this.alertCtrl.create({
      header: 'Delete this expense?',
      message: "It will be removed from your records. This can't be undone.",
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Delete', role: 'destructive' },
      ],
    });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    if (role !== 'destructive') {
      return;
    }
    try {
      await this.expensesStore.remove(id);
    } catch {
      await this.notifier.notifyError('Could not delete expense.');
    }
  }

  private async loadMonth(force = false): Promise<void> {
    const prefix = monthPrefix(this.viewYear(), this.viewMonth());
    const prevDate = new Date(this.viewYear(), this.viewMonth() - 2, 1);
    const prev = monthPrefix(prevDate.getFullYear(), prevDate.getMonth() + 1);
    this.prevItems.set([]);
    // The previous month only feeds the "vs last month" pill; never block on it.
    void this.api
      .list(prev, prev)
      .then((res) => {
        if (monthPrefix(this.viewYear(), this.viewMonth()) === prefix) this.prevItems.set(res.items);
      })
      .catch(() => undefined);
    await this.expensesStore.load(prefix, prefix, force);
  }
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
