import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  IonButton,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardSubtitle,
  IonCardTitle,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonNote,
  IonSpinner,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';
import { SessionService } from '../../core/auth/session.service';
import { CategoriesStore } from '../categories/categories.store';
import { ExpensesStore } from '../expenses/expenses.store';
import { SettingsStore } from '../settings/settings.store';

@Component({
  selector: 'artha-dashboard',
  standalone: true,
  imports: [
    CurrencyPipe,
    DatePipe,
    RouterLink,
    IonButton,
    IonCard,
    IonCardContent,
    IonCardHeader,
    IonCardSubtitle,
    IonCardTitle,
    IonContent,
    IonHeader,
    IonIcon,
    IonItem,
    IonLabel,
    IonList,
    IonListHeader,
    IonNote,
    IonSpinner,
    IonTitle,
    IonToolbar,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Dashboard</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      @if (loading()) {
        <ion-spinner></ion-spinner>
      } @else {
        @if (currentUser(); as user) {
          <p class="welcome">Hi {{ firstName(user.name) }} 👋</p>
        }

        <ion-card>
          <ion-card-header>
            <ion-card-subtitle>{{ monthLabel() }}</ion-card-subtitle>
            <ion-card-title>
              {{ expensesStore.totalAmount() | currency: settingsStore.currency() }}
            </ion-card-title>
          </ion-card-header>
          <ion-card-content>
            {{ expensesStore.items().length }} expense(s) this month
          </ion-card-content>
        </ion-card>

        <ion-list>
          <ion-list-header>
            <ion-label>Recent</ion-label>
          </ion-list-header>
          @if (recent().length === 0) {
            <ion-item lines="none">
              <ion-label color="medium">No expenses yet.</ion-label>
            </ion-item>
          } @else {
            @for (expense of recent(); track expense.id) {
              <ion-item>
                <ion-label>
                  <h2>{{ categoryName(expense.categoryId) }}</h2>
                  <p>{{ expense.date | date:'mediumDate' }}</p>
                </ion-label>
                <ion-note slot="end">
                  {{ expense.amount | currency: expense.currency }}
                </ion-note>
              </ion-item>
            }
          }
        </ion-list>

        <ion-button expand="block" routerLink="/expenses" class="cta">
          <ion-icon name="wallet-outline" slot="start"></ion-icon>
          Manage expenses
        </ion-button>
      }
    </ion-content>
  `,
  styles: [`
    .welcome { font-size: 18px; margin: 0 0 16px; color: var(--ion-color-medium); }
    .cta { margin-top: 16px; }
    ion-card { margin: 0 0 16px; }
  `],
})
export class DashboardComponent implements OnInit {
  protected readonly expensesStore = inject(ExpensesStore);
  private readonly categoriesStore = inject(CategoriesStore);
  protected readonly settingsStore = inject(SettingsStore);
  private readonly session = inject(SessionService);

  protected readonly currentUser = this.session.currentUser;

  protected readonly recent = computed(() =>
    this.expensesStore.items().slice(0, 5),
  );

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
    if (!this.settingsStore.settings()) {
      void this.settingsStore.load();
    }
  }

  protected categoryName(id: string): string {
    return this.categoriesStore.byId()[id]?.name ?? 'Unknown';
  }

  protected monthLabel(): string {
    return new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }

  protected firstName(name: string): string {
    return name.split(' ')[0] ?? name;
  }
}
