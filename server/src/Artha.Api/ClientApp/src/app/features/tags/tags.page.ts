import { CurrencyPipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  IonBackButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonRefresher,
  IonRefresherContent,
  IonSpinner,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';
import { Expense } from '../../core/models/expense.model';
import { ActiveTagService } from '../../core/tags/active-tag.service';
import { CategoriesStore } from '../categories/categories.store';
import { ExpensesApi } from '../expenses/expenses.api';
import { normalizeTag } from '../expenses/expenses.drive';

interface TagGroup {
  tag: string;
  /** Money spent (not income, not excluded). */
  total: number;
  count: number;
  first: string;
  last: string;
  items: Expense[];
}

/**
 * Tags group expenses across categories and months - a trip, an event, a
 * project. Each tag shows its total and dates; "Auto-tag" adds a tag to
 * every new expense until it's turned off (trip mode).
 */
@Component({
  selector: 'artha-tags',
  standalone: true,
  imports: [
    CurrencyPipe,
    FormsModule,
    IonBackButton,
    IonButtons,
    IonContent,
    IonHeader,
    IonIcon,
    IonRefresher,
    IonRefresherContent,
    IonSpinner,
    IonTitle,
    IonToolbar,
  ],
  template: `
    <ion-header class="ion-no-border">
      <ion-toolbar>
        <ion-buttons slot="start"><ion-back-button defaultHref="/more" text=""></ion-back-button></ion-buttons>
        <ion-title>Tags</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <ion-refresher slot="fixed" (ionRefresh)="onPull($event)"><ion-refresher-content></ion-refresher-content></ion-refresher>
      <div class="wrap">
        <!-- Trip mode -->
        <section class="auto" [class.auto--on]="activeTag.active()">
          @if (activeTag.active(); as a) {
            <div class="auto-head">
              <span class="auto-ic"><ion-icon name="pricetag" aria-hidden="true"></ion-icon></span>
              <div class="auto-text">
                <b>Auto-tagging #{{ a.tag }}</b>
                <span>Every new expense gets it, since {{ dateLabel(a.since.slice(0, 10)) }}. Turn it off when the trip ends.</span>
              </div>
            </div>
            <button type="button" class="btn btn--wide" (click)="activeTag.stop()">Stop auto-tagging</button>
          } @else {
            <div class="auto-head">
              <span class="auto-ic"><ion-icon name="airplane-outline" aria-hidden="true"></ion-icon></span>
              <div class="auto-text">
                <b>Going on a trip or event?</b>
                <span>Pick a tag and every new expense — SMS, Scan &amp; Pay or added by hand — gets it until you stop.</span>
              </div>
            </div>
            <div class="start-row">
              <input class="field" type="text" placeholder="e.g. goa-trip" aria-label="Tag to add automatically"
                     [ngModel]="draft()" (ngModelChange)="draft.set($event)" (keydown.enter)="start(draft())" />
              <button type="button" class="btn btn--primary" (click)="start(draft())" [disabled]="!normalize(draft())">Start</button>
            </div>
            @if (groups().length) {
              <div class="chips">
                @for (g of groups().slice(0, 6); track g.tag) {
                  <button type="button" class="chip" (click)="start(g.tag)">#{{ g.tag }}</button>
                }
              </div>
            }
          }
        </section>

        @if (loading()) {
          <div class="state"><ion-spinner></ion-spinner></div>
        } @else if (groups().length === 0) {
          <p class="empty">No tags yet. Add tags to expenses (#goa-trip, #birthday, #home-repair…) to see each group's
            total here.</p>
        } @else {
          <ul class="list">
            @for (g of groups(); track g.tag) {
              <li>
                <button type="button" class="row" [class.row--open]="open() === g.tag" (click)="toggle(g.tag)">
                  <span class="row-tag">#{{ g.tag }}</span>
                  <span class="row-meta">{{ g.count }} {{ g.count === 1 ? 'expense' : 'expenses' }} · {{ span(g) }}</span>
                  <span class="row-amt num">{{ g.total | currency: 'INR' : 'symbol' : '1.0-0' }}</span>
                </button>
                @if (open() === g.tag) {
                  <ul class="items">
                    @for (e of g.items; track e.id) {
                      <li>
                        <button type="button" class="item" (click)="router.navigate(['/expenses', e.id])">
                          <span class="item-date">{{ dateLabel(e.date) }}</span>
                          <span class="item-name">{{ e.note || categoryName(e.categoryId) }}
                            <small>{{ categoryName(e.categoryId) }}</small></span>
                          <span class="item-amt num" [class.inc]="e.type === 'income'">
                            {{ e.type === 'income' ? '+' : '' }}{{ e.amount | currency: e.currency || 'INR' : 'symbol' : '1.0-0' }}
                          </span>
                        </button>
                      </li>
                    }
                  </ul>
                  @if (byCategory(g).length > 1) {
                    <p class="split">
                      @for (c of byCategory(g); track c.name; let last = $last) {
                        {{ c.name }} {{ c.total | currency: 'INR' : 'symbol' : '1.0-0' }}@if (!last) { · }
                      }
                    </p>
                  }
                }
              </li>
            }
          </ul>
        }
      </div>
    </ion-content>
  `,
  styles: [`
    ion-content { --background: var(--artha-surface); }
    ion-toolbar { --background: var(--artha-surface); }
    .wrap { max-width: 640px; margin: 0 auto; padding: 4px 16px 24px; }
    .num { font-variant-numeric: tabular-nums; }
    .state { display: flex; justify-content: center; padding: 40px; }
    .empty { margin: 28px 8px; text-align: center; color: var(--artha-text-muted); font-size: 14px; line-height: 1.5; }

    .auto { padding: 14px; border-radius: 20px; background: var(--artha-surface-2); display: flex; flex-direction: column; gap: 12px; }
    .auto--on { background: var(--artha-accent-tint); }
    .auto-head { display: flex; gap: 12px; align-items: flex-start; }
    .auto-ic {
      width: 40px; height: 40px; border-radius: 14px; display: grid; place-items: center; flex-shrink: 0;
      background: var(--artha-accent); color: #fff; font-size: 20px;
    }
    .auto-text { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
    .auto-text b { font-size: 15px; color: var(--artha-text); }
    .auto-text span { font-size: 13px; line-height: 1.4; color: var(--artha-text-muted); }
    .start-row { display: flex; gap: 8px; }
    .field {
      flex: 1; min-width: 0; height: 46px; padding: 0 14px; border-radius: 14px; border: 1px solid var(--artha-border);
      background: var(--artha-surface); color: var(--artha-text); font: inherit; font-size: 15px;
    }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .chip {
      height: 34px; padding: 0 12px; border-radius: 999px; border: 1px dashed var(--artha-border-strong);
      background: transparent; color: var(--artha-text-muted); cursor: pointer; font: inherit; font-size: 13px; font-weight: 600;
    }
    .btn {
      height: 46px; padding: 0 18px; border-radius: 999px; border: 1px solid var(--artha-border); cursor: pointer;
      background: var(--artha-surface); color: var(--artha-text); font: inherit; font-size: 14.5px; font-weight: 700;
    }
    .btn[disabled] { opacity: 0.5; cursor: default; }
    .btn--primary { border: 0; background: var(--artha-accent); color: #fff; }
    .btn--wide { width: 100%; }

    .list { list-style: none; margin: 16px 0 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .row {
      width: 100%; display: grid; grid-template-columns: 1fr auto; grid-template-areas: 'tag amt' 'meta amt';
      align-items: center; gap: 2px 12px; padding: 12px 14px; border-radius: 16px; border: 1px solid var(--artha-border);
      background: var(--artha-surface); color: var(--artha-text); text-align: left; font: inherit; cursor: pointer;
    }
    .row--open { border-color: var(--artha-accent); }
    .row-tag { grid-area: tag; font-size: 15.5px; font-weight: 800; color: var(--artha-accent); }
    .row-meta { grid-area: meta; font-size: 12.5px; color: var(--artha-text-muted); }
    .row-amt { grid-area: amt; font-size: 17px; font-weight: 800; }
    .items { list-style: none; margin: 6px 0 0; padding: 0 0 0 8px; }
    .item {
      width: 100%; display: flex; align-items: center; gap: 10px; padding: 8px 6px; border: 0; border-bottom: 1px solid var(--artha-border);
      background: transparent; color: var(--artha-text); text-align: left; font: inherit; cursor: pointer;
    }
    .item-date { width: 52px; flex-shrink: 0; font-size: 12px; color: var(--artha-text-muted); }
    .item-name { flex: 1; min-width: 0; font-size: 14px; font-weight: 600; overflow-wrap: anywhere; }
    .item-name small { display: block; font-size: 11.5px; font-weight: 500; color: var(--artha-text-muted); }
    .item-amt { font-size: 14px; font-weight: 700; }
    .item-amt.inc { color: var(--artha-positive); }
    .split { margin: 8px 6px 4px; font-size: 12.5px; color: var(--artha-text-muted); line-height: 1.5; }
  `],
})
export class TagsPage implements OnInit {
  protected readonly router = inject(Router);
  protected readonly activeTag = inject(ActiveTagService);
  private readonly api = inject(ExpensesApi);
  private readonly categoriesStore = inject(CategoriesStore);

  protected readonly loading = signal(true);
  private readonly all = signal<Expense[]>([]);
  protected readonly open = signal<string | null>(null);
  protected readonly draft = signal('');
  protected readonly normalize = normalizeTag;

  /** Every tag with its spend, newest activity first. */
  protected readonly groups = computed<TagGroup[]>(() => {
    const map = new Map<string, TagGroup>();
    for (const e of this.all()) {
      for (const t of e.tags ?? []) {
        let g = map.get(t);
        if (!g) {
          g = { tag: t, total: 0, count: 0, first: e.date, last: e.date, items: [] };
          map.set(t, g);
        }
        g.items.push(e);
        g.count++;
        if (!e.excluded && e.type !== 'income') g.total += e.amount;
        if (e.date < g.first) g.first = e.date;
        if (e.date > g.last) g.last = e.date;
      }
    }
    const list = [...map.values()];
    for (const g of list) g.items.sort((a, b) => b.date.localeCompare(a.date));
    return list.sort((a, b) => b.last.localeCompare(a.last) || b.total - a.total);
  });

  async ngOnInit(): Promise<void> {
    if (this.categoriesStore.items().length === 0) void this.categoriesStore.load().catch(() => undefined);
    await this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      // Tags span months: read them all (served from the local copy of your Drive data).
      this.all.set((await this.api.list()).items);
    } catch {
      this.all.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  protected async onPull(event: Event): Promise<void> {
    await this.load();
    (event.target as HTMLIonRefresherElement).complete();
  }

  protected start(raw: string): void {
    const t = normalizeTag(raw);
    if (!t) return;
    this.activeTag.start(t);
    this.draft.set('');
  }

  protected toggle(tag: string): void {
    this.open.set(this.open() === tag ? null : tag);
  }

  protected categoryName(id: string): string {
    return this.categoriesStore.pathLabel(id) || 'Uncategorised';
  }

  /** Spend per category inside a tag (biggest first). */
  protected byCategory(g: TagGroup): { name: string; total: number }[] {
    const byId = this.categoriesStore.byId();
    const m = new Map<string, number>();
    for (const e of g.items) {
      if (e.excluded || e.type === 'income') continue;
      const root = byId[e.categoryId]?.parentId ?? e.categoryId;
      const name = byId[root]?.name ?? 'Other';
      m.set(name, (m.get(name) ?? 0) + e.amount);
    }
    return [...m.entries()].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total);
  }

  protected span(g: TagGroup): string {
    return g.first === g.last ? this.dateLabel(g.first) : `${this.dateLabel(g.first)} – ${this.dateLabel(g.last)}`;
  }

  protected dateLabel(ymd: string): string {
    const d = new Date(`${ymd}T00:00:00`);
    if (Number.isNaN(d.getTime())) return ymd;
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
  }
}
