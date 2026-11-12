import { Injectable, NgZone, computed, inject, signal } from '@angular/core';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { AppDataRepository } from '../../core/drive/app-data.repository';
import { DRIVE_FILES } from '../../core/drive/drive-schema';
import { SmsReader } from '../../core/native/sms-reader';
import { AppLockService } from '../../core/security/app-lock.service';
import {
  VaultFile,
  createVault,
  decryptJson,
  encryptJson,
  exportDek,
  importDek,
  isVaultFile,
  unlockWithPassword,
  wrapWithPassword,
} from '../../core/security/vault-crypto';
import { SmsCaptureService } from '../sms/sms-capture.service';
import { CardNetwork, last4 } from './card-utils';

export interface VaultCard {
  id: string;
  /** "HDFC Millennia", "ICICI Amazon Pay". */
  label: string;
  bank: string;
  network: CardNetwork;
  kind: 'credit' | 'debit' | 'prepaid';
  number: string;
  /** MM/YY */
  expiry: string;
  nameOnCard: string;
  cvv: string;
  /** Linked Artha account (e.g. the credit-card account), optional. */
  accountId: string | null;
  note: string;
  createdAt: string;
  updatedAt: string;
}

interface VaultPayload {
  cards: VaultCard[];
}

export type VaultStatus = 'loading' | 'none' | 'locked' | 'unlocked' | 'error';

/** Sealed vault key for fingerprint unlock (this phone only; useless without the keystore). */
const BIO_KEY = 'artha.vault.bio';
/** Lock after this long without activity in the vault. */
const IDLE_MS = 2 * 60 * 1000;

/**
 * The encrypted card vault. Cards are decrypted only in memory while
 * unlocked; Drive (and the local cache) only ever hold ciphertext. Locks on
 * idle, when the app goes to the background, and when the vault screen closes.
 */
@Injectable({ providedIn: 'root' })
export class VaultService {
  private readonly repo = inject(AppDataRepository);
  private readonly lock$ = inject(AppLockService);
  private readonly zone = inject(NgZone);
  private readonly sms = inject(SmsCaptureService);

  private readonly _status = signal<VaultStatus>('loading');
  private readonly _cards = signal<VaultCard[]>([]);
  private readonly _bioEnabled = signal<boolean>(hasBioKey());
  readonly status = this._status.asReadonly();
  readonly cards = this._cards.asReadonly();
  readonly bioEnabled = this._bioEnabled.asReadonly();
  readonly count = computed(() => this._cards().length);

  private file: VaultFile | null = null;
  private dek: CryptoKey | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private lifecycleBound = false;
  /** The camera scanner / fingerprint prompt is up: going to the background then is expected. */
  private holdLock = false;

  isNative(): boolean {
    return Capacitor.getPlatform() === 'android';
  }

  /** Read the vault file (ciphertext) and work out whether it's set up. */
  async load(): Promise<void> {
    this.bindLifecycle();
    if (this.dek) {
      this._status.set('unlocked');
      return;
    }
    try {
      const doc = await this.repo.read<unknown>(DRIVE_FILES.cardVault);
      this.file = doc && isVaultFile(doc.document) ? doc.document : null;
      this._status.set(this.file ? 'locked' : 'none');
    } catch {
      this._status.set('error');
    }
  }

  /** First use: create the vault with a master password. */
  async setup(password: string): Promise<void> {
    const { file, dek } = await createVault(password);
    this.file = file;
    this.dek = dek;
    this._cards.set([]);
    await this.persist();
    this._status.set('unlocked');
    this.touch();
  }

  /** Unlock with the master password (throws WrongPasswordError). */
  async unlock(password: string): Promise<void> {
    if (!this.file) await this.load();
    if (!this.file) throw new Error('No vault yet.');
    const dek = await unlockWithPassword(this.file, password);
    await this.open(dek);
  }

  /** Unlock with fingerprint (phone only). False when cancelled or the key is gone. */
  async unlockWithBiometric(): Promise<boolean> {
    const sealed = readBioKey();
    if (!sealed || !this.isNative()) return false;
    if (!this.file) await this.load();
    if (!(await this.lock$.verify('Open card vault'))) return false;
    try {
      const { data } = await SmsReader.vaultOpen({ sealed });
      await this.open(await importDek(data));
      return true;
    } catch (e) {
      // A new fingerprint was enrolled (key wiped) or the key is gone: back to the password.
      if (String((e as Error)?.message ?? e).includes('invalidated')) this.clearBio();
      return false;
    }
  }

  /** Turn fingerprint unlock on (must be unlocked). */
  async enableBiometric(): Promise<boolean> {
    if (!this.dek || !this.isNative()) return false;
    if (!(await this.held(() => this.lock$.verify('Use fingerprint for the vault')))) return false;
    try {
      const { sealed } = await SmsReader.vaultSeal({ data: await exportDek(this.dek) });
      localStorage.setItem(BIO_KEY, sealed);
      this._bioEnabled.set(true);
      return true;
    } catch {
      return false;
    }
  }

