import { CurrencyPipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController, IonContent, IonIcon, IonSpinner } from '@ionic/angular/standalone';
import { ConflictNotifierService } from '../../core/feedback/conflict-notifier.service';
import {
  Account,
  ACCOUNT_TYPE_ICONS,
  ACCOUNT_TYPE_LABELS,
  DEFAULT_ACCOUNT_ID,
} from '../../core/models/account.model';
import { bankPresetById } from '../../core/models/bank-preset';
import { cardOwed, daysUntil, dueLabel, isoDate, lastStatementDate, nextDueDate } from '../../core/models/card-cycle';
import { ExpensesApi } from '../expenses/expenses.api';
import { AccountsStore } from './accounts.store';
import { BalanceSyncService } from './balance-sync.service';

// Deep tones so white text stays readable on every card.
const TILE_PALETTE = ['#1e3a8a', '#0e7490', '#7c2d12', '#4c1d95', '#065f46', '#9f1239', '#334155'];

@Component({
  selector: 'artha-accounts-list',
  standalone: true,
  imports: [
    CurrencyPipe,
    IonContent,
    IonIcon,
    IonSpinner,
  ],
  template: `
    <ion-content>
      <div class="wrap">
        <header class="head">
          <h1>Accounts</h1>
          <button type="button" class="add-btn" aria-label="Add account" (click)="addAccount()">
            <ion-icon name="add"></ion-icon>
          </button>
        </header>

        @if (store.loading()) {
          <div class="state"><ion-spinner></ion-spinner></div>
        } @else {
          @if (summary().count > 0) {
            <section class="hero">
              <div class="hero-label">Total balance</div>
              @if (summary().total !== null) {
                <div class="hero-value num">
                  {{ summary().total | currency: summary().currency : 'symbol' : '1.0-0' }}
                </div>
              } @else {
                <div class="hero-value">{{ accountsLabel() }}</div>
              }
              <div class="hero-sub">
                <span>{{ summary().total !== null ? accountsLabel() : 'Across multiple currencies' }}</span>
                @if (summary().cards !== null && summary().cardCount > 0) {
                  <span>Credit cards <b class="num">{{ summary().cards | currency: summary().currency : 'symbol' : '1.0-0' }}</b></span>
                }
              </div>
            </section>
          }

          <div class="seg" role="group" aria-label="Show">
            <button type="button" [class.on]="view() === 'active'" [attr.aria-pressed]="view() === 'active'" (click)="setView('active')">Active</button>
            <button type="button" [class.on]="view() === 'archived'" [attr.aria-pressed]="view() === 'archived'" (click)="setView('archived')">Archived</button>
          </div>

          @if (visible().length === 0) {
            @if (view() === 'archived') {
              <div class="empty">
                <ion-icon name="archive-outline"></ion-icon>
                <div>No archived accounts.</div>
              </div>
            } @else {
              <div class="empty">
                <ion-icon name="wallet-outline"></ion-icon>
                <div>No accounts yet.</div>
                <button type="button" class="cta" (click)="addAccount()">Add your first account</button>
              </div>
            }
          } @else {
            <div class="grid">
              @for (acc of visible(); track acc.id; let i = $index) {
                <article
                  class="tile"
                  [class.tile--card]="acc.type === 'credit_card'"
                  [class.archived]="acc.archived"
                  [style.background]="tileColor(acc, i)"
                  (click)="openAccount(acc)"
                >
                  <div class="tile-top">
                    <span class="tile-icon"><ion-icon [name]="iconFor(acc)"></ion-icon></span>
                    <span class="tile-name">{{ acc.name }}</span>
                  </div>
                  @if (acc.type === 'credit_card') {
                    <div class="tile-bottom">
                      <div class="tile-balance num">
                        {{ owed(acc) | currency: acc.currency : 'symbol' : '1.0-0' }}
                        <span class="owed">owed</span>
                      </div>
                      @if (acc.creditLimit) {
                        <div class="usage" [class.usage--high]="usagePct(acc) >= 80">
                          <span [style.width.%]="usagePct(acc)"></span>
                        </div>
                        <div class="tile-meta">
                          <span class="num">
                            {{ available(acc) | currency: acc.currency : 'symbol' : '1.0-0' }} available of
                            {{ acc.creditLimit | currency: acc.currency : 'symbol' : '1.0-0' }}
                          </span>
                        </div>
                      }
                      <div class="tile-meta">
                        @if (cycleSpend()[acc.id] != null) {
                          <span class="num">This cycle {{ cycleSpend()[acc.id] | currency: acc.currency : 'symbol' : '1.0-0' }}</span>
                        }
                        @if (dueInfo(acc); as due) {
                          <span class="due" [class.due--soon]="due.soon">{{ due.text }}</span>
                        }
                        <span>{{ bankName(acc) || typeLabel(acc) }}@if (acc.cardLast4) { ·· {{ acc.cardLast4 }} }</span>
                        @if (simChip(acc); as sim) { <span class="sim">{{ sim }}</span> }
                      </div>
                    </div>
                  } @else {
                    <div class="tile-bottom">
                      <div class="tile-balance num">
                        {{ acc.openingBalance | currency: acc.currency : 'symbol' : '1.0-0' }}
                      </div>
                      <div class="tile-meta">
                        <span>{{ bankName(acc) || typeLabel(acc) }}</span>
                        @if (simChip(acc); as sim) { <span class="sim">{{ sim }}</span> }
                      </div>
                    </div>
                  }
                  @if (canSync(acc) || canArchive(acc)) {
                    <div class="tile-actions">
                      @if (canSync(acc)) {
                        <button type="button" class="tbtn" aria-label="Sync balance" (click)="syncBalance($event, acc)">
                          <ion-icon name="sync-outline"></ion-icon>
                        </button>
                      }
                      @if (canArchive(acc)) {
                        <button type="button" class="tbtn" aria-label="Archive account" (click)="archive($event, acc)">
                          <ion-icon name="archive-outline"></ion-icon>
                        </button>
                      }
                    </div>
                  }
                </article>
              }
              @if (view() === 'active') {
                <button type="button" class="tile-add" (click)="addAccount()">
                  <ion-icon name="add"></ion-icon>
                  Add account
                </button>
              }
            </div>
          }
        }
      </div>
    </ion-content>
  `,
  styles: [`
    ion-content { --background: var(--artha-bg); }
    .wrap {
      padding: calc(16px + var(--ion-safe-area-top, 0px)) 20px 24px;
      max-width: 720px; margin: 0 auto;
      display: flex; flex-direction: column; gap: 14px;
    }
    .head { display: flex; align-items: center; justify-content: space-between; padding-top: 8px; }
    .head h1 { margin: 0; font-size: 26px; font-weight: 800; letter-spacing: -0.03em; color: var(--artha-text); }
    .add-btn {
      width: 44px; height: 44px; border-radius: 14px; cursor: pointer;
      border: 1px solid var(--artha-border); background: var(--artha-surface);
      color: var(--artha-text); display: grid; place-items: center; font-size: 22px;
    }

    .hero {
      padding: 18px 20px; border-radius: var(--artha-radius-2xl, 24px);
      background: #0f172a; color: #fff;
    }
    :host-context(.ion-palette-dark) .hero { background: var(--artha-surface-2); }
    .hero-label { font-size: 13px; font-weight: 600; color: #cbd5e1; }
    .hero-value { margin-top: 4px; font-size: 34px; font-weight: 800; letter-spacing: -0.03em; line-height: 1.1; }
    .hero-sub {
      display: flex; flex-wrap: wrap; gap: 6px 18px; margin-top: 10px;
      font-size: 12.5px; font-weight: 600; color: #cbd5e1;
    }
    .hero-sub b { color: #fff; }

    .seg {
      display: inline-flex; align-self: flex-start; padding: 4px; gap: 2px;
      border-radius: 999px; background: var(--artha-surface-2);
    }
    .seg button {
      height: 34px; padding: 0 16px; border: 0; border-radius: 999px; cursor: pointer;
      background: transparent; color: var(--artha-text-muted); font-size: 13px; font-weight: 600;
    }
    .seg button.on { background: var(--artha-surface); color: var(--artha-text); font-weight: 700; box-shadow: var(--artha-shadow); }

    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    @media (min-width: 640px) { .grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
    .tile {
      position: relative; min-height: 124px; box-sizing: border-box;
      display: flex; flex-direction: column; justify-content: space-between; gap: 10px;
      padding: 14px; border-radius: 20px; color: #fff; cursor: pointer; overflow: hidden;
      transition: transform 120ms ease;
    }
    .tile:active { transform: scale(0.98); }
    .tile.archived { opacity: 0.6; }
    .tile-top { display: flex; align-items: center; gap: 8px; min-width: 0; padding-right: 56px; }
    .tile-icon {
      flex: none; width: 28px; height: 28px; border-radius: 9px;
      background: rgba(255, 255, 255, 0.2); display: grid; place-items: center; font-size: 15px;
    }
    .tile-name { font-size: 13px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .tile-balance { font-size: 19px; font-weight: 800; letter-spacing: -0.02em; }
    .tile--card { grid-column: 1 / -1; }
    .owed { font-size: 12px; font-weight: 700; opacity: 0.8; letter-spacing: 0; }
    .usage { height: 6px; margin-top: 8px; border-radius: 999px; background: rgba(255, 255, 255, 0.25); overflow: hidden; }
    .usage span { display: block; height: 100%; border-radius: 999px; background: #fff; }
    .usage--high span { background: #fde68a; }
    .due { padding: 1px 8px; border-radius: 999px; background: rgba(255, 255, 255, 0.2); font-weight: 700; }
    .due--soon { background: #fde68a; color: #78350f; }
    .tile-meta {
      display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 2px;
      font-size: 11.5px; opacity: 0.85;
    }
    .sim { padding: 1px 7px; border-radius: 999px; background: rgba(255, 255, 255, 0.2); font-weight: 700; }
    .tile-actions { position: absolute; top: 8px; right: 8px; display: flex; gap: 2px; }
    .tbtn {
      width: 30px; height: 30px; border: 0; border-radius: 9px; cursor: pointer;
      background: rgba(255, 255, 255, 0.16); color: #fff; display: grid; place-items: center; font-size: 15px;
    }
    .tile-add {
      min-height: 124px; border-radius: 20px; cursor: pointer;
      border: 2px dashed var(--artha-border-strong); background: transparent;
      color: var(--artha-text-muted); font-size: 13px; font-weight: 700;
      display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
    }
    .tile-add ion-icon { font-size: 22px; }

    .state, .empty {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 8px; padding: 48px 24px; color: var(--artha-text-subtle); text-align: center;
    }
    .empty ion-icon { font-size: 40px; }
    .empty .cta { border: 0; background: none; color: var(--artha-accent); font-weight: 700; font-size: 14px; cursor: pointer; }
  `],
})
export class AccountsListPage implements OnInit {
  protected readonly store = inject(AccountsStore);
  private readonly router = inject(Router);
  private readonly alertCtrl = inject(AlertController);
  private readonly notifier = inject(ConflictNotifierService);
  private readonly balanceSync = inject(BalanceSyncService);
  private readonly expensesApi = inject(ExpensesApi);

