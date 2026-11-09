import { Injectable, inject, signal } from '@angular/core';
import { App } from '@capacitor/app';
import { Capacitor, PluginListenerHandle } from '@capacitor/core';
import { ModalController } from '@ionic/angular/standalone';
import { ConflictNotifierService } from '../../core/feedback/conflict-notifier.service';
import { Expense } from '../../core/models/expense.model';
import { PreApprovedEntry, SmsMessage, SmsReader } from '../../core/native/sms-reader';
import { AccountsStore } from '../accounts/accounts.store';
import { CategoriesStore } from '../categories/categories.store';
import { ExpensesApi } from '../expenses/expenses.api';
import { ExpensesStore } from '../expenses/expenses.store';
import { SettingsStore } from '../settings/settings.store';
import { SmsBulkReviewModal, SmsCandidateRow } from './sms-bulk-review.modal';
import { SmsConfirmModal } from './sms-confirm.modal';
import { SmsScanRangeModal } from './sms-scan-range.modal';
import { ParsedExpense, parseExpenseSms } from './sms-parser';
import { SAMPLE_BANK_SMS } from './sms-samples';
import { AiProviderConfig, AiProviderService, AiSuggestion } from '../../core/ai/ai-provider.service';

const ENABLED_KEY = 'artha.sms.captureEnabled';
// Watermark: epoch ms of the newest message we've already offered, so the
// app-open/resume catch-up never re-prompts the same SMS.
const LAST_SEEN_KEY = 'artha.sms.lastSeen';
// Learned "which Artha account does this SMS belong to" map, keyed by the
// account's last-4 (or sender), built up from the user's confirmations.
const ACCOUNT_MAP_KEY = 'artha.sms.accountMap';
// Learned "which category does this merchant belong to" map, keyed by the
// normalised merchant name.
const CATEGORY_MAP_KEY = 'artha.sms.categoryMap';
// Senders the user has chosen to ignore (normalised), skipped everywhere.
const IGNORED_KEY = 'artha.sms.ignoredSenders';
// Persistent queue of detected-but-unattended expenses. Items survive app
// restarts and stay until the user saves or dismisses them.
const PENDING_KEY = 'artha.sms.pending';
// Content keys of items the user just resolved (saved/dismissed/auto-added).
// A catch-up scan can re-read the same SMS from the inbox, so we suppress
// re-queuing it for a while. Keyed by content + day, so it never blocks a
// genuinely new transaction on a later date.
const RESOLVED_KEY = 'artha.sms.resolved';
const RESOLVED_TTL_MS = 24 * 60 * 60 * 1000;
// When on, a detected expense whose vendor (category) and account are already
// learned is logged automatically and the user is just notified.
const AUTO_ADD_KEY = 'artha.sms.autoAdd';
// AI suggestions per pending key, so each SMS is sent to the provider at most once.
const AI_SUGGEST_KEY = 'artha.sms.aiSuggestions';
const AI_SUGGEST_LIMIT = 200;
// Don't hold a review screen open longer than this waiting on the provider.
const AI_WAIT_MS = 8000;
// Bulk scan: parallel AI requests, and the longest the review list waits overall.
const AI_BULK_CONCURRENCY = 4;
const AI_BULK_WAIT_MS = 30000;

/** A detected expense waiting in the persistent queue. */
interface PendingItem {
  /** Content key used to dedup and to drop the item once resolved. */
  key: string;
  parsed: ParsedExpense;
  addedAt: number;
}

/** A learned "this SMS → this account" rule, for display in settings. */
export interface AccountMapping {
  /** Raw storage key (e.g. "h:1234" or "s:HDFCBK"). */
  key: string;
  /** Human-readable description of what the rule matches. */
  label: string;
  accountId: string;
  accountName: string;
}

