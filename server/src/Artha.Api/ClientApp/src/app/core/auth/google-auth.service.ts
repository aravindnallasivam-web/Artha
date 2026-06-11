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
import { getElectron } from '../native/electron-bridge';
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
  private electronListenerAttached = false;

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
    // Durable storage: returning from the OAuth browser can recreate the
    // WebView, which would wipe sessionStorage and lose the PKCE verifier.
    localStorage.setItem(PKCE_STORAGE_KEY, JSON.stringify(pending));
    localStorage.setItem(STATE_STORAGE_KEY, state);

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
    } else if (getElectron()) {
      // Desktop: Google blocks sign-in inside Electron's webview, so open the
      // user's real browser. The redirect (to <origin>/auth/callback) is caught
      // by the Electron main process and returned to us over IPC.
      this.initializeElectronAuthListener();
      await getElectron()!.openExternal(authUrl);
    } else {
      window.location.assign(authUrl);
    }
  }

  /**
   * Desktop-only: receive the OAuth redirect captured by the Electron main
   * process (electron/main.js) and finish the login. Idempotent; also wired
   * from APP_INITIALIZER so a redirect is never missed.
   */
  initializeElectronAuthListener(): void {
    if (this.electronListenerAttached) return;
    const electron = getElectron();
    if (!electron) return;
    this.electronListenerAttached = true;

    electron.onOAuthCallback((payload) => {
      if (payload.error) {
        this.authError.set(
          `Google sign-in didn't complete (${payload.error}). Please try again.`,
        );
        return;
      }
      if (!payload.code || !payload.state) return;
      void this.completeLogin(payload.code, payload.state)
        .then(() => this.router.navigate(['/dashboard']))
        .catch((err) => this.authError.set(describeAuthError(err)));
    });
  }

  /**
   * Native-only: registers the appUrlOpen listener that catches the OAuth
   * deep link. Idempotent. Wired from APP_INITIALIZER so the listener is
   * in place even if the OS launches the app cold via the deep link.
   */
  initializeMobileAuthListener(): void {
    if (this.mobileListenerAttached || !Capacitor.isNativePlatform()) return;
    this.mobileListenerAttached = true;

    // Warm path: the OAuth response deep-links back while the app is alive.
    void App.addListener('appUrlOpen', (event) => {
      void this.handleRedirectUrl(event.url);
    });
    // Cold path: the redirect may have launched the app before this listener
    // attached, so process the launch URL too (no-op on a normal launch).
    void App.getLaunchUrl()
      .then((res) => {
        if (res?.url) {
          void this.handleRedirectUrl(res.url);
        }
      })
      .catch(() => undefined);
  }

  /** Scheme prefix the OAuth redirect comes back on, e.g. "com.google…:". */
  private redirectScheme(): string {
    return environment.google.nativeRedirectUri.split(':')[0].toLowerCase() + ':';
  }

  /**
   * Handle an inbound OAuth redirect URL (from appUrlOpen or the launch URL):
   * exchange the code and navigate, surfacing any error/cancel to the login UI.
   */
  private async handleRedirectUrl(url: string): Promise<void> {
    if (!url || !url.toLowerCase().startsWith(this.redirectScheme())) {
      return;
    }
    const queryStart = url.indexOf('?');
    const params = new URLSearchParams(queryStart >= 0 ? url.slice(queryStart + 1) : '');
    const oauthError = params.get('error');
    if (oauthError) {
      this.authError.set(`Google sign-in didn't complete (${oauthError}). Please try again.`);
      try { await Browser.close(); } catch { /* already dismissed */ }
      return;
    }
    const code = params.get('code');
    const state = params.get('state');
    if (!code || !state) {
      return;
    }
    try {
      await this.completeLogin(code, state);
      await this.router.navigate(['/dashboard']);
    } catch (err) {
      // Detached from the login component — publish the failure for the UI.
      this.authError.set(describeAuthError(err));
    } finally {
      try { await Browser.close(); } catch { /* already dismissed */ }
    }
  }

  async completeLogin(code: string, returnedState: string): Promise<LoginResponse> {
    const raw = localStorage.getItem(PKCE_STORAGE_KEY);
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

    localStorage.removeItem(PKCE_STORAGE_KEY);
    localStorage.removeItem(STATE_STORAGE_KEY);

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