  /** Card account id -> spend since its last statement date (cards with a statement day only). */
  protected readonly cycleSpend = signal<Record<string, number>>({});

  protected readonly defaultAccountId = DEFAULT_ACCOUNT_ID;
  protected readonly view = signal<'active' | 'archived'>('active');
  /** Friendly SIM labels keyed by subscription id (for the per-account chip). */
  protected readonly simLabels = signal<Record<number, string>>({});

  protected readonly visible = computed(() =>
    this.view() === 'active'
      ? this.store.active()
      : this.store.items().filter((a) => a.archived),
  );

  protected readonly summary = computed(() => {
    const active = this.store.active();
    const currencies = [...new Set(active.map((a) => a.currency))];
    const single = currencies.length === 1;
    const cardAccounts = active.filter((a) => a.type === 'credit_card');
    const total = single
      ? active.filter((a) => a.type !== 'credit_card').reduce((sum, a) => sum + a.openingBalance, 0)
      : null;
    const cards = single ? cardAccounts.reduce((sum, a) => sum + a.openingBalance, 0) : null;
    return { count: active.length, currency: currencies[0] ?? '', total, cards, cardCount: cardAccounts.length };
  });

  ngOnInit(): void {
    void this.store.load().then(() => this.loadCycleSpend());
    if (this.balanceSync.isSupported()) {
      void this.balanceSync.simLabels().then((m) => this.simLabels.set(m));
    }
  }

