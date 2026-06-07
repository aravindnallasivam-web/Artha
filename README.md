# Artha

A personal expense-management app built on **data sovereignty**: your data lives
in *your* Google Drive, and the app talks to Drive directly. There is no Artha
backend — nothing sits between your device and your data.

## Stack

| Layer | Tech |
|---|---|
| App | **Angular 21** (standalone, signals, zoneless) + **Ionic + Capacitor** (Android / iOS) |
| Auth | **Google Sign-In** — OAuth 2.0 / OIDC with **PKCE, no client secret** (installed-app flow) |
| Storage | **Your Google Drive** (`drive.appdata` scope) — plain JSON files |
| Networking | **CapacitorHttp** straight to the Google Drive REST API (native, CORS-free) |

Serverless and mobile-first: the WebView reads and writes the Drive `appDataFolder`
itself. The app can only see data it created — the `drive.appdata` scope is
private to Artha.

## Repository layout

```
/server/src/Artha.Api/ClientApp        the app (path kept for Capacitor/CI stability)
  capacitor.config.ts                  appId = com.artha.app
  android/  ios/                        native projects
  /src
    /environments                      environment.ts / .prod.ts / .mobile.ts
    /app
      /core
        /auth                          pkce, session, guard, google-auth, google-oauth
        /drive                         the Drive layer (see below)
        /models                        Expense, Category, Account, PlannedExpense, …
      /features                        expenses, categories, accounts, planned, reports,
                                       settings, sms, dashboard
/.github/workflows
  android.yml                          builds the debug APK artifact
  ci.yml                               type-checks + builds the SPA
```

### The Drive layer (`src/app/core/drive`)

Everything that was server-side now runs on-device here:

| File | Role |
|---|---|
| `drive-rest.client.ts` | Drive v3 REST over `appDataFolder` (CapacitorHttp) |
| `app-data.repository.ts` | typed read/write + `headRevisionId` optimistic concurrency + schema guard |
| `drive-schema.ts` | file names, document shapes, monthly-shard helpers |
| `drive-bootstrap.service.ts` | first-run seeding (accounts/categories/settings/manifest) |
| `google-token.store.ts` | durable Google token storage + silent refresh (no secret) |

Each feature has a `*.drive.ts` service (the former controller logic). The
`*.api.ts` files are thin pass-throughs to those, so feature stores are unaware
of the transport.

### Drive file layout (per user, in `appDataFolder`)

```
manifest.json                  index of expense shards
settings.json                  currency, locale, first-run flag
categories.json                category list
accounts.json                  financial accounts
planned-expenses.json          recurring/budget items
expenses-YYYY-MM.json          one shard per month
```

## How sign-in works (serverless)

1. The app generates a PKCE `code_verifier` / `code_challenge` and opens Google's
   authorize URL (scopes `openid email profile drive.appdata`) in the system
   browser.
2. Google redirects to `com.artha.app://auth/callback?code=…` — caught by the
   app's deep-link handler (no server bridge).
3. The app exchanges the code for tokens **directly at Google's token endpoint
   with no client secret** (`GoogleOAuthService`), and stores the access +
   refresh tokens (`GoogleTokenStore`).
4. The user profile comes from the returned `id_token`. The session is
   long-lived; the access token refreshes silently in the background.
5. Every Drive call attaches `Authorization: Bearer <access token>`.

## Google Cloud Console setup (required)

The token exchange runs on-device, so it needs an **installed-app** OAuth client:

1. APIs & Services → Credentials → **Create OAuth client ID** → type **Android**
   (package `com.artha.app` + your signing SHA-1). Enable the **Drive API**.
2. Put the client ID in
   [`environment.mobile.ts`](server/src/Artha.Api/ClientApp/src/environments/environment.mobile.ts)
   → `google.clientId`.
3. Allow the redirect `com.artha.app://auth/callback` (`google.nativeRedirectUri`).
   It must match the `<intent-filter>` already in `AndroidManifest.xml`.

> Android/iOS OAuth clients use PKCE **without** a secret — that's what makes the
> serverless exchange possible. (A "Web" client would require a secret and can't
> be used from a public mobile binary.)

## Local development

Prerequisites: **Node.js 22 + npm 10**. (No .NET, no server.)

```bash
cd server/src/Artha.Api/ClientApp
npm ci
npm start            # ng serve at http://localhost:4200
```

Note: the OAuth flow targets the native custom-scheme redirect, so end-to-end
sign-in is exercised on a device/emulator, not the browser dev server.

### Build & run on Android

```bash
cd server/src/Artha.Api/ClientApp
npm run cap:sync            # ng build --configuration mobile && cap sync
npm run cap:open:android    # Android Studio → run on device/emulator
```

A debug APK is also produced by the `android.yml` GitHub Action on every push.

### Tests

```bash
cd server/src/Artha.Api/ClientApp && npm test    # vitest
```
