// Feature-detect the Electron desktop shell. The preload (electron/preload.js)
// exposes `window.electronAPI` only when the app runs inside Electron, so the
// rest of the app can branch on getElectron() without any Electron dependency.

/** Result of an OAuth redirect captured by the Electron main process. */
export interface ElectronOAuthCallback {
  code?: string;
  state?: string;
  error?: string;
}

/** The bridge surface exposed by electron/preload.js. */
export interface ElectronApi {
  platform: 'electron';
  openExternal(url: string): Promise<void>;
  onOAuthCallback(cb: (payload: ElectronOAuthCallback) => void): void;
}

/** The Electron bridge when running on desktop, otherwise null. */
export function getElectron(): ElectronApi | null {
  const api = (globalThis as unknown as { electronAPI?: ElectronApi }).electronAPI;
  return api && api.platform === 'electron' ? api : null;
}

/** True when running inside the Electron desktop shell. */
export function isElectron(): boolean {
  return getElectron() !== null;
}
