// Loan amortization math (reducing-balance EMI).
//
// EMI = P·r·(1+r)^n / ((1+r)^n − 1), where r is the monthly rate and n the
// term in months. The schedule splits each EMI into interest (balance·r) and
// principal (EMI − interest); the final row is trued up so the balance lands
// exactly on zero. Outstanding/progress are derived from how many EMIs have
// fallen due since the start date.

import { Loan } from '../../core/models/loan.model';

export interface ScheduleRow {
  index: number; // 1..termMonths
  date: string; // 'YYYY-MM-DD' due date
  emi: number;
  interest: number;
  principal: number;
  balance: number; // remaining after this payment
}

export interface LoanStats {
  emi: number;
  totalPayable: number;
  totalInterest: number;
  paidCount: number; // EMIs fallen due so far
  outstanding: number; // remaining principal now
  principalPaid: number;
  progress: number; // 0..1 of principal paid
  payoffDate: string | null;
  nextDueDate: string | null;
  closed: boolean;
}

export function monthlyRate(annualPercent: number): number {
  return annualPercent / 12 / 100;
}

/** Equated Monthly Installment for the given terms. */
export function computeEmi(principal: number, annualPercent: number, termMonths: number): number {
  if (principal <= 0 || termMonths <= 0) return 0;
  const r = monthlyRate(annualPercent);
  if (r === 0) return principal / termMonths;
  const factor = Math.pow(1 + r, termMonths);
  return (principal * r * factor) / (factor - 1);
}

/** Full month-by-month amortization schedule. */
export function buildSchedule(loan: Loan): ScheduleRow[] {
  const rows: ScheduleRow[] = [];
  const emi = computeEmi(loan.principal, loan.annualInterestRate, loan.termMonths);
  const r = monthlyRate(loan.annualInterestRate);
  let balance = loan.principal;

  for (let i = 1; i <= loan.termMonths; i++) {
    const interest = balance * r;
    let principalPortion = emi - interest;
    // Last installment (or any overshoot) clears the remaining balance.
    if (i === loan.termMonths || principalPortion > balance) {
      principalPortion = balance;
    }
    balance = Math.max(0, balance - principalPortion);
    rows.push({
      index: i,
      date: addMonths(loan.startDate, i - 1),
      emi: principalPortion + interest,
      interest,
      principal: principalPortion,
      balance,
    });
  }
  return rows;
}

/** Derived figures for "now" (EMIs due up to today drive the outstanding). */
export function loanStats(loan: Loan, today: Date = new Date()): LoanStats {
  const schedule = buildSchedule(loan);
  const emi = computeEmi(loan.principal, loan.annualInterestRate, loan.termMonths);
  const totalInterest = schedule.reduce((s, row) => s + row.interest, 0);
  const paidCount = clamp(elapsedInstallments(loan.startDate, today), 0, loan.termMonths);
  const outstanding = paidCount <= 0 ? loan.principal : schedule[paidCount - 1].balance;
  const principalPaid = loan.principal - outstanding;

  return {
    emi,
    totalInterest,
    totalPayable: loan.principal + totalInterest,
    paidCount,
    outstanding,
    principalPaid,
    progress: loan.principal > 0 ? principalPaid / loan.principal : 0,
    payoffDate: schedule.length ? schedule[schedule.length - 1].date : null,
    nextDueDate: paidCount < loan.termMonths ? schedule[paidCount].date : null,
    closed: paidCount >= loan.termMonths,
  };
}

/** Count of EMIs whose due date is on or before `today`. */
function elapsedInstallments(startDate: string, today: Date): number {
  const start = parseIso(startDate);
  if (!start) return 0;
  const monthsDiff =
    (today.getFullYear() - start.getFullYear()) * 12 + (today.getMonth() - start.getMonth());
  // The k-th EMI is due on startDate + (k-1) months; once we're past that
  // month's due day, that installment counts.
  return monthsDiff + (today.getDate() >= start.getDate() ? 1 : 0);
}

/** Add whole months to an ISO date, clamping the day to the month's length. */
export function addMonths(isoDate: string, months: number): string {
  const d = parseIso(isoDate) ?? new Date();
  const targetMonth = d.getMonth() + months;
  const result = new Date(d.getFullYear(), targetMonth, 1);
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(d.getDate(), lastDay));
  return `${result.getFullYear()}-${pad(result.getMonth() + 1)}-${pad(result.getDate())}`;
}

function parseIso(isoDate: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
