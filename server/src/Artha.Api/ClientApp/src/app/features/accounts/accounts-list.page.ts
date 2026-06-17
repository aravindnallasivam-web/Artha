import { CurrencyPipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  AlertController,
  IonContent,
  IonFab,
  IonFabButton,
  IonHeader,
  IonIcon,
  IonLabel,
  IonSegment,
  IonSegmentButton,
  IonSpinner,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';
import { ConflictNotifierService } from '../../core/feedback/conflict-notifier.service';
import {
  Account,
  ACCOUNT_TYPE_ICONS,
  ACCOUNT_TYPE_LABELS,
  DEFAULT_ACCOUNT_ID,
} from '../../core/models/account.model';
import { bankPresetById } from '../../core/models/bank-preset';
import { AccountsStore } from './accounts.store';
import { BalanceSyncService } from './balance-sync.service';

@Component({
  selector: 'artha-accounts-list',
  standalone: true,
  imports: [
    CurrencyPipe,
    IonContent,
    IonFab,
    IonFabButton,
    IonHeader,
    IonIcon,
    IonLabel,
    IonSegment,
    IonSegmentButton,
    IonSpinner,
    IonTitle,
    IonToolbar,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Accounts</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      @if (store.loading()) {
        <div class="state"><ion-spinner></ion-spinner></div>
      } @else {
        <div class="wrap">
          @if (summary().count > 0) {
            <div class="hero">
              <div class="hero-label">Total balance</div>
              @if (summary().total !== null) {
                <div class="hero-value">
                  {{ summary().total | currency: summary().currency : 'symbol' : '1.0-0' }}
                </div>
                <div class="hero-sub">{{ accountsLabel() }}</div>
              } @else {
                <div class="hero-value">{{ accountsLabel() }}</div>
                <div class="hero-sub">Across multiple currencies</div>
              }
            </div>
          }

          <ion-segment [value]="view()" (ionChange)="onView($event)">
            <ion-segment-button value="active"><ion-label>Active</ion-label></ion-segment-button>
            <ion-segment-button value="archived"><ion-label>Archived</ion-label></ion-segment-button>
          </ion-segment>

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
                <div class="cta" (click)="addAccount()">Add your first account</div>
              </div>
            }
          } @else {
            @for (acc of visible(); track acc.id) {
              <div class="acc-card" (click)="openAccount(acc)">
                <div
                  class="acc-badge"
                  [style.background]="badgeBg(acc)"
                  [style.color]="badgeColor(acc)"
                >
                  <ion-icon [name]="iconFor(acc)"></ion-icon>
                </div>
                <div class="acc-main">
                  <div class="acc-name">{{ acc.name }}</div>
                  <div class="acc-meta">
                    <span>{{ typeLabel(acc) }} · {{ acc.currency }}</span>
                    @if (bankName(acc); as bn) {
                      <span class="chip">{{ bn }}</span>
                    }
                    @if (simChip(acc); as sim) {
                      <span class="chip chip--sim">{{ sim }}</span>
                    }
                  </div>
                </div>
                <div class="acc-right">
                  <div class="acc-balance" [class.neg]="acc.openingBalance < 0">
                    {{ acc.openingBalance | currency: acc.currency : 'symbol' : '1.0-0' }}
                  </div>
                  @if (canSync(acc) || canArchive(acc)) {
                    <div class="acc-actions">
                      @if (canSync(acc)) {
                        <button
                          class="iconbtn"
                          aria-label="Sync balance"
                          (click)="syncBalance($event, acc)"
                        >
                          <ion-icon name="sync-outline"></ion-icon>
                        </button>
                      }
                      @if (canArchive(acc)) {
                        <button
                          class="iconbtn danger"
                          aria-label="Archive account"
                          (click)="archive($event, acc)"
                        >
                          <ion-icon name="trash"></ion-icon>
                        </button>
                      }
                    </div>
                  }
                </div>
              </div>
            }
          }
        </div>
      }

      <ion-fab slot="fixed" vertical="bottom" horizontal="end">
        <ion-fab-button (click)="addAccount()">
          <ion-icon name="add"></ion-icon>
        </ion-fab-button>
      </ion-fab>
    </ion-content>
  `,
  styles: [`
    ion-content { --background: var(--artha-bg); }
    .wrap { padding: 14px 14px 96px; max-width: 640px; margin: 0 auto; }

    .hero {
      background: linear-gradient(135deg, var(--artha-accent) 0%, var(--artha-accent-hover) 100%);
      border-radius: var(--artha-radius-lg);
      padding: 18px 20px 20px;
      color: #fff;
      box-shadow: 0 10px 24px -10px rgba(79, 70, 229, 0.55);
      margin-bottom: 14px;
    }
    .hero-label {
      font-size: 12px; font-weight: 600; letter-spacing: 0.5px;
      text-transform: uppercase; opacity: 0.85;
    }
    .hero-value {
      font-size: 34px; font-weight: 800; margin-top: 4px;
      font-variant-numeric: tabular-nums; line-height: 1.1;
    }
    .hero-sub { font-size: 13px; opacity: 0.9; margin-top: 4px; }

    ion-segment { margin-bottom: 14px; }

    .acc-card {
      display: flex; align-items: center; gap: 12px;
      background: var(--artha-surface);
      border: 1px solid var(--artha-border);
      border-radius: var(--artha-radius);
      padding: 12px 14px; margin-bottom: 10px;
      box-shadow: var(--artha-shadow-sm);
      cursor: pointer;
      transition: transform 120ms ease, box-shadow 120ms ease;
    }
    .acc-card:active { transform: scale(0.992); }
    .acc-badge {
      width: 40px; height: 40px; border-radius: 12px; flex: none;
      display: flex; align-items: center; justify-content: center; font-size: 20px;
    }
    .acc-main { flex: 1; min-width: 0; }
    .acc-name {
      font-weight: 600; font-size: 15px; color: var(--artha-text);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .acc-meta {
      display: flex; align-items: center; gap: 8px; margin-top: 2px;
      font-size: 12.5px; color: var(--artha-text-muted);
    }
    .chip {
      font-size: 11px; font-weight: 600; padding: 1px 7px; border-radius: 999px;
      background: var(--artha-surface-2); color: var(--artha-text-muted);
      white-space: nowrap;
    }
    .chip--sim {
      background: var(--artha-accent-tint, #eaf1ff); color: var(--artha-accent, #2f6df6);
    }
    .acc-right { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
    .acc-balance {
      font-weight: 700; font-size: 15px; color: var(--artha-text);
      font-variant-numeric: tabular-nums;
    }
    .acc-balance.neg { color: var(--artha-negative); }
    .acc-actions { display: flex; gap: 2px; }
    .iconbtn {
      background: transparent; border: 0; padding: 4px; border-radius: 8px;
      color: var(--artha-text-subtle); font-size: 18px; display: flex; cursor: pointer;
    }
    .iconbtn:hover { background: var(--artha-surface-2); color: var(--artha-text-muted); }
    .iconbtn.danger:hover { color: var(--artha-negative); }

    .state, .empty {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 8px; padding: 48px 24px; color: var(--artha-text-subtle); text-align: center;
    }
    .empty ion-icon { font-size: 40px; }
    .empty .cta { color: var(--artha-accent); font-weight: 600; cursor: pointer; }
  `],
})
export class AccountsListPage implements OnInit {
  protected readonly store = inject(AccountsStore);
  private readonly router = inject(Router);
  private readonly alertCtrl = inject(AlertController);
  private readonly notifier = inject(ConflictNotifierService);
  private readonly balanceSync = inject(BalanceSyncService);

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
    const total =
      currencies.length === 1
        ? active.reduce((sum, a) => sum + a.openingBalance, 0)
        : null;
    return { count: active.length, currency: currencies[0] ?? '', total };
  });

  ngOnInit(): void {
    void this.store.load();
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

  protected async onView(event: Event): Promise<void> {
    const value = (event as CustomEvent<{ value: 'active' | 'archived' }>).detail?.value;
    if (!value || value === this.view()) {
      return;
    }
    this.view.set(value);
    if (value === 'archived') {
      await this.store.load(true);
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

  protected badgeColor(acc: Account): string {
    return acc.color || 'var(--artha-accent)';
  }

  protected badgeBg(acc: Account): string {
    return acc.color ? `${acc.color}22` : 'var(--artha-accent-tint)';
  }
}
