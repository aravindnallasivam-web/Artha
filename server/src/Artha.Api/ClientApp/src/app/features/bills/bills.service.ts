import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { SmsBill, SmsReader } from '../../core/native/sms-reader';

const CONFIG_KEY = 'artha.bills.config';
const SCANNED_KEY = 'artha.bills.firstScan';
const DAY_MS = 24 * 60 * 60 * 1000;

export interface BillConfig {
  enabled: boolean;
  /** First reminder this many days before the due date (then the day before and on the day). */
  daysBefore: number;
}

export interface BillView extends SmsBill {
  /** Whole days until the due date (negative when overdue). */
  daysLeft: number;
  /** "today", "tomorrow", "in 3 days", "2 days ago". */
  when: string;
}

/**
 * Bills found in SMS: credit-card statements and "due on" messages. Detection,
 * storage and the reminder notifications all live on the phone (BillReminders
 * in the Android app), so reminders work even when Artha isn't open; this
 * service shows them and lets the user mark them paid.
 */
@Injectable({ providedIn: 'root' })
export class BillsService {
  private readonly router = inject(Router);

  private readonly _bills = signal<SmsBill[]>([]);
  private readonly _config = signal<BillConfig>(loadConfig());
  private readonly _loaded = signal(false);
  private started = false;

  readonly config = this._config.asReadonly();
  readonly loaded = this._loaded.asReadonly();

  readonly views = computed<BillView[]>(() => {
    const today = startOfDay(Date.now());
    return this._bills()
      .map((b) => {
        const daysLeft = Math.round((startOfDay(b.dueMs) - today) / DAY_MS);
        return { ...b, daysLeft, when: whenLabel(daysLeft) };
      })
      .sort((a, b) => a.dueMs - b.dueMs);
  });

  /** Still to pay (overdue first, then by due date). */
  readonly open = computed(() => this.views().filter((b) => b.status === 'due'));
  /** Paid or dismissed, newest due date first. */
  readonly settled = computed(() =>
    this.views().filter((b) => b.status !== 'due').sort((a, b) => b.dueMs - a.dueMs).slice(0, 20),
  );
  /** For the dashboard: unpaid bills overdue or due within a week. */
  readonly upcoming = computed(() => this.open().filter((b) => b.daysLeft <= 7 && b.daysLeft >= -15));

  isSupported(): boolean {
    return Capacitor.getPlatform() === 'android';
  }

  /** Startup: push the settings to the phone, load bills, open /bills if a reminder was tapped. */
  async init(): Promise<void> {
    if (!this.isSupported() || this.started) return;
    this.started = true;
    await this.pushConfig();
    await this.refresh();
    if (this._config().enabled && !localStorage.getItem(SCANNED_KEY)) {
      // First run: pick up statements already in the inbox.
      try {
        localStorage.setItem(SCANNED_KEY, '1');
      } catch {
        // Scan again next time.
      }
      void this.scan(45);
    }
    await this.openRouteIfAny();
    void App.addListener('resume', () => {
      void this.refresh();
      void this.openRouteIfAny();
    });
  }

  async refresh(): Promise<void> {
    if (!this.isSupported()) return;
    try {
      const res = await SmsReader.getBills();
      this._bills.set(Array.isArray(res?.bills) ? res.bills : []);
    } catch {
      // Older build without bills.
    } finally {
      this._loaded.set(true);
    }
  }

  /** Read the last `days` of SMS for bills. Resolves with how many were added or changed. */
  async scan(days = 45): Promise<number> {
    if (!this.isSupported()) return 0;
    const res = await SmsReader.scanBills({ days });
    await this.refresh();
    return res?.changed ?? 0;
  }

  async setStatus(bill: SmsBill, status: SmsBill['status']): Promise<void> {
    // Optimistic: the list updates at once.
    this._bills.update((list) =>
      list.map((b) => (b.id === bill.id ? { ...b, status, paidBy: status === 'paid' ? 'user' : undefined } : b)),
    );
    try {
      await SmsReader.setBillStatus({ id: bill.id, status });
    } finally {
      await this.refresh();
    }
  }

  async setConfig(patch: Partial<BillConfig>): Promise<void> {
    const next = { ...this._config(), ...patch };
    this._config.set(next);
    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify(next));
    } catch {
      // This session only.
    }
    await this.pushConfig();
  }

  private async pushConfig(): Promise<void> {
    if (!this.isSupported()) return;
    await SmsReader.setBillConfig(this._config()).catch(() => undefined);
  }

  private async openRouteIfAny(): Promise<void> {
    try {
      const { route } = await SmsReader.consumeOpenRoute();
      if (route) await this.router.navigateByUrl(route);
    } catch {
      // Older build.
    }
  }
}

function loadConfig(): BillConfig {
  try {
    const v = JSON.parse(localStorage.getItem(CONFIG_KEY) ?? '{}');
    const days = Number(v.daysBefore);
    return {
      enabled: v.enabled !== false,
      daysBefore: Number.isFinite(days) && days >= 1 && days <= 10 ? days : 3,
    };
  } catch {
    return { enabled: true, daysBefore: 3 };
  }
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function whenLabel(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days > 1) return `in ${days} days`;
  return days === -1 ? '1 day ago' : `${-days} days ago`;
}
