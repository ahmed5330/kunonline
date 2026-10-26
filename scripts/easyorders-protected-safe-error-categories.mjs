// Approved one-off read-only Cloudflare D1 classifier.
// No customer/order rows, tenant IDs, store names, secrets or raw provider
// error messages are written to stdout or GitHub Actions logs.
// The only SQL executed is the constant SELECT below.
import {spawnSync} from 'node:child_process';

const SELECT = `SELECT
  json_extract(config_json,'$.easyOrdersRecoveryLastStatus') AS recovery_status,
  json_extract(config_json,'$.easyOrdersRecoveryLastRunAt') AS last_run_at,
  json_extract(config_json,'$.easyOrdersRecoveryLastError') AS recovery_error,
  json_extract(config_json,'$.easyOrdersRecoveryLastProviderHttpStatus') AS provider_http_status,
  json_extract(config_json,'$.easyOrdersRecoveryLastProviderErrorCategory') AS provider_error_category,
  json_extract(config_json,'$.easyOrdersRecoveryLastPositiveControlHttpStatus') AS positive_control_http_status,
  json_extract(config_json,'$.easyOrdersRecoveryLastPositiveControlIdentityVerified') AS positive_control_verified
FROM store_connections
WHERE provider='easyorders' AND status='connected'
LIMIT 25`;

export function classifyRecoveryError(value){
  const text=String(value??'').slice(0,2048);
  if(!text.trim())return 'NO_ERROR_TEXT';
  if(/(?:HTTP\s*(401|403)|unauthorized|forbidden|invalid\s+api.?key|api.?key\s+not\s+valid)/i.test(text))return 'UPSTREAM_CREDENTIAL_REJECTED';
  if(/(?:HTTP\s*429|rate.?limit|too\s+many\s+requests)/i.test(text))return 'UPSTREAM_RATE_LIMIT';
  if(/(?:HTTP\s*5\d{2}|bad\s+gateway|service\s+unavailable|upstream.*(error|failed))/i.test(text))return 'UPSTREAM_SERVER_ERROR';
  if(/(?:HTTP\s*4\d{2}|bad\s+request|unprocessable|provider.*(reject|fail))/i.test(text))return 'UPSTREAM_REQUEST_REJECTED';
  if(/(?:SQLITE|D1_|no\s+such\s+(table|column)|constraint|database\s+is\s+locked|DB\.prepare)/i.test(text))return 'DATABASE_SCHEMA_OR_WRITE';
  if(/(?:external.*store|store.*identity|STORE_UNBOUND|STORE_MISMATCH|store_id.*(missing|mismatch))/i.test(text))return 'EXTERNAL_STORE_BINDING';
  if(/(?:webhook|ingest|payload.*invalid|order.*collision|canonical)/i.test(text))return 'CANONICAL_WEBHOOK_OR_VALIDATION';
  if(/(?:encrypt|decrypt|key\s+missing|cannot.*key)/i.test(text))return 'SECRET_DECRYPT_OR_MISSING';
  if(/(?:fetch\s+failed|network|timeout|timed\s+out|socket|ECONN)/i.test(text))return 'NETWORK_OR_TIMEOUT';
  if(/(?:management\s+fee|reconcil|accounting|fee\s+write)/i.test(text))return 'FEE_RECONCILIATION';
  if(/(?:order\s+not\s+found|record\s+not\s+found|HTTP\s*404)/i.test(text))return 'UPSTREAM_ORDER_NOT_FOUND';
  return 'OTHER_UNCLASSIFIED';
}

