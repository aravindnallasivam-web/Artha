import { Injectable, signal } from '@angular/core';
import { BiometricAuth } from '@aparajita/capacitor-biometric-auth';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';

const ENABLED_KEY = 'artha.appLock';
const AFTER_KEY = 'artha.appLock.after';

/**
 * When to ask again after leaving the app: "start" = only when Artha starts
 * (default), otherwise after this many ms away (0 = every time).
 */
export type LockAfter = 'start' | number;
export const LOCK_AFTER_OPTIONS: { value: LockAfter; label: string }[] = [
  { value: 'start', label: 'Only when Artha starts' },
  { value: 5 * 60_000, label: 'After 5 minutes away' },
  { value: 60_000, label: 'After 1 minute away' },
  { value: 0, label: 'Every time I leave' },
];

/**
 * Optional biometric/device-credential app lock (Android/iOS only).
 *
 * When enabled in Settings, the app is covered by a lock screen on launch and
 * whenever it returns from the background, requiring fingerprint/face (or the
 * device PIN) to continue. No-op on web/desktop, where biometrics aren't
 * available — the app simply never locks.
 */
@Injectable({ providedIn: 'root' })
export class AppLockService {
  private readonly _locked = signal(false);
  /** True while the lock screen should cover the app. */
  readonly locked = this._locked.asReadonly();

  private lifecycleBound = false;
  private prompting = false;
  /** When the app went to the background (0 = in front). */
  private hiddenAt = 0;
  /** Artha itself opened something (camera, UPI app, fingerprint prompt): that's not "leaving". */
  private holds = 0;
  private holdUntil = 0;

  private readonly _lockAfter = signal<LockAfter>(loadLockAfter());
  readonly lockAfter = this._lockAfter.asReadonly();

  setLockAfter(v: LockAfter): void {
    this._lockAfter.set(v);
    try {
      localStorage.setItem(AFTER_KEY, String(v));
    } catch {
      // This session only.
    }
  }

  /**
   * Run something that takes the user out of Artha on its behalf (camera
   * scanner, the UPI app, a permission page) without the lock asking again
   * on return.
   */
  async hold<T>(fn: () => Promise<T>): Promise<T> {
    this.holds++;
    try {
      return await fn();
    } finally {
      this.holds--;
      // The resume event can land just after the call returns.
      this.holdUntil = Date.now() + 2000;
    }
  }

  private held(): boolean {
    return this.holds > 0 || Date.now() < this.holdUntil;
  }

  /** Lock only makes sense on a native device. */
  isSupported(): boolean {
    return Capacitor.isNativePlatform();
  }

  isEnabled(): boolean {
    return this.isSupported() && localStorage.getItem(ENABLED_KEY) === '1';
  }

  /** Whether the device can authenticate (biometry enrolled, or a secure PIN). */
  async isAvailable(): Promise<boolean> {
    if (!this.isSupported()) {
      return false;
    }
    try {
      const info = await BiometricAuth.checkBiometry();
      return info.isAvailable || info.deviceIsSecure;
    } catch {
      return false;
    }
  }

  /**
   * Turn the lock on or off. Enabling first requires a successful auth (so the
   * user can't lock themselves out); returns whether the change took effect.
   */
  async setEnabled(enabled: boolean): Promise<boolean> {
    if (!enabled) {
      localStorage.removeItem(ENABLED_KEY);
      this._locked.set(false);
      return true;
    }
    if (!(await this.authenticate())) {
      return false;
    }
    localStorage.setItem(ENABLED_KEY, '1');
    return true;
  }

  /** Wire startup + background/foreground locking. Call once at app start. */
  async initialize(): Promise<void> {
    if (!this.isSupported()) {
      return;
    }
    this.bindLifecycle();
    if (this.isEnabled()) {
      this._locked.set(true);
      await this.tryUnlock();
    }
  }

  /** Prompt to unlock; clears the lock on success. Used by the overlay's button. */
  async tryUnlock(): Promise<void> {
    if (this.prompting) {
      return;
    }
    this.prompting = true;
    try {
      if (await this.authenticate()) {
        this._locked.set(false);
      }
    } finally {
      this.prompting = false;
    }
  }

  private bindLifecycle(): void {
    if (this.lifecycleBound) {
      return;
    }
    this.lifecycleBound = true;
    void App.addListener('appStateChange', ({ isActive }) => {
      if (!this.isEnabled()) {
        return;
      }
      if (!isActive) {
        if (this.held() || this.prompting) return;
        this.hiddenAt = Date.now();
        // "Every time": cover the app at once (also hides it in the recents view).
        if (this._lockAfter() === 0) this._locked.set(true);
        return;
      }
      const away = this.hiddenAt ? Date.now() - this.hiddenAt : 0;
      this.hiddenAt = 0;
      if (this._locked()) {
        void this.tryUnlock();
        return;
      }
      const after = this._lockAfter();
      if (after !== 'start' && away > 0 && away >= after && !this.held()) {
        this._locked.set(true);
        void this.tryUnlock();
      }
    });
  }

  /** One fingerprint / face / screen-lock check, e.g. to open the card vault. */
  async verify(title: string, subtitle = 'Verify it\'s you'): Promise<boolean> {
    if (!this.isSupported()) return false;
    return this.authenticate(title, subtitle);
  }

  private async authenticate(title = 'Unlock Artha', subtitle = 'Verify to continue'): Promise<boolean> {
    // The fingerprint sheet itself can pause the app on some phones: not "leaving".
    this.holds++;
    try {
      await BiometricAuth.authenticate({
        reason: title,
        cancelTitle: 'Cancel',
        allowDeviceCredential: true,
        androidTitle: title,
        androidSubtitle: subtitle,
        iosFallbackTitle: 'Use passcode',
      });
      return true;
    } catch {
      // Cancelled, failed, or unavailable.
      return false;
    } finally {
      this.holds--;
      this.holdUntil = Date.now() + 2000;
    }
  }
}

function loadLockAfter(): LockAfter {
  try {
    const v = localStorage.getItem(AFTER_KEY);
    if (v === null || v === 'start') return 'start';
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : 'start';
  } catch {
    return 'start';
  }
}