  /** Chip text for the SIM an account's balance enquiry uses, or null. */
  protected simChip(acc: Account): string | null {
    if (!this.canSync(acc)) {
      return null;
    }
    const subId = this.balanceSync.rememberedSim(acc.id);
    if (subId == null) {
      return null;
    }
    return this.simLabels()[subId] ?? null;
  }

  protected accountsLabel(): string {
    const c = this.summary().count;
    return `${c} ${c === 1 ? 'account' : 'accounts'}`;
  }

  protected async setView(value: 'active' | 'archived'): Promise<void> {
    if (value === this.view()) {
      return;
    }
    this.view.set(value);
    if (value === 'archived') {
      await this.store.load(true);
    }
  }

  protected owed(acc: Account): number {
    return cardOwed(acc);
  }

  protected available(acc: Account): number {
    return Math.max(0, (acc.creditLimit ?? 0) - cardOwed(acc));
  }

  protected usagePct(acc: Account): number {
    const limit = acc.creditLimit ?? 0;
    return limit > 0 ? Math.min(100, Math.round((cardOwed(acc) / limit) * 100)) : 0;
  }

  /** "Due 23 Nov · in 4 days" for a card with a due day; soon = within 5 days. */
  protected dueInfo(acc: Account): { text: string; soon: boolean } | null {
    if (!acc.dueDay) {
      return null;
    }
    const due = nextDueDate(acc.dueDay);
    const days = daysUntil(due);
    const date = due.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    return { text: `Due ${date} · ${dueLabel(days)}`, soon: days <= 5 };
  }