  async disableBiometric(): Promise<void> {
    this.clearBio();
    if (this.isNative()) await SmsReader.vaultForget().catch(() => undefined);
  }

  async changePassword(current: string, next: string): Promise<void> {
    if (!this.file) throw new Error('No vault yet.');
    const dek = await unlockWithPassword(this.file, current); // throws on a wrong password
    this.file = await wrapWithPassword(dek, next, this.file);
    await this.persist();
  }

  lock(): void {
    this.dek = null;
    this._cards.set([]);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    if (this._status() === 'unlocked') this._status.set('locked');
  }

  /** Activity in the vault: push the auto-lock back. */
  touch(): void {
    if (!this.dek) return;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.zone.run(() => this.lock()), IDLE_MS);
  }

  async upsert(card: VaultCard): Promise<void> {
    this.requireUnlocked();
    const now = new Date().toISOString();
    const list = this._cards();
    const i = list.findIndex((c) => c.id === card.id);
    const before = i >= 0 ? list[i] : null;
    const next = i >= 0
      ? list.map((c) => (c.id === card.id ? { ...card, updatedAt: now } : c))
      : [...list, { ...card, createdAt: now, updatedAt: now }];
    this._cards.set(next);
    await this.persist();
    this.touch();
    await this.syncLink(before, card);
  }

  async remove(id: string): Promise<void> {
    this.requireUnlocked();
    const gone = this._cards().find((c) => c.id === id) ?? null;
    this._cards.set(this._cards().filter((c) => c.id !== id));
    await this.persist();
    this.touch();
    await this.syncLink(gone, null);
  }

  /**
   * Keep the linked account's card digits in step with the vault, so SMS for
   * this card land on that account. Only the last 4 digits leave the vault
   * (they're in every bank SMS anyway).
   */
  private async syncLink(before: VaultCard | null, after: VaultCard | null): Promise<void> {
    try {
      const was = before?.accountId ? { l4: last4(before.number), acc: before.accountId } : null;
      const now = after?.accountId ? { l4: last4(after.number), acc: after.accountId } : null;
      if (was && (!now || was.l4 !== now.l4 || was.acc !== now.acc)) {
        await this.sms.unlinkCard(was.l4, was.acc);
      }
      if (now && now.l4.length === 4) {
        await this.sms.linkCard(now.l4, now.acc);
      }
    } catch {
      // The card is saved; the link can be set again by saving it once more.
    }
  }

  /**
   * Read a card with the camera (Android). Null when cancelled or not available.
   * The vault stays unlocked while the scanner is open.
   */
  async scanCard(): Promise<{ number: string; expiry: string; name: string } | null> {
    if (!this.isNative()) return null;
    const r = await this.held(() => this.lock$.hold(() => SmsReader.scanCard()));
    this.touch();
    if (!r || r.cancelled || !r.number) return null;
    return { number: r.number, expiry: r.expiry ?? '', name: r.name ?? '' };
  }

  private async held<T>(fn: () => Promise<T>): Promise<T> {
    this.holdLock = true;
    try {
      return await fn();
    } finally {
      // The app's resume event lands just after; release the hold a moment later.
      setTimeout(() => (this.holdLock = false), 1500);
    }
  }

  /** Block screenshots while vault content is on screen (Android). */
  async setSecureScreen(on: boolean): Promise<void> {
    if (this.isNative()) await SmsReader.setSecureScreen({ secure: on }).catch(() => undefined);
  }

  private async open(dek: CryptoKey): Promise<void> {
    if (!this.file) throw new Error('No vault yet.');
    const payload = await decryptJson<VaultPayload>(dek, this.file);
    this.dek = dek;
    this._cards.set(payload?.cards ?? []);
    this._status.set('unlocked');
    this.touch();
  }

  private async persist(): Promise<void> {
    if (!this.dek || !this.file) return;
    const sealed = await encryptJson(this.dek, { cards: this._cards() } satisfies VaultPayload);
    this.file = { ...this.file, ...sealed, updatedAt: new Date().toISOString() };
    await this.repo.write(DRIVE_FILES.cardVault, this.file);
  }

  private requireUnlocked(): void {
    if (!this.dek) throw new Error('The vault is locked.');
  }

  private clearBio(): void {
    try {
      localStorage.removeItem(BIO_KEY);
    } catch {
      // Nothing stored.
    }
    this._bioEnabled.set(false);
  }

  private bindLifecycle(): void {
    if (this.lifecycleBound) return;
    this.lifecycleBound = true;
    if (!Capacitor.isNativePlatform()) {
      // Web: hiding the tab or window locks it.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') this.zone.run(() => this.lock());
      });
      return;
    }
    // Leaving the app locks the vault at once.
    void App.addListener('appStateChange', ({ isActive }) => {
      if (!isActive && !this.holdLock) this.zone.run(() => this.lock());
    });
  }
}

function readBioKey(): string | null {
  try {
    return localStorage.getItem(BIO_KEY);
  } catch {
    return null;
  }
}

function hasBioKey(): boolean {
  return !!readBioKey();
}

export function newCardId(): string {
  return `card-${crypto.randomUUID()}`;
}
