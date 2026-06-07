import { CurrencyPipe } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import {
  AlertController,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardSubtitle,
  IonCardTitle,
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
import { PlannedExpense, monthlyEquivalent } from '../../core/models/planned-expense.model';
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
    IonCardHeader,
    IonCardSubtitle,
    IonCardTitle,
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
      <ion-card>
        <ion-card-header>
          <ion-card-subtitle>Planned per month</ion-card-subtitle>
          <ion-card-title>{{ store.plannedTotal() | currency: settings.currency() }}</ion-card-title>
        </ion-card-header>
        <ion-card-content>
          {{ store.active().length }} predefined expense(s) — fixed monthly budget.
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
                  @if (item.cycle === 'yearly') {
                    <p>Yearly · ≈ {{ monthlyEq(item) | currency: settings.currency() }}/mo</p>
                  }
                  @if (item.archived) {
                    <ion-note color="medium"> · archived</ion-note>
                  }
                </ion-label>
                <ion-note slot="end">
                  {{ item.amount | currency: settings.currency() }}{{ item.cycle === 'yearly' ? ' /yr' : ' /mo' }}
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
  `],
})
export class PlannedExpensesListPage implements OnInit {
  protected readonly store = inject(PlannedExpensesStore);
  protected readonly settings = inject(SettingsStore);
  private readonly categories = inject(CategoriesStore);
  private readonly router = inject(Router);
  private readonly alertCtrl = inject(AlertController);
  private readonly notifier = inject(ConflictNotifierService);

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
