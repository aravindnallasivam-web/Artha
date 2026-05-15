function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function generateCodeVerifier(byteLength = 32): string {
  const random = new Uint8Array(byteLength);
  crypto.getRandomValues(random);
  return base64UrlEncode(random.buffer);
}

export async function generateCodeChallenge(codeVerifier: string): Promise<string> {
  const data = new TextEncoder().encode(codeVerifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(digest);
}

export function generateState(byteLength = 16): string {
  const random = new Uint8Array(byteLength);
  crypto.getRandomValues(random);
  return base64UrlEncode(random.buffer);
}
