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

Single .NET app — the API and the Angular SPA ship as one process.

```
/server                              ASP.NET Core 10 solution
  Artha.slnx
  global.json
  Directory.Build.props
  Directory.Packages.props           (Central Package Management)
  Dockerfile                         multi-stage: Node 22 + .NET 10 -> single image
  /src
    Artha.Api                        composition root, controllers, DI wiring
      /ClientApp                     Angular 21 + Ionic 8 + Capacitor 8
        capacitor.config.ts          appId = com.artha.app
        proxy.conf.json              dev: /api/* proxied to .NET on :5239
        /src
          /environments              environment.ts / environment.prod.ts
          /app
            app.config.ts            provideRouter, provideHttpClient, interceptors
            app.routes.ts            lazy-loaded standalone routes
            /core/auth               pkce, session, google-auth, guard, interceptor
            /features/auth           login, callback components
            /features/dashboard      placeholder post-login screen
      /wwwroot                       (populated at publish time from ClientApp/dist)
    Artha.Core                       domain models, DTOs, interfaces
    Artha.Auth                       Google OIDC exchange, JWT issuer, token store
    Artha.Drive                      (M2) Drive client + appdata repository
    Artha.Infrastructure             Serilog, caching, options helpers
  /tests                             xunit + FluentAssertions + NSubstitute
/.do/app.yaml                        DigitalOcean App Platform spec
/scripts/deploy-do.sh                One-command deploy via doctl + .env
/.env.example                        Template for local deploy secrets
/.github/workflows
```

At runtime the single .NET process serves both:

```
GET /api/*    -> ASP.NET Core controllers
GET /*        -> Angular static files (with SPA fallback to /index.html)
```

## Milestones

| | Scope | Status |
|---|---|---|
| **M1** | Solution scaffold + Google login end-to-end (web) | ✅ Done |
| **M2** | Drive integration + Expense CRUD (web) | Planned |
| **M3** | Categories + monthly reports | Planned |
| **M4** | Capacitor iOS + Android builds | In progress (scaffold landed) |
| **M5** | Polish: settings, multi-currency, Apple Sign-In, export | Planned |

## Local development

### Prerequisites

- .NET 10 SDK
- Node.js 22 + npm 10
- A Google Cloud Console project with an **OAuth 2.0 Web client ID** and **Drive API** enabled

### Configure secrets (one-time)

```bash
cd server/src/Artha.Api
dotnet user-secrets set "GoogleAuth:ClientSecret" "<your-google-web-client-secret>"
dotnet user-secrets set "Jwt:SigningKey" "$(openssl rand -base64 48)"
```

The **Client ID** is already in `appsettings.json` (it's public). In Google Cloud Console, add this **authorized redirect URI** to your Web OAuth client:

```
http://localhost:4200/auth/callback
```

### Run

Two terminals, but you only need to remember one command in each:

```bash
# Terminal 1 — Angular dev server (HMR + dev-mode /api proxy to the .NET port)
cd server/src/Artha.Api/ClientApp
npm start                                  # http://localhost:4200

# Terminal 2 — .NET API
cd server
dotnet run --project src/Artha.Api          # http://localhost:5239
```

Open <http://localhost:4200> → "Sign in with Google" → land on the dashboard. The Angular dev server proxies `/api/*` calls to the .NET process automatically (see `ClientApp/proxy.conf.json`).

To preview the **production single-process build** locally:

```bash
cd server
dotnet publish src/Artha.Api -c Release -o /tmp/artha-publish
cd /tmp/artha-publish
Jwt__SigningKey="$(openssl rand -base64 48)" \
GoogleAuth__ClientSecret="<your-secret>" \
ASPNETCORE_URLS=http://localhost:8088 \
dotnet Artha.Api.dll
# now everything is at http://localhost:8088 — SPA at /, API at /api/*
```

### Tests

```bash
cd server && dotnet test                                 # xunit (server)
cd server/src/Artha.Api/ClientApp && npm test            # vitest (SPA)
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

### Fast path: one command via `doctl` + `.env`

If you have [`doctl`](https://docs.digitalocean.com/reference/doctl/how-to/install/) installed, the whole deploy is one command:

```bash
cp .env.example .env
# edit .env — fill in GOOGLE_CLIENT_SECRET and JWT_SIGNING_KEY
#   (Client ID is already in .do/app.yaml; it's public and safe to commit.)
#   Generate JWT_SIGNING_KEY with: openssl rand -base64 48

doctl auth init                  # one-time; paste an API token from
                                 # https://cloud.digitalocean.com/account/api/tokens
./scripts/deploy-do.sh           # creates (or updates) the app, waits for it to deploy
```

The script renders a temp copy of `.do/app.yaml` with your secrets substituted in (file is `chmod 600` and deleted on exit), then runs `doctl apps create --spec` (or `apps update` if the app already exists).

When it finishes it prints the app URL — add `<that-url>/auth/callback` to your Google OAuth client's authorized redirect URIs and you're done.

### Manual path (dashboard clicks)

If you'd rather use the DO web UI:

1. **Create a Google OAuth Web client** in Google Cloud Console (APIs & Services → Credentials):
   - Enable the **Google Drive API** on the project.
   - Add **Authorized redirect URI**: `https://<your-app>.ondigitalocean.app/auth/callback`
     (you can update this after step 4 — for now use a placeholder and come back).
   - Copy the **Client ID** and **Client secret**.

2. **The Client ID is already wired in** at `.do/app.yaml`, `server/src/Artha.Api/appsettings.json`, and `server/src/Artha.Api/ClientApp/src/environments/{environment.ts,environment.prod.ts}`. If you create a different OAuth client, update all four — they each contain the same `952436597649-…` Client ID string.

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

## Mobile (M4 — Capacitor)

The Capacitor scaffold is committed: `appId = com.artha.app`, `webDir = dist/client/browser`, both `ios/` and `android/` native projects are present.

### 1. Point the mobile bundle at your deployed API

Edit [`src/environments/environment.mobile.ts`](server/src/Artha.Api/ClientApp/src/environments/environment.mobile.ts) and set `apiBaseUrl` to your deployed DigitalOcean URL (e.g. `https://artha-abc12.ondigitalocean.app`). Same-origin won't work on mobile — the WebView serves from `capacitor://localhost`, so all API calls must be absolute. CORS for `capacitor://localhost` and `ionic://localhost` is already allowed in `Program.cs`.

### 2. Build the mobile web bundle + sync

```bash
cd server/src/Artha.Api/ClientApp
npm run cap:sync       # = ng build --configuration mobile && cap sync
```

This swaps `environment.ts` → `environment.mobile.ts`, writes the Angular output to `dist/client/browser`, and copies it into both native projects.

### 3. Open in your native IDE

```bash
npm run cap:open:ios       # Xcode (macOS only)
npm run cap:open:android   # Android Studio
```

From there, run on a simulator or device. Capacitor 8 uses Swift Package Manager for iOS plugins — **no CocoaPods step required**.

### Auth on mobile (M4.3 — pending)

The web build uses cookie auth. Mobile WebViews handle cross-origin cookies awkwardly, so M4.3 will switch the mobile path to:

- Open Google OAuth in an in-app browser via `@capacitor/browser` (SFSafariViewController / Chrome Custom Tabs).
- Capture the redirect via the `com.artha.app://auth/callback` custom URL scheme, picked up by `@capacitor/app`'s `appUrlOpen` listener.
- Persist the JWT in `@capacitor/preferences` and attach it as a `Bearer` header via the existing `AuthInterceptor`.
