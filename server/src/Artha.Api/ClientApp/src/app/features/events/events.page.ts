import { CurrencyPipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
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
import { ExpensesApi } from '../expenses/expenses.api';
import { eventStats, rangeLabel, statusLabel } from './event-stats';
import { EventsStore, localToday } from './events.store';

/** Trips, celebrations and projects: ongoing first, then upcoming, then past. */
@Component({
  selector: 'artha-events',
  standalone: true,
  imports: [CurrencyPipe, RouterLink, IonBackButton, IonButtons, IonContent, IonHeader, IonIcon, IonRefresher, IonRefresherContent, IonSpinner, IonTitle, IonToolbar],
  template: `
    <ion-header class="ion-no-border">
      <ion-toolbar>
        <ion-buttons slot="start"><ion-back-button defaultHref="/more" text=""></ion-back-button></ion-buttons>
        <ion-title>Events</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <ion-refresher slot="fixed" (ionRefresh)="onPull($event)"><ion-refresher-content></ion-refresher-content></ion-refresher>
      <div class="wrap">
        <a class="new" routerLink="/events/new">
          <ion-icon name="add" aria-hidden="true"></ion-icon>
          <span><b>New event</b><small>A trip, a birthday, a wedding, a home project…</small></span>
        </a>

        @if (loading()) {
          <div class="state"><ion-spinner></ion-spinner></div>
        } @else if (rows().length === 0) {
          <p class="empty">Plan a trip or a celebration: give it dates and a budget, and every expense in those dates
            joins it automatically — from SMS, Scan &amp; Pay or added by hand.</p>
        } @else {
          @for (group of groups(); track group.title) {
            @if (group.rows.length) {
              <h2 class="section">{{ group.title }}</h2>
              @for (r of group.rows; track r.e.id) {
                <a class="card" [routerLink]="['/events', r.e.id]" [class.card--on]="r.s.status === 'ongoing'">
                  <span class="emoji" aria-hidden="true">{{ r.e.emoji || '📅' }}</span>
                  <div class="card-text">
                    <div class="card-top">
                      <b>{{ r.e.name }}</b>
                      <span class="amt num">{{ r.s.spent | currency: 'INR' : 'symbol' : '1.0-0' }}</span>
                    </div>
                    <div class="card-meta">{{ range(r.e) }} · {{ status(r.s) }} · {{ r.s.count }} {{ r.s.count === 1 ? 'expense' : 'expenses' }}</div>
                    @if (r.e.budget) {
                      <div class="bar" [class.bar--over]="(r.s.used ?? 0) > 1" [class.bar--near]="(r.s.used ?? 0) > 0.85">
                        <span [style.width.%]="Math.min(100, (r.s.used ?? 0) * 100)"></span>
                      </div>
                      <div class="card-meta">of {{ r.e.budget | currency: 'INR' : 'symbol' : '1.0-0' }} budget</div>
                    }
                  </div>
                </a>
              }
            }
          }
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
    .empty { margin: 24px 8px; text-align: center; color: var(--artha-text-muted); font-size: 14px; line-height: 1.5; }
    .new {
      display: flex; align-items: center; gap: 12px; padding: 14px; border-radius: 18px; text-decoration: none;
      border: 1.5px dashed var(--artha-accent); background: var(--artha-accent-tint); color: var(--artha-accent);
    }
    .new ion-icon { font-size: 26px; }
    .new span { display: flex; flex-direction: column; }
    .new small { font-size: 12.5px; color: var(--artha-text-muted); }
    .section { margin: 20px 4px 8px; font-size: 12px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--artha-text-subtle); }
    .card {
      display: flex; gap: 12px; padding: 14px; margin-bottom: 10px; border-radius: 18px; text-decoration: none;
      border: 1px solid var(--artha-border); background: var(--artha-surface); color: var(--artha-text);
    }
    .card--on { border-color: var(--artha-accent); box-shadow: 0 6px 18px -12px var(--artha-accent); }
    .emoji { width: 44px; height: 44px; border-radius: 14px; display: grid; place-items: center; flex-shrink: 0; font-size: 24px; background: var(--artha-surface-2); }
    .card-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
    .card-top { display: flex; justify-content: space-between; gap: 8px; }
    .card-top b { font-size: 15.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .amt { font-size: 16px; font-weight: 800; flex-shrink: 0; }
    .card-meta { font-size: 12.5px; color: var(--artha-text-muted); }
    .bar { height: 6px; border-radius: 999px; background: var(--artha-surface-2); overflow: hidden; margin-top: 4px; }
    .bar span { display: block; height: 100%; border-radius: inherit; background: var(--artha-positive); }
    .bar--near span { background: var(--artha-warning, #f59e0b); }
    .bar--over span { background: var(--artha-negative); }
  `],
})
export class EventsPage implements OnInit {
  private readonly events = inject(EventsStore);
  private readonly api = inject(ExpensesApi);
  protected readonly Math = Math;
  protected readonly loading = signal(true);
  private readonly expenses = signal<Expense[]>([]);
  protected readonly range = rangeLabel;
  protected readonly status = statusLabel;

  protected readonly rows = computed(() => {
    const today = localToday();
    return this.events.active().map((e) => ({ e, s: eventStats(e, this.expenses(), today) }));
  });
  protected readonly groups = computed(() => [
    { title: 'Now', rows: this.rows().filter((r) => r.s.status === 'ongoing') },
    { title: 'Coming up', rows: this.rows().filter((r) => r.s.status === 'upcoming').sort((a, b) => a.e.start.localeCompare(b.e.start)) },
    { title: 'Past', rows: this.rows().filter((r) => r.s.status === 'ended').sort((a, b) => b.e.end.localeCompare(a.e.end)) },
  ]);

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      await this.events.ensureLoaded(true);
      this.expenses.set((await this.api.listAll()).items);
    } catch {
      // Shows what's loaded.
    } finally {
      this.loading.set(false);
    }
  }

  protected async onPull(ev: Event): Promise<void> {
    await this.load();
    (ev.target as HTMLIonRefresherElement).complete();
  }
}
