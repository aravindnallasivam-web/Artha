import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
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

  async beginLogin(): Promise<void> {
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    const state = generateState();
    const redirectUri = `${window.location.origin}${environment.google.redirectPath}`;

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

    window.location.assign(`${environment.google.authEndpoint}?${params.toString()}`);
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
}
