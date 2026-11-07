/**
 * Minimal, read-only, egress-free audit sandbox probe.
 * Not a commerce Worker. No other imports, outbound fetch, schedules,
 * order mutations, credentials, carrier or payment integrations.
 * Deployment is NOT authorized by having this file in GitHub.
 */
const json = (data,status=200) => new Response(JSON.stringify(data),{
  status,headers:{
    'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'private, no-store'
  }
});
async function secureEqual(a,b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length < 32 || b.length < 32)
    return false;
  const encode = new TextEncoder();
  const [x,y] = await Promise.all([
    crypto.subtle.digest('SHA-256',encode.encode(a)),
    crypto.subtle.digest('SHA-256',encode.encode(b))
  ]);
  const first = new Uint8Array(x), second = new Uint8Array(y);
  let difference = 0;
  for (let i=0;i<first.length;i++) difference |= first[i] ^ second[i];
  return difference === 0;
}
export default {
  async fetch(request,env) {
    if (env?.APP_ENV !== 'audit_sandbox' || env?.SANDBOX_EGRESS_OFFLINE !== 'true')
      return json({ok:false,code:'AUDIT_SANDBOX_CONFIG_INVALID'},503);
    const url=new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/healthz')
      return json({ok:true,kind:'isolated_audit_probe',readOnly:true,runtimeBindingsVerified:false});

    if (url.pathname !== '/qa/schema-proof')
      return json({ok:false,code:'AUDIT_ROUTE_NOT_FOUND'},404);
    if (request.method !== 'GET')
      return json({ok:false,code:'METHOD_NOT_ALLOWED'},405);
    if (!(await secureEqual(request.headers.get('X-Sandbox-QA-Key'),env?.SANDBOX_QA_SECRET)))
      return json({ok:false,code:'AUDIT_PROBE_UNAUTHORIZED'},403);
    if (!env?.DB || typeof env.DB.prepare !== 'function')
      return json({ok:false,code:'AUDIT_SANDBOX_D1_MISSING'},503);
    try {
      // Read ONLY the dedicated fixture table name; never query user/order rows.
      // This cannot independently attest the remote Cloudflare resource UUID.
      const row=await env.DB.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='qa_sandbox_marker' LIMIT 1"
      ).first();
      return json({ok:true,syntheticMarkerPresent:row?.name==='qa_sandbox_marker',
        onlyReadSqliteMaster:true,runtimeBindingsVerified:false});
    }catch {
      return json({ok:false,code:'AUDIT_SANDBOX_READ_FAILED'},503);
    }
  }
};
