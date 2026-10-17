export const encoder = new TextEncoder();
export class ApiError extends Error {
  constructor(status, message, code = 'request_failed') { super(message); this.status = status; this.code = code; }
}
export const fail = (status, message, code) => { throw new ApiError(status, message, code); };
export function b64(bytes) { return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
export function unb64(text) { return Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)); }
export async function key(env, usage = 'AES-GCM') {
  if (!env.CONNECTION_ENCRYPTION_KEY) fail(503, 'Защищённое хранилище ещё не настроено.');
  return crypto.subtle.importKey('raw', unb64(env.CONNECTION_ENCRYPTION_KEY), usage === 'AES-GCM' ? 'AES-GCM' : { name: 'HMAC', hash: 'SHA-256' }, false, usage === 'AES-GCM' ? ['encrypt', 'decrypt'] : ['sign', 'verify']);
}
export async function seal(env, owner, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(owner) }, await key(env), encoder.encode(JSON.stringify(value)));
  return JSON.stringify({ owner, iv: b64(iv), ciphertext: b64(encrypted) });
}
export async function unseal(env, owner, value) {
  if (value.owner !== owner) throw new Error('Wrong owner');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(value.iv), additionalData: encoder.encode(owner) }, await key(env), unb64(value.ciphertext));
  return JSON.parse(new TextDecoder().decode(plain));
}
export async function digest(value) { return b64(await crypto.subtle.digest('SHA-256', encoder.encode(value))); }
