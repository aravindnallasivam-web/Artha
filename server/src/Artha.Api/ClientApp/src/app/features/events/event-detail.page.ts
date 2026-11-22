import { CurrencyPipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonSpinner,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';
import { Expense } from '../../core/models/expense.model';
import { CategoriesStore } from '../categories/categories.store';
import { ExpensesApi } from '../expenses/expenses.api';
import { ExpensesStore } from '../expenses/expenses.store';
import { dateLabel, eventStats, rangeLabel, statusLabel } from './event-stats';
import { EventsStore, localToday } from './events.store';

/** One event: spend vs budget, per day / per person, category split and its expenses. */
@Component({
  selector: 'artha-event-detail',
  standalone: true,
  imports: [CurrencyPipe, RouterLink, IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonSpinner, IonTitle, IonToolbar],
  template: `
    <ion-header class="ion-no-border">
      <ion-toolbar>
        <ion-buttons slot="start"><ion-back-button defaultHref="/events" text=""></ion-back-button></ion-buttons>
        <ion-title>{{ ev()?.name || 'Event' }}</ion-title>
        @if (ev(); as e) {
          <ion-buttons slot="end">
            <ion-button [routerLink]="['/events', e.id, 'edit']" aria-label="Edit event">
              <ion-icon name="create-outline" slot="icon-only"></ion-icon>
            </ion-button>
          </ion-buttons>
        }
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <div class="wrap">
        @if (loading()) {
          <div class="state"><ion-spinner></ion-spinner></div>
        } @else if (ev(); as e) {
          @if (stats(); as s) {
            <section class="hero">
              <span class="emoji" aria-hidden="true">{{ e.emoji || '📅' }}</span>
              <div class="hero-meta">{{ range() }} · {{ status() }}</div>
              <div class="hero-amt num">{{ s.spent | currency: 'INR' : 'symbol' : '1.0-0' }}</div>
              @if (e.budget) {
                <div class="bar" [class.bar--over]="(s.used ?? 0) > 1" [class.bar--near]="(s.used ?? 0) > 0.85">
                  <span [style.width.%]="min(100, (s.used ?? 0) * 100)"></span>
                </div>
                <div class="hero-meta">
                  @if ((s.used ?? 0) <= 1) {
                    {{ e.budget - s.spent | currency: 'INR' : 'symbol' : '1.0-0' }} left of {{ e.budget | currency: 'INR' : 'symbol' : '1.0-0' }}
                  } @else {
                    <b class="neg">{{ s.spent - e.budget | currency: 'INR' : 'symbol' : '1.0-0' }} over</b> the {{ e.budget | currency: 'INR' : 'symbol' : '1.0-0' }} budget
                  }
                </div>
              }
              <div class="facts">
                <div><b class="num">{{ s.perDay | currency: 'INR' : 'symbol' : '1.0-0' }}</b><span>per day</span></div>
                @if (e.people > 1) {
                  <div><b class="num">{{ s.perPerson | currency: 'INR' : 'symbol' : '1.0-0' }}</b><span>each · {{ e.people }} people</span></div>
                }
                <div><b class="num">{{ s.count }}</b><span>{{ s.count === 1 ? 'expense' : 'expenses' }}</span></div>
              </div>
            </section>
          }

          @if (candidates().length) {
            <div class="join">
              <span>{{ candidates().length }} {{ candidates().length === 1 ? 'expense' : 'expenses' }} from these dates
                {{ candidates().length === 1 ? "isn't" : "aren't" }} in this event yet.</span>
              <button type="button" class="btn-sm" (click)="joinAll()" [disabled]="busy()">{{ busy() ? 'Adding…' : 'Add them' }}</button>
            </div>
          }

          @if (split().length > 1) {
            <h2 class="section">Where it went</h2>
            @for (c of split(); track c.name) {
              <div class="split">
                <span class="split-name">{{ c.name }}</span>
                <span class="split-bar"><span [style.width.%]="c.share * 100"></span></span>
                <span class="split-amt num">{{ c.total | currency: 'INR' : 'symbol' : '1.0-0' }}</span>
              </div>
            }
          }

          <div class="section-row">
            <h2 class="section">Expenses</h2>
            <a class="add" [routerLink]="['/expenses/new']" [queryParams]="{ event: e.id }">+ Add expense</a>
          </div>
          @if (items().length === 0) {
            <p class="empty">Nothing yet. Expenses dated {{ range() }} land here automatically.</p>
          }
          @for (x of items(); track x.id) {
            <button type="button" class="item" (click)="router.navigate(['/expenses', x.id])">
              <span class="item-date">{{ day(x.date) }}</span>
              <span class="item-name">{{ x.note || categoryName(x.categoryId) }}<small>{{ categoryName(x.categoryId) }}</small></span>
              <span class="item-amt num" [class.inc]="x.type === 'income'">{{ x.type === 'income' ? '+' : '' }}{{ x.amount | currency: x.currency || 'INR' : 'symbol' : '1.0-0' }}</span>
            </button>
          }

          <button type="button" class="delete" (click)="remove()">
            {{ confirmDelete() ? 'Tap again to delete the event (its expenses stay)' : 'Delete event' }}
          </button>
        } @else {
          <p class="empty">This event was deleted.</p>
        }
      </div>
    </ion-content>
  `,
  styles: [`
    ion-content { --background: var(--artha-surface); }
    ion-toolbar { --background: var(--artha-surface); }
    .wrap { max-width: 640px; margin: 0 auto; padding: 4px 16px 32px; }
    .num { font-variant-numeric: tabular-nums; }
    .state { display: flex; justify-content: center; padding: 40px; }
    .empty { margin: 12px 4px; font-size: 13.5px; color: var(--artha-text-muted); }
    .hero { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 18px; border-radius: 22px; background: var(--artha-surface-2); text-align: center; }
    .emoji { font-size: 34px; }
    .hero-meta { font-size: 13px; color: var(--artha-text-muted); }
    .hero-amt { font-size: 34px; font-weight: 800; letter-spacing: -0.02em; color: var(--artha-text); }
    .neg { color: var(--artha-negative); }
    .bar { width: 100%; height: 8px; border-radius: 999px; background: var(--artha-surface); overflow: hidden; }
    .bar span { display: block; height: 100%; border-radius: inherit; background: var(--artha-positive); }
    .bar--near span { background: var(--artha-warning, #f59e0b); }
    .bar--over span { background: var(--artha-negative); }
    .facts { display: flex; justify-content: center; gap: 22px; margin-top: 8px; flex-wrap: wrap; }
    .facts div { display: flex; flex-direction: column; }
    .facts b { font-size: 16px; color: var(--artha-text); }
    .facts span { font-size: 11.5px; color: var(--artha-text-muted); }
    .join { display: flex; align-items: center; gap: 10px; margin-top: 12px; padding: 12px 14px; border-radius: 16px; background: var(--artha-accent-tint); font-size: 13px; color: var(--artha-text); }
    .join span { flex: 1; }
    .btn-sm { height: 36px; padding: 0 14px; border: 0; border-radius: 999px; background: var(--artha-accent); color: #fff; font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; flex-shrink: 0; }
    .section-row { display: flex; align-items: baseline; justify-content: space-between; }
    .section { margin: 20px 4px 8px; font-size: 12px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--artha-text-subtle); }
    .add { font-size: 13.5px; font-weight: 700; color: var(--artha-accent); text-decoration: none; }
    .split { display: grid; grid-template-columns: 96px 1fr auto; align-items: center; gap: 10px; padding: 5px 4px; }
    .split-name { font-size: 13px; font-weight: 600; color: var(--artha-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .split-bar { height: 8px; border-radius: 999px; background: var(--artha-surface-2); overflow: hidden; }
    .split-bar span { display: block; height: 100%; background: var(--artha-accent); border-radius: inherit; }
    .split-amt { font-size: 13px; font-weight: 700; }
    .item { width: 100%; display: flex; align-items: center; gap: 10px; padding: 10px 4px; border: 0; border-bottom: 1px solid var(--artha-border); background: transparent; color: var(--artha-text); text-align: left; font: inherit; cursor: pointer; }
    .item-date { width: 50px; flex-shrink: 0; font-size: 12px; color: var(--artha-text-muted); }
    .item-name { flex: 1; min-width: 0; font-size: 14px; font-weight: 600; overflow-wrap: anywhere; }
    .item-name small { display: block; font-size: 11.5px; font-weight: 500; color: var(--artha-text-muted); }
    .item-amt { font-size: 14px; font-weight: 700; }
    .item-amt.inc { color: var(--artha-positive); }
    .delete { display: block; margin: 28px auto 0; padding: 10px 16px; border: 0; background: transparent; color: var(--artha-negative); font: inherit; font-size: 13.5px; font-weight: 700; cursor: pointer; }
  `],
})
export class EventDetailPage implements OnInit {
  protected readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly events = inject(EventsStore);
  private readonly api = inject(ExpensesApi);
  private readonly expensesStore = inject(ExpensesStore);
  private readonly categoriesStore = inject(CategoriesStore);

  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly confirmDelete = signal(false);
  private readonly id = signal<string>('');
  private readonly all = signal<Expense[]>([]);
  protected readonly min = Math.min;
  protected readonly day = dateLabel;

  protected readonly ev = computed(() => {
    const e = this.events.byId()[this.id()];
    return e && !e.archived ? e : null;
  });
  protected readonly stats = computed(() => (this.ev() ? eventStats(this.ev()!, this.all(), localToday()) : null));
  protected readonly range = computed(() => (this.ev() ? rangeLabel(this.ev()!) : ''));
  protected readonly status = computed(() => (this.stats() ? statusLabel(this.stats()!) : ''));
  protected readonly items = computed(() =>
    this.all().filter((x) => x.eventId === this.id()).sort((a, b) => b.date.localeCompare(a.date)),
  );
  /** Expenses dated inside the event that belong to no event (added before it existed). */
  protected readonly candidates = computed(() => {
    const e = this.ev();
    if (!e) return [];
    return this.all().filter((x) => !x.eventId && x.type !== 'income' && x.date >= e.start && x.date <= e.end);
  });
  protected readonly split = computed(() => {
    const byId = this.categoriesStore.byId();
    const m = new Map<string, number>();
    for (const x of this.items()) {
      if (x.excluded || x.type === 'income') continue;
      const root = byId[x.categoryId]?.parentId ?? x.categoryId;
      const name = byId[root]?.name ?? 'Other';
      m.set(name, (m.get(name) ?? 0) + x.amount);
    }
    const rows = [...m.entries()].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total);
    const max = rows[0]?.total || 1;
    return rows.map((r) => ({ ...r, share: r.total / max }));
  });

  async ngOnInit(): Promise<void> {
    this.id.set(this.route.snapshot.paramMap.get('id') ?? '');
    if (this.categoriesStore.items().length === 0) void this.categoriesStore.load().catch(() => undefined);
    try {
      await this.events.ensureLoaded();
      this.all.set((await this.api.listAll()).items);
    } finally {
      this.loading.set(false);
    }
  }

  protected categoryName(id: string): string {
    return this.categoriesStore.pathLabel(id) || 'Uncategorised';
  }

  /** Bring in the expenses from these dates that aren't in any event yet. */
  protected async joinAll(): Promise<void> {
    this.busy.set(true);
    try {
      for (const x of this.candidates()) {
        await this.expensesStore.update(x.id, {
          date: x.date,
          amount: x.amount,
          categoryId: x.categoryId,
          accountId: x.accountId,
          note: x.note,
          excluded: x.excluded,
          type: x.type,
          eventId: this.id(),
        });
      }
      this.all.set((await this.api.listAll()).items);
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(): Promise<void> {
    if (!this.confirmDelete()) {
      this.confirmDelete.set(true);
      return;
    }
    await this.events.remove(this.id());
    await this.router.navigate(['/events'], { replaceUrl: true });
  }
}
