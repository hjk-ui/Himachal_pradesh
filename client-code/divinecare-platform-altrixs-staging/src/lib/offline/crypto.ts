/**
 * Offline draft encryption — AES-GCM-256, PBKDF2 100k from session token.
 * CryptoKey stays in memory only (never localStorage).
 */
const SALT = 'product-offline-v1';
const PBKDF2_ITERS = 100_000;

let cryptoKey: CryptoKey | null = null;

function b64(buf: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function fromB64(s: string) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

export async function initOfflineEncryption(sessionToken: string) {
  if (typeof window === 'undefined' || !sessionToken) return;
  const enc = new TextEncoder();
  const material = await crypto.subtle.importKey(
    'raw',
    enc.encode(sessionToken),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  cryptoKey = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: enc.encode(SALT),
      iterations: PBKDF2_ITERS,
      hash: 'SHA-256',
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export function wipeOfflineEncryption() {
  cryptoKey = null;
}

export async function encryptJson(payload: unknown): Promise<string> {
  if (!cryptoKey) throw new Error('Offline encryption not initialized');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, plaintext);
  return `${b64(iv.buffer)}.${b64(cipher)}`;
}

export async function decryptJson<T = unknown>(blob: string): Promise<T> {
  if (!cryptoKey) throw new Error('Offline encryption not initialized');
  const [ivB64, dataB64] = blob.split('.');
  if (!ivB64 || !dataB64) throw new Error('Invalid ciphertext');
  const iv = new Uint8Array(fromB64(ivB64));
  const data = fromB64(dataB64);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, data);
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}

export function hasOfflineKey() {
  return Boolean(cryptoKey);
}
