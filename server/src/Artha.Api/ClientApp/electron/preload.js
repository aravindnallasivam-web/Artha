// Preload: exposes a tiny, safe bridge to the renderer under window.electronAPI.
// The Angular app feature-detects this object to switch its OAuth flow to the
// system browser + IPC callback when running on the desktop.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform: 'electron',

  /** Open a URL (the Google sign-in page) in the user's default browser. */
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  /**
   * Subscribe to the OAuth redirect captured by the main process. The callback
   * receives { code?, state?, error? } parsed from the /auth/callback request.
   */
  onOAuthCallback: (cb) => {
    ipcRenderer.removeAllListeners('oauth-callback');
    ipcRenderer.on('oauth-callback', (_event, payload) => cb(payload));
  },
});
