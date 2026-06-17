// Consumer side of family sharing.
//
// Lets you connect to a ledger someone shared with you. Because the app uses
// the `drive.file` scope (not full Drive), you grant access to the shared
// snapshot by picking it once via the Google Picker; afterwards the app can
// read that one file. The parsed snapshot is exposed read-only.

import { Injectable, computed, inject, signal } from '@angular/core';
import { CapacitorHttp } from '@capacitor/core';
import { environment } from '../../../environments/environment';
import { GoogleTokenStore } from '../../core/drive/google-token.store';
import { InboundShare, SharedSnapshot } from '../../core/models/shared-ledger.model';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const IN_KEY = 'artha.sharing.in';
const GAPI_SRC = 'https://apis.google.com/js/api.js';

// Google Picker is loaded at runtime and has no types; treat as unknown global.
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const google: any;

@Injectable({ providedIn: 'root' })
export class SharedLedgerService {
  private readonly tokens = inject(GoogleTokenStore);

  private readonly _snapshot = signal<SharedSnapshot | null>(null);
  readonly snapshot = this._snapshot.asReadonly();
  readonly connected = computed(() => this.connectedShare() !== null);

  private readonly _share = signal<InboundShare | null>(this.loadShare());
  readonly share = this._share.asReadonly();

  connectedShare(): InboundShare | null {
    return this._share();
  }

  /** Launch the Google Picker so the user selects the shared snapshot file. */
  async connect(): Promise<InboundShare | null> {
    if (!environment.google.pickerApiKey || !environment.google.appId) {
      throw new Error('Sharing is not configured (missing Picker API key).');
    }
    await this.loadPicker();
    const token = await this.tokens.getAccessToken();
    const fileId = await this.pickFile(token);
    if (!fileId) {
      return null;
    }
    // Read it now to capture the owner's name for display.
    const snapshot = await this.readSnapshot(fileId, token);
    const share: InboundShare = {
      fileId,
      ownerName: snapshot?.owner?.name || snapshot?.owner?.email || 'Shared account',
      connectedAt: new Date().toISOString(),
    };
    localStorage.setItem(IN_KEY, JSON.stringify(share));
    this._share.set(share);
    this._snapshot.set(snapshot);
    return share;
  }

  /** Re-read the connected snapshot (pull the latest the owner published). */
  async refresh(): Promise<void> {
    const share = this._share();
    if (!share) {
      return;
    }
    const token = await this.tokens.getAccessToken();
    this._snapshot.set(await this.readSnapshot(share.fileId, token));
  }

  disconnect(): void {
    localStorage.removeItem(IN_KEY);
    this._share.set(null);
    this._snapshot.set(null);
  }

  // ── internals ──────────────────────────────────────────────────────────

  private loadShare(): InboundShare | null {
    try {
      const raw = localStorage.getItem(IN_KEY);
      return raw ? (JSON.parse(raw) as InboundShare) : null;
    } catch {
      return null;
    }
  }

  private async readSnapshot(fileId: string, token: string): Promise<SharedSnapshot | null> {
    const res = await CapacitorHttp.request({
      method: 'GET',
      url: `${DRIVE_API}/files/${fileId}`,
      params: { alt: 'media' },
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Could not read the shared ledger (HTTP ${res.status}).`);
    }
    return typeof res.data === 'string' ? (JSON.parse(res.data) as SharedSnapshot) : (res.data as SharedSnapshot);
  }

  private loadPicker(): Promise<void> {
    if (typeof google !== 'undefined' && google.picker) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const existing = document.getElementById('artha-gapi') as HTMLScriptElement | null;
      const onLoaded = () => (window as any).gapi.load('picker', { callback: () => resolve() });
      if (existing) {
        onLoaded();
        return;
      }
      const script = document.createElement('script');
      script.id = 'artha-gapi';
      script.src = GAPI_SRC;
      script.onload = onLoaded;
      script.onerror = () => reject(new Error('Could not load the Google Picker.'));
      document.head.appendChild(script);
    });
  }

  private pickFile(token: string): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      const view = new google.picker.DocsView(google.picker.ViewId.DOCS)
        .setOwnedByMe(false) // surface files shared with me
        .setMimeTypes('application/json');
      const picker = new google.picker.PickerBuilder()
        .addView(view)
        .setOAuthToken(token)
        .setDeveloperKey(environment.google.pickerApiKey)
        .setAppId(environment.google.appId)
        .setTitle('Choose a shared Artha ledger')
        .setCallback((data: any) => {
          if (data.action === google.picker.Action.PICKED) {
            resolve(data.docs?.[0]?.id ?? null);
          } else if (data.action === google.picker.Action.CANCEL) {
            resolve(null);
          }
        })
        .build();
      picker.setVisible(true);
    });
  }
}