const knownStatuses=new Set(['healthy','error','rate_limited','catching_up','waiting_for_seed','unknown']);
function safeStatus(value){const status=String(value??'unknown').trim().toLowerCase();return knownStatuses.has(status)?status:'unknown';}
export function summarizeRecoveryRows(rows,nowMs=Date.now()){
  if(!Array.isArray(rows)||rows.length>25)throw Error('EASYORDERS_DIAGNOSTIC_RESULT_UNEXPECTED');
  const byCategory={},byStatus={},byProviderHttpStatus={},byProviderErrorCategory={},
    byPositiveControlHttpStatus={},checked={within20Minutes:0,olderThan20Minutes:0,neverOrInvalid:0};
  let verifiedKnownOrderControls=0;
  for(const row of rows){
    const category=classifyRecoveryError(row?.recovery_error);
    const status=safeStatus(row?.recovery_status);
    byCategory[category]=(byCategory[category]||0)+1;
    byStatus[status]=(byStatus[status]||0)+1;
    const numericStatus=value=>{const n=Number(value);return Number.isInteger(n)&&n>=200&&n<=599?String(n):'not_recorded';};
    const providerHttp=numericStatus(row?.provider_http_status);
    const positiveHttp=numericStatus(row?.positive_control_http_status);
    const categoryRaw=String(row?.provider_error_category||'');
    const providerCategory=['provider_auth','provider_throttle','provider_server_error','provider_other_http','provider_unknown_http']
      .includes(categoryRaw)?categoryRaw:'not_recorded';
    byProviderHttpStatus[providerHttp]=(byProviderHttpStatus[providerHttp]||0)+1;
    byProviderErrorCategory[providerCategory]=(byProviderErrorCategory[providerCategory]||0)+1;
    byPositiveControlHttpStatus[positiveHttp]=(byPositiveControlHttpStatus[positiveHttp]||0)+1;
    if(row?.positive_control_verified===true||row?.positive_control_verified===1)verifiedKnownOrderControls++;
    const time=Date.parse(String(row?.last_run_at??''));
    if(!Number.isFinite(time)||time>nowMs+60_000)checked.neverOrInvalid++;
    else if(nowMs-time<=20*60*1000)checked.within20Minutes++;
    else checked.olderThan20Minutes++;
  }
  return {kind:'EASYORDERS_CANONICAL_D1_ERROR_CATEGORIES_READ_ONLY',
    connections:rows.length,byStatus,byCategory,byProviderHttpStatus,byProviderErrorCategory,
    byPositiveControlHttpStatus,verifiedKnownOrderControls,checked,
    customerRowsReturned:false,customerIdentifiersReturned:false,
    providerErrorsReturned:false,providerSecretsReturned:false,
    d1Writes:false,cloudflareDeployment:false,
    // Classification is only a root-cause hint, not order-completeness proof.
    wefaqHistoricalCompletenessProven:false
  };
}

function fromWranglerJson(raw){
  const parsed=JSON.parse(raw);
  const collections=Array.isArray(parsed)?parsed:[parsed];
  const rows=collections.flatMap(item=>Array.isArray(item?.results)?item.results:
    Array.isArray(item?.result?.results)?item.result.results:[]);
  if(!rows.length){
    const meta=collections.find(x=>x?.success===false);
    if(meta)throw Error('EASYORDERS_D1_SELECT_UNAVAILABLE');
  }
  return rows;
}
export function validateQuery(sql=SELECT){
 if(!/^SELECT\b/i.test(sql.trim())||/;|--|\/\*|\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|ATTACH|PRAGMA)\b/i.test(sql))
   throw Error('ONLY_CONSTANT_SELECT_IS_ALLOWED');
 return sql;
}

if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 try{
  if(!process.env.CLOUDFLARE_API_TOKEN||!process.env.CLOUDFLARE_ACCOUNT_ID)
    throw Error('EASYORDERS_READONLY_D1_AUTH_MISSING');
  validateQuery();
  const cli=spawnSync('./node_modules/.bin/wrangler',[
    'd1','execute','kunonline-preview','--remote','--config','wrangler.preview.toml',
    '--json','--command',SELECT
  ],{encoding:'utf8',timeout:60000,maxBuffer:1024*1024,env:process.env});
  if(cli.error||cli.status!==0)throw Error('EASYORDERS_READONLY_D1_SELECT_FAILED');
  const rows=fromWranglerJson(cli.stdout);
  const summary=summarizeRecoveryRows(rows);
  console.log(JSON.stringify(summary,null,2));
 }catch(error){
  // Deliberately NEVER print Wrangler stderr/stdout or any database error.
  console.error(JSON.stringify({ok:false,code:/^EASYORDERS_|^ONLY_CONSTANT/.test(error?.message||'')?error.message:'EASYORDERS_READONLY_DIAGNOSTIC_UNAVAILABLE',writes:false,rawErrorsPrinted:false}));
  process.exitCode=1;
 }
}
