import { PermissionState, PluginListenerHandle, registerPlugin } from '@capacitor/core';

/** A raw SMS surfaced by the native plugin. `date` is epoch milliseconds. */
export interface SmsMessage {
  address: string;
  body: string;
  date: number;
}

export interface SmsPermissionStatus {
  sms: PermissionState;
  /** POST_NOTIFICATIONS — for background "expense detected" alerts (Android 13+). */
  notifications?: PermissionState;
  /** SEND_SMS — for the balance-enquiry "Sync balance" action. */
  send?: PermissionState;
  /** READ_PHONE_STATE — for listing SIMs to pick which one sends the SMS. */
  phone?: PermissionState;
}

/**
 * One pre-approved SMS entry: the original message plus the account / category
 * the native mapper resolved at post time. Written by the lock-screen Approve
 * (SmsPromptActivity) and the notification's Approve action (SmsActionReceiver);
 * drained by the web layer on next organic resume.
 */
/** A bill found in SMS (credit-card statement, "due on" reminder). Kept on the phone. */
export interface SmsBill {
  id: string;
  title: string;
  kind: 'card' | 'emi' | 'bill';
  last4: string;
  amount: number;
  minDue: number;
  /** yyyy-MM-dd */
  dueDate: string;
  dueMs: number;
  smsDate: number;
  status: 'due' | 'paid' | 'dismissed';
  /** Read by the AI from an SMS the patterns didn't recognise. */
  ai?: boolean;
  paidAt?: number;
  /** "sms" when a payment-received SMS settled it, "user" when marked by hand. */
  paidBy?: 'sms' | 'user';
}

/** An SMS no pattern recognised, which the AI read as an expense / income / refund. */
export interface AiFoundEntry {
  address: string;
  body: string;
  date: number;
  type: 'expense' | 'income' | 'refund';
  amount: number;
  merchant: string;
  last4: string;
  confidence: 'high' | 'medium';
}

export interface NearbyPlace {
  name: string;
  kind: string;
  distanceM: number;
}

export interface PreApprovedEntry {
  address: string;
  body: string;
  date: number;
  amountDisplay: string;
  merchant: string;
  category: string;
  /** Exact category id when picked on the full-screen prompt (absent from older builds). */
  categoryId?: string;
  /** Shop picked from "Nearby" on the prompt (absent / empty when none). */
  placeName?: string;
  /** The alert's "Remember category" switch (absent from older builds). */
  remember?: boolean;
  /** Where the phone was when the SMS was shown (when "Save location" is on). */
  location?: { lat: number; lng: number; accuracy?: number | null; at?: number } | null;
  account: string;
  approvedAt: number;
}

/** An active SIM card, for choosing which one sends a balance-enquiry SMS. */
export interface SimCard {
  /** Subscription id passed back to sendSms to bind to this SIM. */
  subscriptionId: number;
  /** Physical slot (0 = SIM 1, 1 = SIM 2). */
  slotIndex: number;
  displayName: string;
  carrierName: string;
  number: string;
}

