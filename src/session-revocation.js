// D1-backed per-token logout revocation. Never persist a bearer token or cookie.
// Schema must be migrated before serving this code; reads fail closed if absent.
const COOKIE='ko_session';
const text=v=>String(v||'');
export function sessionTokenFromRequest(request){
  const value=text(request.headers.get('Cookie')).split(';').map(s=>s.trim())
    .find(s=>s.startsWith(COOKIE+'='));
  return value?value.slice(COOKIE.length+1):'';
}
export async function sessionTokenHash(token){
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));
  return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
}
export async function isSessionRevoked(env,token){
  if(!env?.DB)throw new Error('Session revocation database unavailable');
  const row=await env.DB.prepare('SELECT token_hash FROM revoked_session_tokens WHERE token_hash=? LIMIT 1')
    .bind(await sessionTokenHash(token)).first();
  return Boolean(row);
}
export async function revokeSession(env,token,expiresAt){
  if(!env?.DB)throw new Error('Session revocation database unavailable');
  const expiry=Math.floor(Number(expiresAt));
  if(!token||!Number.isSafeInteger(expiry))throw new Error('Invalid session expiry');
  await env.DB.prepare('INSERT OR IGNORE INTO revoked_session_tokens (token_hash,expires_at,revoked_at) VALUES (?,?,?)')
    .bind(await sessionTokenHash(token),expiry,new Date().toISOString()).run();
}
