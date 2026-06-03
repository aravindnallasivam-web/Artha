import { Injectable, inject } from '@angular/core';
import { App } from '@capacitor/app';
import { Capacitor, PluginListenerHandle } from '@capacitor/core';
import { ModalController } from '@ionic/angular/standalone';
import { Expense } from '../../core/models/expense.model';
import { SmsMessage, SmsReader } from '../../core/native/sms-reader';
import { AccountsStore } from '../accounts/accounts.store';
import { CategoriesStore } from '../categories/categories.store';
import { ExpensesApi } from '../expenses/expenses.api';
import { SmsConfirmModal } from './sms-confirm.modal';
import { ParsedExpense, parseExpenseSms } from './sms-parser';

const ENABLED_KEY = 'artha.sms.captureEnabled';
// Watermark: epoch ms of the newest message we've already offered, so the
// app-open/resume catch-up never re-prompts the same SMS.
const LAST_SEEN_KEY = 'artha.sms.lastSeen';
// Learned "which Artha account does this SMS belong to" map, keyed by the
// account's last-4 (or sender), built up from the user's confirmations.
const ACCOUNT_MAP_KEY = 'artha.sms.accountMap';
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Coordinates SMS-based expense capture (Android only):
 *  - asks for the SMS permission,
 *  - listens for incoming bank messages and opens a confirm dialog,
 *  - backfills via a one-off inbox scan.
 *
 * Parsing is on-device; raw messages never leave the phone.
 */
@Injectable({ providedIn: 'root' })
export class SmsCaptureService {
  private readonly modalCtrl = inject(ModalController);
  private readonly categoriesStore = inject(CategoriesStore);
  private readonly accountsStore = inject(AccountsStore);
  private readonly expensesApi = inject(ExpensesApi);

  private listener: PluginListenerHandle | null = null;
  private resumeBound = false;
  // Serialise confirm dialogs so live messages never stack on top of each other.
  private chain: Promise<void> = Promise.resolve();

  /** SMS capture only exists on Android. */
  isSupported(): boolean {
    return Capacitor.getPlatform() === 'android';
  }

  isEnabled(): boolean {
    return this.isSupported() && localStorage.getItem(ENABLED_KEY) === '1';
  }

  /**
   * Called once at startup. Binds the resume hook and, if capture is enabled
   * with permission, resumes the live watcher and catches up on any bank SMS
   * that arrived while the app was closed.
   */
  async init(): Promise<void> {
    if (!this.isSupported()) {
      return;
    }
    this.bindResume();
    if (!this.isEnabled()) {
      return;
    }
    const status = await SmsReader.checkPermissions().catch(() => null);
    if (status?.sms === 'granted') {
      await this.startWatching();
      await this.catchUp();
    }
  }

  /** Turn capture on: request permission, persist the flag, start watching. */
  async enable(): Promise<boolean> {
    if (!this.isSupported()) {
      return false;
    }
    let status = await SmsReader.checkPermissions().catch(() => null);
    if (status?.sms !== 'granted') {
      status = await SmsReader.requestPermissions().catch(() => null);
    }
    if (status?.sms !== 'granted') {
      return false;
    }
    // Best-effort: also request notification permission so background
    // "expense detected" alerts can show (Android 13+). Never blocks capture.
    if (status?.notifications !== 'granted') {
      await SmsReader.requestPermissions().catch(() => null);
    }
    localStorage.setItem(ENABLED_KEY, '1');
    // Start the watermark at "now" so we only catch messages from here on; use
    // "Scan recent messages" for historical backfill.
    this.setLastSeen(Date.now());
    this.bindResume();
    await this.startWatching();
    return true;
  }

