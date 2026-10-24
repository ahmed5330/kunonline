/* Audit-only Cloudflare Worker.
 * The only imported application functions are the UNWIRED dual-revocation
 * proof-of-concept; NO commerce handler, assets, scheduled events, service
 * bindings, upstream URL, provider SDK, customer data or outbound fetch().
 * Never deploy against Production/Preview D1. No routes are configured.
 */
import {isRevokedAcrossBoth,revokeAcrossBoth} from './session-revocation-compatibility-bridge.js';

const reply=(payload,status=200)=>new Response(JSON.stringify(payload),{
  status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}
});
async function sameSecret(a,b){
  // Compare fixed-size digests instead of different-length strings.
  const enc=new TextEncoder();
  const [aDigest,bDigest]=await Promise.all([
    crypto.subtle.digest('SHA-256',enc.encode(a)),
    crypto.subtle.digest('SHA-256',enc.encode(b))
  ]);
  const x=new Uint8Array(aDigest),y=new Uint8Array(bDigest);
  let mismatch=0;
  for(let i=0;i<x.length;i++)mismatch|=x[i]^y[i];
  return mismatch===0;
}
export async function handleAuditSandboxRequest(request,env){
  // Fail closed when run with unexpected bindings. Require a distinct Worker
  // config with AUDIT_EGRESS_OFFLINE=true; do not pretend this proves remote
  // Cloudflare binding isolation, which requires separate approval.
  if(env?.APP_ENV!=='audit_sandbox'||env?.AUDIT_EGRESS_OFFLINE!=='true')
    return reply({ok:false,error:'SANDBOX_CONFIGURATION_REQUIRED'},503);
  const url=new URL(request.url);
  if(request.method==='GET'&&url.pathname==='/healthz')
    return reply({ok:true,kind:'isolated_auth_sandbox',deployVerified:false});
  if(request.method!=='POST'||url.pathname!=='/qa/revocation-selftest')
    return reply({ok:false,error:'NOT_FOUND'},404);
  if(typeof env?.AUDIT_QA_KEY!=='string'||env.AUDIT_QA_KEY.length<32)
    return reply({ok:false,error:'QA_AUTH_UNAVAILABLE'},503);
  const supplied=request.headers.get('X-Audit-QA-Key')||'';
  if(!supplied||!(await sameSecret(supplied,env.AUDIT_QA_KEY)))
    return reply({ok:false,error:'FORBIDDEN'},403);

  if(!env.DB||typeof env.DB.prepare!=='function'||typeof env.DB.batch!=='function')
    return reply({ok:false,error:'DEDICATED_D1_REQUIRED'},503);
  // Only fake ephemeral strings, no credentials, no user accounts/cookies.
  // The unique digest is stored in D1 for this synthetic selftest alone.
  const token='KUN_AUDIT_SYNTHETIC_'+crypto.randomUUID();
  const expiresAt=Math.floor(Date.now()/1000)+300;
  try{
    const before=await isRevokedAcrossBoth(env,token);
    if(before)return reply({ok:false,error:'UNEXPECTED_PREEXISTING_SYNTHETIC_REVOCATION'},500);
    await revokeAcrossBoth(env,token,expiresAt);
    const after=await isRevokedAcrossBoth(env,token);
    if(!after)return reply({ok:false,error:'SYNTHETIC_REPLAY_NOT_BLOCKED'},500);
    return reply({ok:true,checks:{freshNotRevoked:true,afterLogoutRevoked:true,dualD1WritesAtomic:true},
      syntheticOnly:true});
  }catch{
    // Do not log the D1 error message: it may carry sensitive deployment info.
    return reply({ok:false,error:'SANDBOX_D1_SCHEMA_OR_WRITE_UNAVAILABLE'},503);
  }
}

export default {fetch:handleAuditSandboxRequest};
