import { CurrencyPipe } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  AlertController,
  IonButton,
  IonContent,
  IonFab,
  IonFabButton,
  IonHeader,
  IonIcon,
  IonItem,
  IonItemOption,
  IonItemOptions,
  IonItemSliding,
  IonLabel,
  IonList,
  IonNote,
  IonSpinner,
  IonTitle,
  IonToggle,
  IonToolbar,
} from '@ionic/angular/standalone';
import { ConflictNotifierService } from '../../core/feedback/conflict-notifier.service';
import {
  Account,
  ACCOUNT_TYPE_ICONS,
  ACCOUNT_TYPE_LABELS,
  DEFAULT_ACCOUNT_ID,
} from '../../core/models/account.model';
import { AccountsStore } from './accounts.store';
import { BalanceSyncService } from './balance-sync.service';

@Component({
  selector: 'artha-accounts-list',
  standalone: true,
  imports: [
    CurrencyPipe,
    RouterLink,
    IonButton,
    IonContent,
    IonFab,
    IonFabButton,
    IonHeader,
    IonIcon,
    IonItem,
    IonItemOption,
    IonItemOptions,
    IonItemSliding,
    IonLabel,
    IonList,
    IonNote,
    IonSpinner,
    IonTitle,
    IonToggle,
    IonToolbar,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Accounts</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <ion-item lines="full">
        <ion-toggle (ionChange)="onToggleArchived($event)">Show archived</ion-toggle>
      </ion-item>

      @if (store.loading()) {
        <div class="state"><ion-spinner></ion-spinner></div>
      } @else if (store.items().length === 0) {
        <div class="empty">No accounts yet. Tap + to add one.</div>
      } @else {
        <ion-list>
          @for (acc of store.items(); track acc.id) {
            <ion-item-sliding>
              <ion-item [routerLink]="['/accounts', acc.id]" detail>
                <ion-icon
                  slot="start"
                  [name]="iconFor(acc)"
                  [style.color]="acc.color || 'var(--ion-color-primary)'"
                ></ion-icon>
                <ion-label>
                  <h2>
                    {{ acc.name }}
                    @if (acc.archived) {
                      <ion-note color="medium"> · archived</ion-note>
                    }
                  </h2>
                  <p>{{ typeLabel(acc) }} · {{ acc.currency }}</p>
                </ion-label>
                @if (canSync(acc)) {
                  <ion-button
                    slot="end"
                    fill="clear"
                    size="small"
                    aria-label="Sync balance"
                    (click)="syncBalance($event, acc)"
                  >
                    <ion-icon name="sync-outline" slot="icon-only"></ion-icon>
                  </ion-button>
                }
                <ion-note slot="end" class="balance">
                  {{ acc.openingBalance | currency: acc.currency }}
                </ion-note>
              </ion-item>
              @if (!acc.archived) {
                <ion-item-options side="end">
                  <ion-item-option
                    color="danger"
                    (click)="archive(acc)"
                    [disabled]="acc.id === defaultAccountId"
                  >
                    <ion-icon name="trash" slot="icon-only"></ion-icon>
                  </ion-item-option>
                </ion-item-options>
              }
            </ion-item-sliding>
          }
        </ion-list>
      }

      <ion-fab slot="fixed" vertical="bottom" horizontal="end">
        <ion-fab-button (click)="addAccount()">
          <ion-icon name="add"></ion-icon>
        </ion-fab-button>
      </ion-fab>
    </ion-content>
  `,
  styles: [`
    .state, .empty {
      display: flex; align-items: center; justify-content: center;
      padding: 32px; color: var(--ion-color-medium);
    }
    ion-icon[slot="start"] { font-size: 24px; margin-inline-end: 12px; }
    .balance { font-variant-numeric: tabular-nums; }
  `],
})
export class AccountsListPage implements OnInit {
  protected readonly store = inject(AccountsStore);
  private readonly router = inject(Router);
  private readonly alertCtrl = inject(AlertController);
  private readonly notifier = inject(ConflictNotifierService);
  private readonly balanceSync = inject(BalanceSyncService);

  protected readonly defaultAccountId = DEFAULT_ACCOUNT_ID;

  protected canSync(acc: Account): boolean {
    return this.balanceSync.isSupported() && !!acc.bank && !acc.archived;
  }

  protected syncBalance(event: Event, acc: Account): void {
    event.stopPropagation();
    void this.balanceSync.syncBalance(acc);
  }

  ngOnInit(): void {
    void this.store.load();
  }

  async onToggleArchived(event: Event): Promise<void> {
    const checked = (event as CustomEvent<{ checked: boolean }>).detail?.checked ?? false;
    await this.store.load(checked);
  }

  addAccount(): void {
    void this.router.navigate(['/accounts/new']);
  }

  async archive(acc: Account): Promise<void> {
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
}
