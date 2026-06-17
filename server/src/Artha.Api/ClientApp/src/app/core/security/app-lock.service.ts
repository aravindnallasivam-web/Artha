import { Injectable, signal } from '@angular/core';
import { BiometricAuth } from '@aparajita/capacitor-biometric-auth';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';

const ENABLED_KEY = 'artha.appLock';

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
        // Going to the background — lock so the app is covered on return.
        this._locked.set(true);
      } else if (this._locked()) {
        void this.tryUnlock();
      }
    });
  }

  private async authenticate(): Promise<boolean> {
    try {
      await BiometricAuth.authenticate({
        reason: 'Unlock Artha',
        cancelTitle: 'Cancel',
        allowDeviceCredential: true,
        androidTitle: 'Unlock Artha',
        androidSubtitle: 'Verify to continue',
        iosFallbackTitle: 'Use passcode',
      });
      return true;
    } catch {
      // Cancelled, failed, or unavailable.
      return false;
    }
  }
}
