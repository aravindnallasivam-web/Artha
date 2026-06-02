import { CurrencyPipe, KeyValuePipe } from '@angular/common';
import { Component, OnInit, computed, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  AlertController,
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
  INVESTMENT_TYPE_ICONS,
  INVESTMENT_TYPE_LABELS,
  Investment,
  InvestmentType,
} from '../../core/models/investment.model';
import { InvestmentsStore } from './investments.store';

@Component({
  selector: 'artha-investments-list',
  standalone: true,
  imports: [
    CurrencyPipe,
    KeyValuePipe,
    RouterLink,
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
        <ion-title>Investments</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      @if (hasTotals()) {
        <div class="portfolio">
          <p class="portfolio-label">Portfolio value</p>
          @for (entry of store.totalsByCurrency() | keyvalue; track entry.key) {
            <p class="portfolio-amount">{{ entry.value | currency: entry.key }}</p>
          }
        </div>
      }

      <ion-item lines="full">
        <ion-toggle (ionChange)="onToggleArchived($event)">Show archived</ion-toggle>
      </ion-item>

      @if (store.loading()) {
        <div class="state"><ion-spinner></ion-spinner></div>
      } @else if (store.items().length === 0) {
        <div class="empty">No investments yet. Tap + to add an RD, FD, policy or mutual fund.</div>
      } @else {
        <ion-list>
          @for (inv of sorted(); track inv.id) {
            <ion-item-sliding>
              <ion-item [routerLink]="['/investments', inv.id]" detail>
                <ion-icon
                  slot="start"
                  [name]="iconFor(inv)"
                  [style.color]="inv.color || 'var(--ion-color-primary)'"
                ></ion-icon>
                <ion-label>
                  <h2>
                    {{ inv.name }}
                    @if (inv.archived) {
                      <ion-note color="medium"> · archived</ion-note>
                    }
                  </h2>
                  <p>
                    {{ typeLabel(inv) }} · {{ inv.currency }}
                    @if (inv.institution) {
                      · {{ inv.institution }}
                    }
                  </p>
                </ion-label>
                <ion-note slot="end" class="value">
                  {{ inv.currentValue | currency: inv.currency }}
                </ion-note>
              </ion-item>
              @if (!inv.archived) {
                <ion-item-options side="end">
                  <ion-item-option color="danger" (click)="archive(inv)">
                    <ion-icon name="trash" slot="icon-only"></ion-icon>
                  </ion-item-option>
                </ion-item-options>
              }
            </ion-item-sliding>
          }
        </ion-list>
      }

      <ion-fab slot="fixed" vertical="bottom" horizontal="end">
        <ion-fab-button (click)="addInvestment()">
          <ion-icon name="add"></ion-icon>
        </ion-fab-button>
      </ion-fab>
    </ion-content>
  `,
  styles: [`
    .state, .empty {
      display: flex; align-items: center; justify-content: center;
      padding: 32px; color: var(--ion-color-medium); text-align: center;
    }
    .portfolio {
      padding: 16px;
      border-bottom: 1px solid var(--artha-border, var(--ion-color-step-150));
    }
    .portfolio-label {
      margin: 0 0 2px; font-size: 12px; font-weight: 600;
      letter-spacing: 0.04em; text-transform: uppercase;
      color: var(--ion-color-medium);
    }
    .portfolio-amount {
      margin: 0; font-size: 24px; font-weight: 700;
      font-variant-numeric: tabular-nums;
    }
    ion-icon[slot="start"] { font-size: 24px; margin-inline-end: 12px; }
    .value { font-variant-numeric: tabular-nums; }
  `],
})
export class InvestmentsListPage implements OnInit {
  protected readonly store = inject(InvestmentsStore);
  private readonly router = inject(Router);
  private readonly alertCtrl = inject(AlertController);
  private readonly notifier = inject(ConflictNotifierService);

  // RD first (the primary type), then by name — mirrors the picker order.
  private static readonly TYPE_ORDER: Record<InvestmentType, number> = {
    recurring_deposit: 0,
    fixed_deposit: 1,
    mutual_fund: 2,
    insurance_policy: 3,
  };

  protected readonly sorted = computed(() =>
    [...this.store.items()].sort((a, b) => {
      const byType =
        InvestmentsListPage.TYPE_ORDER[a.type] - InvestmentsListPage.TYPE_ORDER[b.type];
      return byType !== 0 ? byType : a.name.localeCompare(b.name);
    }),
  );

  protected readonly hasTotals = computed(
    () => Object.keys(this.store.totalsByCurrency()).length > 0,
  );

  ngOnInit(): void {
    void this.store.load();
  }

  async onToggleArchived(event: Event): Promise<void> {
    const checked = (event as CustomEvent<{ checked: boolean }>).detail?.checked ?? false;
    await this.store.load(checked);
  }

  addInvestment(): void {
    void this.router.navigate(['/investments/new']);
  }

  async archive(inv: Investment): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: `Archive "${inv.name}"?`,
      message: 'It will be hidden from your list. You can show archived items to find it again.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Archive',
          role: 'destructive',
          handler: async () => {
            try {
              await this.store.remove(inv.id);
            } catch (err) {
              await this.notifier.notifyError('Could not archive this investment.');
            }
          },
        },
      ],
    });
    await alert.present();
  }

  protected typeLabel(inv: Investment): string {
    return INVESTMENT_TYPE_LABELS[inv.type] ?? inv.type;
  }

  protected iconFor(inv: Investment): string {
    return inv.icon || INVESTMENT_TYPE_ICONS[inv.type] || 'trending-up';
  }
}
