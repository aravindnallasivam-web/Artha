import { Injectable, computed, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { LoginResponse, User } from './auth.models';

const STORAGE_KEY = 'artha.session';

interface PersistedSession {
  token: string;
  expiresAt: string;
  user: User;
}

@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly sessionSignal = signal<PersistedSession | null>(this.loadFromStorage());

  readonly session = this.sessionSignal.asReadonly();
  readonly isAuthenticated = computed(() => {
    const current = this.sessionSignal();
    if (!current) return false;
    return new Date(current.expiresAt).getTime() > Date.now();
  });
  readonly currentUser = computed(() => this.sessionSignal()?.user ?? null);
  readonly token = computed(() => {
    const current = this.sessionSignal();
    if (!current) return null;
    return new Date(current.expiresAt).getTime() > Date.now() ? current.token : null;
  });

  set(response: LoginResponse): void {
    const session: PersistedSession = {
      token: response.token,
      expiresAt: response.expiresAt,
      user: response.user,
    };
    this.sessionSignal.set(session);
    this.persist(session);
  }

  clear(): void {
    this.sessionSignal.set(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    if (Capacitor.isNativePlatform()) {
      void Preferences.remove({ key: STORAGE_KEY });
    }
  }

  /**
   * Native-only fallback: if the synchronous localStorage probe at construction
   * returned nothing, the WebView may have evicted its localStorage under
   * storage pressure even though the user is still logged in. Capacitor
   * Preferences (NSUserDefaults / SharedPreferences) is durable across that,
   * so we mirror writes there and restore from it at startup.
   *
   * Called from APP_INITIALIZER so the session is in place before the auth
   * guard runs. No-op on web.
   */
  async restoreFromNativeIfNeeded(): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    if (this.sessionSignal() !== null) return;

    try {
      const { value } = await Preferences.get({ key: STORAGE_KEY });
      if (!value) return;
      const parsed = JSON.parse(value) as PersistedSession;
      if (!parsed?.token || !parsed?.expiresAt || !parsed?.user) return;
      if (new Date(parsed.expiresAt).getTime() <= Date.now()) {
        await Preferences.remove({ key: STORAGE_KEY });
        return;
      }
      this.sessionSignal.set(parsed);
      // Repopulate localStorage so subsequent synchronous reads hit it too.
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed)); } catch { /* ignore */ }
    } catch {
      // Quietly ignore — the user will just be asked to sign in again, which
      // is the same fallback localStorage eviction already produces on web.
    }
  }

  private persist(session: PersistedSession): void {
    const json = JSON.stringify(session);
    try {
      localStorage.setItem(STORAGE_KEY, json);
    } catch {
      // ignore storage failures (private mode, quota)
    }
    if (Capacitor.isNativePlatform()) {
      // Fire-and-forget. Preferences I/O is fast on both platforms; if it
      // does fail (unlikely), localStorage still has the session for this
      // app run and the user only loses durability across cold restarts.
      void Preferences.set({ key: STORAGE_KEY, value: json });
    }
  }

  private loadFromStorage(): PersistedSession | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as PersistedSession;
      if (!parsed?.token || !parsed?.expiresAt || !parsed?.user) return null;
      if (new Date(parsed.expiresAt).getTime() <= Date.now()) {
        localStorage.removeItem(STORAGE_KEY);
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }
}
