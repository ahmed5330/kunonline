// Expired token fingerprints cannot revoke a still-valid token: exp is signed.
export async function cleanupExpiredSessions(env,{nowSeconds=Math.floor(Date.now()/1000),limit=200}={}){
  if(!Number.isSafeInteger(nowSeconds)||nowSeconds<0||!Number.isSafeInteger(limit)||limit<1||limit>1000)
    throw Object.assign(new Error('Invalid session maintenance bounds'),{code:'SYNC_SESSION_MAINTENANCE_BOUNDS'});
  try{
    const result=await env.DB.prepare(`DELETE FROM revoked_sessions
      WHERE token_hash IN (SELECT token_hash FROM revoked_sessions WHERE expires_at<=? ORDER BY expires_at LIMIT ?)
      AND expires_at<=?`).bind(nowSeconds,limit,nowSeconds).run();
    if(result?.success===false||!Number.isSafeInteger(result?.meta?.changes)||result.meta.changes<0||result.meta.changes>limit)
      throw new Error('Invalid maintenance result');
    return {ok:true,deleted:result.meta.changes,limit};
  }catch{
    throw Object.assign(new Error('Session maintenance failed'),{code:'SYNC_SESSION_MAINTENANCE_FAILED'});
  }
}
export async function runWithSessionMaintenance(cron,env,run){
  const upstream=await run();
  if(String(cron||'')!=='*/5 * * * *')return upstream;
  const sessionMaintenance=await cleanupExpiredSessions(env);
  return {...(upstream&&typeof upstream==='object'?upstream:{upstream}),sessionMaintenance};
}
