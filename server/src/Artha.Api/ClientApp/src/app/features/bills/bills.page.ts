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
import { ConflictNotifierService } from '../../core/feedback/conflict-notifier.service';
import { BillView, BillsService } from './bills.service';

/**
 * Bills found in SMS — credit-card statements, "due on" reminders, EMIs —
 * with the days left, and Paid / Not a bill actions. Reminders are posted by
 * the phone before each due date.
 */
@Component({
  selector: 'artha-bills',
  standalone: true,
  imports: [
    CurrencyPipe,
    RouterLink,
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
        <ion-buttons slot="start">
          <ion-back-button defaultHref="/dashboard" text=""></ion-back-button>
        </ion-buttons>
        <ion-title>Bills</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <ion-refresher slot="fixed" (ionRefresh)="onPull($event)">
        <ion-refresher-content></ion-refresher-content>
      </ion-refresher>

      <div class="wrap">
        @if (!bills.isSupported()) {
          <p class="empty">Bills are found in your bank SMS, so they're available in the Android app.</p>
        } @else {
          <!-- Summary -->
          <section class="hero">
            <div class="hero-label">To pay</div>
            <div class="hero-amount num">{{ openTotal() | currency: 'INR' : 'symbol' : '1.0-0' }}</div>
            <div class="hero-sub">
              {{ bills.open().length }} {{ bills.open().length === 1 ? 'bill' : 'bills' }}
              @if (overdueCount() > 0) { · <b class="neg">{{ overdueCount() }} overdue</b> }
            </div>
            <div class="hero-actions">
              <button type="button" class="ghost" [disabled]="scanning()" (click)="scan()">
                @if (scanning()) {
                  <ion-spinner name="dots" aria-label="Scanning SMS"></ion-spinner>
                } @else {
                  <ion-icon name="refresh-outline" aria-hidden="true"></ion-icon>Scan SMS for bills
                }
              </button>
              <a class="ghost" routerLink="/settings">
                <ion-icon name="notifications-outline" aria-hidden="true"></ion-icon>
                @if (bills.config().enabled) { Remind {{ bills.config().daysBefore }}d before } @else { Reminders off }
              </a>
            </div>
          </section>

          @if (!bills.loaded()) {
            <div class="state"><ion-spinner></ion-spinner></div>
          } @else if (bills.open().length === 0) {
            <div class="empty">
              <ion-icon name="checkmark-circle-outline" aria-hidden="true"></ion-icon>
              <p><b>Nothing due.</b> Credit-card statements and "due on" SMS show up here, with a reminder before
                each due date.</p>
            </div>
          } @else {
            <h2 class="section">Due</h2>
            <ul class="list">
              @for (b of bills.open(); track b.id) {
                <li class="bill" [class.bill--overdue]="b.daysLeft < 0" [class.bill--soon]="b.daysLeft >= 0 && b.daysLeft <= 2">
                  <div class="bill-top">
                    <span class="bill-ic" aria-hidden="true">
                      <ion-icon [name]="icon(b)"></ion-icon>
                    </span>
                    <div class="bill-text">
                      <div class="bill-title">{{ b.title }}</div>
                      <div class="bill-sub">Due {{ dateLabel(b.dueDate) }} · <b>{{ b.when }}</b></div>
                    </div>
                    <div class="bill-amt">
                      <div class="num">{{ b.amount | currency: 'INR' : 'symbol' : amountFormat(b.amount) }}</div>
                      @if (b.minDue > 0 && b.minDue < b.amount) {
                        <div class="bill-min">min {{ b.minDue | currency: 'INR' : 'symbol' : '1.0-0' }}</div>
                      }
                    </div>
                  </div>
                  <div class="bill-actions">
                    <button type="button" class="pay" (click)="markPaid(b)">
                      <ion-icon name="checkmark" aria-hidden="true"></ion-icon>Mark paid
                    </button>
                    <button type="button" class="link" (click)="dismiss(b)">Not a bill</button>
                  </div>
                </li>
              }
            </ul>
          }

          @if (bills.settled().length > 0) {
            <h2 class="section">Recent</h2>
            <ul class="list">
              @for (b of bills.settled(); track b.id) {
                <li class="bill bill--done">
                  <div class="bill-top">
                    <span class="bill-ic" aria-hidden="true">
                      <ion-icon [name]="b.status === 'paid' ? 'checkmark-circle' : 'close-circle-outline'"></ion-icon>
                    </span>
                    <div class="bill-text">
                      <div class="bill-title">{{ b.title }}</div>
                      <div class="bill-sub">
                        @if (b.status === 'paid') {
                          Paid{{ b.paidBy === 'sms' ? ' · from bank SMS' : '' }}
                        } @else {
                          Hidden
                        }
                        · due {{ dateLabel(b.dueDate) }}
                      </div>
                    </div>
                    <div class="bill-amt num">{{ b.amount | currency: 'INR' : 'symbol' : amountFormat(b.amount) }}</div>
                  </div>
                  <div class="bill-actions">
                    <button type="button" class="link" (click)="undo(b)">Move back to due</button>
                  </div>
                </li>
              }
            </ul>
          }

          <p class="foot">
            Found on this phone from your SMS; a "payment received" SMS for the same card marks it paid automatically.
          </p>
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

    .hero {
      padding: 18px; border-radius: 22px; text-align: center;
      background: var(--artha-surface-2);
    }
    .hero-label {
      font-size: 12px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
      color: var(--artha-text-subtle);
    }
    .hero-amount { margin-top: 4px; font-size: 36px; font-weight: 800; letter-spacing: -0.03em; color: var(--artha-text); }
    .hero-sub { margin-top: 2px; font-size: 13px; color: var(--artha-text-muted); }
    .neg { color: var(--artha-negative); }
    .hero-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin-top: 14px; }
    .ghost {
      display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 14px;
      border-radius: 999px; border: 1px solid var(--artha-border); background: var(--artha-surface);
      color: var(--artha-text); font-family: inherit; font-size: 13px; font-weight: 700;
      text-decoration: none; cursor: pointer;
    }
    .ghost[disabled] { opacity: 0.7; cursor: default; }
    .ghost ion-icon { font-size: 16px; color: var(--artha-accent); }
    .ghost ion-spinner { width: 22px; height: 22px; }

    .section {
      margin: 22px 4px 10px; font-size: 12.5px; font-weight: 700; letter-spacing: 0.04em;
      text-transform: uppercase; color: var(--artha-text-subtle);
    }
    .list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
    .bill {
      padding: 14px; border-radius: 18px; border: 1px solid var(--artha-border); background: var(--artha-surface);
    }
    .bill--soon { border-color: color-mix(in srgb, var(--artha-warning, #f59e0b) 55%, transparent); }
    .bill--overdue {
      border-color: color-mix(in srgb, var(--artha-negative) 50%, transparent);
      background: var(--artha-negative-tint);
    }
    .bill--done { opacity: 0.8; }
    .bill-top { display: flex; align-items: center; gap: 12px; }
    .bill-ic {
      width: 38px; height: 38px; border-radius: 12px; display: grid; place-items: center; flex-shrink: 0;
      background: var(--artha-accent-tint); color: var(--artha-accent); font-size: 19px;
    }
    .bill--overdue .bill-ic { background: var(--artha-negative); color: #fff; }
    .bill-text { flex: 1; min-width: 0; }
    .bill-title {
      font-size: 14.5px; font-weight: 700; color: var(--artha-text);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .bill-sub { margin-top: 2px; font-size: 12.5px; color: var(--artha-text-muted); }
    .bill--overdue .bill-sub b { color: var(--artha-negative); }
    .bill-amt { text-align: right; font-size: 16px; font-weight: 800; color: var(--artha-text); flex-shrink: 0; }
    .bill-min { font-size: 11.5px; font-weight: 600; color: var(--artha-text-subtle); }
    .bill-actions { display: flex; align-items: center; gap: 8px; margin-top: 12px; }
    .pay {
      display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 16px;
      border: 0; border-radius: 999px; background: var(--artha-accent); color: #fff; cursor: pointer;
      font-family: inherit; font-size: 13px; font-weight: 700;
    }
    .pay ion-icon { font-size: 16px; }
    .link {
      height: 36px; padding: 0 10px; border: 0; background: transparent; cursor: pointer;
      font-family: inherit; font-size: 13px; font-weight: 600; color: var(--artha-text-muted);
    }
    .bill--done .bill-actions { margin-top: 6px; }

    .empty {
      display: flex; flex-direction: column; align-items: center; gap: 8px;
      margin-top: 24px; padding: 24px 16px; text-align: center; color: var(--artha-text-muted); font-size: 14px;
    }
    .empty ion-icon { font-size: 40px; color: var(--artha-positive); }
    .empty p { margin: 0; max-width: 32ch; line-height: 1.45; }
    .foot { margin: 22px 4px 0; font-size: 12px; color: var(--artha-text-subtle); text-align: center; line-height: 1.45; }
  `],
})
export class BillsPage implements OnInit {
  protected readonly bills = inject(BillsService);
  private readonly notifier = inject(ConflictNotifierService);
  protected readonly scanning = signal(false);

  protected readonly openTotal = computed(() => this.bills.open().reduce((s, b) => s + b.amount, 0));
  protected readonly overdueCount = computed(() => this.bills.open().filter((b) => b.daysLeft < 0).length);

  async ngOnInit(): Promise<void> {
    await this.bills.refresh();
  }

  protected icon(b: BillView): string {
    return b.kind === 'card' ? 'card-outline' : b.kind === 'emi' ? 'cash-outline' : 'receipt-outline';
  }

  protected amountFormat(v: number): string {
    return v % 1 === 0 ? '1.0-0' : '1.2-2';
  }

  protected dateLabel(ymd: string): string {
    const d = new Date(`${ymd}T00:00:00`);
    if (Number.isNaN(d.getTime())) return ymd;
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
  }

  protected async markPaid(b: BillView): Promise<void> {
    await this.bills.setStatus(b, 'paid');
  }

  protected async dismiss(b: BillView): Promise<void> {
    await this.bills.setStatus(b, 'dismissed');
  }

  protected async undo(b: BillView): Promise<void> {
    await this.bills.setStatus(b, 'due');
  }

  protected async scan(): Promise<void> {
    this.scanning.set(true);
    try {
      const n = await this.bills.scan(60);
      await this.notifier.notifyInfo(n > 0 ? `Found ${n} bill update${n === 1 ? '' : 's'}.` : 'No new bills in the last 60 days.');
    } catch {
      await this.notifier.notifyError('Could not read SMS. Check the SMS permission in Settings.');
    } finally {
      this.scanning.set(false);
    }
  }

  protected async onPull(event: Event): Promise<void> {
    await this.bills.refresh();
    (event.target as HTMLIonRefresherElement).complete();
  }
}
