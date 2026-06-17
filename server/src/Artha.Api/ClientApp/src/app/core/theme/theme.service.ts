// App theme (Light / Dark / System).
//
// Dark mode is applied by toggling the `.ion-palette-dark` class on <html>
// (Ionic's class palette + our Artha tokens both key off it). This service owns
// that class: it resolves the effective theme from the user's preference and,
// when the preference is "system", follows the OS and reacts to live changes.
//
// The preference is persisted in localStorage (read synchronously to avoid a
// flash) and mirrored to Capacitor Preferences for durability on device.

import { Injectable, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

export type ThemePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'artha.theme';
const DARK_CLASS = 'ion-palette-dark';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly media =
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null;

  private readonly _preference = signal<ThemePreference>(this.loadFromStorage());
  /** The user's chosen mode: system | light | dark. */
  readonly preference = this._preference.asReadonly();

  /** True when dark is currently applied (resolved value). */
  readonly isDark = signal<boolean>(false);

  constructor() {
    this.apply(this._preference());
    // Follow the OS while in "system" mode.
    this.media?.addEventListener('change', () => {
      if (this._preference() === 'system') {
        this.apply('system');
      }
    });
  }

  setPreference(preference: ThemePreference): void {
    this._preference.set(preference);
    this.apply(preference);
    this.persist(preference);
  }

  private apply(preference: ThemePreference): void {
    const dark = preference === 'dark' || (preference === 'system' && (this.media?.matches ?? false));
    this.isDark.set(dark);
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle(DARK_CLASS, dark);
    }
  }

  private persist(preference: ThemePreference): void {
    try {
      localStorage.setItem(STORAGE_KEY, preference);
    } catch {
      // ignore (private mode / quota)
    }
    if (Capacitor.isNativePlatform()) {
      void Preferences.set({ key: STORAGE_KEY, value: preference });
    }
  }

  private loadFromStorage(): ThemePreference {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw === 'light' || raw === 'dark' || raw === 'system') {
        return raw;
      }
    } catch {
      // ignore
    }
    return 'system';
  }
}
