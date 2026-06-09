import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import { environment } from '../../../environments/environment';
import { DriveBootstrap } from '../drive/drive-bootstrap.service';
import { DriveCache } from '../drive/drive-cache.service';
import { GoogleTokenStore } from '../drive/google-token.store';
import { LoginResponse } from './auth.models';
import { GoogleOAuthService } from './google-oauth.service';
import { generateCodeChallenge, generateCodeVerifier, generateState } from './pkce';
import { SessionService } from './session.service';

/** Drive sessions are kept alive by silent token refresh, so the session
 *  itself is long-lived; this is just a sane upper bound. */
const SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1000;

const PKCE_STORAGE_KEY = 'artha.pkce';
const STATE_STORAGE_KEY = 'artha.oauth.state';

interface PendingFlow {
  codeVerifier: string;
  redirectUri: string;
  state: string;
}

@Injectable({ providedIn: 'root' })
export class GoogleAuthService {
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);
  private readonly googleOAuth = inject(GoogleOAuthService);
  private readonly googleTokens = inject(GoogleTokenStore);
  private readonly bootstrap = inject(DriveBootstrap);
  private readonly cache = inject(DriveCache);
  private mobileListenerAttached = false;

  /**
   * Last auth failure message, published for the login screen to display.
   * The mobile OAuth flow finishes asynchronously inside the appUrlOpen
   * listener — detached from the component that started it — so failures are
   * surfaced here instead of leaving the button stuck on "Redirecting…".
   */
  readonly authError = signal<string | null>(null);

  async beginLogin(): Promise<void> {
    this.authError.set(null);
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    const state = generateState();

    const isNative = Capacitor.isNativePlatform();
    // Serverless: the Android OAuth client redirects straight to the app's
    // custom URL scheme — no server bridge. Web (dev) still uses an origin URL.
    const redirectUri = isNative
      ? environment.google.nativeRedirectUri
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
      this.initializeMobileAuthListener();
      await Browser.open({ url: authUrl, presentationStyle: 'popover' });
      // Browser dismissal happens in the appUrlOpen handler.
    } else {
      window.location.assign(authUrl);
    }
  }

  /**
   * Native-only: registers the appUrlOpen listener that catches the OAuth
   * deep link. Idempotent. Wired from APP_INITIALIZER so the listener is
   * in place even if the OS launches the app cold via the deep link.
   */
  initializeMobileAuthListener(): void {
    if (this.mobileListenerAttached || !Capacitor.isNativePlatform()) return;
    this.mobileListenerAttached = true;

    // The OAuth response comes back on the configured redirect scheme (the
    // reversed-client-id custom scheme for Android/iOS clients). Match by that
    // scheme rather than a hardcoded one, and pull code/state from the raw
    // query so we don't depend on URL parsing of non-standard schemes.
    const redirectScheme = environment.google.nativeRedirectUri.split(':')[0].toLowerCase() + ':';

    void App.addListener('appUrlOpen', async (event) => {
      if (!event.url.toLowerCase().startsWith(redirectScheme)) return;
      try {
        const queryStart = event.url.indexOf('?');
        const params = new URLSearchParams(queryStart >= 0 ? event.url.slice(queryStart + 1) : '');
        const code = params.get('code');
        const state = params.get('state');
        if (!code || !state) return;

        await this.completeLogin(code, state);
        await this.router.navigate(['/dashboard']);
      } catch (err) {
        // This runs detached from the login component, so publish the failure
        // for the login UI to display instead of hanging on "Redirecting…".
        this.authError.set(describeAuthError(err));
      } finally {
        try { await Browser.close(); } catch { /* already dismissed */ }
      }
    });
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

    // Exchange the code for Google tokens on-device (no server, no secret).
    const result = await this.googleOAuth.exchangeCode(
      code,
      pending.codeVerifier,
      pending.redirectUri,
    );

    sessionStorage.removeItem(PKCE_STORAGE_KEY);
    sessionStorage.removeItem(STATE_STORAGE_KEY);

    // The session just marks "signed in"; Drive calls authorize via the token
    // store (which refreshes silently), so the session can be long-lived.
    const response: LoginResponse = {
      token: 'google-drive',
      expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
      user: result.user,
    };
    this.session.set(response);
    return response;
  }

  async logout(): Promise<void> {
    // Local-only sign-out: drop the Google tokens, reset the first-run guard,
    // and clear the session. (Tokens can be fully revoked from the user's
    // Google account settings.)
    await this.cache.clear();
    await this.googleTokens.clear();
    this.bootstrap.reset();
    this.session.clear();
  }

}

/**
 * Turn an auth failure into a message the user can act on. A status of 0 from
 * HttpClient means the request never got a usable response — typically a
 * network drop or a CORS rejection (the app's https://localhost origin not
 * being allowed by the API). Server ProblemDetails carry a human-readable
 * detail/title we can show directly.
 */
function describeAuthError(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    if (err.status === 0) {
      return 'Could not reach the server — this is usually a network or CORS issue. Please try again.';
    }
    const body = err.error as { detail?: string; title?: string } | string | null;
    if (body && typeof body === 'object') {
      return body.detail ?? body.title ?? `Sign-in failed (HTTP ${err.status}).`;
    }
    return `Sign-in failed (HTTP ${err.status}).`;
  }
  if (err instanceof Error) return err.message;
  return 'Sign-in failed. Please try again.';
}
