import { CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  IonContent,
  IonIcon,
  IonSpinner,
  ModalController,
} from '@ionic/angular/standalone';
import { ConflictNotifierService } from '../../core/feedback/conflict-notifier.service';
import { Expense } from '../../core/models/expense.model';
import { ImportResultResponse } from '../../core/models/import.model';
import { AccountsStore } from '../accounts/accounts.store';
import { CategoriesStore } from '../categories/categories.store';
import { ExpenseImportModal } from './expense-import.modal';
import { ExpensesStore } from './expenses.store';

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
    IonContent,
    IonIcon,
    IonSpinner,
  ],
  template: `
    <ion-content class="page-content">
      <div class="page">
        <!-- Header: month picker + view switcher + add CTA -->
        <header class="page-header">
          <div class="month-picker">
            <button
              type="button"
              class="month-nav"
              (click)="shiftMonth(-1)"
              aria-label="Previous month"
            >
              <ion-icon name="chevron-back"></ion-icon>
            </button>
            <button type="button" class="month-label" (click)="resetToCurrentMonth()">
              <span class="month-name">{{ monthLabel() }}</span>
              @if (!isCurrentMonth()) {
                <span class="month-jump">Today</span>
              }
            </button>
            <button
              type="button"
              class="month-nav"
              (click)="shiftMonth(1)"
              aria-label="Next month"
            >
              <ion-icon name="chevron-forward"></ion-icon>
            </button>
          </div>

          <div class="view-switcher" role="tablist">
            @for (v of viewOptions; track v.value) {
              <button
                type="button"
                role="tab"
                [class.active]="view() === v.value"
                (click)="setView(v.value)"
              >
                <ion-icon [name]="v.icon" aria-hidden="true"></ion-icon>
                <span>{{ v.label }}</span>
              </button>
            }
          </div>

          <button type="button" class="import-cta" (click)="openImport()">
            <ion-icon name="cloud-upload-outline" aria-hidden="true"></ion-icon>
            <span>Import</span>
          </button>

          <button type="button" class="add-cta" (click)="add()">
            <ion-icon name="add" aria-hidden="true"></ion-icon>
            <span>Add expense</span>
          </button>
        </header>

        <!-- Summary strip -->
        <section class="summary">
          <div class="summary-stat">
            <p class="summary-label">Spent</p>
            <p class="summary-value num">
              {{ monthTotal() | currency: currency() : 'symbol' : '1.2-2' }}
            </p>
          </div>
          <div class="summary-stat">
            <p class="summary-label">Entries</p>
            <p class="summary-value num">{{ monthCount() }}</p>
          </div>
          <div class="summary-stat">
            <p class="summary-label">Daily avg</p>
            <p class="summary-value num">
              {{ dailyAverage() | currency: currency() : 'symbol' : '1.0-0' }}
            </p>
          </div>
          <div class="summary-stat">
            <p class="summary-label">Biggest day</p>
            <p class="summary-value num">
              @if (biggestDay(); as bd) {
                {{ bd.total | currency: currency() : 'symbol' : '1.0-0' }}
              } @else {
                —
              }
            </p>
          </div>
        </section>

        <!-- Filters -->
        <section class="filters">
          <select
            class="filter-select"
            aria-label="Filter by category"
            [value]="filterCategoryId() ?? ''"
            (change)="onCategoryFilter($event)"
          >
            <option value="">All categories</option>
            @for (c of filterableCategories(); track c.id) {
              <option [value]="c.id">{{ c.name }}</option>
            }
          </select>

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

          <input
            class="filter-search"
            type="search"
            placeholder="Search notes…"
            [value]="search()"
            (input)="onSearch($event)"
          />

          @if (hasActiveFilters()) {
            <button type="button" class="filter-clear" (click)="clearFilters()">
              <ion-icon name="close-outline" aria-hidden="true"></ion-icon>
              <span>Clear</span>
            </button>
          }
        </section>

        @if (expensesStore.loading()) {
          <div class="state"><ion-spinner></ion-spinner></div>
        } @else if (monthCount() === 0) {
          @if (hasActiveFilters()) {
            <div class="empty">
              <ion-icon name="receipt-outline"></ion-icon>
              <p>No expenses match your filters in {{ monthLabel() }}.</p>
              <button type="button" class="empty-cta" (click)="clearFilters()">
                Clear filters
              </button>
            </div>
          } @else {
            <div class="empty">
              <ion-icon name="receipt-outline"></ion-icon>
              <p>No expenses in {{ monthLabel() }}.</p>
              <button type="button" class="empty-cta" (click)="add()">
                Add your first one
              </button>
            </div>
          }
        } @else {
          <!-- View body -->
          @switch (view()) {
            @case ('list') {
              <section class="list-view">
                @for (group of dayGroups(); track group.date) {
                  <div class="day-group">
                    <div class="day-group-head">
                      <div>
                        <p class="day-group-date">{{ group.date | date:'EEEE, MMMM d' }}</p>
                        <p class="day-group-meta">
                          {{ group.items.length }}
                          {{ group.items.length === 1 ? 'expense' : 'expenses' }}
                        </p>
                      </div>
                      <p class="day-group-total num">
                        {{ group.total | currency: currency() : 'symbol' : '1.2-2' }}
                      </p>
                    </div>
                    <ul class="row-list">
                      @for (expense of group.items; track expense.id) {
                        <li class="row" (click)="edit(expense.id)">
                          <span
                            class="row-dot"
                            [style.background]="categoryColor(expense.categoryId)"
                          ></span>
                          <div class="row-text">
                            <p class="row-title">
                            {{ categoryName(expense.categoryId) }}
                            @if (expense.excluded) { <span class="excluded-badge">Excluded</span> }
                          </p>
                            <p class="row-meta">
                              {{ accountName(expense.accountId) }}
                              @if (expense.note) { · {{ expense.note }} }
                            </p>
                          </div>
                          <span class="row-amount num">
                            {{ expense.amount | currency: expense.currency : 'symbol' : '1.2-2' }}
                          </span>
                          <button
                            type="button"
                            class="row-delete"
                            aria-label="Delete"
                            (click)="onDelete($event, expense.id)"
                          >
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
                  <button
                    type="button"
                    class="day-nav-btn"
                    (click)="shiftSelectedDay(-1)"
                    aria-label="Previous day"
                  >
                    <ion-icon name="chevron-back"></ion-icon>
                  </button>
                  <div class="day-nav-label">
                    <p class="day-nav-eyebrow">{{ selectedDay() | date:'EEEE' }}</p>
                    <p class="day-nav-date">{{ selectedDay() | date:'MMMM d, y' }}</p>
                  </div>
                  <button
                    type="button"
                    class="day-nav-btn"
                    (click)="shiftSelectedDay(1)"
                    aria-label="Next day"
                  >
                    <ion-icon name="chevron-forward"></ion-icon>
                  </button>
                </div>

                <div class="day-summary">
                  <p class="day-summary-total num">
                    {{ selectedDayTotal() | currency: currency() : 'symbol' : '1.2-2' }}
                  </p>
                  <p class="day-summary-meta">
                    {{ selectedDayExpenses().length }}
                    {{ selectedDayExpenses().length === 1 ? 'expense' : 'expenses' }} today
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
                          class="row-dot"
                          [style.background]="categoryColor(expense.categoryId)"
                        ></span>
                        <div class="row-text">
                          <p class="row-title">
                            {{ categoryName(expense.categoryId) }}
                            @if (expense.excluded) { <span class="excluded-badge">Excluded</span> }
                          </p>
                          <p class="row-meta">
                            {{ accountName(expense.accountId) }}
                            @if (expense.note) { · {{ expense.note }} }
                          </p>
                        </div>
                        <span class="row-amount num">
                          {{ expense.amount | currency: expense.currency : 'symbol' : '1.2-2' }}
                        </span>
                        <button
                          type="button"
                          class="row-delete"
                          aria-label="Delete"
                          (click)="onDelete($event, expense.id)"
                        >
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
                        <span class="cell-total num">
                          {{ cell.total | number: '1.0-0' }}
                        </span>
                      }
                    </button>
                  }
                </div>
                <p class="month-legend">
                  Cell tint scales with daily spend.
                  Tap a day to drill in.
                </p>
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

    .page {
      padding: 28px 24px 64px;
      max-width: 1080px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    /* ====== Header ====== */
    .page-header {
      display: flex;
      align-items: center;
      gap: 16px;
      flex-wrap: wrap;
    }

    .month-picker {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px;
      background: var(--artha-surface);
      border: 1px solid var(--artha-border);
      border-radius: var(--artha-radius);
      box-shadow: var(--artha-shadow-sm);
    }
    .month-nav {
      width: 32px; height: 32px;
      border: 0; background: transparent;
      border-radius: 8px;
      cursor: pointer;
      color: var(--artha-text-muted);
      display: inline-flex; align-items: center; justify-content: center;
      transition: background 120ms ease, color 120ms ease;
    }
    .month-nav:hover {
      background: var(--artha-surface-2);
      color: var(--artha-text);
    }
    .month-nav ion-icon { font-size: 18px; }
    .month-label {
      border: 0; background: transparent;
      padding: 6px 14px;
      cursor: pointer;
      display: inline-flex; align-items: center; gap: 8px;
      font-size: 14px; font-weight: 600;
      color: var(--artha-text);
      border-radius: 8px;
    }
    .month-label:hover { background: var(--artha-surface-2); }
    .month-jump {
      font-size: 11px; font-weight: 600;
      color: var(--artha-accent);
      background: var(--artha-accent-tint);
      padding: 2px 8px;
      border-radius: 999px;
    }

    .view-switcher {
      display: inline-flex;
      padding: 4px;
      background: var(--artha-surface);
      border: 1px solid var(--artha-border);
      border-radius: var(--artha-radius);
      box-shadow: var(--artha-shadow-sm);
    }
    .view-switcher button {
      border: 0; background: transparent;
      padding: 6px 12px;
      border-radius: 8px;
      cursor: pointer;
      color: var(--artha-text-muted);
      display: inline-flex; align-items: center; gap: 6px;
      font-size: 13px; font-weight: 500;
      transition: background 120ms ease, color 120ms ease;
    }
    .view-switcher button ion-icon { font-size: 16px; }
    .view-switcher button:hover { color: var(--artha-text); }
    .view-switcher button.active {
      background: var(--artha-accent-tint);
      color: var(--artha-accent);
      font-weight: 600;
    }

    .import-cta {
      margin-left: auto;
      display: inline-flex; align-items: center; gap: 6px;
      padding: 9px 14px;
      border: 1px solid var(--artha-border);
      border-radius: var(--artha-radius-sm);
      background: var(--artha-surface);
      color: var(--artha-text);
      font-size: 13px; font-weight: 600;
      cursor: pointer;
      box-shadow: var(--artha-shadow-sm);
      transition: background 120ms ease, transform 80ms ease;
    }
    .import-cta:hover { background: var(--artha-surface-2); }
    .import-cta:active { transform: translateY(1px); }
    .import-cta ion-icon { font-size: 16px; }

    .add-cta {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 9px 16px;
      border: 0;
      border-radius: var(--artha-radius-sm);
      background: var(--artha-accent);
      color: white;
      font-size: 13px; font-weight: 600;
      cursor: pointer;
      box-shadow: var(--artha-shadow-sm);
      transition: background 120ms ease, transform 80ms ease;
    }
    .add-cta:hover { background: var(--artha-accent-hover); }
    .add-cta:active { transform: translateY(1px); }
    .add-cta ion-icon { font-size: 16px; }

    /* ====== Filters ====== */
    .filters {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      margin: 16px 0 4px;
    }
    .filter-select, .filter-search {
      padding: 8px 11px;
      border: 1px solid var(--artha-border);
      border-radius: var(--artha-radius-sm);
      background: var(--artha-surface);
      color: var(--artha-text);
      font-size: 13px;
      box-shadow: var(--artha-shadow-sm);
    }
    .filter-select { cursor: pointer; min-width: 150px; }
    .filter-search { flex: 1; min-width: 160px; }
    .filter-select:focus, .filter-search:focus {
      outline: 2px solid var(--artha-accent); outline-offset: -1px;
    }
    .filter-clear {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 8px 12px;
      border: 1px solid var(--artha-border);
      border-radius: var(--artha-radius-sm);
      background: var(--artha-surface);
      color: var(--artha-text-muted);
      font-size: 13px; font-weight: 600; cursor: pointer;
    }
    .filter-clear:hover { background: var(--artha-surface-2); color: var(--artha-text); }
    .filter-clear ion-icon { font-size: 15px; }

    /* ====== Summary strip ====== */
    .summary {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 1px;
      background: var(--artha-border);
      border: 1px solid var(--artha-border);
      border-radius: var(--artha-radius);
      overflow: hidden;
      box-shadow: var(--artha-shadow-sm);
    }
    .summary-stat {
      padding: 14px 18px;
      background: var(--artha-surface);
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .summary-label {
      margin: 0;
      font-size: 11px; font-weight: 600;
      letter-spacing: 0.04em; text-transform: uppercase;
      color: var(--artha-text-subtle);
    }
    .summary-value {
      margin: 0;
      font-size: 19px; font-weight: 700;
      color: var(--artha-text);
      letter-spacing: -0.015em;
    }

    /* ====== Shared row list (list & day views) ====== */
    .row-list {
      list-style: none; padding: 0; margin: 0;
    }
    .row-list--card {
      background: var(--artha-surface);
      border: 1px solid var(--artha-border);
      border-radius: var(--artha-radius);
      box-shadow: var(--artha-shadow-sm);
      overflow: hidden;
    }
    .row {
      display: grid;
      grid-template-columns: 10px 1fr auto 28px;
      align-items: center;
      gap: 14px;
      padding: 12px 16px;
      cursor: pointer;
      border-top: 1px solid var(--artha-border);
      transition: background 120ms ease;
    }
    .row:first-child { border-top: 0; }
    .row:hover { background: var(--artha-surface-2); }
    .row-dot {
      width: 8px; height: 8px;
      border-radius: 50%;
    }
    .row-text { min-width: 0; }
    .row-title {
      margin: 0;
      font-size: 14px; font-weight: 600;
      color: var(--artha-text);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .excluded-badge {
      display: inline-block;
      margin-left: 6px;
      padding: 1px 7px;
      border-radius: 10px;
      font-size: 10px; font-weight: 600;
      background: var(--artha-surface-2); color: var(--artha-text-muted);
      vertical-align: middle;
    }
    .row-meta {
      margin: 2px 0 0;
      font-size: 12px;
      color: var(--artha-text-muted);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .row-amount {
      font-size: 14px; font-weight: 600;
      color: var(--artha-text);
    }
    .row-delete {
      width: 28px; height: 28px;
      border: 0; background: transparent;
      border-radius: 8px;
      color: var(--artha-text-subtle);
      cursor: pointer;
      opacity: 0;
      transition: opacity 120ms ease, background 120ms ease, color 120ms ease;
      display: inline-flex; align-items: center; justify-content: center;
    }
    .row-delete ion-icon { font-size: 15px; }
    .row:hover .row-delete { opacity: 1; }
    .row-delete:hover {
      background: var(--artha-negative-tint);
      color: var(--artha-negative);
    }

    /* ====== List view ====== */
    .list-view {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .day-group {
      background: var(--artha-surface);
      border: 1px solid var(--artha-border);
      border-radius: var(--artha-radius);
      box-shadow: var(--artha-shadow-sm);
      overflow: hidden;
    }
    .day-group-head {
      display: flex; align-items: center; justify-content: space-between;
      padding: 14px 18px;
      border-bottom: 1px solid var(--artha-border);
      background: linear-gradient(to bottom, var(--artha-surface) 0%, var(--artha-bg) 100%);
    }
    .day-group-date {
      margin: 0;
      font-size: 13px; font-weight: 600;
      color: var(--artha-text);
    }
    .day-group-meta {
      margin: 2px 0 0;
      font-size: 11px;
      color: var(--artha-text-subtle);
    }
    .day-group-total {
      margin: 0;
      font-size: 16px; font-weight: 700;
      color: var(--artha-text);
      letter-spacing: -0.01em;
    }

    /* ====== Day view ====== */
    .day-view {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .day-nav {
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 16px;
      background: var(--artha-surface);
      border: 1px solid var(--artha-border);
      border-radius: var(--artha-radius);
      box-shadow: var(--artha-shadow-sm);
    }
    .day-nav-btn {
      width: 36px; height: 36px;
      border: 0; background: transparent;
      border-radius: 8px;
      cursor: pointer;
      color: var(--artha-text-muted);
      display: inline-flex; align-items: center; justify-content: center;
      transition: background 120ms ease, color 120ms ease;
    }
    .day-nav-btn:hover {
      background: var(--artha-surface-2);
      color: var(--artha-text);
    }
    .day-nav-btn ion-icon { font-size: 20px; }
    .day-nav-label { text-align: center; }
    .day-nav-eyebrow {
      margin: 0 0 2px;
      font-size: 11px; font-weight: 600;
      letter-spacing: 0.08em; text-transform: uppercase;
      color: var(--artha-accent);
    }
    .day-nav-date {
      margin: 0;
      font-size: 16px; font-weight: 700;
      color: var(--artha-text);
      letter-spacing: -0.01em;
    }
    .day-summary {
      text-align: center;
      padding: 32px 16px;
      background: linear-gradient(135deg, var(--artha-accent) 0%, var(--artha-accent-hover) 100%);
      border-radius: var(--artha-radius);
      color: white;
      box-shadow: var(--artha-shadow);
    }
    .day-summary-total {
      margin: 0;
      font-size: 38px; font-weight: 700;
      letter-spacing: -0.025em;
    }
    .day-summary-meta {
      margin: 4px 0 0;
      font-size: 13px;
      color: rgba(255, 255, 255, 0.82);
    }

    /* ====== Month view ====== */
    .month-view {
      background: var(--artha-surface);
      border: 1px solid var(--artha-border);
      border-radius: var(--artha-radius);
      box-shadow: var(--artha-shadow-sm);
      padding: 16px;
    }
    .weekdays {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 6px;
      padding: 0 4px 8px;
    }
    .weekday {
      text-align: center;
      font-size: 11px; font-weight: 600;
      color: var(--artha-text-subtle);
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .calendar {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 6px;
    }
    .cell {
      aspect-ratio: 1;
      border: 1px solid var(--artha-border);
      border-radius: 10px;
      padding: 8px 10px;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      justify-content: space-between;
      background: var(--artha-surface);
      transition: transform 80ms ease, border-color 120ms ease;
      position: relative;
      min-height: 76px;
    }
    .cell:hover {
      border-color: var(--artha-accent);
      transform: translateY(-1px);
    }
    .cell--off { opacity: 0.35; }
    .cell--today { border-color: var(--artha-accent); }
    .cell--today .cell-day {
      color: var(--artha-accent);
      font-weight: 700;
    }
    .cell--selected {
      outline: 2px solid var(--artha-accent);
      outline-offset: -2px;
    }
    .cell-day {
      font-size: 13px; font-weight: 600;
      color: var(--artha-text-muted);
    }
    .cell--has .cell-day { color: var(--artha-text); }
    .cell-total {
      font-size: 12px; font-weight: 600;
      color: var(--artha-text);
      letter-spacing: -0.01em;
    }
    .cell--has[style*='background'] .cell-day,
    .cell--has[style*='background'] .cell-total {
      color: var(--artha-accent-hover);
    }
    .month-legend {
      margin: 14px 4px 0;
      font-size: 11px;
      color: var(--artha-text-subtle);
      text-align: center;
    }

    /* ====== State helpers ====== */
    .state {
      display: flex; justify-content: center; padding: 64px;
    }
    .empty {
      display: flex; flex-direction: column; align-items: center;
      gap: 10px;
      padding: 64px 24px;
      background: var(--artha-surface);
      border: 1px dashed var(--artha-border-strong);
      border-radius: var(--artha-radius);
      color: var(--artha-text-subtle);
    }
    .empty ion-icon { font-size: 40px; color: var(--artha-text-subtle); }
    .empty p { margin: 0; font-size: 14px; }
    .empty-cta {
      margin-top: 4px;
      border: 0;
      background: transparent;
      font-size: 13px; font-weight: 600;
      color: var(--artha-accent);
      cursor: pointer;
    }
    .empty-cta:hover { text-decoration: underline; }
    .empty--inline {
      padding: 32px 16px;
      border-style: solid;
      border-color: var(--artha-border);
    }

    /* ====== Responsive ====== */
    @media (max-width: 900px) {
      .summary { grid-template-columns: repeat(2, 1fr); }
    }
    @media (max-width: 640px) {
      .page { padding: 20px 14px 56px; }
      .page-header { gap: 10px; }
      .import-cta { margin-left: auto; }
      .add-cta { margin-left: 0; }
      .view-switcher button span { display: none; }
      .calendar { gap: 4px; }
      .cell { min-height: 60px; padding: 5px 6px; }
      .cell-day { font-size: 12px; }
      .cell-total { font-size: 10px; }
      .day-summary-total { font-size: 30px; }
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
  private readonly modalCtrl = inject(ModalController);

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
      if (cat && e.categoryId !== cat) return false;
      if (acc && e.accountId !== acc) return false;
      if (q) {
        const hay = `${e.note ?? ''} ${this.categoryName(e.categoryId)} ${this.accountName(e.accountId)}`
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  });

  protected readonly currency = computed(() =>
    this.monthExpenses()[0]?.currency
      ?? this.expensesStore.currency()
      ?? 'USD',
  );

  protected readonly monthTotal = computed(() =>
    this.monthExpenses().reduce((sum, e) => (e.excluded ? sum : sum + e.amount), 0),
  );

  protected readonly monthCount = computed(() =>
    this.monthExpenses().filter((e) => !e.excluded).length,
  );

  protected readonly dailyAverage = computed(() => {
    const total = this.monthTotal();
    if (total <= 0) return 0;
    const daysSoFar = this.isCurrentMonth()
      ? new Date().getDate()
      : daysInMonth(this.viewYear(), this.viewMonth());
    return total / Math.max(1, daysSoFar);
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
      if (!e.excluded) g.total += e.amount;
    }
    return Array.from(groups.values()).sort((a, b) => b.date.localeCompare(a.date));
  });

  protected readonly biggestDay = computed(() => this.dayGroups()
    .reduce<DayGroup | null>((max, g) => (!max || g.total > max.total ? g : max), null));

  protected readonly selectedDayExpenses = computed<Expense[]>(() =>
    this.expensesStore.items().filter((e) => e.date === this.selectedDay()),
  );

  protected readonly selectedDayTotal = computed(() =>
    this.selectedDayExpenses().reduce((sum, e) => (e.excluded ? sum : sum + e.amount), 0),
  );

  protected readonly calendar = computed<CalendarCell[]>(() => {
    const year = this.viewYear();
    const month = this.viewMonth();
    const totals = new Map<string, { total: number; count: number }>();
    for (const g of this.dayGroups()) {
      totals.set(g.date, { total: g.total, count: g.items.filter((e) => !e.excluded).length });
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

  protected categoryName(id: string): string {
    return this.categoriesStore.byId()[id]?.name ?? 'Unknown';
  }

  protected accountName(id: string): string {
    return this.accountsStore.byId()[id]?.name ?? 'Cash';
  }

  protected categoryColor(id: string): string {
    // Same deterministic palette as the dashboard for visual continuity.
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

  protected async openImport(): Promise<void> {
    const modal = await this.modalCtrl.create({ component: ExpenseImportModal });
    await modal.present();

    const { role, data } = await modal.onWillDismiss<ImportResultResponse>();
    if (role !== 'imported' || !data) {
      return;
    }

    // New categories/accounts may have been created, and expenses added across
    // months — force-refresh the relevant stores so the UI reflects the import.
    await Promise.all([
      this.categoriesStore.load(/* includeArchived */ true, /* force */ true),
      this.accountsStore.load(/* includeArchived */ true, /* force */ true),
      this.loadMonth(/* force */ true),
    ]);

    const parts = [`Imported ${data.importedCount} expense${data.importedCount === 1 ? '' : 's'}.`];
    if (data.createdCategories.length > 0) {
      parts.push(`Created ${data.createdCategories.length} categor${data.createdCategories.length === 1 ? 'y' : 'ies'}.`);
    }
    if (data.createdAccounts.length > 0) {
      parts.push(`Created ${data.createdAccounts.length} account${data.createdAccounts.length === 1 ? '' : 's'}.`);
    }
    await this.notifier.notifyInfo(parts.join(' '));
  }

  protected edit(id: string): void {
    void this.router.navigate(['/expenses', id]);
  }

  protected async onDelete(event: Event, id: string): Promise<void> {
    event.stopPropagation();
    try {
      await this.expensesStore.remove(id);
    } catch {
      await this.notifier.notifyError('Could not delete expense.');
    }
  }

  private async loadMonth(force = false): Promise<void> {
    const prefix = monthPrefix(this.viewYear(), this.viewMonth());
    await this.expensesStore.load(prefix, prefix, force);
  }
}

function monthPrefix(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
