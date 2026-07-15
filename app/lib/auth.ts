export const SESSION_COOKIE_NAME = 'session';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function getKey(): Promise<CryptoKey> {
  const secret = requireEnv('SESSION_SECRET');
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function base64UrlEncode(text: string): string {
  const bytes = encoder.encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return decoder.decode(bytes);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function createSessionToken(username: string): Promise<{ token: string; maxAge: number }> {
  const expires = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS;
  const payload = base64UrlEncode(JSON.stringify({ u: username, e: expires }));
  const key = await getKey();
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return { token: `${payload}.${toHex(signature)}`, maxAge: SESSION_MAX_AGE_SECONDS };
}

export async function verifySessionToken(token: string | undefined | null): Promise<string | null> {
  if (!token) return null;
  const dotIndex = token.indexOf('.');
  if (dotIndex === -1) return null;
  const payload = token.slice(0, dotIndex);
  const signatureHex = token.slice(dotIndex + 1);

  const key = await getKey();
  const expectedSignature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  const expectedHex = toHex(expectedSignature);

  if (!timingSafeEqual(expectedHex, signatureHex)) return null;

  try {
    const { u: username, e: expires } = JSON.parse(base64UrlDecode(payload)) as { u: string; e: number };
    if (!Number.isFinite(expires) || expires < Math.floor(Date.now() / 1000)) return null;
    return username;
  } catch {
    return null;
  }
}
