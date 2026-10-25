// Fail-closed, read-only settlement invariants for the shared Preview/Production D1.
// The only returned values are anonymous booleans. No order, customer or account
// identifiers, amounts, or detailed financial records leave Cloudflare.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

export const FINANCE_CHECKS=Object.freeze({
  approved_topup_missing_credit:`SELECT EXISTS(
    SELECT 1 FROM wallet_topup_requests t
    WHERE t.status='approved' AND NOT EXISTS(
      SELECT 1 FROM wallet_log l WHERE l.client_id=t.client_id
        AND l.reference_type='topup_request' AND l.reference_id=t.id AND l.type='topup'
    ) LIMIT 1
  ) AS conflict`,
  credited_topup_rejected:`SELECT EXISTS(
    SELECT 1 FROM wallet_topup_requests t
    WHERE t.status IN ('rejected','cancelled') AND EXISTS(
      SELECT 1 FROM wallet_log l WHERE l.client_id=t.client_id
        AND l.reference_type='topup_request' AND l.reference_id=t.id AND l.type='topup'
    ) LIMIT 1
  ) AS conflict`,
  orphan_topup_credit:`SELECT EXISTS(
    SELECT 1 FROM wallet_log l
    WHERE l.reference_type='topup_request' AND l.type='topup'
      AND NOT EXISTS (SELECT 1 FROM wallet_topup_requests t
        WHERE t.client_id=l.client_id AND t.id=l.reference_id)
    LIMIT 1
  ) AS conflict`,
  duplicate_topup_credit:`SELECT EXISTS(
    SELECT 1 FROM (SELECT 1 FROM wallet_log
      WHERE reference_type='topup_request' AND type='topup'
      GROUP BY client_id,reference_id HAVING COUNT(*)>1 LIMIT 1)
  ) AS conflict`,
  invalid_account_balance:`SELECT EXISTS(
    SELECT 1 FROM wallet_accounts
    WHERE balance IS NULL OR typeof(balance) NOT IN ('integer','real')
      OR balance<0-credit_limit LIMIT 1
  ) AS conflict`
});
export function verifyFinanceSqlReadonly(){
  for(const sql of Object.values(FINANCE_CHECKS)){
    assert(sql.startsWith('SELECT EXISTS('),'finance gate permits SELECT EXISTS only');
    assert(!/;|\b(?:UPDATE|DELETE|INSERT|ALTER|DROP|REPLACE|ATTACH|DETACH|PRAGMA)\b/i.test(sql),
      'finance gate must not change customer data');
  }
  return true;
}
function resultsOf(payload){
  if(Array.isArray(payload)){
    for(const item of payload){const r=resultsOf(item);if(r)return r;}
    return null;
  }
  if(payload && typeof payload==='object'){
    if(Object.hasOwn(payload,'conflict'))return [payload];
    if(Array.isArray(payload.results))return payload.results;
    if(Array.isArray(payload.result))return resultsOf(payload.result);
  }
  return null;
}
export function assertFinanceResults(values){
  const failures=[];
  for(const check of Object.keys(FINANCE_CHECKS)){
    const raw=values?.[check];
    if(raw===null||raw===undefined||raw==='')throw Error('Finance check response missing: '+check);
    const result=Number(raw);
    if(result!==0&&result!==1)throw Error('Invalid finance check response: '+check);
    if(result===1)failures.push(check);
  }
  if(failures.length)throw Error('Finance settlement inconsistencies detected ('+failures.join(', ')+'); release blocked');
  return {ok:true,checks:Object.keys(FINANCE_CHECKS).length};
}
export async function verifyLiveFinanceSettlement(run){
  verifyFinanceSqlReadonly();
  const values={};
  for(const [name,sql] of Object.entries(FINANCE_CHECKS)){
    const rows=resultsOf(await run(sql));
    if(!rows || rows.length!==1 || !Object.hasOwn(rows[0],'conflict'))
      throw Error('Finance check did not return an authoritative result: '+name);
    values[name]=rows[0].conflict;
  }
  return assertFinanceResults(values);
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const result=await verifyLiveFinanceSettlement(sql=>JSON.parse(execFileSync('npx',[
    'wrangler','d1','execute','kunonline-preview','--remote','--json',
    '--config','wrangler.preview.toml','--command',sql
  ],{encoding:'utf8',timeout:60000,maxBuffer:1024*1024})));
  console.log('Shared D1 wallet settlement invariants PASS: '+result.checks+' checks; no customer rows were queried.');
}
