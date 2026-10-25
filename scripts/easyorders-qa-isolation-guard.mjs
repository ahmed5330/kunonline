/* Fail-closed guard for state-writing Easy Orders release QA.
 * This is NOT proof of Cloudflare isolation: an operator must still inspect
 * actual service bindings and prove a backup/restore on separate D1.
 */
const LIVE_WORKERS=new Set(['kunonline','kunonline-preview','kunonline-sync-preview']);
const LIVE_HOSTS=new Set([
  'app.kun-online.com','kunonline-preview.mr-a-mnaa.workers.dev',
  'kunonline.mr-a-mnaa.workers.dev','kunonline-sync-preview.mr-a-mnaa.workers.dev'
]);
const LIVE_PREVIEW_D1='31cd5cdf-fc01-42d7-ba1e-571f3dd58495';
const field=(source,key)=>source.match(new RegExp('^\\s*'+key+'\\s*=\\s*"([^"]+)"','m'))?.[1]||'';
function fail(reason){throw new Error('EASYORDERS_QA_ISOLATION_REQUIRED: '+reason);}
export function assertIsolatedEasyOrdersQa({baseUrl,configText,approvedDatabaseId}={}){
  let target;
  try{target=new URL(baseUrl);}catch{fail('Provide an exact QA worker URL');}
  if(!['https:','http:'].includes(target.protocol)||target.username||target.password)
    fail('Invalid QA worker target URL');
  if(LIVE_HOSTS.has(target.hostname.toLowerCase())||
    /(^|\\.)kun-online\\.com$/i.test(target.hostname))
    fail('Refusing to run state-writing QA against a customer-facing Worker');
  if(!configText||typeof configText!=='string')fail('Dedicated QA Wrangler config is required');
  const worker=field(configText,'name'),main=field(configText,'main');
  const databaseBlock=configText.match(/\\[\\[d1_databases\\]\\]([\\s\\S]*?)(?=\\n\\[|$)/)?.[1]||'';
  const databaseName=field(databaseBlock,'database_name'),databaseId=field(databaseBlock,'database_id');
  if(!worker||!/(?:qa|sandbox|isolated)/i.test(worker)||LIVE_WORKERS.has(worker))
    fail('QA Worker must have a distinct and explicit QA/sandbox name');
  if(!main||!databaseName||!databaseId||field(databaseBlock,'binding')!=='DB')
    fail('QA app must have a distinct D1 DB binding and entrypoint');
  if(!/(?:qa|sandbox|isolated)/i.test(databaseName)||
    ['kunonline','kunonline-preview'].includes(databaseName)||databaseId===LIVE_PREVIEW_D1)
    fail('QA database must not reuse live customer D1');
  if(!approvedDatabaseId||databaseId!==String(approvedDatabaseId).trim())
    fail('Approved isolated QA D1 ID does not match Wrangler configuration');
  if(/service\\s*=\\s*"(?:kunonline|kunonline-preview|kunonline-sync-preview)"/i.test(configText))
    fail('QA configuration still points at a live Worker service');
  return {worker,databaseId};
}
