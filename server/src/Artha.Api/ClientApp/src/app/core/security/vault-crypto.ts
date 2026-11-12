/**
 * Client-side encryption for the card vault. Nothing here leaves the device
 * unencrypted: the vault file in Drive only holds ciphertext.
 *
 *   master password ──PBKDF2-SHA256 (600k)──▶ KEK ──AES-GCM wrap──▶ DEK
 *   DEK (random AES-256) ──AES-GCM──▶ the cards (JSON)
 *
 * The random data key (DEK) means a password change only re-wraps the DEK,
 * and "unlock with fingerprint" can keep the DEK sealed by the phone's
 * hardware keystore without ever storing the password.
 */

export const VAULT_FORMAT = 'artha-card-vault';
const PBKDF2_ITERATIONS = 600_000;

export interface VaultFile {
  format: typeof VAULT_FORMAT;
  version: 1;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string };
  /** The DEK, wrapped by the password-derived key (AES-GCM). */
  wrappedKey: string;
  wrapIv: string;
  /** The cards, encrypted with the DEK (AES-GCM). */
  iv: string;
  data: string;
  updatedAt: string;
}

export class WrongPasswordError extends Error {
  constructor() {
    super('Wrong master password.');
  }
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export function toB64(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s);
}

export function fromB64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(new ArrayBuffer(n)));
}

async function deriveKek(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(password.normalize('NFKC')), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  );
}

/** A new vault: random DEK, wrapped by the password. Returns the file header and the DEK. */
export async function createVault(password: string): Promise<{ file: VaultFile; dek: CryptoKey }> {
  const dek = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const file = await wrapWithPassword(dek, password, {
    format: VAULT_FORMAT,
    version: 1,
    iv: '',
    data: '',
    updatedAt: new Date().toISOString(),
  });
  return { file, dek };
}

/** (Re)wrap the DEK with a password: used at setup and to change the master password. */
export async function wrapWithPassword(
  dek: CryptoKey,
  password: string,
  rest: Omit<VaultFile, 'kdf' | 'wrappedKey' | 'wrapIv'>,
): Promise<VaultFile> {
  const salt = randomBytes(16);
  const kek = await deriveKek(password, salt, PBKDF2_ITERATIONS);
  const wrapIv = randomBytes(12);
  const wrapped = await crypto.subtle.wrapKey('raw', dek, kek, { name: 'AES-GCM', iv: wrapIv });
  return {
    ...rest,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: PBKDF2_ITERATIONS, salt: toB64(salt) },
    wrappedKey: toB64(wrapped),
    wrapIv: toB64(wrapIv),
  };
}

/** Unwrap the DEK with the master password; WrongPasswordError when it doesn't fit. */
export async function unlockWithPassword(file: VaultFile, password: string): Promise<CryptoKey> {
  const kek = await deriveKek(password, fromB64(file.kdf.salt), file.kdf.iterations);
  try {
    return await crypto.subtle.unwrapKey(
      'raw',
      fromB64(file.wrappedKey),
      kek,
      { name: 'AES-GCM', iv: fromB64(file.wrapIv) },
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt'],
    );
  } catch {
    throw new WrongPasswordError();
  }
}

export async function encryptJson(dek: CryptoKey, value: unknown): Promise<{ iv: string; data: string }> {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, dek, enc.encode(JSON.stringify(value)));
  return { iv: toB64(iv), data: toB64(ct) };
}

export async function decryptJson<T>(dek: CryptoKey, file: Pick<VaultFile, 'iv' | 'data'>): Promise<T | null> {
  if (!file.data) return null;
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(file.iv) }, dek, fromB64(file.data));
  return JSON.parse(dec.decode(pt)) as T;
}

/** Raw DEK bytes (base64), only to seal them with the phone's hardware keystore. */
export async function exportDek(dek: CryptoKey): Promise<string> {
  return toB64(await crypto.subtle.exportKey('raw', dek));
}

export async function importDek(b64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', fromB64(b64), { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

export function isVaultFile(v: unknown): v is VaultFile {
  const f = v as Partial<VaultFile> | null;
  return !!f && f.format === VAULT_FORMAT && !!f.kdf && !!f.wrappedKey;
}
