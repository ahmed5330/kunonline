// D1-backed per-token logout revocation. Never persist a bearer token or cookie.
// Schema must be migrated before serving this code; reads fail closed if absent.
const COOKIE='ko_session';
const text=v=>String(v||'');
const sessionCookies=request=>text(request.headers.get('Cookie')).split(';').map(s=>s.trim())
  .filter(s=>s.startsWith(COOKIE+'='));
// Duplicate session cookies are ambiguous (different Domain/Path values can
// be combined in one Cookie header). Never authenticate an arbitrary first
// copy: the revocation hash must identify the exact authenticated token.
export function hasDuplicateSessionCookies(request){
  return sessionCookies(request).length>1;
}
export function sessionTokenFromRequest(request){
  const matches=sessionCookies(request);
  return matches.length===1?matches[0].slice(COOKIE.length+1):'';
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
  const result=await env.DB.prepare('INSERT OR IGNORE INTO revoked_session_tokens (token_hash,expires_at,revoked_at) VALUES (?,?,?)')
    .bind(await sessionTokenHash(token),expiry,new Date().toISOString()).run();
  // D1 normally throws on SQL errors, but a driver/adapter can report a
  // structured failure without throwing. Such a response must never produce
  // a successful logout. meta.changes=0 is fine for an already-revoked token.
  if(result?.success===false)throw new Error('Session revocation write rejected');
}
