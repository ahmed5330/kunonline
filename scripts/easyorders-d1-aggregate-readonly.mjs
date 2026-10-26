/**
 * One-shot *read-only* D1 diagnosis of aggregate Easy Orders error categories.
 * Runs only in the already protected GitHub Preview environment.
 *
 * Never select client/store/connection IDs, secrets, webhook routes, order
 * data, provider response text or plaintext last_error. The SQL is a fixed
 * SELECT and the printed result has a strictly numeric allow-list.
 */
import {execFileSync} from 'node:child_process';

export const AGGREGATE_SQL=`
WITH scoped AS (
  SELECT CASE WHEN json_valid(config_json) THEN config_json ELSE '{}' END AS cfg
  FROM store_connections
  WHERE provider='easyorders' AND status='connected'
), diagnostics AS (
  SELECT json_extract(cfg,'$.easyOrdersRecoveryLastStatus') AS status,
    CAST(json_extract(cfg,'$.easyOrdersRecoveryLastProviderHttpStatus') AS INTEGER) AS upstream_code,
    json_extract(cfg,'$.easyOrdersRecoveryLastCronAt') AS cron_at,
    json_extract(cfg,'$.easyOrdersRecoveryLastPositiveControlIdentityVerified') AS positive_control
  FROM scoped
)
SELECT COUNT(*) AS connected,
  COALESCE(SUM(CASE WHEN status='error' THEN 1 ELSE 0 END),0) AS errors,
  COALESCE(SUM(CASE WHEN status='healthy' THEN 1 ELSE 0 END),0) AS healthy,
  COALESCE(SUM(CASE WHEN status='rate_limited' THEN 1 ELSE 0 END),0) AS throttled,
  COALESCE(SUM(CASE WHEN upstream_code=400 THEN 1 ELSE 0 END),0) AS http400,
  COALESCE(SUM(CASE WHEN upstream_code IN (401,403) THEN 1 ELSE 0 END),0) AS httpAuth,
  COALESCE(SUM(CASE WHEN upstream_code=429 THEN 1 ELSE 0 END),0) AS http429,
  COALESCE(SUM(CASE WHEN upstream_code>=500 AND upstream_code<600 THEN 1 ELSE 0 END),0) AS http5xx,
  COALESCE(SUM(CASE WHEN status='error' AND upstream_code IS NULL THEN 1 ELSE 0 END),0) AS errorsWithoutHttp,
  COALESCE(SUM(CASE WHEN cron_at IS NOT NULL THEN 1 ELSE 0 END),0) AS everCron,
  COALESCE(SUM(CASE WHEN cron_at IS NOT NULL AND
    datetime(cron_at)>=datetime('now','-20 minutes') THEN 1 ELSE 0 END),0) AS recentCron,
  COALESCE(SUM(CASE WHEN positive_control=1 THEN 1 ELSE 0 END),0) AS positiveControlVerified
FROM diagnostics`;
const PERMITTED=[
  'connected','errors','healthy','throttled','http400','httpAuth',
  'http429','http5xx','errorsWithoutHttp','everCron','recentCron',
  'positiveControlVerified'
];
const safeCount=v=>Number.isSafeInteger(Number(v))&&Number(v)>=0?Number(v):null;

export function safeEasyOrdersD1Aggregate(raw){
  const parsed=typeof raw==='string'?JSON.parse(raw):raw;
  const statements=Array.isArray(parsed)?parsed:[parsed];
  if(statements.length!==1||statements[0]?.success!==true)throw Error('D1_READONLY_AGGREGATE_UNAVAILABLE');
  const rows=statements[0].results;
  if(!Array.isArray(rows)||rows.length!==1)throw Error('D1_READONLY_AGGREGATE_SHAPE_INVALID');
  const src=rows[0],out={};
  for(const key of PERMITTED){
    const value=safeCount(src?.[key]);
    if(value===null)throw Error('D1_READONLY_AGGREGATE_COUNT_INVALID');
    out[key]=value;
  }
  if(out.errors>out.connected||out.healthy>out.connected||out.recentCron>out.connected)
    throw Error('D1_READONLY_AGGREGATE_IMPOSSIBLE_COUNTS');
  return {ok:true,kind:'EASYORDERS_D1_AGGREGATE_ONLY',
    noCustomerRows:true,noStoredSecrets:true,noDatabaseWrites:true,...out};
}
export function readEasyOrdersD1Aggregate({
  executor=execFileSync
}={}){
  const bin='./node_modules/.bin/wrangler';
  const args=['d1','execute','kunonline-preview','--remote',
    '--config','wrangler.preview.toml','--command',AGGREGATE_SQL,'--json'];
  // Wrangler executes a fixed read-only CTE/SELECT; never issue schema
  // migrations or display raw API responses on failure.
  let stdout;
  try{
    stdout=executor(bin,args,{encoding:'utf8',timeout:45_000,maxBuffer:128*1024,
      stdio:['ignore','pipe','pipe']});
  }catch{throw Error('D1_READONLY_AGGREGATE_UNAVAILABLE');}
  try{return safeEasyOrdersD1Aggregate(stdout);}
  catch{throw Error('D1_READONLY_AGGREGATE_UNAVAILABLE');}
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  try{console.log(JSON.stringify(readEasyOrdersD1Aggregate(),null,2));}
  catch{console.error(JSON.stringify({ok:false,code:'D1_READONLY_AGGREGATE_UNAVAILABLE',
    noCustomerRows:true,noDatabaseWrites:true}));process.exitCode=1;}
}
