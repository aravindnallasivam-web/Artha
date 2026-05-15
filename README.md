# Artha

A personal expense-management workspace built on the principle of **data sovereignty**: your expense data lives in your own Google Drive, not on our servers.

## Stack

| Layer | Tech |
|---|---|
| Backend | ASP.NET Core Web API on **.NET 10** |
| Web client | **Angular 21** (standalone components, signals, zoneless) |
| Mobile client | **Ionic + Capacitor** wrapping the same Angular codebase (iOS + Android) |
| Auth | **Google Sign-In** (OAuth 2.0 / OIDC with PKCE) |
| Storage | **Per-user Google Drive** (`drive.appdata` scope, JSON files) |

## Repository layout

```
/server          ASP.NET Core 10 solution
  Artha.sln
  global.json
  Directory.Build.props
  Directory.Packages.props      (Central Package Management)
  /src
    Artha.Api                   composition root, controllers, DI wiring
    Artha.Core                  domain models, DTOs, interfaces
    Artha.Auth                  Google OIDC exchange, JWT issuer, token store
    Artha.Drive                 (M2) Drive client + appdata repository
    Artha.Infrastructure        Serilog, caching, options helpers
  /tests                        xunit + FluentAssertions + NSubstitute
/client          Angular + Ionic + Capacitor workspace
  capacitor.config.ts           appId = com.artha.app
  /src
    /environments               environment.ts / environment.prod.ts
    /app
      app.config.ts             provideRouter, provideHttpClient, interceptors
      app.routes.ts             lazy-loaded standalone routes
      /core/auth                pkce, session, google-auth, guard, interceptor
      /features/auth            login, callback components
      /features/dashboard       placeholder post-login screen
/docs
/.github/workflows
```

## Milestones

| | Scope | Status |
|---|---|---|
| **M1** | Solution scaffold + Google login end-to-end (web) | ✅ Done |
| **M2** | Drive integration + Expense CRUD (web) | Planned |
| **M3** | Categories + monthly reports | Planned |
| **M4** | Capacitor iOS + Android builds | Planned |
| **M5** | Polish: settings, multi-currency, Apple Sign-In, export | Planned |

## Local development

### Prerequisites

- .NET 10 SDK
- Node.js 22 + npm 10
- A Google Cloud Console project with an **OAuth 2.0 Web client ID** and **Drive API** enabled

### Configure secrets

Edit `server/src/Artha.Api/appsettings.json` (or better, use User Secrets):

```bash
cd server/src/Artha.Api
dotnet user-secrets set "GoogleAuth:ClientId" "<your-google-web-client-id>"
dotnet user-secrets set "GoogleAuth:ClientSecret" "<your-google-web-client-secret>"
dotnet user-secrets set "Jwt:SigningKey" "<a-long-random-string-of-32+-chars>"
```

In Google Cloud Console, set the **authorized redirect URI** for the Web client to:

```
http://localhost:4200/auth/callback
```

Then update `client/src/environments/environment.ts` with the same `google.clientId`.

### Run

```bash
# Terminal 1 — API
cd server
dotnet run --project src/Artha.Api

# Terminal 2 — Web client
cd client
npm start
```

Open <http://localhost:4200> → click "Sign in with Google" → after consent you'll land on the placeholder dashboard.

### Tests

```bash
cd server && dotnet test
cd client && npm test
```

## How the auth flow works

1. Client generates PKCE `code_verifier` and `code_challenge`, redirects to Google's authorize endpoint with scopes `openid email profile drive.appdata`.
2. Google redirects back to `/auth/callback?code=...&state=...`.
3. Client POSTs `{ code, codeVerifier, redirectUri }` to `/api/auth/google`.
4. Server exchanges the code with Google for an access token + refresh token, validates the returned ID token, encrypts and stores the Drive tokens server-side (keyed by user id), and issues an Artha session JWT.
5. Client stores the JWT in `localStorage` (web) and attaches it as `Authorization: Bearer …` on subsequent API calls.
6. Drive tokens never leave the server — the server proxies all Drive operations on behalf of the user.

## Hosting on DigitalOcean App Platform

The repo is wired for DO App Platform with both components on **one domain** (no CORS in production). Spec lives at `.do/app.yaml`.

```
https://<your-app>.ondigitalocean.app
├── /             →  Angular SPA (static site, free tier)
└── /api/*        →  .NET 10 API (Basic web service, ~$5/mo)
```

### One-time setup

1. **Create a Google OAuth Web client** in Google Cloud Console (APIs & Services → Credentials):
   - Enable the **Google Drive API** on the project.
   - Add **Authorized redirect URI**: `https://<your-app>.ondigitalocean.app/auth/callback`
     (you can update this after step 4 — for now use a placeholder and come back).
   - Copy the **Client ID** and **Client secret**.

2. **Update both env files** with your Web Client ID (do NOT commit the secret — that goes into DO):
   - `client/src/environments/environment.ts`
   - `client/src/environments/environment.prod.ts`

   Commit + push.

3. **Generate a JWT signing key** — any random string of 32+ characters. Example:
   ```bash
   openssl rand -base64 48
   ```

4. **Create the app** on DigitalOcean — either path:

   **A. Dashboard** (easiest):
   - Apps → **Create App** → choose **GitHub** as source → pick `aravindnallasivam-web/Artha` → branch `main`.
   - DO will auto-detect `.do/app.yaml`. Click "Edit Plan" if you want to confirm the components.
   - Before first deploy, go to **Settings → Components → `api` → Environment Variables** and set:
     - `GoogleAuth__ClientId` (encrypted) — your Google Web Client ID
     - `GoogleAuth__ClientSecret` (encrypted) — your Google Web Client secret
     - `Jwt__SigningKey` (encrypted) — the random string from step 3

   **B. CLI** (if you have `doctl` installed):
   ```bash
   doctl apps create --spec .do/app.yaml
   doctl apps update <APP_ID> --spec .do/app.yaml
   # then set secrets in the dashboard, or via `doctl apps update` with --env
   ```

5. **After first deploy**, copy the app's URL (e.g. `https://artha-abc12.ondigitalocean.app`) and:
   - Update the Google OAuth client's redirect URI to `https://artha-abc12.ondigitalocean.app/auth/callback`.
   - (Optional) point a custom domain at the app in **Settings → Domains** — DO will issue a Let's Encrypt cert automatically.

### What gets billed

| Component | Plan | Monthly |
|---|---|---|
| `api` web service | `apps-s-1vcpu-0.5gb` | ~$5 |
| `web` static site | Free tier | $0 |
| Bandwidth | First 100 GB free | $0 (typical) |

You can scale the API up later (`apps-s-1vcpu-1gb`, etc.) without changing anything in this repo — just edit the plan in the dashboard.

### Pushing changes

Once the app is created, every push to `main` triggers a deploy automatically (`deploy_on_push: true` in the spec). Build logs show in **Activity → Deployments**.

## Mobile (planned for M4)

Capacitor is already configured in `client/capacitor.config.ts` with `appId = com.artha.app`. To build native projects:

```bash
cd client
npm run build
npx cap add ios
npx cap add android
npx cap sync
npx cap open ios     # opens Xcode
npx cap open android # opens Android Studio
```

The same PKCE flow will work in mobile via `@capacitor/browser` (SFSafariViewController / Chrome Custom Tabs) and a custom URL scheme `com.artha.app://auth/callback`, captured by `@capacitor/app`'s `appUrlOpen` listener.