  /**
   * Re-scan for bank SMS received since we last looked, and prompt for each.
   * This is the reliable path: the live listener only fires while the app is
   * foregrounded, so messages that arrive while Artha is backgrounded/closed
   * are picked up here the next time the app opens or resumes.
   */
  async catchUp(): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }
    const status = await SmsReader.checkPermissions().catch(() => null);
    if (status?.sms !== 'granted') {
      return;
    }
    const since = this.getLastSeen();
    let messages: SmsMessage[] = [];
    try {
      messages = (await SmsReader.readInbox({ since, limit: 100 })).messages;
    } catch {
      return;
    }
    // Advance the watermark right away so overlapping resumes don't double-read.
    this.setLastSeen(Date.now());

    const parsed = messages
      .map((m) => parseExpenseSms(m))
      .filter((p): p is ParsedExpense => p !== null);
    if (parsed.length === 0) {
      return;
    }
    await this.ensureStores();
    const existing = await this.fetchExisting([...new Set(parsed.map((p) => monthOf(p.date)))]);
    for (const p of parsed.reverse()) {
      await this.queue(() => this.openConfirm(p, this.findDuplicate(p, existing)));
    }
  }

  private bindResume(): void {
    if (this.resumeBound || !this.isSupported()) {
      return;
    }
    this.resumeBound = true;
    void App.addListener('resume', () => {
      void this.catchUp();
    });
  }

  /** Turn capture off and stop the live watcher. */
  async disable(): Promise<void> {
    localStorage.removeItem(ENABLED_KEY);
    await this.listener?.remove();
    this.listener = null;
    await SmsReader.stopWatch().catch(() => undefined);
  }

  /**
   * One-off backfill: read the last `days` of inbox messages, parse them, and
   * walk the user through a confirm dialog for each detected expense.
   * Returns the number of expenses detected (offered for confirmation).
   */
  async scanInbox(days = 30): Promise<number> {
    if (!this.isSupported()) {
      return 0;
    }
    let status = await SmsReader.checkPermissions().catch(() => null);
    if (status?.sms !== 'granted') {
      status = await SmsReader.requestPermissions().catch(() => null);
    }
    if (status?.sms !== 'granted') {
      return 0;
    }

    const since = Date.now() - days * DAY_MS;
    const { messages } = await SmsReader.readInbox({ since, limit: 400 });
    const parsed = messages
      .map((m) => parseExpenseSms(m))
      .filter((p): p is ParsedExpense => p !== null);

    await this.ensureStores();
    // Pull existing expenses across the scanned months once, so we can flag
    // ones already logged instead of creating duplicates.
    const existing = await this.fetchExisting([...new Set(parsed.map((p) => monthOf(p.date)))]);

    // Oldest-first so the confirm sequence reads chronologically.
    for (const p of parsed.reverse()) {
      await this.queue(() => this.openConfirm(p, this.findDuplicate(p, existing)));
    }
    return parsed.length;
  }

  private async startWatching(): Promise<void> {
    await this.ensureStores();
    await SmsReader.startWatch();
    if (!this.listener) {
      this.listener = await SmsReader.addListener('smsReceived', (msg) =>
        this.handleIncoming(msg),
      );
    }
  }

  private handleIncoming(msg: SmsMessage): void {
    // Move the watermark past this message so the resume catch-up won't re-offer it.
    if (msg.date) {
      this.setLastSeen(Math.max(this.getLastSeen(), msg.date + 1));
    }
    const parsed = parseExpenseSms(msg);
    if (!parsed) {
      return;
    }
    void this.queue(() => this.confirmWithDedup(parsed));
  }

  /** Serialise all confirm dialogs (live + catch-up + scan) into one queue. */
  private queue(task: () => Promise<void>): Promise<void> {
    const next = this.chain.then(task, task);
    this.chain = next.catch(() => undefined);
    return next;
  }

  private getLastSeen(): number {
    const v = Number(localStorage.getItem(LAST_SEEN_KEY));
    return Number.isFinite(v) && v > 0 ? v : Date.now();
  }

  private setLastSeen(ms: number): void {
    localStorage.setItem(LAST_SEEN_KEY, String(ms));
  }

  /** Live path: fetch the month's expenses to flag duplicates, then confirm. */
  private async confirmWithDedup(parsed: ParsedExpense): Promise<void> {
    const existing = await this.fetchExisting([monthOf(parsed.date)]);
    await this.openConfirm(parsed, this.findDuplicate(parsed, existing));
  }

  private async fetchExisting(months: string[]): Promise<Expense[]> {
    const lists = await Promise.all(
      months.map((m) => this.expensesApi.list(m, m).then((r) => r.items).catch(() => [])),
    );
    return lists.flat();
  }

  /**
   * A parsed SMS is a duplicate when an expense on the same date has the same
   * amount and a matching description (the SMS merchant vs. the expense note).
   * When the SMS has no merchant we fall back to amount + date.
   */
  private findDuplicate(parsed: ParsedExpense, existing: Expense[]): Expense | null {
    const desc = (parsed.merchant ?? '').trim().toLowerCase();
    return existing.find((e) =>
      e.date === parsed.date
      && Math.abs(e.amount - parsed.amount) < 0.01
      && descriptionMatches(desc, (e.note ?? '').trim().toLowerCase()),
    ) ?? null;
  }

  private async ensureStores(): Promise<void> {
    const tasks: Promise<unknown>[] = [];
    if (this.categoriesStore.items().length === 0) {
      tasks.push(this.categoriesStore.load(/* includeArchived */ false));
    }
    if (this.accountsStore.items().length === 0) {
      tasks.push(this.accountsStore.load(/* includeArchived */ false));
    }
    await Promise.all(tasks);
  }

  private async openConfirm(parsed: ParsedExpense, duplicate: Expense | null): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: SmsConfirmModal,
      componentProps: {
        parsed,
        duplicate,
        categoryId: this.resolveCategoryId(parsed.suggestedCategory),
        accountId: this.resolveAccountId(parsed),
      },
    });
    await modal.present();
    const { role, data } = await modal.onWillDismiss<{ accountId?: string }>();
    // Learn the account the user chose for this sender/account so future SMS
    // from it map automatically.
    if (role === 'saved' && data?.accountId) {
      this.rememberAccount(parsed, data.accountId);
    }
  }

  private resolveCategoryId(name: string | null): string {
    if (!name) {
      return '';
    }
    const lower = name.toLowerCase();
    const match = this.categoriesStore
      .items()
      .find((c) => !c.archived && c.name.toLowerCase() === lower)
      ?? this.categoriesStore
        .items()
        .find((c) => !c.archived && c.name.toLowerCase().includes(lower));
    return match?.id ?? '';
  }

  private resolveAccountId(parsed: ParsedExpense): string {
    const accounts = this.accountsStore.items().filter((a) => !a.archived);
    // 1) A mapping the user taught us by confirming a prior SMS.
    const mapped = this.accountMap()[accountKey(parsed)];
    if (mapped && accounts.some((a) => a.id === mapped)) {
      return mapped;
    }
    // 2) Heuristic: the account's last-4 appears in an account name.
    if (parsed.accountHint) {
      const byHint = accounts.find((a) => a.name.includes(parsed.accountHint!));
      if (byHint) {
        return byHint.id;
      }
    }
    // 3) Fall back to the first account; the user's choice gets remembered.
    return accounts[0]?.id ?? '';
  }

  private accountMap(): Record<string, string> {
    try {
      return JSON.parse(localStorage.getItem(ACCOUNT_MAP_KEY) ?? '{}') as Record<string, string>;
    } catch {
      return {};
    }
  }

  private rememberAccount(parsed: ParsedExpense, accountId: string): void {
    const key = accountKey(parsed);
    if (!key) {
      return;
    }
    const map = this.accountMap();
    if (map[key] === accountId) {
      return;
    }
    map[key] = accountId;
    localStorage.setItem(ACCOUNT_MAP_KEY, JSON.stringify(map));
  }
}

