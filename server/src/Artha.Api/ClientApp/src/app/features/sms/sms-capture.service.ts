import { Injectable, inject } from '@angular/core';
import { Capacitor, PluginListenerHandle } from '@capacitor/core';
import { ModalController } from '@ionic/angular/standalone';
import { SmsMessage, SmsReader } from '../../core/native/sms-reader';
import { AccountsStore } from '../accounts/accounts.store';
import { CategoriesStore } from '../categories/categories.store';
import { SmsConfirmModal } from './sms-confirm.modal';
import { ParsedExpense, parseExpenseSms } from './sms-parser';

const ENABLED_KEY = 'artha.sms.captureEnabled';
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

  private listener: PluginListenerHandle | null = null;
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
   * Called once at startup. If the user previously enabled capture and the
   * permission still holds, resume the live watcher.
   */
  async init(): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }
    const status = await SmsReader.checkPermissions().catch(() => null);
    if (status?.sms === 'granted') {
      await this.startWatching();
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
    localStorage.setItem(ENABLED_KEY, '1');
    await this.startWatching();
    return true;
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
    // Oldest-first so the confirm sequence reads chronologically.
    for (const p of parsed.reverse()) {
      await this.openConfirm(p);
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
    const parsed = parseExpenseSms(msg);
    if (!parsed) {
      return;
    }
    // Queue so concurrent messages don't open overlapping dialogs.
    this.chain = this.chain.then(() => this.openConfirm(parsed));
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

  private async openConfirm(parsed: ParsedExpense): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: SmsConfirmModal,
      componentProps: {
        parsed,
        categoryId: this.resolveCategoryId(parsed.suggestedCategory),
        accountId: this.resolveAccountId(parsed.accountHint),
      },
    });
    await modal.present();
    await modal.onWillDismiss();
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

  private resolveAccountId(hint: string | null): string {
    const accounts = this.accountsStore.items().filter((a) => !a.archived);
    if (hint) {
      const byHint = accounts.find((a) => a.name.includes(hint));
      if (byHint) {
        return byHint.id;
      }
    }
    return accounts[0]?.id ?? '';
  }
}
