/* Offline-candidate dual revocation compatibility bridge.
 *
 * NOT connected to the active Worker. DO NOT enable without verifying BOTH
 * deployed auth D1 tables, migration ledgers, current Worker bindings and
 * concurrency/rollback semantics on a NEW isolated Cloudflare sandbox.
 *
 * Why dual read/write? Main's old Worker writes revoked_sessions; the PR Worker
 * writes revoked_session_tokens. A one-time copy can miss a logout while a
 * rolling deployment has mixed Worker versions. During overlap, every new
 * Worker must honor BOTH registries and write BOTH registries atomically.
 */
import {sessionTokenHash} from './session-revocation.js';

const LEGACY='revoked_sessions';
const CANONICAL='revoked_session_tokens';
const validExpiry=value=>{
  const n=Number(value);
  if(!Number.isSafeInteger(n)||n<=0)throw new Error('Invalid session expiry');
  return n;
};
const activeDb=env=>{
  if(!env?.DB||typeof env.DB.prepare!=='function')throw new Error('Auth D1 binding unavailable');
  return env.DB;
};

export async function isRevokedAcrossBoth(env,sessionToken){
  if(typeof sessionToken!=='string'||!sessionToken)throw new Error('Missing session token');
  const db=activeDb(env);
  const hash=await sessionTokenHash(sessionToken);
  // Require BOTH lookups to succeed. A missing table, permission failure,
  // failed adapter or inconsistent schema DENIES authentication (throws).
  const [old,current]=await Promise.all([
    db.prepare('SELECT token_hash FROM '+LEGACY+' WHERE token_hash=? LIMIT 1').bind(hash).first(),
    db.prepare('SELECT token_hash FROM '+CANONICAL+' WHERE token_hash=? LIMIT 1').bind(hash).first()
  ]);
  return Boolean(old||current);
}

export async function revokeAcrossBoth(env,sessionToken,expiresAt){
  if(typeof sessionToken!=='string'||!sessionToken)throw new Error('Missing session token');
  const db=activeDb(env);
  if(typeof db.batch!=='function')throw new Error('Atomic D1 batch is required');
  const expiry=validExpiry(expiresAt);
  const hash=await sessionTokenHash(sessionToken),revokedAt=new Date().toISOString();
  const queries=[
    db.prepare('INSERT INTO '+LEGACY+' (token_hash,expires_at) VALUES (?,?) ON CONFLICT(token_hash) DO UPDATE SET expires_at=MAX('+LEGACY+'.expires_at,excluded.expires_at)').bind(hash,expiry),
    db.prepare('INSERT INTO '+CANONICAL+' (token_hash,expires_at,revoked_at) VALUES (?,?,?) ON CONFLICT(token_hash) DO UPDATE SET expires_at=MAX('+CANONICAL+'.expires_at,excluded.expires_at)').bind(hash,expiry,revokedAt)
  ];
  // Cloudflare D1 batch() is transactional. Never silently fall back to
  // separate .run() calls or pretend partial success is a completed logout.
  const results=await db.batch(queries);
  if(!Array.isArray(results)||results.length!==2||results.some(x=>x?.success!==true))
    throw new Error('Atomic D1 revocation batch did not confirm both writes');
  // No raw token or fingerprint returned to callers.
  return {ok:true};
}
