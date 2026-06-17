<div align="center">

# Artha

**Your money, your data.** A private, serverless personal‑finance app for Android, iOS, desktop and web — where every expense, account and loan lives in *your* Google Drive, not on someone else's server.

*Artha (अर्थ) — Sanskrit for “wealth” and “purpose.”*

</div>

---

## Why Artha

Most finance apps make you hand your transaction history to their servers. Artha doesn't have servers. It signs you in with Google and reads/writes plain JSON files in **your own Google Drive** (`drive.appdata`) directly from the device. Nothing sits between you and your data — and because the app can only see the private folder it created, even Google's Drive UI never shows it.

- 🔒 **Private by design** — data never leaves your Google account; no backend, no analytics pipeline, no data resale.
- 💸 **No running costs** — serverless means it's cheap to operate and easy to self‑host.
- 📵 **Works offline‑first** — a local cache serves the UI instantly and syncs to Drive in the background.
- 📲 **Captures spending automatically** (Android) — reads bank/UPI SMS on‑device and turns them into expenses.

---

## Features

### Money tracking
- **Expenses & income** — log money out and money in, with notes, dates, and an "exclude from totals" flag for refunds/transfers.
- **Accounts** — multiple accounts (bank, cash, card, wallet) with opening balances and per‑account currency; balances stay in sync from SMS alerts.
- **Categories with subcategories** — organise spending one level deep (e.g. *Food → Restaurants*). A **searchable picker** (used everywhere) lets you filter by name and **create a category inline** while adding an expense.
- **Loans & EMIs** — track loans with full amortization: principal, rate, tenure, EMI and prepayments, with an accurate outstanding balance; loan payments can post to the expense ledger.
- **Planned / recurring expenses** — set monthly or yearly bills as a budget and compare planned vs actual.

### Insight
- **Dashboard** — this month's spend, budget progress, month‑over‑month trend, top categories (rolled up from subcategories), a **loans summary card**, and recent activity.
- **Reports** — monthly and yearly breakdowns with a category donut and bars; subcategory spend rolls up into the parent, and each parent **drills down** into its subcategories.
- **Themes** — Light / Dark / System.

### Automatic SMS capture (Android)
- Detects bank & UPI transaction SMS **on‑device** and proposes an expense — parsing is local, raw messages never leave the phone.
- **One‑tap "Add"** straight from the notification when the merchant and account are already learned.
- **Foreign‑currency aware** — reads card spends abroad (e.g. `USD 23.60`), never mistakes the “Avl Limit/Bal” figure for the amount, and offers an **exchange‑rate conversion** in the confirm dialog.
- **Learns** which merchant maps to which category and which SMS sender maps to which account, so future messages auto‑fill (and can auto‑log).
- **Pending queue & bulk review** — anything detected while the app was closed is queued and reviewable in one list; "Train SMS" wizard and ignore‑sender controls included.

> **Note on Android & SMS:** reading SMS is gated by Google Play policy. The app is structured so the parsing logic can also be driven from a notification listener — see the roadmap.

---

## Platforms

| Platform | Status | Notes |
|---|---|---|
| **Android** | ✅ Full | Includes SMS capture and balance sync. |
| **iOS** | ✅ App | No SMS capture (Apple sandbox); everything else works. |
| **Desktop** (Windows / macOS / Linux) | ✅ Electron | See [`electron/`](server/src/Artha.Api/ClientApp/electron). SMS/SIM features hidden. |
| **Web** | 🧪 Dev | Used for development; production targets the native/desktop shells. |

---

## How it works (serverless architecture)

The WebView reads and writes the Drive `appDataFolder` itself; what used to be server‑side now runs on‑device.

**The Drive layer** (`src/app/core/drive`):

| File | Role |
|---|---|
| `drive-rest.client.ts` | Drive v3 REST over `appDataFolder` (CapacitorHttp, CORS‑free) |
| `app-data.repository.ts` | typed read/write + `headRevisionId` optimistic concurrency + schema guard |
| `drive-cache.service.ts` | local‑first cache with background sync + 3‑way merge |
| `drive-schema.ts` | file names, document shapes, monthly‑shard helpers |
| `drive-bootstrap.service.ts` | first‑run seeding (accounts/categories/settings/manifest) |
| `google-token.store.ts` | durable token storage + silent refresh (no secret) |

Each feature has a `*.drive.ts` service (the former controller logic); the `*.api.ts` files are thin pass‑throughs, so feature stores are unaware of the transport.

**Drive file layout** (per user, in `appDataFolder`):

```
manifest.json                  index of expense shards
settings.json                  currency, locale, first-run flag
categories.json                categories (with parentId for subcategories)
accounts.json                  financial accounts
planned-expenses.json          recurring / budget items
loans.json                     loans + payment history
expenses-YYYY-MM.json          one shard per month
```

