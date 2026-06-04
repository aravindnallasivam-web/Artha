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
}

export interface SmsReaderPlugin {
  checkPermissions(): Promise<SmsPermissionStatus>;
  requestPermissions(): Promise<SmsPermissionStatus>;
  /** Read recent inbox messages, newest first. `since` = epoch ms lower bound. */
  readInbox(options: { since?: number; limit?: number }): Promise<{ messages: SmsMessage[] }>;
  /** Begin emitting `smsReceived` for each incoming message. */
  startWatch(): Promise<void>;
  stopWatch(): Promise<void>;
  /** Send a balance-enquiry SMS to the bank (requires SEND_SMS). */
  sendSms(options: { to: string; body: string }): Promise<void>;
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
