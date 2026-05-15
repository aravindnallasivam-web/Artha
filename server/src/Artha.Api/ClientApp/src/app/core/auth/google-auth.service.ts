import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { GoogleLoginRequest, LoginResponse } from './auth.models';
import { generateCodeChallenge, generateCodeVerifier, generateState } from './pkce';
import { SessionService } from './session.service';

const PKCE_STORAGE_KEY = 'artha.pkce';
const STATE_STORAGE_KEY = 'artha.oauth.state';

interface PendingFlow {
  codeVerifier: string;
  redirectUri: string;
  state: string;
}

@Injectable({ providedIn: 'root' })
export class GoogleAuthService {
  private readonly http = inject(HttpClient);
  private readonly session = inject(SessionService);
  private mobileListenerAttached = false;

  async beginLogin(): Promise<void> {
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    const state = generateState();

    const isNative = Capacitor.isNativePlatform();
    // Native build redirects through the deployed bridge page, which
    // bounces to the com.artha.app:// custom URL scheme. The Web OAuth
    // client cannot redirect directly to a custom scheme.
    const redirectUri = isNative
      ? `${environment.apiBaseUrl}/auth/callback/mobile`
      : `${window.location.origin}${environment.google.redirectPath}`;

    const pending: PendingFlow = { codeVerifier, redirectUri, state };
    sessionStorage.setItem(PKCE_STORAGE_KEY, JSON.stringify(pending));
    sessionStorage.setItem(STATE_STORAGE_KEY, state);

    const params = new URLSearchParams({
      client_id: environment.google.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: environment.google.scopes.join(' '),
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
    });

    const authUrl = `${environment.google.authEndpoint}?${params.toString()}`;

    if (isNative) {
      this.attachMobileListenerOnce();
      await Browser.open({ url: authUrl, presentationStyle: 'popover' });
      // Browser dismissal happens in the appUrlOpen handler.
    } else {
      window.location.assign(authUrl);
    }
  }

  async completeLogin(code: string, returnedState: string): Promise<LoginResponse> {
    const raw = sessionStorage.getItem(PKCE_STORAGE_KEY);
    if (!raw) {
      throw new Error('Missing PKCE state. Please try signing in again.');
    }
    const pending = JSON.parse(raw) as PendingFlow;
    if (pending.state !== returnedState) {
      throw new Error('OAuth state mismatch. Please try signing in again.');
    }

    const request: GoogleLoginRequest = {
      code,
      codeVerifier: pending.codeVerifier,
      redirectUri: pending.redirectUri,
    };

    const response = await firstValueFrom(
      this.http.post<LoginResponse>(`${environment.apiBaseUrl}/api/auth/google`, request),
    );

    sessionStorage.removeItem(PKCE_STORAGE_KEY);
    sessionStorage.removeItem(STATE_STORAGE_KEY);

    this.session.set(response);
    return response;
  }

  async logout(): Promise<void> {
    if (!this.session.token()) {
      this.session.clear();
      return;
    }
    try {
      await firstValueFrom(
        this.http.post(`${environment.apiBaseUrl}/api/auth/logout`, null),
      );
    } finally {
      this.session.clear();
    }
  }

  /**
   * Native-only: catches the com.artha.app://auth/callback?code=...&state=...
   * deep link emitted by the bridge page, completes login, and dismisses
   * the system browser. Handler is idempotent — safe to call repeatedly.
   */
  private attachMobileListenerOnce(): void {
    if (this.mobileListenerAttached || !Capacitor.isNativePlatform()) return;
    this.mobileListenerAttached = true;

    void App.addListener('appUrlOpen', async (event) => {
      try {
        const url = new URL(event.url);
        if (url.protocol !== 'com.artha.app:') return;
        if (!url.pathname.endsWith('/auth/callback')) return;

        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        if (!code || !state) return;

        await this.completeLogin(code, state);
      } catch {
        // Surfacing is handled by the login UI's error path; keep the
        // listener silent so a malformed deep link doesn't crash the app.
      } finally {
        try { await Browser.close(); } catch { /* already dismissed */ }
      }
    });
  }
}
