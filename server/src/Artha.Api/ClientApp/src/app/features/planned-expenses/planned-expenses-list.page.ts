import { CurrencyPipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
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
import { DonutChartComponent, DonutSegment } from '../reports/donut-chart.component';
import { SettingsStore } from '../settings/settings.store';
import { PlannedExpensesStore } from './planned-expenses.store';

const PALETTE = [
  '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ec4899',
  '#06b6d4', '#ef4444', '#84cc16', '#f97316', '#6366f1',
];

@Component({
  selector: 'artha-planned-expenses-list',
  standalone: true,
  imports: [
    CurrencyPipe,
    DonutChartComponent,
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

          @if (categoryDonut().length > 0) {
            @if (drillRoot(); as r) {
              <button type="button" class="drill-back" (click)="clearDrill()">
                ‹ {{ rootName() }} — tap to go back
              </button>
            }
            <div class="donut-wrap">
              <artha-donut-chart
                class="donut"
                [segments]="categoryDonut()"
                [currency]="settings.currency()"
                [interactive]="true"
                (segmentSelect)="onDonutSelect($event)"
              ></artha-donut-chart>
              <ul class="legend">
                @for (seg of categoryDonut(); track seg.label) {
                  <li>
                    <span class="dot" [style.background]="seg.color"></span>
                    <span class="lg-name">{{ seg.label }}</span>
                    <span class="lg-amt num">
                      {{ seg.value | currency: settings.currency() : 'symbol' : '1.0-0' }}/mo
                    </span>
                  </li>
                }
              </ul>
            </div>
          }
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
    .drill-back {
      margin-top: 12px; background: transparent; border: 0; cursor: pointer;
      font-size: 12.5px; font-weight: 600; color: var(--artha-accent, #2f6df6); padding: 2px 0;
    }
    .donut-wrap {
      display: flex; align-items: center; gap: 16px;
      margin-top: 14px; padding-top: 14px;
      border-top: 1px solid var(--artha-border, rgba(0,0,0,0.08));
    }
    .donut-wrap .donut { width: 120px; flex-shrink: 0; }
    .legend { flex: 1; min-width: 0; list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 7px; }
    .legend li { display: flex; align-items: center; gap: 8px; font-size: 13px; }
    .legend .dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
    .legend .lg-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--artha-text); }
    .legend .lg-amt { font-weight: 700; color: var(--artha-text); }
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

  /** Drilled-into root category id (showing its subcategory split), or null. */
  protected readonly drillRoot = signal<string | null>(null);
  protected readonly rootName = computed(() => {
    const r = this.drillRoot();
    return r ? this.categories.byId()[r]?.name ?? '' : '';
  });

  /**
   * Planned commitments as donut slices (monthly-equivalent). At the top level
   * they're grouped by root (parent) category; once drilled into a root, they're
   * its per-subcategory split.
   */
  protected readonly categoryDonut = computed<DonutSegment[]>(() => {
    const byId = this.categories.byId();
    const root = this.drillRoot();
    const totals = new Map<string, number>();
    for (const p of this.store.active()) {
      const catId = p.categoryId ?? '';
      const rootId = catId ? this.categories.rootIdOf(catId) : '';
      if (root) {
        if (rootId !== root) continue;
        const key = catId || root;
        totals.set(key, (totals.get(key) ?? 0) + monthlyEquivalent(p));
      } else {
        totals.set(rootId, (totals.get(rootId) ?? 0) + monthlyEquivalent(p));
      }
    }
    return [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id, value], idx) => {
        const cat = id ? byId[id] : null;
        return {
          id,
          label: cat?.name ?? 'Uncategorised',
          value,
          color: cat?.color ?? PALETTE[idx % PALETTE.length],
        };
      });
  });

  /** Clicking a top-level root slice drills into its subcategories (if any). */
  protected onDonutSelect(seg: DonutSegment): void {
    if (this.drillRoot() || !seg.id) {
      return;
    }
    if (this.distinctCategoriesUnder(seg.id) > 1) {
      this.drillRoot.set(seg.id);
    }
  }

  protected clearDrill(): void {
    this.drillRoot.set(null);
  }

  /** How many distinct categories appear under a root among active planned items. */
  private distinctCategoriesUnder(rootId: string): number {
    const seen = new Set<string>();
    for (const p of this.store.active()) {
      const catId = p.categoryId ?? '';
      if (catId && this.categories.rootIdOf(catId) === rootId) {
        seen.add(catId);
      }
    }
    return seen.size;
  }

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