### Sign‑in (no server, no secret)
1. The app generates a PKCE `code_verifier` / `code_challenge` and opens Google's authorize URL (`openid email profile drive.appdata`).
2. Google redirects back via the platform's redirect — a custom scheme on Android/iOS, `http://localhost:8717/auth/callback` on desktop.
3. The app exchanges the code for tokens **directly at Google's token endpoint with no client secret**, and stores access + refresh tokens.
4. The session is long‑lived; the access token refreshes silently. Every Drive call attaches `Authorization: Bearer …`.

---

## Tech stack

| Layer | Tech |
|---|---|
| App | **Angular 21** (standalone, signals, zoneless) + **Ionic** |
| Native | **Capacitor** (Android / iOS) |
| Desktop | **Electron** + electron‑builder |
| Auth | **Google Sign‑In** — OAuth 2.0 / OIDC with **PKCE, no client secret** |
| Storage | **Your Google Drive** (`drive.appdata`) — plain JSON |
| Networking | **CapacitorHttp** straight to the Drive REST API |

---

## Repository layout

```
/server/src/Artha.Api/ClientApp        the app (path kept for Capacitor/CI stability)
  capacitor.config.ts                  appId = com.artha.app
  android/  ios/                        native projects
  electron/                             desktop shell (main process, builder config)
  /src
    /environments                      environment.ts / .prod.ts / .mobile.ts
    /app
      /core
        /auth                          pkce, session, guard, google-auth, google-oauth
        /drive                         the on-device Drive layer
        /native                        electron bridge, sms reader, native UI
        /models                        Expense, Category, Account, Loan, PlannedExpense, …
      /features                        expenses, categories, accounts, loans, planned,
                                       reports, settings, sms, dashboard
/.github/workflows
  ci.yml                               type-checks + builds the SPA
  android.yml                          builds the debug APK artifact
  desktop.yml                          builds macOS/Windows/Linux installers (tags → Release)
```

---

## Getting started

**Prerequisites:** Node.js 22 + npm 10.

```bash
cd server/src/Artha.Api/ClientApp
npm ci
npm start            # ng serve at http://localhost:4200 (dev)
```

> Sign‑in uses a platform redirect, so end‑to‑end auth is exercised on a device/emulator or the desktop build, not the bare browser dev server.

### Android

```bash
npm run cap:sync            # ng build --configuration mobile && cap sync
npm run cap:open:android    # Android Studio → run on device/emulator
```

A debug APK is also produced by the **Android** GitHub Action on every push.

### Desktop (Electron)

```bash
npm run electron:install    # once
npm run electron:start      # build + launch the desktop app
npm run electron:dist       # build installers (.dmg / .exe / .AppImage) for the current OS
```

See [`electron/README.md`](server/src/Artha.Api/ClientApp/electron/README.md) for the desktop OAuth setup.

### Tests

```bash
npm test                    # vitest
```

---

## Google Cloud setup (required)

The token exchange runs on‑device, so you need OAuth clients with **PKCE and no secret**:

- **Android** — OAuth client type *Android* (package `com.artha.app` + signing SHA‑1); redirect `com.artha.app://auth/callback`. Put the client ID in `environment.mobile.ts`. Enable the **Drive API**.
- **Desktop** — add `http://localhost:8717` (JavaScript origin) and `http://localhost:8717/auth/callback` (redirect) to the **Web** client used by the desktop build.

> A "Web" client requires a secret and can't be embedded in a public mobile binary — that's why the mobile flow uses an installed‑app client.

---

## Privacy & security

- Data is stored **only** in your Google Drive's app‑private folder; the `drive.appdata` scope can't see your other files, and Artha never sends your data anywhere else.
- SMS parsing is **100% on‑device**; message contents are never uploaded.
- No client secret is embedded; tokens live in secure device storage and refresh silently.
- Sign out wipes the local cache and tokens (revoke fully from your Google Account settings).

---

## CI / CD

- **CI** — type‑checks and builds the SPA on every push/PR.
- **Android** — assembles a downloadable debug APK.
- **Desktop** — on demand or on a `v*` tag, builds macOS/Windows/Linux installers; tags also publish a GitHub Release with the installers attached.

---

## Roadmap

- Notification‑listener capture (Play‑policy‑friendly alternative to `READ_SMS`).
- Email‑based transaction capture (cross‑platform, incl. iOS).
- Optional location‑assisted merchant suggestions for cash spends.
- Shared/household ledger.
- Account Aggregator (India) integration for structured bank data.

---

## License

Proprietary — all rights reserved. © Artha.
