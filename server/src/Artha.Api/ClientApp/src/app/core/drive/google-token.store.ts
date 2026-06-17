// Holds the Google OAuth tokens the app uses to call Drive directly.
//
// In the serverless model the device talks to Google Drive itself, so it needs
// a live access token. This store persists the access + refresh tokens
// (durably, via Capacitor Preferences) and transparently refreshes the access
// token when it is near expiry — using the refresh-token grant against
// Google's token endpoint with NO client secret, which is valid for installed
// (Android/iOS) OAuth client types.
//
// The sign-in flow (GoogleAuthService) populates this via set(); everything
// that reads Drive depends only on getAccessToken().

import { Injectable } from '@angular/core';
import { CapacitorHttp } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { environment } from '../../../environments/environment';

const STORAGE_KEY = 'artha.drive.tokens';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
/** Refresh this many ms before the token actually expires. */
const EXPIRY_SKEW_MS = 60_000;

export interface GoogleTokens {
  accessToken: string;
  /** Absent if Google didn't return one (e.g. the user didn't re-consent). */
  refreshToken: string | null;
  /** ISO timestamp when the access token expires. */
  expiresAt: string;
  /** Space-separated scopes Google actually granted (from the token response). */
  scope?: string | null;
}

@Injectable({ providedIn: 'root' })
export class GoogleTokenStore {
  private tokens: GoogleTokens | null = null;
  private loaded = false;
  private refreshInFlight: Promise<string> | null = null;

  /** Store tokens captured during sign-in. */
  async set(tokens: GoogleTokens): Promise<void> {
    this.tokens = tokens;
    this.loaded = true;
    await Preferences.set({ key: STORAGE_KEY, value: JSON.stringify(tokens) });
  }

  async clear(): Promise<void> {
    this.tokens = null;
    this.loaded = true;
    await Preferences.remove({ key: STORAGE_KEY });
  }

  /** True if we have any stored tokens (not necessarily unexpired). */
  async hasTokens(): Promise<boolean> {
    await this.ensureLoaded();
    return this.tokens !== null;
  }

  /** Whether the current grant includes a given OAuth scope (full URL or suffix). */
  async hasScope(scope: string): Promise<boolean> {
    await this.ensureLoaded();
    const granted = (this.tokens?.scope ?? '').split(/\s+/).filter(Boolean);
    return granted.some((s) => s === scope || s.endsWith('/' + scope));
  }

  /** A valid access token, refreshing first if it is expired or near expiry. */
  async getAccessToken(): Promise<string> {
    await this.ensureLoaded();
    const current = this.tokens;
    if (!current) {
      throw new Error('Not signed in to Google Drive.');
    }
    const expiresMs = new Date(current.expiresAt).getTime();
    if (Date.now() < expiresMs - EXPIRY_SKEW_MS) {
      return current.accessToken;
    }
    // Coalesce concurrent refreshes so a burst of Drive calls triggers one.
    this.refreshInFlight ??= this.refresh(current).finally(() => {
      this.refreshInFlight = null;
    });
    return this.refreshInFlight;
  }

  private async refresh(current: GoogleTokens): Promise<string> {
    if (!current.refreshToken) {
      throw new Error('Your session expired. Please sign in again.');
    }
    const res = await CapacitorHttp.request({
      method: 'POST',
      url: GOOGLE_TOKEN_ENDPOINT,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: {
        client_id: environment.google.clientId,
        grant_type: 'refresh_token',
        refresh_token: current.refreshToken,
      },
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Token refresh failed (HTTP ${res.status}).`);
    }
    const body = res.data as {
      access_token: string;
      expires_in: number;
      refresh_token?: string;
      scope?: string;
    };
    const next: GoogleTokens = {
      accessToken: body.access_token,
      // Google usually omits a fresh refresh_token on refresh — keep the old one.
      refreshToken: body.refresh_token ?? current.refreshToken,
      expiresAt: new Date(Date.now() + body.expires_in * 1000).toISOString(),
      // Refresh responses usually omit scope — keep what was granted at consent.
      scope: body.scope ?? current.scope ?? null,
    };
    await this.set(next);
    return next.accessToken;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) {
      return;
    }
    try {
      const { value } = await Preferences.get({ key: STORAGE_KEY });
      this.tokens = value ? (JSON.parse(value) as GoogleTokens) : null;
    } catch {
      this.tokens = null;
    } finally {
      this.loaded = true;
    }
  }
}