  /** Sum each card's spending since its last statement date, in one read. */
  private async loadCycleSpend(): Promise<void> {
    const cards = this.store.active().filter((a) => a.type === 'credit_card' && a.statementDay);
    if (cards.length === 0) {
      this.cycleSpend.set({});
      return;
    }
    const starts = new Map(cards.map((c) => [c.id, isoDate(lastStatementDate(c.statementDay!))]));
    const earliest = [...starts.values()].sort()[0];
    const today = isoDate(new Date());
    try {
      const { items } = await this.expensesApi.list(earliest.slice(0, 7), today.slice(0, 7));
      const totals: Record<string, number> = Object.fromEntries(cards.map((c) => [c.id, 0]));
      for (const e of items) {
        const start = starts.get(e.accountId);
        if (start && !e.excluded && e.type !== 'income' && e.date >= start && e.date <= today) {
          totals[e.accountId] += e.amount;
        }
      }
      this.cycleSpend.set(totals);
    } catch {
      // Leave the cycle line off; the rest of the card still shows.
    }
  }

  protected canSync(acc: Account): boolean {
    return this.balanceSync.isSupported() && !!acc.bank && !acc.archived;
  }

  protected canArchive(acc: Account): boolean {
    return !acc.archived && acc.id !== DEFAULT_ACCOUNT_ID;
  }

  protected syncBalance(event: Event, acc: Account): void {
    event.stopPropagation();
    void this.balanceSync.syncBalance(acc);
  }

  protected openAccount(acc: Account): void {
    void this.router.navigate(['/accounts', acc.id]);
  }

  addAccount(): void {
    void this.router.navigate(['/accounts/new']);
  }

  async archive(event: Event, acc: Account): Promise<void> {
    event.stopPropagation();
    if (acc.id === DEFAULT_ACCOUNT_ID) return;
    const alert = await this.alertCtrl.create({
      header: `Archive "${acc.name}"?`,
      message:
        'Existing expenses keep this account. New expenses can no longer use it.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Archive',
          role: 'destructive',
          handler: async () => {
            try {
              await this.store.remove(acc.id);
            } catch (err) {
              await this.notifier.notifyError(
                'Could not archive — it may still be in use by expenses.',
              );
            }
          },
        },
      ],
    });
    await alert.present();
  }

  protected typeLabel(acc: Account): string {
    return ACCOUNT_TYPE_LABELS[acc.type] ?? acc.type;
  }

  protected iconFor(acc: Account): string {
    return acc.icon || ACCOUNT_TYPE_ICONS[acc.type] || 'wallet-outline';
  }

  protected bankName(acc: Account): string | null {
    return bankPresetById(acc.bank)?.name ?? null;
  }

  /** Card colour: the account's own colour, else a stable pick from a dark palette. */
  protected tileColor(acc: Account, index: number): string {
    return acc.color || TILE_PALETTE[index % TILE_PALETTE.length];
  }
}
