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
  /** List active SIM cards. `permissionGranted` is false if READ_PHONE_STATE is missing. */
  getSimCards(): Promise<{ permissionGranted: boolean; sims: SimCard[] }>;
  /** Read recent inbox messages, newest first. `since` = epoch ms lower bound. */
  readInbox(options: { since?: number; limit?: number }): Promise<{ messages: SmsMessage[] }>;
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
   * If the app was opened by tapping a background "expense detected"
   * notification, return the SMS that triggered it (and clear it so it is
   * handed out only once). `message` is null otherwise. Lets the app open the
   * confirm dialog straight from the notification instead of re-scanning.
   */
  consumePendingSms(): Promise<{ message: SmsMessage | null }>;
  addListener(
    eventName: 'smsReceived',
    listenerFunc: (message: SmsMessage) => void,
  ): Promise<PluginListenerHandle>;
}

/**
 * Native SMS bridge (Android only). On web/iOS the methods reject with
 * "not implemented" — callers must gate on `Capacitor.getPlatform()`.
 */
export const SmsReader = registerPlugin<SmsReaderPlugin>('SmsReader');
