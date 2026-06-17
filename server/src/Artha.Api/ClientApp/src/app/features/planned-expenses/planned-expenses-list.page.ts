import { CurrencyPipe } from '@angular/common';
import { Component, OnInit, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import {
  AlertController,
  IonCard,
  IonCardContent,
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
  PlannedExpense,
  cadenceLabel,
  intervalOf,
  monthlyEquivalent,
} from '../../core/models/planned-expense.model';
import { CategoriesStore } from '../categories/categories.store';
import { SettingsStore } from '../settings/settings.store';
import { PlannedExpensesStore } from './planned-expenses.store';

@Component({
  selector: 'artha-planned-expenses-list',
  standalone: true,
  imports: [
    CurrencyPipe,
    IonCard,
    IonCardContent,
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
        <ion-title>Planned</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <ion-card class="summary">
        <ion-card-content>
          <div class="sum-row">
            <div class="sum-cell">
              <div class="sum-label">Per month</div>
              <div class="sum-value">
                {{ store.plannedTotal() | currency: settings.currency() : 'symbol' : '1.0-0' }}
              </div>
            </div>
            <div class="sum-divider"></div>
            <div class="sum-cell">
              <div class="sum-label">Per year</div>
              <div class="sum-value">
                {{ annualTotal() | currency: settings.currency() : 'symbol' : '1.0-0' }}
              </div>
            </div>
          </div>
          <div class="sum-foot">
            {{ store.active().length }} bill{{ store.active().length === 1 ? '' : 's' }} committed
          </div>
        </ion-card-content>
      </ion-card>

      <ion-item>
        <ion-toggle (ionChange)="onToggleArchived($event)">Show archived</ion-toggle>
      </ion-item>

      @if (store.loading()) {
        <div class="state"><ion-spinner></ion-spinner></div>
      } @else if (store.items().length === 0) {
        <div class="empty">No planned expenses yet. Add rent, broadband, and other monthly bills.</div>
      } @else {
        <ion-list>
          @for (item of store.items(); track item.id) {
            <ion-item-sliding>
              <ion-item button (click)="edit(item)">
                <ion-label>
                  {{ item.name }}
                  @if (categoryName(item.categoryId); as cat) {
                    <ion-note color="medium"> · {{ cat }}</ion-note>
                  }
                  @if (item.dayOfMonth) {
                    <p>Due day {{ item.dayOfMonth }}</p>
                  }
                  @if (interval(item) > 1) {
                    <p>{{ cadence(item) }} · ≈ {{ monthlyEq(item) | currency: settings.currency() }}/mo</p>
                  }
                  @if (item.archived) {
                    <ion-note color="medium"> · archived</ion-note>
                  }
                </ion-label>
                <ion-note slot="end">
                  {{ item.amount | currency: settings.currency() }} {{ suffix(item) }}
                </ion-note>
              </ion-item>
              @if (!item.archived) {
                <ion-item-options side="end">
                  <ion-item-option (click)="edit(item)">
                    <ion-icon name="pencil" slot="icon-only"></ion-icon>
                  </ion-item-option>
                  <ion-item-option color="danger" (click)="archive(item)">
                    <ion-icon name="trash" slot="icon-only"></ion-icon>
                  </ion-item-option>
                </ion-item-options>
              }
            </ion-item-sliding>
          }
        </ion-list>
      }

      <ion-fab slot="fixed" vertical="bottom" horizontal="end">
        <ion-fab-button (click)="add()">
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
    .summary .sum-row { display: flex; align-items: stretch; }
    .sum-cell { flex: 1; text-align: center; }
    .sum-label {
      font-size: 11px; font-weight: 600; letter-spacing: 0.4px; text-transform: uppercase;
      color: var(--ion-color-medium);
    }
    .sum-value {
      margin-top: 4px; font-size: 24px; font-weight: 800; letter-spacing: -0.02em;
      font-variant-numeric: tabular-nums;
    }
    .sum-divider { width: 1px; background: var(--artha-border, rgba(0,0,0,0.08)); margin: 4px 0; }
    .sum-foot {
      margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--artha-border, rgba(0,0,0,0.08));
      font-size: 12.5px; color: var(--ion-color-medium); text-align: center; line-height: 1.4;
    }
  `],
})
export class PlannedExpensesListPage implements OnInit {
  protected readonly store = inject(PlannedExpensesStore);
  protected readonly settings = inject(SettingsStore);
  private readonly categories = inject(CategoriesStore);
  private readonly router = inject(Router);
  private readonly alertCtrl = inject(AlertController);
  private readonly notifier = inject(ConflictNotifierService);

  /** Total committed per year: monthly-equivalent total × 12. */
  protected readonly annualTotal = computed(() => this.store.plannedTotal() * 12);

  ngOnInit(): void {
    void this.store.load();
    void this.settings.load();
    void this.categories.load();
  }

  async onToggleArchived(event: Event): Promise<void> {
    const checked = (event as CustomEvent<{ checked: boolean }>).detail?.checked ?? false;
    await this.store.load(checked);
  }

  protected categoryName(categoryId: string | null): string | null {
    if (!categoryId) return null;
    return this.categories.byId()[categoryId]?.name ?? null;
  }

  protected monthlyEq(item: PlannedExpense): number {
    return monthlyEquivalent(item);
  }

  protected interval(item: PlannedExpense): number {
    return intervalOf(item);
  }

  protected cadence(item: PlannedExpense): string {
    return cadenceLabel(item);
  }

  /** Short amount suffix: /mo, /yr, or /Nmo. */
  protected suffix(item: PlannedExpense): string {
    const n = intervalOf(item);
    if (n === 1) return '/mo';
    if (n === 12) return '/yr';
    return `/${n}mo`;
  }

  add(): void {
    void this.router.navigate(['/planned-expenses/new']);
  }

  edit(item: PlannedExpense): void {
    if (item.archived) return;
    void this.router.navigate(['/planned-expenses', item.id]);
  }

  async archive(item: PlannedExpense): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: `Archive "${item.name}"?`,
      message: 'It will no longer count toward your planned monthly total.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Archive',
          role: 'destructive',
          handler: async () => {
            try {
              await this.store.remove(item.id);
            } catch (err) {
              await this.notifier.notifyError('Could not archive planned expense.');
            }
          },
        },
      ],
    });
    await alert.present();
  }
}