export interface SmsReaderPlugin {
  checkPermissions(): Promise<SmsPermissionStatus>;
  requestPermissions(): Promise<SmsPermissionStatus>;
  /** Request READ_PHONE_STATE so the SIM picker can list active SIMs. */
  requestPhonePermission(): Promise<SmsPermissionStatus>;
  /** Ask for location, for "Nearby shops" on the expense prompt. */
  requestLocationPermission(): Promise<SmsPermissionStatus & { location?: PermissionState }>;
  /** List active SIM cards. `permissionGranted` is false if READ_PHONE_STATE is missing. */
  getSimCards(): Promise<{ permissionGranted: boolean; sims: SimCard[] }>;
  /** Read recent inbox messages, newest first. `since` = epoch ms lower bound. */
  /** Newest first; `since` is exclusive, `until` inclusive (epoch ms). Older APKs ignore `until`. */
  readInbox(options: { since?: number; until?: number; limit?: number }): Promise<{ messages: SmsMessage[] }>;
  /** Begin emitting `smsReceived` for each incoming message. */
  startWatch(): Promise<void>;
  stopWatch(): Promise<void>;
  /**
   * Send a balance-enquiry SMS to the bank (requires SEND_SMS). Pass
   * `subscriptionId` to send from a specific SIM; omit for the default SIM.
   */
  sendSms(options: { to: string; body: string; subscriptionId?: number }): Promise<void>;
  /** Persist the normalised ignored-sender list so the background receiver skips them. */
  setIgnoredSenders(options: { senders: string[] }): Promise<void>;
  /**
   * Persist the learned-mapping NAMES so the background notification can show a
   * one-tap "Add" action only when BOTH the account and category resolve, and
   * display them. `accountNames` is keyed by normalised sender; `categoryNames`
   * by normalised merchant key (the receiver matches a key found in the body).
   */
  setNotificationMappings(options: {
    accountNames: Record<string, string>;
    /** Card / a/c last digits → account name ("4444" → "HDFC Credit Card"). */
    accountHints?: Record<string, string>;
    categoryNames: Record<string, string>;
    /** Every active category (most used first), for the full-screen prompt's picker. */
    categories?: { id: string; name: string; color: string | null; parentId: string | null }[];
    /** Every active account name (most used first), for the prompt's account picker. */
    accounts?: string[];
    /**
     * AI provider for the full-screen prompt's suggestions, kept on this device
     * only; null turns them off.
     */
    ai?: { kind: string; apiKey: string; model: string; baseUrl: string } | null;
    /** "Nearby shops" on the prompt; googleKey empty = OpenStreetMap. */
    nearby?: { enabled: boolean; googleKey: string };
  }): Promise<void>;
  /**
   * If the app was opened by tapping a background "expense detected"
   * notification, return the SMS that triggered it (and clear it so it is
   * handed out only once). `message` is null otherwise. `autoLog` is true when
   * the user tapped the notification's "Add" action (vs. the body, which opens
   * the review dialog). Lets the app log straight from the notification.
   */
  consumePendingSms(): Promise<{ message: SmsMessage | null; autoLog?: boolean }>;
  /**
   * Drain the pre-approved queue — entries written by the lock-screen Approve
   * button (SmsPromptActivity) and the notification's Approve action (silent,
   * no WebView boot). Each entry carries the original SMS plus the resolved
   * account / category, so the web layer can log the expense without
   * re-prompting. Cleared on read — entries are handed out exactly once.
   */
  consumePreApproved(): Promise<{ entries: PreApprovedEntry[] }>;
  /**
   * Report whether the Expense Detection notification will take over the lock
   * screen on arrival. `supported` is false on web/iOS; `granted` is true on
   * Android ≤ 13 (auto-granted via manifest) and reflects the user's choice on
   * Android 14+ (where Full-screen notifications must be granted per-app).
   */
  canUseFullScreenIntent(): Promise<{ supported: boolean; granted: boolean }>;
  /**
   * Open the system Settings page where Android 14+ users grant Full-screen
   * notifications for Artha. No-op on older OSes.
   */
  openFullScreenIntentSettings(): Promise<void>;
  /** Whether Artha may "Display over other apps" (lets the prompt pop up while the phone is unlocked). */
  canDrawOverlays(): Promise<{ granted: boolean }>;
  /** Bills found in SMS. */
  getBills(): Promise<{ bills: SmsBill[] }>;
  setBillStatus(options: { id: string; status: SmsBill['status'] }): Promise<void>;
  setBillConfig(options: { enabled: boolean; daysBefore: number }): Promise<void>;
  /** Read the last `days` of the inbox for bills; resolves with how many were added or changed. */
  scanBills(options: { days: number }): Promise<{ changed: number }>;
  /** A route to open once (e.g. "/bills" after tapping a bill reminder). */
  consumeOpenRoute(): Promise<{ route: string | null }>;
  /** Read the location now and keep it for this SMS (used when the app is open). */
  captureSmsLocation(options: { address: string; body: string }): Promise<{
    location: { lat: number; lng: number; accuracy?: number | null; at?: number } | null;
  }>;
  /** Scan & Pay: read a UPI QR with the camera. */
  scanUpiQr(): Promise<{ qr?: string | null; cancelled?: boolean }>;
  /** Installed apps that can pay a upi:// link. */
  listUpiApps(): Promise<{ apps: { packageName: string; label: string }[] }>;
  /** Open a UPI app with the payment; resolves when the user comes back. */
  upiPay(options: { uri: string; packageName?: string | null; amount: number }): Promise<{
    resultCode: number;
    response: string | null;
  }>;
  /** A Scan & Pay payment didn't happen: stop skipping the next debit SMS of this amount. */
  upiForget(options: { amount: number }): Promise<void>;
  /** Card vault: scan a card with the camera (read on the phone; the CVV is never read). */
  scanCard(): Promise<{ number?: string | null; expiry?: string | null; name?: string | null; cancelled?: boolean }>;
  /** Card vault: seal / open the vault key with the hardware keystore (right after a fingerprint check). */
  vaultSeal(options: { data: string }): Promise<{ sealed: string }>;
  vaultOpen(options: { sealed: string }): Promise<{ data: string }>;
  vaultForget(): Promise<void>;
  /** Block screenshots and the recents preview (FLAG_SECURE). */
  setSecureScreen(options: { secure: boolean }): Promise<void>;
  /** The phone's location now (Android). */
  getCurrentLocation(): Promise<{
    location: { lat: number; lng: number; accuracy?: number | null; at?: number } | null;
  }>;
  /** Remember that at this spot the user paid `name`, so the alert fills it in next time. */
  rememberPlace(options: { lat: number; lng: number; name: string; categoryId?: string | null }): Promise<void>;
  /** Named shops around a point (OpenStreetMap, or Google Places with the saved key). */
  findNearbyPlaces(options: { lat: number; lng: number }): Promise<{ places: NearbyPlace[] }>;
  /** Location fixes the full-screen alert took, keyed `address|javaHash(body)|body.length`. */
  getSmsLocations(): Promise<{
    locations: Record<string, { lat: number; lng: number; accuracy?: number | null; at?: number; saved?: number }>;
  }>;
  /** Open the system "Display over other apps" page for Artha. */
  openOverlaySettings(): Promise<void>;
  /** Show the sample expense prompt (notification + full-screen alert), optionally after a delay. */
  testSmsPrompt(options: { delaySeconds: number }): Promise<void>;
  /** AI-read expenses from unrecognised SMS (handed out once), plus today's AI checks used. */
  consumeAiFound(): Promise<{ entries: AiFoundEntry[]; usedToday: number }>;
  addListener(
    eventName: 'smsReceived',
    listenerFunc: (message: SmsMessage) => void,
  ): Promise<PluginListenerHandle>;
  /** The AI found an expense in an SMS while the app is open. */
  addListener(eventName: 'aiSmsFound', listenerFunc: () => void): Promise<PluginListenerHandle>;
}

/**
 * Native SMS bridge (Android only). On web/iOS the methods reject with
 * "not implemented" — callers must gate on `Capacitor.getPlatform()`.
 */
export const SmsReader = registerPlugin<SmsReaderPlugin>('SmsReader');
