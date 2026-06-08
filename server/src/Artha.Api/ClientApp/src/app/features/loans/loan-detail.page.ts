import { CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
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
  ModalController,
} from '@ionic/angular/standalone';
import { ConflictNotifierService } from '../../core/feedback/conflict-notifier.service';
import { Loan } from '../../core/models/loan.model';
import { SettingsStore } from '../settings/settings.store';
import { LedgerRow, ScheduleRow, buildSchedule, loanStats, paymentLedger } from './loan-math';
import { LoanPaymentModal } from './loan-payment.modal';
import { LoansStore } from './loans.store';

@Component({
  selector: 'artha-loan-detail',
  standalone: true,
  imports: [
    CurrencyPipe,
    DatePipe,
    DecimalPipe,
    RouterLink,
    IonBackButton,
    IonButton,
    IonButtons,
    IonContent,
    IonHeader,
    IonIcon,
    IonSpinner,
    IonTitle,
    IonToolbar,
  ],
  template: `
    <ion-header class="ion-no-border">
      <ion-toolbar>
        <ion-buttons slot="start"><ion-back-button defaultHref="/loans"></ion-back-button></ion-buttons>
        <ion-title>{{ loan()?.name ?? 'Loan' }}</ion-title>
        @if (loan(); as l) {
          <ion-buttons slot="end">
            <ion-button [routerLink]="['/loans', l.id, 'edit']" aria-label="Edit loan">
              <ion-icon slot="icon-only" name="create-outline"></ion-icon>
            </ion-button>
          </ion-buttons>
        }
      </ion-toolbar>
    </ion-header>

    <ion-content>
      @if (loadingState()) {
        <div class="state"><ion-spinner></ion-spinner></div>
      } @else if (loan(); as l) {
        <div class="page">
          <!-- Outstanding hero -->
          <section class="hero">
            <div class="hero-label">OUTSTANDING</div>
            <div class="hero-value num">{{ stats().outstanding | currency: cur() : 'symbol' : '1.0-0' }}</div>
            @if (l.lender) { <div class="hero-sub">{{ l.lender }}</div> }
            <div class="bar"><div class="bar-fill" [style.width.%]="stats().progress * 100"></div></div>
            <div class="hero-foot">
              {{ stats().principalPaid | currency: cur() : 'symbol' : '1.0-0' }} of
              {{ l.principal | currency: cur() : 'symbol' : '1.0-0' }} repaid
              ({{ stats().progress * 100 | number: '1.0-0' }}%)
              @if (!stats().tracked && !stats().closed) { <span class="est">· estimated</span> }
            </div>
          </section>

          @if (!stats().closed) {
            <ion-button expand="block" class="pay-btn" (click)="recordPayment()">
              <ion-icon name="add" slot="start"></ion-icon> Record payment
            </ion-button>
          }

          <!-- KPI grid -->
          <section class="kpis">
            <div class="kpi"><span class="k-label">EMI</span><span class="k-value">{{ stats().emi | currency: cur() : 'symbol' : '1.0-0' }}</span></div>
            <div class="kpi"><span class="k-label">Rate</span><span class="k-value">{{ l.annualInterestRate | number: '1.0-2' }}%</span></div>
            <div class="kpi"><span class="k-label">Paid</span><span class="k-value">{{ stats().paidCount }}/{{ l.termMonths }}</span></div>
            <div class="kpi"><span class="k-label">Total interest</span><span class="k-value">{{ stats().totalInterest | currency: cur() : 'symbol' : '1.0-0' }}</span></div>
            <div class="kpi"><span class="k-label">Total payable</span><span class="k-value">{{ stats().totalPayable | currency: cur() : 'symbol' : '1.0-0' }}</span></div>
            <div class="kpi">
              <span class="k-label">{{ stats().closed ? 'Paid off' : 'Next due' }}</span>
              <span class="k-value">
                @if (stats().closed) { 🎉 }
                @else if (stats().nextDueDate) { {{ stats().nextDueDate | date: 'MMM d' }} }
                @else { — }
              </span>
            </div>
          </section>

          <!-- Recorded payments -->
          @if (payments().length > 0) {
            <div class="section-label">Payments</div>
            <div class="pays">
              @for (row of payments(); track row.payment.id) {
                <div class="pay-row">
                  <div class="pay-main">
                    <span class="pay-amt num">{{ row.payment.amount | currency: cur() : 'symbol' : '1.0-0' }}</span>
                    @if (row.payment.type === 'prepayment') { <span class="tag tag-pre">Prepayment</span> }
                  </div>
                  <div class="pay-meta">
                    {{ row.payment.date | date: 'MMM d, y' }}
                    @if (row.payment.type === 'emi') {
                      · {{ row.principal | currency: cur() : 'symbol' : '1.0-0' }} principal
                      + {{ row.interest | currency: cur() : 'symbol' : '1.0-0' }} interest
                    }
                  </div>
                  <button type="button" class="pay-del" (click)="deletePayment(row.payment.id)" aria-label="Remove payment">
                    <ion-icon name="trash-outline"></ion-icon>
                  </button>
                </div>
              }
            </div>
          }

          <!-- Amortization schedule -->
          <div class="section-label">Amortization schedule</div>
          <div class="sched">
            <div class="sched-head">
              <span class="c-when">Due</span>
              <span class="c-num">Principal</span>
              <span class="c-num">Interest</span>
              <span class="c-num">Balance</span>
            </div>
            @for (row of schedule(); track row.index) {
              <div class="sched-row" [class.paid]="row.index <= stats().paidCount"
                [class.next]="row.index === stats().paidCount + 1">
                <span class="c-when">
                  <strong>{{ row.date | date: 'MMM yyyy' }}</strong>
                  <small>#{{ row.index }}</small>
                </span>
                <span class="c-num">{{ row.principal | currency: cur() : 'symbol' : '1.0-0' }}</span>
                <span class="c-num c-int">{{ row.interest | currency: cur() : 'symbol' : '1.0-0' }}</span>
                <span class="c-num">{{ row.balance | currency: cur() : 'symbol' : '1.0-0' }}</span>
              </div>
            }
          </div>
        </div>
      } @else {
        <div class="state"><p>Loan not found.</p></div>
      }
    </ion-content>
  `,
  styles: [`
    ion-content { --background: var(--artha-bg); }
    .state { display: flex; justify-content: center; padding: 48px; color: var(--artha-text-subtle); }
    .page { max-width: 720px; margin: 0 auto; padding: 12px 16px 80px; display: flex; flex-direction: column; gap: 14px; }

    .hero {
      background: var(--artha-surface); border: 1px solid var(--artha-border);
      border-radius: var(--artha-radius-lg); box-shadow: var(--artha-shadow-sm); padding: 18px 20px;
    }
    .hero-label { font-size: 11px; font-weight: 700; letter-spacing: 0.06em; color: var(--artha-text-subtle); }
    .hero-value { margin-top: 6px; font-size: 32px; font-weight: 800; letter-spacing: -0.025em; color: var(--artha-text); }
    .hero-sub { font-size: 12.5px; color: var(--artha-text-muted); margin-top: 2px; }
    .bar { height: 10px; border-radius: 999px; background: var(--artha-accent-tint); overflow: hidden; margin: 14px 0 8px; }
    .bar-fill { height: 100%; border-radius: 999px; background: linear-gradient(90deg, var(--artha-accent), var(--artha-accent-hover)); }
    .hero-foot { font-size: 12.5px; color: var(--artha-text-muted); }
    .est { color: var(--artha-text-subtle); font-style: italic; }
    .pay-btn { --border-radius: var(--artha-radius); margin: 0; }

    /* Payments list */
    .pays {
      background: var(--artha-surface); border: 1px solid var(--artha-border);
      border-radius: var(--artha-radius); box-shadow: var(--artha-shadow-sm); overflow: hidden;
    }
    .pay-row {
      display: grid; grid-template-columns: 1fr auto; align-items: center;
      gap: 4px 10px; padding: 11px 14px; border-top: 1px solid var(--artha-border);
    }
    .pay-row:first-child { border-top: none; }
    .pay-main { display: flex; align-items: center; gap: 8px; }
    .pay-amt { font-size: 15px; font-weight: 700; color: var(--artha-text); }
    .tag { font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 999px; text-transform: uppercase; letter-spacing: 0.3px; }
    .tag-pre { background: var(--artha-positive-tint); color: var(--artha-positive); }
    .pay-meta { grid-column: 1; font-size: 11.5px; color: var(--artha-text-muted); }
    .pay-del {
      grid-row: 1 / span 2; grid-column: 2; background: transparent; border: 0; cursor: pointer;
      color: var(--artha-text-subtle); font-size: 18px; padding: 6px; display: flex; align-items: center;
    }
    .pay-del:active { color: var(--artha-negative); }

    .kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
    .kpi {
      background: var(--artha-surface); border: 1px solid var(--artha-border);
      border-radius: var(--artha-radius); box-shadow: var(--artha-shadow-sm); padding: 10px 12px;
      display: flex; flex-direction: column; gap: 4px;
    }
    .k-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.4px; color: var(--artha-text-subtle); }
    .k-value { font-size: 15px; font-weight: 800; color: var(--artha-text); font-variant-numeric: tabular-nums; }

    .section-label { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; color: var(--artha-text-subtle); margin: 6px 4px 0; }

    .sched {
      background: var(--artha-surface); border: 1px solid var(--artha-border);
      border-radius: var(--artha-radius); box-shadow: var(--artha-shadow-sm); overflow: hidden;
    }
    .sched-head, .sched-row {
      display: grid; grid-template-columns: 1.2fr 1fr 1fr 1.1fr; align-items: center;
      gap: 6px; padding: 9px 14px; font-size: 12.5px;
    }
    .sched-head { background: var(--artha-surface-2); color: var(--artha-text-subtle); font-weight: 700; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.3px; }
    .sched-row { border-top: 1px solid var(--artha-border); color: var(--artha-text); }
    .sched-row.paid { color: var(--artha-text-subtle); }
    .sched-row.next { background: var(--artha-accent-tint); }
    .c-when { display: flex; flex-direction: column; }
    .c-when strong { font-weight: 600; }
    .c-when small { font-size: 10px; color: var(--artha-text-subtle); }
    .c-num { text-align: right; font-variant-numeric: tabular-nums; }
    .c-int { color: var(--artha-text-muted); }
  `],
})
export class LoanDetailPage implements OnInit {
  private readonly store = inject(LoansStore);
  private readonly settings = inject(SettingsStore);
  private readonly route = inject(ActivatedRoute);
  private readonly modalCtrl = inject(ModalController);
  private readonly notifier = inject(ConflictNotifierService);