/** A learned "this merchant → this category" rule, for display in settings. */
export interface CategoryMapping {
  /** Raw storage key — the normalised merchant. */
  key: string;
  merchant: string;
  categoryId: string;
  categoryName: string;
}

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
  private readonly expensesStore = inject(ExpensesStore);
  private readonly settingsStore = inject(SettingsStore);
  private readonly notifier = inject(ConflictNotifierService);
  private readonly ai = inject(AiProviderService);
  private aiSuggestions: Record<string, AiSuggestion> = this.loadAiSuggestions();

  private listener: PluginListenerHandle | null = null;
  private resumeBound = false;
  // In-memory cache of ignored senders (normalised) for synchronous checks.
  private readonly ignored = new Set<string>(this.loadIgnored());

  // ----- Pending queue -----
  // Reactive count for UI badges. Declared before `pending` so the field
  // initializer below can update it as it loads.
  private readonly _pendingCount = signal(0);
  /** Number of detected expenses waiting to be saved or dismissed. */
  readonly pendingCount = this._pendingCount.asReadonly();
  private pending: PendingItem[] = this.loadPending();
  // Content keys -> resolved-at epoch ms; suppresses re-queuing a just-handled
  // SMS that a later catch-up scan re-reads from the inbox.
  private resolved: Record<string, number> = this.loadResolved();
  /** Queue keys of the AI provider's sample SMS: shown for review, never saved. */
  private readonly sampleKeys = new Set<string>(loadSampleKeys());
  /** Amount + merchant + sender of each sample, to also catch ones queued before they were marked. */
  private readonly sampleSignatures = new Set<string>(
    SAMPLE_BANK_SMS.map((s) => parseExpenseSms({ address: s.address, body: s.body.replace('{date}', '01-01-26'), date: 0 }))
      .filter((p): p is ParsedExpense => !!p)
      .map((p) => this.sampleSignature(p)),
  );

  private sampleSignature(p: ParsedExpense): string {
    return `${p.amount.toFixed(2)}|${categoryKey(p.merchant)}|${normalizeSender(p.sender)}`;
  }

  /** True for the AI provider's sample SMS, which are never saved. */
  private isSample(p: ParsedExpense, key?: string): boolean {
    return this.sampleKeys.has(key ?? this.pendingKey(p)) || this.sampleSignatures.has(this.sampleSignature(p));
  }
  // Guards so we never stack the queue-review or single-confirm dialogs.
  private reviewing = false;
  private confirming = false;

  // ----- Lock-screen takeover (Android 14+ full-screen notification) -----
  // Null = not yet queried / not supported (iOS, web). On Android we populate
  // on first `isSupported()` + enable path and refresh on resume so the UI
  // reflects whatever the user chose on the system settings page.
  private readonly _fullScreenGranted = signal<boolean | null>(null);
  /** Reactive: true once Android grants USE_FULL_SCREEN_INTENT, null off-Android. */
  readonly fullScreenGranted = this._fullScreenGranted.asReadonly();
  private readonly _overlayGranted = signal<boolean | null>(null);
  /** Reactive: whether "Display over other apps" is granted; null off-Android. */
  readonly overlayGranted = this._overlayGranted.asReadonly();

  // ----- Ignored senders -----

  /** Normalised senders the user has chosen to skip. */
  ignoredSenders(): string[] {
    return [...this.ignored];
  }

  ignoredCount(): number {
    return this.ignored.size;
  }

  /** Skip all future messages from this sender (scan + live + background). */
  ignoreSender(rawSender: string): void {
    const key = normalizeSender(rawSender);
    if (!key || this.ignored.has(key)) {
      return;
    }
    this.ignored.add(key);
    this.persistIgnored();
  }

  /** Stop ignoring a sender. */
  unignoreSender(normalized: string): void {
    if (this.ignored.delete(normalized)) {
      this.persistIgnored();
    }
  }

  /** Whether a sender is currently on the ignore list (normalised match). */
  isSenderIgnored(sender: string): boolean {
    return this.ignored.has(normalizeSender(sender));
  }

  private isIgnored(sender: string): boolean {
    return this.isSenderIgnored(sender);
  }

  private loadIgnored(): string[] {
    try {
      return JSON.parse(localStorage.getItem(IGNORED_KEY) ?? '[]') as string[];
    } catch {
      return [];
    }
  }

  private persistIgnored(): void {
    localStorage.setItem(IGNORED_KEY, JSON.stringify([...this.ignored]));
    void this.syncIgnoredToNative();
  }

  /** Push the blocklist to the native side so the background receiver honours it. */
  private async syncIgnoredToNative(): Promise<void> {
    if (!this.isSupported()) {
      return;
    }
    await SmsReader.setIgnoredSenders({ senders: [...this.ignored] }).catch(() => undefined);
  }

  /**
   * Push the learned-mapping NAMES to the native side, so the background
   * notification can show a one-tap "Add" action only when BOTH the account
   * (by sender) and category (a learned merchant key found in the body) resolve,
   * and display their names.
   */
  private async syncNotificationMappings(): Promise<void> {
    if (!this.isSupported()) {
      return;
    }
    await this.ensureStores();
    const accById = this.accountsStore.byId();
    const catById = this.categoriesStore.byId();

    const accountNames: Record<string, string> = {};
    for (const [key, accountId] of Object.entries(this.accountMap())) {
      if (!key.startsWith('s:')) {
        continue; // the receiver matches by sender
      }
      const acc = accById[accountId];
      if (acc && !acc.archived) {
        accountNames[key.slice(2)] = acc.name;
      }
    }

    const categoryNames: Record<string, string> = {};
    for (const [merchantKey, categoryId] of Object.entries(this.categoryMap())) {
      const cat = catById[categoryId];
      if (merchantKey && cat && !cat.archived) {
        categoryNames[merchantKey] = cat.name;
      }
    }

    // Full lists for the prompt's pickers, the ones learned most often first.
    const uses = (map: Record<string, string>) => {
      const counts: Record<string, number> = {};
      for (const id of Object.values(map)) counts[id] = (counts[id] ?? 0) + 1;
      return counts;
    };
    const catUses = uses(this.categoryMap());
    const accUses = uses(this.accountMap());
    const byUse = <T extends { id: string; name: string }>(counts: Record<string, number>) =>
      (a: T, b: T) => (counts[b.id] ?? 0) - (counts[a.id] ?? 0) || a.name.localeCompare(b.name);
    // A group's use counts its subcategories too, so busy groups come first.
    const active = this.categoriesStore.items().filter((c) => !c.archived);
    const groupUses: Record<string, number> = { ...catUses };
    for (const c of active) {
      if (c.parentId) groupUses[c.parentId] = (groupUses[c.parentId] ?? 0) + (catUses[c.id] ?? 0);
    }
    const categories = active
      .sort(byUse(groupUses))
      .map((c) => ({ id: c.id, name: c.name, color: c.color, parentId: c.parentId ?? null }));
    const accounts = this.accountsStore
      .items()
      .filter((a) => !a.archived)
      .sort(byUse(accUses))
      .map((a) => a.name);

    // The full-screen prompt asks the same AI provider when it can't tell the
    // category / account itself; the config stays on this device.
    const ai = this.ai.isEnabled() ? { ...this.ai.config() } : null;
    await SmsReader.setNotificationMappings({ accountNames, categoryNames, categories, accounts, ai }).catch(
      () => undefined,
    );
  }

  /** Push the current AI provider (and lists) to the full-screen prompt, e.g. after it changes. */
  async syncNativeAi(): Promise<void> {
    await this.syncNotificationMappings();
  }

  /** SMS capture only exists on Android. */
  isSupported(): boolean {
    return Capacitor.getPlatform() === 'android';
  }

  /**
   * Refresh the cached USE_FULL_SCREEN_INTENT state from the native layer.
   * Safe to call repeatedly — a no-op off-Android. Call on app resume so a
   * grant made from the system settings page reflects back into the UI
   * without a restart.
   */
  async refreshFullScreenState(): Promise<void> {
    if (!this.isSupported()) {
      this._fullScreenGranted.set(null);
      return;
    }
    try {
      const result = await SmsReader.canUseFullScreenIntent();
      this._fullScreenGranted.set(result.granted);
    } catch {
      this._fullScreenGranted.set(null);
    }
    try {
      this._overlayGranted.set((await SmsReader.canDrawOverlays()).granted);
    } catch {
      // Older APK without the method.
      this._overlayGranted.set(null);
    }
  }

  /** Open Android's "Display over other apps" page for Artha. */
  async openOverlaySettings(): Promise<void> {
    if (!this.isSupported()) return;
    try {
      await SmsReader.openOverlaySettings();
    } catch {
      // Nothing to do; the row stays Off.
    }
  }

  /** Show the sample expense prompt now, or after `delaySeconds` (time to lock the phone). */
  async testPrompt(delaySeconds = 0): Promise<void> {
    if (!this.isSupported()) return;
    await SmsReader.testSmsPrompt({ delaySeconds });
  }

  /**
   * Open Android's Full-screen notifications settings for this app. On <14
   * the permission is auto-granted so this is a no-op. We also refresh the
   * cached state after a short delay so the UI updates when the user comes
   * back from the settings page.
   */
  async openFullScreenIntentSettings(): Promise<void> {
    if (!this.isSupported()) return;
    try {
      await SmsReader.openFullScreenIntentSettings();
    } catch {
      // Receiver already logs; swallow so the UI toggle doesn't throw.
    }
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
    void this.syncIgnoredToNative();
    void this.syncNotificationMappings();
    if (!this.isEnabled()) {
      return;
    }
    const status = await SmsReader.checkPermissions().catch(() => null);
    if (status?.sms === 'granted') {
      await this.startWatching();
      // Drain anything approved from the lock-screen prompt first — those are
      // explicit user approvals; they should land before we consider the
      // tapped notification or the backlog scan.
      await this.drainPreApproved();
      // Fast path next: if we were opened by tapping a notification, show its
      // confirm dialog straight away before the slower full catch-up scan, and
      // don't also auto-open the whole backlog list on top of it.
      const handled = await this.handlePendingNotification();
      await this.catchUp(/* present */ !handled);
    }
  }

  /**
   * When the app is opened by tapping a background "expense detected"
   * notification, the SMS that triggered it is already parsed and waiting
   * natively. Grab it and open the confirm dialog immediately — no inbox
   * re-scan and no duplicate-check round-trip — so the screen appears fast.
   */
  private async handlePendingNotification(): Promise<boolean> {
    if (!this.isEnabled()) {
      return false;
    }
    let pending: SmsMessage | null = null;
    let autoLog = false;
    try {
      const result = await SmsReader.consumePendingSms();
      pending = result.message;
      autoLog = result.autoLog ?? false;
    } catch {
      return false;
    }
    if (!pending) {
      return false;
    }
    // NB: don't advance the watermark to this SMS's time here. Tapping the
    // newest of several notifications would otherwise make the follow-up
    // catch-up scan skip the older pending SMS. The catch-up scan still reads
    // from the previous watermark and picks up the whole batch; the
    // "recently resolved" guard stops this tapped one being re-offered.
    if (this.isIgnored(pending.address)) {
      return false;
    }
    const parsed = parseExpenseSms(pending);
    if (!parsed) {
      return false;
    }
    this.enqueue(parsed);
    await this.ensureStores();
    // "Add" action: log it straight away (bypassing the auto-add toggle), then
    // drop back to the background. If the category isn't actually known the
    // force-add fails and we fall through to the review dialog.
    if (autoLog && (await this.tryAutoAdd(parsed, undefined, /* force */ true))) {
      await this.notifyAutoAdded([parsed]);
      try {
        await App.minimizeApp();
      } catch {
        // Not on Android / unavailable — harmless.
      }
      return true;
    }
    // Body tap: open the polished single confirm (fast path, no dup-check read).
    await this.openSingleConfirm(parsed, /* skipDuplicateCheck */ true);
    return true;
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
  async catchUp(present = true): Promise<void> {
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
      .filter((m) => !this.isIgnored(m.address))
      .map((m) => parseExpenseSms(m))
      .filter((p): p is ParsedExpense => p !== null);
    // Add everything detected to the persistent queue (deduped). Auto-log the
    // ones whose vendor + account are already learned (notifying the user),
    // then surface whatever is left as the reviewable backlog.
    for (const p of parsed) {
      this.enqueue(p);
    }
    const added = await this.autoAddPending();
    if (added.length > 0) {
      await this.notifyAutoAdded(added);
    }
    // Skip auto-opening the backlog when a notification was just handled — the
    // user asked for that one expense, not the whole list. The pending badge
    // still reflects anything left for them to review later.
    if (present) {
      await this.presentQueue();
    }
  }

  private bindResume(): void {
    if (this.resumeBound || !this.isSupported()) {
      return;
    }
    this.resumeBound = true;
    // Prime the full-screen-intent state now that we know we're on Android +
    // enabled, so the Settings page toggle reflects reality on first paint.
    void this.refreshFullScreenState();
    void App.addListener('resume', () => {
      void (async () => {
        // Refresh in case the user came back from the system settings page
        // where they just granted / revoked Full-screen notifications.
        void this.refreshFullScreenState();
        // Drain any lock-screen-approved entries first (silent log), then
        // handle the tapped-notification fast path, then the backlog.
        await this.drainPreApproved();
        const handled = await this.handlePendingNotification();
        await this.catchUp(/* present */ !handled);
      })();
    });
  }

  /**
   * Pull every entry the user approved from the lock-screen prompt (or the
   * notification's Approve button) and log it silently. The native layer
   * captured the account + category NAMES at post time, so we resolve by name
   * to the current store ids — ensuring the entry lands on the account the
   * mapping actually points at today, even if ids have shifted. Each log is
   * followed by a brief toast so the user sees what happened.
   */
  private async drainPreApproved(): Promise<void> {
    if (!this.isSupported()) {
      return;
    }
    let entries: PreApprovedEntry[] = [];
    try {
      const result = await SmsReader.consumePreApproved();
      entries = result.entries ?? [];
    } catch {
      return;
    }
    if (entries.length === 0) {
      return;
    }
    await this.ensureStores();
    const added: ParsedExpense[] = [];
    for (const entry of entries) {
      const parsed = parseExpenseSms({
        address: entry.address,
        body: entry.body,
        date: entry.date,
      });
      if (!parsed) {
        continue;
      }
      // The user already approved this on the lock screen; drop any queued
      // copy so the review backlog doesn't double it up.
      this.removePending([this.pendingKey(parsed)]);

      const accountId = this.accountIdByName(entry.account)
        ?? this.learnedAccountId(parsed);
      // Exact id from the prompt's picker first (same-named subcategories), then by name.
      const byId = entry.categoryId
        ? this.categoriesStore.items().find((c) => c.id === entry.categoryId && !c.archived)?.id
        : undefined;
      const categoryId = byId ?? this.categoryIdByName(entry.category) ?? this.learnedCategoryId(parsed);
      if (!accountId || !categoryId) {
        // Native shouldn't have let this through — the Approve button is only
        // offered when BOTH the sender and merchant mappings resolve. Fall
        // back to leaving it in the pending queue for manual review.
        this.enqueue(parsed);
        continue;
      }
      // Duplicate guard: a rapid double-tap on Approve, or an inbox re-read
      // that re-parsed the same message, should not create a second expense.
      const existing = await this.fetchExisting([monthOf(parsed.date)]);
      if (this.findDuplicate(parsed, existing)) {
        continue;
      }
      try {
        await this.expensesStore.add({
          date: parsed.date,
          amount: parsed.amount,
          categoryId,
          accountId,
          note: parsed.merchant ?? parsed.sender ?? null,
          excluded: false,
          type: parsed.type,
        });
      } catch {
        continue;
      }
      this.rememberAccount(parsed, accountId);
      this.rememberCategory(parsed, categoryId);
      if (parsed.balance != null) {
        await this.syncBalance(accountId, parsed.balance);
      }
      added.push(parsed);
    }
    if (added.length > 0) {
      await this.notifyAutoAdded(added);
    }
  }

  private accountIdByName(name: string | null | undefined): string | null {
    if (!name) {
      return null;
    }
    const match = this.accountsStore
      .items()
      .find((a) => !a.archived && a.name === name);
    return match ? match.id : null;
  }

  private categoryIdByName(name: string | null | undefined): string | null {
    if (!name) {
      return null;
    }
    const match = this.categoriesStore
      .items()
      .find((c) => !c.archived && c.name === name);
    return match ? match.id : null;
  }

  /** Turn capture off and stop the live watcher. */
  async disable(): Promise<void> {
    localStorage.removeItem(ENABLED_KEY);
    await this.listener?.remove();
    this.listener = null;
    await SmsReader.stopWatch().catch(() => undefined);
  }

  /**
   * One-off backfill: let the user pick a date range, read that slice of the
   * inbox, parse it, and show everything in one bulk-review list.
   * Returns the number of expenses detected, or -1 if no scan ran (not
   * supported, permission denied, or the range picker was cancelled).
   */
  async scanInbox(): Promise<number> {
    if (!this.isSupported()) {
      return -1;
    }
    let status = await SmsReader.checkPermissions().catch(() => null);
    if (status?.sms !== 'granted') {
      status = await SmsReader.requestPermissions().catch(() => null);
    }
    if (status?.sms !== 'granted') {
      return -1;
    }

    const range = await this.pickRange();
    if (!range) {
      return -1;
    }

    const { messages } = await SmsReader.readInbox({ since: range.fromMs, limit: 1000 });
    const parsed = messages
      .filter((m) => m.date <= range.toMs && !this.isIgnored(m.address))
      .map((m) => parseExpenseSms(m))
      .filter((p): p is ParsedExpense => p !== null);
    if (parsed.length === 0) {
      return 0;
    }

    await this.ensureStores();

    // Open the list straight away; duplicate lookup and AI suggestions fill it in.
    const modal = await this.modalCtrl.create({
      component: SmsBulkReviewModal,
      componentProps: {
        dataPromise: this.buildScanData(parsed),
        loadingText: this.ai.isEnabled() ? 'Checking for duplicates and asking AI for categories…' : '',
      },
    });
    await modal.present();
    const { role, data } = await modal.onWillDismiss<{ rows: SmsCandidateRow[] }>();

    if (role === 'save' && data?.rows?.length) {
      let saved = 0;
      // Rows are newest-first, so the first balance seen per account is newest.
      const balanced = new Set<string>();
      for (const r of data.rows) {
        if (!r.categoryId || !r.accountId || r.amount <= 0) {
          continue;
        }
        try {
          await this.expensesStore.add({
            date: r.date,
            amount: r.amount,
            categoryId: r.categoryId,
            accountId: r.accountId,
            note: r.note?.trim() || null,
            excluded: r.excluded,
          });
          this.rememberAccount(r.parsed, r.accountId);
          this.rememberCategory(r.parsed, r.categoryId);
          if (r.parsed.balance != null && !balanced.has(r.accountId)) {
            await this.syncBalance(r.accountId, r.parsed.balance);
            balanced.add(r.accountId);
          }
          saved++;
        } catch {
          // Skip the failed row and keep going.
        }
      }
      if (saved > 0) {
        await this.notifier.notifyInfo(`Added ${saved} expense${saved === 1 ? '' : 's'} from SMS.`);
      }
    }
    return parsed.length;
  }

  // ----- Training wizard support -----

  /**
   * Headless inbox scan over a [from, to] day range (YYYY-MM-DD). Reads, parses,
   * drops ignored senders, and returns the detected transactions newest-first.
   * No UI. Ensures the category/account stores are loaded. Returns [] when not
   * supported, permission denied, or none found.
   */
  async scanRange(from: string, to: string): Promise<ParsedExpense[]> {
    if (!this.isSupported()) {
      return [];
    }
    let status = await SmsReader.checkPermissions().catch(() => null);
    if (status?.sms !== 'granted') {
      status = await SmsReader.requestPermissions().catch(() => null);
    }
    if (status?.sms !== 'granted') {
      return [];
    }
    const fromMs = Date.parse(`${from}T00:00:00`);
    const toMs = Date.parse(`${to}T23:59:59`);
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
      return [];
    }
    const { messages } = await SmsReader.readInbox({ since: fromMs, limit: 1000 });
    const parsed = messages
      .filter((m) => m.date <= toMs && !this.isIgnored(m.address))
      .map((m) => parseExpenseSms(m))
      .filter((p): p is ParsedExpense => p !== null);
    await this.ensureStores();
    return parsed;
  }

  /**
   * Resolution snapshot for one parsed SMS, for the training list:
   *  - accountId/categoryId: the best default to prefill the editor.
   *  - learnedAccountId/learnedCategoryId: confident learned values (or null),
   *    used to show "Set"/"Not set" and to recompute siblings after training.
   */
  rowDefaults(parsed: ParsedExpense): {
    accountId: string;
    categoryId: string;
    learnedAccountId: string | null;
    learnedCategoryId: string | null;
  } {
    return {
      accountId: this.resolveAccountId(parsed),
      categoryId: this.resolveCategoryId(parsed),
      learnedAccountId: this.learnedAccountId(parsed),
      learnedCategoryId: this.learnedCategoryId(parsed),
    };
  }

  /** Persist both learned mappings for a trained message (sender→account,
   *  merchant→category). Called during training, independent of logging. */
  setMapping(parsed: ParsedExpense, accountId: string, categoryId: string): void {
    if (accountId) {
      this.rememberAccount(parsed, accountId);
    }
    if (categoryId) {
      this.rememberCategory(parsed, categoryId);
    }
  }

  /**
   * Log one trained candidate: add the transaction (with its type), reinforce
   * the mappings, and sync the account balance from the SMS (unless skipBalance,
   * for newest-first dedup). Returns true when it was added.
   */
  async logTrained(
    parsed: ParsedExpense,
    fields: {
      categoryId: string;
      accountId: string;
      amount: number;
      date: string;
      note: string | null;
      excluded: boolean;
    },
    opts?: { skipBalance?: boolean },
  ): Promise<boolean> {
    if (!fields.categoryId || !fields.accountId || fields.amount <= 0) {
      return false;
    }
    try {
      await this.expensesStore.add({
        date: fields.date,
        amount: fields.amount,
        categoryId: fields.categoryId,
        accountId: fields.accountId,
        note: fields.note?.trim() || null,
        excluded: fields.excluded,
        type: parsed.type,
      });
    } catch {
      return false;
    }
    this.rememberAccount(parsed, fields.accountId);
    this.rememberCategory(parsed, fields.categoryId);
    if (parsed.balance != null && !opts?.skipBalance) {
      await this.syncBalance(fields.accountId, parsed.balance);
    }
    return true;
  }

  /** For each candidate, find an already-logged expense it likely duplicates. */
  async findDuplicates(parsed: ParsedExpense[]): Promise<Map<ParsedExpense, Expense | null>> {
    const existing = await this.fetchExisting([...new Set(parsed.map((p) => monthOf(p.date)))]);
    return new Map(parsed.map((p) => [p, this.findDuplicate(p, existing)]));
  }

  private namedCategories(): { id: string; name: string }[] {
    return this.categoriesStore
      .items()
      .filter((c) => !c.archived)
      .map((c) => ({ id: c.id, name: c.name }));
  }

  private namedAccounts(): { id: string; name: string }[] {
    return this.accountsStore
      .items()
      .filter((a) => !a.archived)
      .map((a) => ({ id: a.id, name: a.name }));
  }

  /** Prompt for the scan date range; null if the user cancels. */
  private async pickRange(): Promise<{ fromMs: number; toMs: number } | null> {
    const modal = await this.modalCtrl.create({ component: SmsScanRangeModal });
    await modal.present();
    const { role, data } = await modal.onWillDismiss<{ from: string; to: string }>();
    if (role !== 'scan' || !data) {
      return null;
    }
    const fromMs = Date.parse(`${data.from}T00:00:00`);
    const toMs = Date.parse(`${data.to}T23:59:59`);
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
      return null;
    }
    return { fromMs, toMs };
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
    if (this.isIgnored(msg.address)) {
      return;
    }
    // Move the watermark past this message so the resume catch-up won't re-offer it.
    if (msg.date) {
      this.setLastSeen(Math.max(this.getLastSeen(), msg.date + 1));
    }
    const parsed = parseExpenseSms(msg);
    if (!parsed) {
      return;
    }
    // Queue it (never lost). If the vendor + account are already learned, log
    // it automatically and just notify; otherwise pop the single confirm since
    // the app is open and the user is here.
    this.enqueue(parsed);
    void (async () => {
      await this.ensureStores();
      if (await this.tryAutoAdd(parsed)) {
        await this.notifyAutoAdded([parsed]);
        return;
      }
      await this.openSingleConfirm(parsed);
    })();
  }

  private getLastSeen(): number {
    const v = Number(localStorage.getItem(LAST_SEEN_KEY));
    return Number.isFinite(v) && v > 0 ? v : Date.now();
  }

  private setLastSeen(ms: number): void {
    localStorage.setItem(LAST_SEEN_KEY, String(ms));
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

  /**
   * Open the single, polished confirm dialog for one detected expense (used by
   * the live path and notification taps). Saving logs it and clears it from the
   * queue; closing leaves it queued so it can be handled later from the backlog.
   */
  private async openSingleConfirm(parsed: ParsedExpense, skipDuplicateCheck = false): Promise<void> {
    // If a dialog is already up, leave this one queued — it'll surface later.
    if (this.confirming || this.reviewing) {
      return;
    }
    this.confirming = true;
    try {
      // On the notification fast-path we skip the duplicate-check Drive read so
      // the confirm dialog appears immediately (a freshly-detected SMS is very
      // unlikely to be already logged).
      const [existing, ai] = await Promise.all([
        skipDuplicateCheck ? Promise.resolve([] as Expense[]) : this.fetchExisting([monthOf(parsed.date)]),
        this.aiSuggestFor(parsed),
      ]);
      const modal = await this.modalCtrl.create({
        component: SmsConfirmModal,
        componentProps: {
          parsed,
          duplicate: skipDuplicateCheck ? null : this.findDuplicate(parsed, existing),
          categoryId: this.resolveCategoryId(parsed, ai),
          accountId: this.resolveAccountId(parsed, ai),
          canDismiss: true,
        },
      });
      await modal.present();
      const { role, data } = await modal.onWillDismiss<{ accountId?: string; categoryId?: string }>();
      // Learn the account + category the user chose, so future SMS from the same
      // account/merchant map automatically; sync the account balance from the SMS.
      if (role === 'saved' && data?.accountId) {
        this.rememberAccount(parsed, data.accountId);
        if (data.categoryId) {
          this.rememberCategory(parsed, data.categoryId);
        }
        if (parsed.balance != null) {
          await this.syncBalance(data.accountId, parsed.balance);
        }
        this.removePending([this.pendingKey(parsed)]);
      } else if (role === 'dismiss') {
        // User chose not to log it — drop it from the queue.
        this.removePending([this.pendingKey(parsed)]);
      } else if (role === 'ignore') {
        // Ignore this sender from now on, and clear any of its queued items.
        this.ignoreSender(parsed.sender);
        this.dropPendingFromIgnoredSenders();
      }
      // On cancel/close we deliberately keep the item in the queue.
    } finally {
      this.confirming = false;
    }
  }

  /** Remove every queued item whose sender is now on the ignore list. */
  private dropPendingFromIgnoredSenders(): void {
    const keys = this.pending
      .filter((item) => this.isSenderIgnored(item.parsed.sender))
      .map((item) => item.key);
    if (keys.length > 0) {
      this.removePending(keys);
    }
  }

  // ----- Pending queue -----

  /** Open the persistent queue as one reviewable list. Public entry for the UI. */
  async reviewPending(): Promise<void> {
    await this.presentQueue();
  }

  /**
   * "Test with a bank SMS" on the AI provider screen: read a pasted SMS and ask
   * the provider (with the draft `config`) for its category and account.
   * Nothing is queued, saved or learned. Throws a readable error.
   */
  async tryAiOnMessage(config: AiProviderConfig, text: string): Promise<AiMessageTest> {
    const body = text.trim();
    if (!body) {
      throw new Error('Paste a bank SMS first.');
    }
    const parsed = parseExpenseSms({ address: 'PASTED', body, date: Date.now() });
    if (!parsed) {
      throw new Error(
        "Artha doesn't read that as a spend: it needs an amount and words like debited, spent or paid. " +
          'OTPs, credits, reminders and "will be debited" notices are skipped.',
      );
    }
    await this.ensureStores();
    const categories = this.namedCategories();
    const accounts = this.namedAccounts();
    const ai = await this.ai.tryClassify(
      config,
      { sender: parsed.sender, body: parsed.raw, amount: parsed.amount, date: parsed.date },
      categories,
      accounts,
    );
    const nameOf = (list: { id: string; name: string }[], id: string | null | undefined) =>
      (id && list.find((x) => x.id === id)?.name) || null;
    return {
      amount: parsed.amount,
      date: parsed.date,
      merchant: parsed.merchant ?? ai?.merchant ?? null,
      aiMerchant: ai?.merchant ?? null,
      category: nameOf(categories, ai?.categoryId),
      account: nameOf(accounts, ai?.accountId),
      answered: ai != null,
    };
  }

  /**
   * Surface the whole pending queue in the bulk-review list. Saved rows are
   * logged and dropped; rows the user dismisses (or whose sender they ignore)
   * are dropped without logging; everything else stays queued.
   */
  private async presentQueue(): Promise<void> {
    if (this.reviewing || this.pending.length === 0) {
      return;
    }
    this.reviewing = true;
    try {
      const items = [...this.pending];
      // Open the modal immediately with a skeleton; build the rows (which needs
      // a network read to flag duplicates) in the background so tapping the
      // queue feels instant instead of freezing until the fetch finishes.
      const modal = await this.modalCtrl.create({
        component: SmsBulkReviewModal,
        componentProps: {
          queueMode: true,
          dataPromise: this.buildQueueData(items),
        },
      });
      await modal.present();
      const { role, data } = await modal.onWillDismiss<{
        rows: SmsCandidateRow[];
        dismissedKeys: string[];
      }>();

      // Keys to drop from the queue: everything the user explicitly dismissed…
      const resolved = new Set<string>(data?.dismissedKeys ?? []);
      // …plus everything successfully saved.
      if (role === 'save' && data?.rows?.length) {
        let saved = 0;
        let samples = 0;
        const balanced = new Set<string>();
        for (const r of data.rows) {
          // Samples are only there to show the AI's picks: clear, never save,
          // learn from or touch balances.
          if (r.sample || this.isSample(r.parsed, r.key)) {
            if (r.key) resolved.add(r.key);
            samples++;
            continue;
          }
          if (!r.categoryId || !r.accountId || r.amount <= 0) {
            continue;
          }
          try {
            await this.expensesStore.add({
              date: r.date,
              amount: r.amount,
              categoryId: r.categoryId,
              accountId: r.accountId,
              note: r.note?.trim() || null,
              excluded: r.excluded,
              type: r.parsed.type,
            });
            this.rememberAccount(r.parsed, r.accountId);
            this.rememberCategory(r.parsed, r.categoryId);
            if (r.parsed.balance != null && !balanced.has(r.accountId)) {
              await this.syncBalance(r.accountId, r.parsed.balance);
              balanced.add(r.accountId);
            }
            if (r.key) {
              resolved.add(r.key);
            }
            saved++;
          } catch {
            // Skip the failed row and keep it queued for a retry.
          }
        }
        if (saved > 0) {
          await this.notifier.notifyInfo(
            `Added ${saved} expense${saved === 1 ? '' : 's'} from SMS.` +
              (samples ? ` ${samples} sample${samples === 1 ? '' : 's'} cleared, not saved.` : ''),
          );
        } else if (samples > 0) {
          await this.notifier.notifyInfo(`Samples are never saved. Cleared ${samples} sample SMS.`);
        }
      }
      this.removePending(resolved);
    } finally {
      this.reviewing = false;
    }
  }

  /** Build the scan rows: flag duplicates and pre-fill from learned rules, then AI. */
  private async buildScanData(parsed: ParsedExpense[]): Promise<{
    candidates: SmsCandidateRow[];
    categories: { id: string; name: string }[];
    accounts: { id: string; name: string }[];
    currency: string;
  }> {
    // Pull existing expenses across the scanned months once, so we can flag
    // ones already logged instead of creating duplicates.
    const [existing, suggestions] = await Promise.all([
      this.fetchExisting([...new Set(parsed.map((p) => monthOf(p.date)))]),
      this.aiSuggestMany(parsed),
    ]);
    // Newest first (matches the inbox order); duplicates start unticked.
    const candidates: SmsCandidateRow[] = parsed.map((p, idx) => {
      const ai = suggestions[idx];
      const duplicate = this.findDuplicate(p, existing);
      const categoryId = this.resolveCategoryId(p, ai);
      const accountId = this.resolveAccountId(p, ai);
      return {
        parsed: p,
        duplicate,
        selected: !duplicate,
        amount: p.amount,
        date: p.date,
        categoryId,
        accountId,
        note: p.merchant ?? ai?.merchant ?? p.sender ?? null,
        excluded: false,
        aiPicked: this.isAiPicked(p, ai, categoryId, accountId),
      };
    });
    return {
      candidates,
      categories: this.namedCategories(),
      accounts: this.namedAccounts(),
      currency: this.settingsStore.currency(),
    };
  }

  /**
   * AI suggestions for a batch of SMS. Messages from the same sender about the
   * same merchant share one request, a few requests run at once, and whatever
   * hasn't answered within AI_BULK_WAIT_MS falls back to the rule-based guess.
   */
  private async aiSuggestMany(parsed: ParsedExpense[]): Promise<(AiSuggestion | null)[]> {
    const results: (AiSuggestion | null)[] = parsed.map(() => null);
    if (!this.ai.isEnabled()) {
      return results;
    }
    const groups = new Map<string, number[]>();
    parsed.forEach((p, idx) => {
      if (this.learnedCategoryId(p) && this.learnedAccountId(p)) {
        return;
      }
      const merchant = categoryKey(p.merchant);
      // Without a merchant, messages can't safely share a category guess.
      const key = merchant ? `${normalizeSender(p.sender)}|${merchant}` : this.pendingKey(p);
      groups.set(key, [...(groups.get(key) ?? []), idx]);
    });
    const queue = [...groups.values()];
    const worker = async () => {
      for (let members = queue.shift(); members; members = queue.shift()) {
        const suggestion = await this.aiSuggestFor(parsed[members[0]]);
        for (const idx of members) {
          results[idx] = suggestion;
        }
      }
    };
    const workers = Array.from({ length: Math.min(AI_BULK_CONCURRENCY, queue.length) }, worker);
    await Promise.race([
      Promise.all(workers),
      new Promise((resolve) => setTimeout(resolve, AI_BULK_WAIT_MS)),
    ]);
    // Stop handing out new requests once we've stopped waiting.
    queue.length = 0;
    return results;
  }

  /** Build the queue rows + reference data (the part that needs a network read). */
  private async buildQueueData(items: PendingItem[]): Promise<{
    candidates: SmsCandidateRow[];
    categories: { id: string; name: string }[];
    accounts: { id: string; name: string }[];
    currency: string;
  }> {
    await this.ensureStores();
    const [existing, suggestions] = await Promise.all([
      this.fetchExisting([...new Set(items.map((i) => monthOf(i.parsed.date)))]),
      Promise.all(items.map((i) => this.aiSuggestFor(i.parsed))),
    ]);
    const candidates: SmsCandidateRow[] = items.map((i, idx) => {
      const p = i.parsed;
      const ai = suggestions[idx];
      const duplicate = this.findDuplicate(p, existing);
      const categoryId = this.resolveCategoryId(p, ai);
      const accountId = this.resolveAccountId(p, ai);
      return {
        key: i.key,
        parsed: p,
        duplicate,
        selected: !duplicate,
        amount: p.amount,
        date: p.date,
        categoryId,
        accountId,
        note: p.merchant ?? ai?.merchant ?? p.sender ?? null,
        excluded: false,
        aiPicked: this.isAiPicked(p, ai, categoryId, accountId),
        sample: this.isSample(p, i.key),
      };
    });
    return {
      candidates,
      categories: this.namedCategories(),
      accounts: this.namedAccounts(),
      currency: this.settingsStore.currency(),
    };
  }

  /** Content key for dedup + resolution: date, amount, merchant and sender. */
  private pendingKey(p: ParsedExpense): string {
    return `${p.date}|${p.amount.toFixed(2)}|${categoryKey(p.merchant)}|${normalizeSender(p.sender)}`;
  }

  /** Add a detected expense to the queue unless it's already queued or was
      just resolved (and a catch-up scan is re-reading it from the inbox). */
  private enqueue(parsed: ParsedExpense): void {
    const key = this.pendingKey(parsed);
    if (this.pending.some((x) => x.key === key)) {
      return;
    }
    const resolvedAt = this.resolved[key];
    if (resolvedAt && Date.now() - resolvedAt < RESOLVED_TTL_MS) {
      return;
    }
    this.pending = [...this.pending, { key, parsed, addedAt: Date.now() }];
    this.persistPending();
  }

  private removePending(keys: Iterable<string>): void {
    const drop = new Set(keys);
    if (drop.size === 0) {
      return;
    }
    // Remember these as just-resolved so a follow-up inbox scan won't re-queue
    // them, then drop them from the live queue.
    const now = Date.now();
    let samplesDropped = false;
    for (const key of drop) {
      this.resolved[key] = now;
      samplesDropped = this.sampleKeys.delete(key) || samplesDropped;
    }
    this.persistResolved();
    if (samplesDropped) {
      this.persistSampleKeys();
    }
    const before = this.pending.length;
    this.pending = this.pending.filter((x) => !drop.has(x.key));
    if (this.pending.length !== before) {
      this.persistPending();
    }
  }

  /** Load the resolved-keys guard, pruning entries past their TTL. */
  private loadResolved(): Record<string, number> {
    let raw: Record<string, number> = {};
    try {
      raw = JSON.parse(localStorage.getItem(RESOLVED_KEY) ?? '{}') as Record<string, number>;
    } catch {
      raw = {};
    }
    const cutoff = Date.now() - RESOLVED_TTL_MS;
    const fresh: Record<string, number> = {};
    for (const [key, at] of Object.entries(raw)) {
      if (typeof at === 'number' && at >= cutoff) {
        fresh[key] = at;
      }
    }
    return fresh;
  }

  private persistSampleKeys(): void {
    try {
      localStorage.setItem(SAMPLE_KEYS_KEY, JSON.stringify([...this.sampleKeys]));
    } catch {
      // Best effort: samples just lose their marker after a restart.
    }
  }

  private persistResolved(): void {
    // Prune stale entries on the way out so the store can't grow unbounded.
    const cutoff = Date.now() - RESOLVED_TTL_MS;
    for (const [key, at] of Object.entries(this.resolved)) {
      if (at < cutoff) {
        delete this.resolved[key];
      }
    }
    localStorage.setItem(RESOLVED_KEY, JSON.stringify(this.resolved));
  }

  private loadPending(): PendingItem[] {
    let items: PendingItem[] = [];
    try {
      items = JSON.parse(localStorage.getItem(PENDING_KEY) ?? '[]') as PendingItem[];
    } catch {
      items = [];
    }
    this._pendingCount.set(items.length);
    return items;
  }

  private persistPending(): void {
    localStorage.setItem(PENDING_KEY, JSON.stringify(this.pending));
    this._pendingCount.set(this.pending.length);
  }

  // ----- Auto-add (log known vendors without approval) -----

  /**
   * Whether known-vendor expenses are logged automatically. Opt-in (off by
   * default): auto-save only happens when the user turns it on in Settings.
   */
  isAutoAddEnabled(): boolean {
    return localStorage.getItem(AUTO_ADD_KEY) === '1';
  }

  setAutoAdd(enabled: boolean): void {
    localStorage.setItem(AUTO_ADD_KEY, enabled ? '1' : '0');
  }

  /**
   * Auto-log every pending item whose vendor (category) and account are already
   * learned and which isn't a likely duplicate. Returns the ones added.
   */
  private async autoAddPending(): Promise<ParsedExpense[]> {
    if (!this.isAutoAddEnabled()) {
      return [];
    }
    await this.ensureStores();
    const items = [...this.pending];
    if (items.length === 0) {
      return [];
    }
    const existing = await this.fetchExisting([
      ...new Set(items.map((i) => monthOf(i.parsed.date))),
    ]);
    const added: ParsedExpense[] = [];
    for (const item of items) {
      if (await this.tryAutoAdd(item.parsed, existing)) {
        added.push(item.parsed);
      }
    }
    return added;
  }

  /**
   * Log a single detected expense automatically if its vendor + account are
   * already learned and it isn't a duplicate. Returns true if it was added.
   */
  private async tryAutoAdd(parsed: ParsedExpense, existing?: Expense[], force = false): Promise<boolean> {
    // `force` is used by the notification "Add" action: the user explicitly
    // asked to log it, so we bypass the global auto-add toggle (but still only
    // log when the account + category are actually known).
    if (!force && !this.isAutoAddEnabled()) {
      return false;
    }
    // Sample SMS (AI provider test) are never logged.
    if (this.isSample(parsed)) {
      return false;
    }
    const categoryId = this.learnedCategoryId(parsed);
    const accountId = this.learnedAccountId(parsed);
    if (!categoryId || !accountId) {
      return false;
    }
    const logged = existing ?? (await this.fetchExisting([monthOf(parsed.date)]));
    if (this.findDuplicate(parsed, logged)) {
      return false;
    }
    try {
      await this.expensesStore.add({
        date: parsed.date,
        amount: parsed.amount,
        categoryId,
        accountId,
        note: parsed.merchant ?? parsed.sender ?? null,
        excluded: false,
        type: parsed.type,
      });
    } catch {
      return false;
    }
    // Reinforce the mappings and sync the balance, then clear from the queue.
    this.rememberAccount(parsed, accountId);
    this.rememberCategory(parsed, categoryId);
    if (parsed.balance != null) {
      await this.syncBalance(accountId, parsed.balance);
    }
    this.removePending([this.pendingKey(parsed)]);
    return true;
  }

  /** A category the user previously taught for this merchant, or null. */
  private learnedCategoryId(parsed: ParsedExpense): string | null {
    const key = categoryKey(parsed.merchant);
    if (!key) {
      return null;
    }
    const mapped = this.categoryMap()[key];
    const active = this.categoriesStore.items().filter((c) => !c.archived);
    return mapped && active.some((c) => c.id === mapped) ? mapped : null;
  }

  /** An account confidently known for this SMS (learned, or the only account). */
  private learnedAccountId(parsed: ParsedExpense): string | null {
    const accounts = this.accountsStore.items().filter((a) => !a.archived);
    const map = this.accountMap();
    for (const key of accountKeys(parsed)) {
      const mapped = map[key];
      if (mapped && accounts.some((a) => a.id === mapped)) {
        return mapped;
      }
    }
    // With a single account there's nothing to disambiguate.
    return accounts.length === 1 ? accounts[0].id : null;
  }

  /** Toast the user about expenses logged automatically. */
  private async notifyAutoAdded(added: ParsedExpense[]): Promise<void> {
    if (added.length === 1) {
      const p = added[0];
      const name = p.merchant ?? p.sender ?? 'expense';
      await this.notifier.notifyInfo(`Expense added: ${this.formatAmount(p.amount)} · ${name}`);
    } else if (added.length > 1) {
      await this.notifier.notifyInfo(`Added ${added.length} expenses automatically from SMS.`);
    }
  }

  private formatAmount(amount: number): string {
    const currency = this.settingsStore.currency() || 'INR';
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);
    } catch {
      return amount.toLocaleString();
    }
  }

  /**
   * Update an account's balance to the value the SMS reported. The app shows
   * `openingBalance` as the account balance, so we write it there.
   */
  private async syncBalance(accountId: string, balance: number): Promise<void> {
    const acc = this.accountsStore.items().find((a) => a.id === accountId);
    if (!acc || acc.archived || Math.abs(acc.openingBalance - balance) < 0.005) {
      return;
    }
    try {
      await this.accountsStore.update(accountId, {
        name: acc.name,
        type: acc.type,
        currency: acc.currency,
        openingBalance: balance,
        color: acc.color,
        icon: acc.icon,
        bank: acc.bank,
      });
    } catch {
      // Balance sync is best-effort; never block expense capture.
    }
  }

  /**
   * Ask the AI provider about an SMS, but only when the learned rules don't
   * already know its category or account. Cached per SMS so it's asked once;
   * gives up after AI_WAIT_MS so a review screen never hangs on the network.
   */
  private async aiSuggestFor(parsed: ParsedExpense): Promise<AiSuggestion | null> {
    if (!this.ai.isEnabled()) {
      return null;
    }
    if (this.learnedCategoryId(parsed) && this.learnedAccountId(parsed)) {
      return null;
    }
    const key = this.pendingKey(parsed);
    const cached = this.aiSuggestions[key];
    if (cached) {
      return cached;
    }
    const request = this.ai.classifySms(
      { sender: parsed.sender, body: parsed.raw, amount: parsed.amount, date: parsed.date },
      this.namedCategories(),
      this.namedAccounts(),
    );
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), AI_WAIT_MS));
    // A late answer still lands in the cache for the next time this SMS is shown.
    void request.then((s) => s && this.rememberAiSuggestion(key, s));
    return Promise.race([request, timeout]);
  }

  /** True when the shown category or account came from the AI, not a learned rule. */
  private isAiPicked(parsed: ParsedExpense, ai: AiSuggestion | null, categoryId: string, accountId: string): boolean {
    if (!ai) {
      return false;
    }
    const category = !!ai.categoryId && categoryId === ai.categoryId && !this.learnedCategoryId(parsed);
    const account = !!ai.accountId && accountId === ai.accountId && !this.learnedAccountId(parsed);
    return category || account;
  }

  private rememberAiSuggestion(key: string, suggestion: AiSuggestion): void {
    this.aiSuggestions[key] = suggestion;
    const keys = Object.keys(this.aiSuggestions);
    for (const old of keys.slice(0, Math.max(0, keys.length - AI_SUGGEST_LIMIT))) {
      delete this.aiSuggestions[old];
    }
    try {
      localStorage.setItem(AI_SUGGEST_KEY, JSON.stringify(this.aiSuggestions));
    } catch {
      // Storage full or unavailable — the suggestion just isn't cached.
    }
  }

  private loadAiSuggestions(): Record<string, AiSuggestion> {
    try {
      return JSON.parse(localStorage.getItem(AI_SUGGEST_KEY) ?? '{}') as Record<string, AiSuggestion>;
    } catch {
      return {};
    }
  }

  private resolveCategoryId(parsed: ParsedExpense, ai?: AiSuggestion | null): string {
    const cats = this.categoriesStore.items().filter((c) => !c.archived);
    // 1) A mapping the user taught us for this merchant.
    const key = categoryKey(parsed.merchant);
    if (key) {
      const mapped = this.categoryMap()[key];
      if (mapped && cats.some((c) => c.id === mapped)) {
        return mapped;
      }
    }
    // 2) What the AI provider picked, when one is set up.
    if (ai?.categoryId && cats.some((c) => c.id === ai.categoryId)) {
      return ai.categoryId;
    }
    // 3) Keyword-guessed category name matched against the user's categories.
    const name = parsed.suggestedCategory;
    if (name) {
      const lower = name.toLowerCase();
      const match = cats.find((c) => c.name.toLowerCase() === lower)
        ?? cats.find((c) => c.name.toLowerCase().includes(lower));
      if (match) {
        return match.id;
      }
    }
    return '';
  }

  private categoryMap(): Record<string, string> {
    try {
      return JSON.parse(localStorage.getItem(CATEGORY_MAP_KEY) ?? '{}') as Record<string, string>;
    } catch {
      return {};
    }
  }

  private rememberCategory(parsed: ParsedExpense, categoryId: string): void {
    const key = categoryKey(parsed.merchant);
    if (!key) {
      return;
    }
    const map = this.categoryMap();
    if (map[key] === categoryId) {
      return;
    }
    map[key] = categoryId;
    localStorage.setItem(CATEGORY_MAP_KEY, JSON.stringify(map));
    void this.syncNotificationMappings();
  }

  private resolveAccountId(parsed: ParsedExpense, ai?: AiSuggestion | null): string {
    const accounts = this.accountsStore.items().filter((a) => !a.archived);
    // 1) A mapping the user taught us by confirming a prior SMS — try the
    //    card/account hint first (most specific), then the sender.
    const map = this.accountMap();
    for (const key of accountKeys(parsed)) {
      const mapped = map[key];
      if (mapped && accounts.some((a) => a.id === mapped)) {
        return mapped;
      }
    }
    // 2) What the AI provider picked, when one is set up.
    if (ai?.accountId && accounts.some((a) => a.id === ai.accountId)) {
      return ai.accountId;
    }
    // 3) Heuristic: the account's last-4 appears in an account name.
    if (parsed.accountHint) {
      const byHint = accounts.find((a) => a.name.includes(parsed.accountHint!));
      if (byHint) {
        return byHint.id;
      }
    }
    // 4) Fall back to the first account; the user's choice gets remembered.
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
    const keys = accountKeys(parsed);
    if (keys.length === 0) {
      return;
    }
    const map = this.accountMap();
    let changed = false;
    for (const key of keys) {
      if (map[key] !== accountId) {
        map[key] = accountId;
        changed = true;
      }
    }
    if (changed) {
      localStorage.setItem(ACCOUNT_MAP_KEY, JSON.stringify(map));
      void this.syncNotificationMappings();
    }
  }

  // ----- Learned mappings (for the settings viewer) -----

  /** Total number of learned account + category rules. */
  mappingCount(): number {
    return Object.keys(this.accountMap()).length + Object.keys(this.categoryMap()).length;
  }

  /** Ensure account/category names are available before listing mappings. */
  async loadReferenceData(): Promise<void> {
    await this.ensureStores();
  }

  /** Learned SMS→account rules, resolved to current account names. */
  accountMappings(): AccountMapping[] {
    const byId = this.accountsStore.byId();
    return Object.entries(this.accountMap())
      .map(([key, accountId]) => ({
        key,
        label: describeAccountKey(key),
        accountId,
        accountName: byId[accountId]?.name ?? 'Deleted account',
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  /** Learned merchant→category rules, resolved to current category names. */
  categoryMappings(): CategoryMapping[] {
    const byId = this.categoriesStore.byId();
    return Object.entries(this.categoryMap())
      .map(([key, categoryId]) => ({
        key,
        merchant: key,
        categoryId,
        categoryName: byId[categoryId]?.name ?? 'Deleted category',
      }))
      .sort((a, b) => a.merchant.localeCompare(b.merchant));
  }

  /** Forget a learned account rule. */
  forgetAccountMapping(key: string): void {
    const map = this.accountMap();
    if (key in map) {
      delete map[key];
      localStorage.setItem(ACCOUNT_MAP_KEY, JSON.stringify(map));
      void this.syncNotificationMappings();
    }
  }

  /** Forget a learned category rule. */
  forgetCategoryMapping(key: string): void {
    const map = this.categoryMap();
    if (key in map) {
      delete map[key];
      localStorage.setItem(CATEGORY_MAP_KEY, JSON.stringify(map));
      void this.syncNotificationMappings();
    }
  }
}

/**
 * Learning keys for "which account does this SMS belong to", most specific
 * first: the mentioned account/card last-4, then the normalised sender. We
 * store and look up under *both* so a correction taught by one message type
 * (e.g. a debit alert that carries a last-4) also applies to others that don't
 * (e.g. a UPI alert from the same account) — otherwise the hint-less ones keep
 * falling back to the default account.
 */
function accountKeys(p: ParsedExpense): string[] {
  const keys: string[] = [];
  if (p.accountHint) {
    keys.push(`h:${p.accountHint}`);
  }
  const sender = normalizeSender(p.sender);
  if (sender) {
    keys.push(`s:${sender}`);
  }
  return keys;
}

/** Human-readable description of an account-mapping key for the settings list. */
function describeAccountKey(key: string): string {
  if (key.startsWith('h:')) {
    return `Card / A/c ending ${key.slice(2)}`;
  }
  if (key.startsWith('s:')) {
    return `Messages from ${key.slice(2)}`;
  }
  return key;
}

/** Strip the telecom operator prefix (e.g. "AD-HDFCBK" -> "HDFCBK"). */
function normalizeSender(sender: string): string {
  return (sender || '')
    .toUpperCase()
    .replace(/^[A-Z]{1,2}-/, '')
    .replace(/[^A-Z0-9]/g, '');
}

/** Normalised merchant key for category learning ("Swiggy*123" -> "swiggy123"). */
function categoryKey(merchant: string | null): string {
  return (merchant ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
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

/** Result of "Test with a bank SMS". */
export interface AiMessageTest {
  amount: number;
  date: string;
  /** Merchant Artha's own parser read (or the AI's, when it found none). */
  merchant: string | null;
  aiMerchant: string | null;
  category: string | null;
  account: string | null;
  /** False when the provider answered in an unexpected format. */
  answered: boolean;
}

const SAMPLE_KEYS_KEY = 'artha.sms.sampleKeys';

function loadSampleKeys(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(SAMPLE_KEYS_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return [];
  }
}
