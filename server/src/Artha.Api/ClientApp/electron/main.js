// Artha desktop (Electron) main process.
//
// Strategy: the Angular build is a normal web app, so we serve it over a fixed
// localhost origin and load that in the window. Running on http://localhost
// means Capacitor reports the 'web' platform and the app reuses its existing
// web OAuth flow (redirect = <origin>/auth/callback) — no app rewrite needed.
//
// Google blocks OAuth inside embedded/Electron user-agents ("disallowed_user
// agent"), so sign-in is opened in the user's real browser. Google then
// redirects to http://localhost:PORT/auth/callback, which our own static server
// intercepts; we pull the code/state out and hand them to the renderer over IPC
// so the app can finish the token exchange exactly as it does on the web.

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

// Fixed port so the OAuth redirect URI is stable and can be registered in the
// Google Cloud "Web application" client. If you change it, update the client.
const PORT = 8717;
const ORIGIN = `http://localhost:${PORT}`;
const CALLBACK_PATH = '/auth/callback';

// Where the built Angular files live: packaged via extraResources, or straight
// from the Angular dist folder during local development.
const CONTENT_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'app-dist')
  : path.join(__dirname, '..', 'dist', 'client', 'browser');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

let mainWindow = null;

/** Small "you can close this tab" page shown in the user's browser post-auth. */
function authDonePage() {
  return `<!doctype html><html><head><meta charset="utf-8">
<title>Artha — sign-in complete</title>
<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
display:flex;min-height:100vh;align-items:center;justify-content:center;
margin:0;background:#f8fafc;color:#0f172a}.c{text-align:center;max-width:360px;
padding:24px}.c h1{font-size:18px;margin:0 0 8px}.c p{color:#475569;margin:0}</style>
</head><body><div class="c"><h1>Signed in to Artha</h1>
<p>You can close this tab and return to the Artha desktop app.</p></div></body></html>`;
}

/** Serve a file from CONTENT_DIR, falling back to index.html for SPA routes. */
function serveStatic(req, res) {
  const reqPath = decodeURIComponent(new URL(req.url, ORIGIN).pathname);
  let filePath = path.join(CONTENT_DIR, reqPath);

  // Prevent path traversal outside the content dir.
  if (!filePath.startsWith(CONTENT_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (!err && stat.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }
    fs.readFile(filePath, (readErr, data) => {
      if (readErr) {
        // SPA fallback: unknown non-asset routes get index.html so the Angular
        // router can resolve them.
        if (!path.extname(reqPath)) {
          fs.readFile(path.join(CONTENT_DIR, 'index.html'), (e2, html) => {
            if (e2) {
              res.writeHead(404).end('Not found');
            } else {
              res.writeHead(200, { 'Content-Type': MIME['.html'] }).end(html);
            }
          });
          return;
        }
        res.writeHead(404).end('Not found');
        return;
      }
      const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type }).end(data);
    });
  });
}

/** Start the local static server (also intercepts the OAuth callback). */
function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, ORIGIN);

      if (url.pathname === CALLBACK_PATH) {
        // The user's browser landed here after Google sign-in. Forward the
        // result to the renderer and tell the browser it's done.
        const payload = {
          code: url.searchParams.get('code') || undefined,
          state: url.searchParams.get('state') || undefined,
          error: url.searchParams.get('error') || undefined,
        };
        res.writeHead(200, { 'Content-Type': MIME['.html'] }).end(authDonePage());
        if (mainWindow) {
          mainWindow.webContents.send('oauth-callback', payload);
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.focus();
        }
        return;
      }

      serveStatic(req, res);
    });

    server.on('error', reject);
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 360,
    minHeight: 600,
    backgroundColor: '#0f172a',
    title: 'Artha',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Open target=_blank / external links in the system browser, never in-app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Keep in-app navigation on our own origin; send anything else outward.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(ORIGIN)) {
      event.preventDefault();
      if (/^https?:/.test(url)) {
        void shell.openExternal(url);
      }
    }
  });

  void mainWindow.loadURL(ORIGIN + '/');
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Single instance: a second launch just focuses the existing window.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    // Renderer asks us to open the Google sign-in URL in the real browser.
    ipcMain.handle('open-external', (_event, url) => {
      if (typeof url === 'string' && /^https?:/.test(url)) {
        return shell.openExternal(url);
      }
      return undefined;
    });

    try {
      await startServer();
    } catch (err) {
      // Most likely the port is already taken.
      console.error('Failed to start local server on', PORT, err);
    }
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
