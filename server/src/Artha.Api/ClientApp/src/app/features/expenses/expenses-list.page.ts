import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import {
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
  IonListHeader,
  IonNote,
  IonSpinner,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';
import { ConflictNotifierService } from '../../core/feedback/conflict-notifier.service';
import { Expense } from '../../core/models/expense.model';
import { CategoriesStore } from '../categories/categories.store';
import { ExpensesStore } from './expenses.store';

@Component({
  selector: 'artha-expenses-list',
  standalone: true,
  imports: [
    CurrencyPipe,
    DatePipe,
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
    IonListHeader,
    IonNote,
    IonSpinner,
    IonTitle,
    IonToolbar,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Expenses</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      @if (expensesStore.loading()) {
        <div class="state"><ion-spinner></ion-spinner></div>
      } @else if (expensesStore.items().length === 0) {
        <div class="empty">
          <p>No expenses yet.</p>
          <p>Tap the + button to add your first one.</p>
        </div>
      } @else {
        @for (group of grouped(); track group.date) {
          <ion-list>
            <ion-list-header>
              <ion-label>{{ group.date | date:'fullDate' }}</ion-label>
            </ion-list-header>
            @for (expense of group.items; track expense.id) {
              <ion-item-sliding>
                <ion-item button (click)="edit(expense.id)">
                  <ion-label>
                    <h2>{{ categoryName(expense.categoryId) }}</h2>
                    @if (expense.note) {
                      <p>{{ expense.note }}</p>
                    }
                  </ion-label>
                  <ion-note slot="end">
                    {{ expense.amount | currency:expense.currency }}
                  </ion-note>
                </ion-item>
                <ion-item-options side="end">
                  <ion-item-option color="danger" (click)="remove(expense.id)">
                    <ion-icon name="trash" slot="icon-only"></ion-icon>
                  </ion-item-option>
                </ion-item-options>
              </ion-item-sliding>
            }
          </ion-list>
        }
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
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      padding: 64px 32px; color: var(--ion-color-medium); text-align: center;
    }
    .empty p { margin: 4px 0; }
  `],
})
export class ExpensesListPage implements OnInit {
  protected readonly expensesStore = inject(ExpensesStore);
  protected readonly categoriesStore = inject(CategoriesStore);
  private readonly router = inject(Router);
  private readonly notifier = inject(ConflictNotifierService);

  protected readonly grouped = computed<{ date: string; items: Expense[] }[]>(() => {
    const groups: { date: string; items: Expense[] }[] = [];
    for (const e of this.expensesStore.items()) {
      const existing = groups.find((g) => g.date === e.date);
      if (existing) {
        existing.items.push(e);
      } else {
        groups.push({ date: e.date, items: [e] });
      }
    }
    return groups;
  });

  ngOnInit(): void {
    void this.expensesStore.load();
    if (this.categoriesStore.items().length === 0) {
      void this.categoriesStore.load(/* includeArchived */ true);
    }
  }

  protected categoryName(id: string): string {
    return this.categoriesStore.byId()[id]?.name ?? 'Unknown';
  }

  add(): void {
    void this.router.navigate(['/expenses', 'new']);
  }

  edit(id: string): void {
    void this.router.navigate(['/expenses', id]);
  }

  async remove(id: string): Promise<void> {
    try {
      await this.expensesStore.remove(id);
    } catch (err) {
      await this.notifier.notifyError('Could not delete expense.');
    }
  }
}
