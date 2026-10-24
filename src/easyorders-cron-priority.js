/* Prioritize customer order recovery over unrelated scheduled analytics.
 * No database or provider logic belongs here. A five-minute order Cron must
 * not wait for an unrelated V33 background job to settle before starting.
 */
export function startEasyOrdersBeforeLegacy({recover,launchLegacy,ctx}={}){
  if(typeof recover!=='function'||typeof launchLegacy!=='function')
    throw new TypeError('A recovery task and a legacy task starter are required');
  // Calling recover() synchronously here starts its first provider/D1 await
  // before the old, potentially slow analytics scheduler is invoked.
  let recovery;
  try{recovery=Promise.resolve(recover());}
  catch(error){recovery=Promise.reject(error);}
  const pending=[],nestedCtx=Object.create(ctx||null);
  nestedCtx.waitUntil=task=>{if(task)pending.push(Promise.resolve(task));};
  try{
    const delegated=launchLegacy(nestedCtx);
    if(delegated&&typeof delegated.then==='function')pending.push(Promise.resolve(delegated));
  }catch(error){pending.push(Promise.reject(error));}
  // Do not block recovery/RPC health on analytics finishing; preserve their
  // lifecycle through Cloudflare waitUntil, settling rejections independently.
  const legacyDone=Promise.allSettled(pending);
  if(typeof ctx?.waitUntil==='function')ctx.waitUntil(legacyDone);
  // Only the actual Easy Orders result determines this Cron RPC success.
  return recovery;
}