  protected readonly loadingState = signal(true);
  private readonly loanId = signal<string | null>(null);

  protected readonly loan = computed<Loan | null>(() => {
    const id = this.loanId();
    return id ? this.store.byId()[id] ?? null : null;
  });
  protected readonly schedule = computed<ScheduleRow[]>(() => {
    const l = this.loan();
    return l ? buildSchedule(l) : [];
  });
  protected readonly stats = computed(() => {
    const l = this.loan();
    return l ? loanStats(l) : loanStats(EMPTY_LOAN);
  });
  /** Recorded payments, newest first, with interest/principal split. */
  protected readonly payments = computed<LedgerRow[]>(() => {
    const l = this.loan();
    return l ? [...paymentLedger(l)].reverse() : [];
  });

  async ngOnInit(): Promise<void> {
    void this.settings.load();
    this.loanId.set(this.route.snapshot.paramMap.get('id'));
    try {
      if (this.store.items().length === 0) {
        await this.store.load(true);
      }
    } finally {
      this.loadingState.set(false);
    }
  }

  protected cur(): string {
    return this.settings.currency() || 'USD';
  }

  async recordPayment(): Promise<void> {
    const l = this.loan();
    if (!l) return;
    const modal = await this.modalCtrl.create({
      component: LoanPaymentModal,
      componentProps: { emi: this.stats().emi },
      breakpoints: [0, 0.85],
      initialBreakpoint: 0.85,
    });
    await modal.present();
    const { role, data } = await modal.onWillDismiss();
    if (role !== 'save' || !data) return;
    try {
      await this.store.addPayment(l.id, data);
    } catch {
      await this.notifier.notifyError('Could not record payment.');
    }
  }

  async deletePayment(paymentId: string): Promise<void> {
    const l = this.loan();
    if (!l) return;
    try {
      await this.store.deletePayment(l.id, paymentId);
    } catch {
      await this.notifier.notifyError('Could not remove payment.');
    }
  }
}

const EMPTY_LOAN: Loan = {
  id: '', name: '', lender: null, principal: 0, annualInterestRate: 0,
  termMonths: 1, startDate: '2000-01-01', accountId: null, payments: [], archived: false,
};
