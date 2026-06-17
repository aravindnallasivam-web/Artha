// On-device exchange of a PKCE authorization code for Google tokens.
//
// This replaces the server's AuthController.Google endpoint. With an installed
// (Android/iOS) OAuth client, the code -> token exchange needs NO client
// secret — just the PKCE verifier — so it can run safely in the app. The
// resulting access + refresh tokens are stored in GoogleTokenStore (used for
// every Drive call); the user profile is read from the returned id_token.

import { Injectable, inject } from '@angular/core';
import { CapacitorHttp } from '@capacitor/core';
import { environment } from '../../../environments/environment';
import { GoogleTokenStore } from '../drive/google-token.store';
import { User } from './auth.models';

const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

export interface ExchangeResult {
  user: User;
  /** ISO expiry of the access token — drives the session lifetime. */
  expiresAt: string;
}

@Injectable({ providedIn: 'root' })
export class GoogleOAuthService {
  private readonly tokens = inject(GoogleTokenStore);

  async exchangeCode(code: string, codeVerifier: string, redirectUri: string): Promise<ExchangeResult> {
    const res = await CapacitorHttp.request({
      method: 'POST',
      url: GOOGLE_TOKEN_ENDPOINT,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: {
        client_id: environment.google.clientId,
        code,
        code_verifier: codeVerifier,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      },
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(describeTokenError(res.data, res.status));
    }

    const body = res.data as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      id_token: string;
      scope?: string;
    };
    const expiresAt = new Date(Date.now() + body.expires_in * 1000).toISOString();
    await this.tokens.set({
      accessToken: body.access_token,
      refreshToken: body.refresh_token ?? null,
      expiresAt,
      scope: body.scope ?? null,
    });

    return { user: userFromIdToken(body.id_token), expiresAt };
  }
}

function userFromIdToken(idToken: string): User {
  const payload = decodeJwtPayload(idToken);
  return {
    id: String(payload['sub'] ?? ''),
    email: String(payload['email'] ?? ''),
    name: String(payload['name'] ?? payload['email'] ?? ''),
    pictureUrl: payload['picture'] ? String(payload['picture']) : undefined,
  };
}

/** Decode a JWT's payload segment (base64url, UTF-8 safe). */
function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const segment = jwt.split('.')[1] ?? '';
  const b64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const utf8 = decodeURIComponent(
    atob(b64)
      .split('')
      .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
      .join(''),
  );
  return JSON.parse(utf8) as Record<string, unknown>;
}

function describeTokenError(data: unknown, status: number): string {
  if (data && typeof data === 'object') {
    const body = data as { error_description?: string; error?: string };
    if (body.error_description || body.error) {
      return `Sign-in failed: ${body.error_description ?? body.error}`;
    }
  }
  return `Sign-in failed (HTTP ${status}).`;
}
