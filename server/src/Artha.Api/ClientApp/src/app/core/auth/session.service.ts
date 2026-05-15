import { Injectable, computed, signal } from '@angular/core';
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
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } catch {
      // ignore storage failures (private mode, quota)
    }
  }

  clear(): void {
    this.sessionSignal.set(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
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
