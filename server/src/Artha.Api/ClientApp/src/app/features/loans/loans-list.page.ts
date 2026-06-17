import { CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import {
  IonContent,
  IonFab,
  IonFabButton,
  IonHeader,
  IonIcon,
  IonSpinner,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';
import { Loan } from '../../core/models/loan.model';
import { SettingsStore } from '../settings/settings.store';
import { LoanStats, loanStats } from './loan-math';
import { LoansStore } from './loans.store';

@Component({
  selector: 'artha-loans-list',
  standalone: true,
  imports: [
    CurrencyPipe,
    DatePipe,
    DecimalPipe,
    IonContent,
    IonFab,
    IonFabButton,
    IonHeader,
    IonIcon,
    IonSpinner,
    IonTitle,
    IonToolbar,
  ],
  template: `
    <ion-header class="ion-no-border">
      <ion-toolbar>
        <ion-title>Loans</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <div class="page">
        @if (store.loading() && store.items().length === 0) {
          <div class="state"><ion-spinner></ion-spinner></div>
        } @else if (store.active().length === 0) {
          <div class="empty">
            <ion-icon name="cash-outline"></ion-icon>
            <p>No loans yet.</p>
            <p class="empty-sub">Track a home, car, or personal loan — EMI, interest and payoff.</p>
          </div>
        } @else {
          <!-- Summary -->
          <section class="summary">
            <div class="sum-row">
              <div class="sum-cell">
                <div class="sum-label">Outstanding</div>
                <div class="sum-value">{{ store.totalOutstanding() | currency: cur() : 'symbol' : '1.0-0' }}</div>
              </div>
              <div class="sum-divider"></div>
              <div class="sum-cell">
                <div class="sum-label">Monthly EMI</div>
                <div class="sum-value">{{ store.totalMonthlyEmi() | currency: cur() : 'symbol' : '1.0-0' }}</div>
              </div>
            </div>
            <div class="sum-foot">
              {{ store.active().length }} active loan{{ store.active().length === 1 ? '' : 's' }}
            </div>
          </section>

          <!-- Loan cards -->
          @for (loan of store.active(); track loan.id) {
            <button type="button" class="loan" (click)="open(loan.id)">
              <div class="loan-top">
                <div class="loan-id">
                  <span class="loan-name">{{ loan.name }}</span>
                  @if (loan.lender) { <span class="loan-lender">{{ loan.lender }}</span> }
                </div>
                <span class="loan-out num">
                  {{ stat(loan).outstanding | currency: cur() : 'symbol' : '1.0-0' }}
                </span>
              </div>
              <div class="bar">
                <div class="bar-fill" [style.width.%]="stat(loan).progress * 100"></div>
              </div>
              <div class="loan-foot">
                <span>
                  {{ stat(loan).emi | currency: cur() : 'symbol' : '1.0-0' }}/mo ·
                  {{ stat(loan).paidCount }}/{{ loan.termMonths }} paid
                </span>
                <span>
                  @if (stat(loan).closed) { Paid off 🎉 }
                  @else if (stat(loan).nextDueDate) { Next {{ stat(loan).nextDueDate | date: 'MMM d' }} }
                </span>
              </div>
            </button>
          }
        }
      </div>

      <ion-fab slot="fixed" vertical="bottom" horizontal="end">
        <ion-fab-button (click)="add()">
          <ion-icon name="add"></ion-icon>
        </ion-fab-button>
      </ion-fab>
    </ion-content>
  `,
  styles: [`
    ion-content { --background: var(--artha-bg); }
    .page { max-width: 680px; margin: 0 auto; padding: 12px 16px 80px; display: flex; flex-direction: column; gap: 12px; }
    .state { display: flex; justify-content: center; padding: 48px; }
    .empty {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      text-align: center; padding: 56px 24px; color: var(--artha-text-subtle); gap: 4px;
    }
    .empty ion-icon { font-size: 44px; margin-bottom: 6px; }
    .empty p { margin: 0; font-size: 14px; color: var(--artha-text-muted); }
    .empty-sub { font-size: 12.5px !important; color: var(--artha-text-subtle) !important; max-width: 32ch; }

    /* Summary */
    .summary {
      background: var(--artha-surface); border: 1px solid var(--artha-border);
      border-radius: var(--artha-radius-lg); box-shadow: var(--artha-shadow-sm); padding: 16px;
    }
    .sum-row { display: flex; align-items: stretch; }
    .sum-cell { flex: 1; text-align: center; }
    .sum-label { font-size: 11px; font-weight: 600; letter-spacing: 0.4px; text-transform: uppercase; color: var(--artha-text-subtle); }
    .sum-value { margin-top: 4px; font-size: 22px; font-weight: 800; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; color: var(--artha-text); }
    .sum-divider { width: 1px; background: var(--artha-border); margin: 4px 0; }
    .sum-foot { margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--artha-border); font-size: 12.5px; color: var(--artha-text-muted); text-align: center; }

    /* Loan card */
    .loan {
      display: block; width: 100%; text-align: left; cursor: pointer;
      background: var(--artha-surface); border: 1px solid var(--artha-border);
      border-radius: var(--artha-radius-lg); box-shadow: var(--artha-shadow-sm); padding: 14px 16px;
    }
    .loan:active { transform: translateY(1px); }
    .loan-top { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
    .loan-id { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .loan-name { font-size: 15px; font-weight: 700; color: var(--artha-text); }
    .loan-lender { font-size: 12px; color: var(--artha-text-subtle); }
    .loan-out { font-size: 16px; font-weight: 800; color: var(--artha-text); }
    .bar { height: 8px; border-radius: 999px; background: var(--artha-surface-2); overflow: hidden; margin: 12px 0 8px; }
    .bar-fill { height: 100%; border-radius: 999px; background: linear-gradient(90deg, var(--artha-accent), var(--artha-accent-hover)); }
    .loan-foot { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; color: var(--artha-text-muted); }
  `],
})
export class LoansListPage implements OnInit {
  protected readonly store = inject(LoansStore);
  private readonly settings = inject(SettingsStore);
  private readonly router = inject(Router);

  ngOnInit(): void {
    void this.store.load();
    if (!this.settings.settings()) {
      void this.settings.load();
    }
  }

  protected cur(): string {
    return this.settings.currency() || 'USD';
  }

  protected stat(loan: Loan): LoanStats {
    return loanStats(loan);
  }

  protected add(): void {
    void this.router.navigate(['/loans', 'new']);
  }

  protected open(id: string): void {
    void this.router.navigate(['/loans', id]);
  }
}