/**
 * Stable key for "which account does this SMS belong to": the mentioned
 * account/card last-4 when present, otherwise the normalised sender. The last-4
 * is the most reliable discriminator across a bank's many sender routes.
 */
function accountKey(p: ParsedExpense): string {
  if (p.accountHint) {
    return `h:${p.accountHint}`;
  }
  const sender = normalizeSender(p.sender);
  return sender ? `s:${sender}` : '';
}

/** Strip the telecom operator prefix (e.g. "AD-HDFCBK" -> "HDFCBK"). */
function normalizeSender(sender: string): string {
  return (sender || '')
    .toUpperCase()
    .replace(/^[A-Z]{1,2}-/, '')
    .replace(/[^A-Z0-9]/g, '');
}

/** Month prefix (YYYY-MM) of a YYYY-MM-DD date. */
function monthOf(isoDate: string): string {
  return isoDate.slice(0, 7);
}

/**
 * Whether an SMS merchant and an expense note describe the same thing. An empty
 * SMS merchant matches anything (so amount + date alone decide); otherwise we
 * accept exact or containment matches either way.
 */
function descriptionMatches(smsDesc: string, expenseNote: string): boolean {
  if (!smsDesc) {
    return true;
  }
  if (!expenseNote) {
    return false;
  }
  return smsDesc === expenseNote
    || smsDesc.includes(expenseNote)
    || expenseNote.includes(smsDesc);
}
