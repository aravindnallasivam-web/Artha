# Artha Desktop (Electron)

A thin Electron shell around Artha's Angular web build. The app's data layer is
pure web (Google Drive REST + `localStorage`), so the desktop build is the same
app served from a fixed `http://localhost:8717` origin inside an Electron window.

SMS capture and SIM-balance features are Android-only and automatically hidden
on desktop. Everything else — manual entry, dashboard, reports, loans,
categories/subcategories, Drive sync — works.

## How sign-in works on desktop

Google blocks OAuth inside embedded/Electron web views. So on desktop:

1. Sign-in opens in your **default browser** (not in the app window).
2. After consent, Google redirects to `http://localhost:8717/auth/callback`.
3. The Electron main process runs the local server, intercepts that redirect,
   and hands the `code`/`state` to the app over IPC.
4. The app finishes the PKCE token exchange exactly as the web build does.

This reuses the existing **Web** OAuth client — no separate "Desktop" client.

## One-time Google Cloud setup

In the Google Cloud console, open the **Web application** OAuth client Artha
already uses, and add:

- **Authorised JavaScript origins:** `http://localhost:8717`
- **Authorised redirect URIs:** `http://localhost:8717/auth/callback`

The Drive scopes are unchanged (`drive.appdata`, `openid`, `email`, `profile`).

> If you change `PORT` in `main.js`, update both entries above to match.

## Develop / run

From the ClientApp root (`server/src/Artha.Api/ClientApp`):

```bash
# once: install the Electron toolchain
npm run electron:install

# build the Angular app and launch the desktop shell
npm run electron:start
```

`electron:start` runs `ng build` (output: `dist/client/browser`) and then
launches Electron, which serves those files locally.

## Package installers

```bash
npm run electron:dist
```

Produces installers under `electron/dist-electron/` (dmg/zip on macOS, nsis on
Windows, AppImage/deb on Linux) via electron-builder. The Angular build is
bundled through `extraResources` (`../dist/client/browser` → `app-dist`).

## Files

- `main.js` — app lifecycle, local static server + SPA fallback, OAuth-redirect
  interception, window, external-link handling, single-instance lock.
- `preload.js` — exposes the minimal `window.electronAPI` bridge.
- `package.json` — Electron deps, scripts, and electron-builder config.
