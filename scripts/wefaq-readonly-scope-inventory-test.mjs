import assert from 'node:assert/strict';
import {candidateConnections,summarizeCandidate} from './wefaq-readonly-scope-inventory.mjs';
const stores=[{id:'PRIVATE_STORE',client_id:'PRIVATE_CLIENT'}];
const row={id:'PRIVATE_CONNECTION',client_id:'PRIVATE_CLIENT',config_store_id:'PRIVATE_STORE',external_store_id:'PRIVATE_PROVIDER_STORE',status:'connected',key_count:1,last_error_present:1,highest:122,cursor:123};
assert.equal(candidateConnections(stores,[row]).length,1);
assert.equal(candidateConnections(stores,[{...row,client_id:'OTHER'}]).length,0);
assert.equal(candidateConnections(stores,[{...row,config_store_id:'OTHER'}]).length,0);
const report=summarizeCandidate(row,{total:666,recent:3});
assert.equal(report.externalStoreBound,true);
assert.equal(report.missingOrderCount,null);
assert.equal(report.upstreamIdentityVerified,false);
assert.equal(report.realOrdersRecovered,null);
assert.equal(report.verifiedRealOrdersRecovered,0);
for(const secret of ['PRIVATE_STORE','PRIVATE_CLIENT','PRIVATE_CONNECTION','PRIVATE_PROVIDER_STORE'])assert.ok(!JSON.stringify(report).includes(secret));
assert.equal(summarizeCandidate({...row,external_store_id:'CON-PLACEHOLDER'},{}).externalStoreBound,false);
console.log('PASS: exact metadata store/client mapping, placeholder rejection and fingerprint-only reports; order counts never imply missing orders or recovery.');

const known=summarizeCandidate({...row,recovery_status:'error',last_cron_at:'2026-10-25T13:10:44.223Z',cron_error_class:'record_not_found_http_unknown'},{});
assert.equal(known.providerHttpStatus,null,'An error message never establishes an HTTP code');
assert.equal(known.cronErrorClass,'record_not_found_http_unknown');
assert.equal(known.recoveryStatus,'error');
assert.equal(known.lastCronAt,'2026-10-25T13:10:44.223Z');
const malicious=summarizeCandidate({...row,recovery_status:'PRIVATE_PAYLOAD',last_cron_at:'PRIVATE_PAYLOAD',cron_error_class:'PRIVATE_PAYLOAD'},{});
assert.ok(!JSON.stringify(malicious).includes('PRIVATE_PAYLOAD'),'Unrecognized database strings never leak into diagnostics');

const measured=summarizeCandidate({...row,provider_http_status:503,provider_error_category:'provider_server_error'},{});
assert.equal(measured.providerHttpStatus,503);
assert.equal(measured.providerErrorCategory,'provider_server_error');
const invalid=summarizeCandidate({...row,provider_http_status:'PRIVATE_HTTP_PAYLOAD',provider_error_category:'PRIVATE_PROVIDER_PAYLOAD'},{});
assert.equal(invalid.providerHttpStatus,null);
assert.equal(invalid.providerErrorCategory,null);
assert.ok(!JSON.stringify(invalid).includes('PRIVATE_'));

const cron=new Date(Date.now()-1000).toISOString(),control=new Date(Date.now()-2000).toISOString();
const verified=summarizeCandidate({...row,last_cron_at:cron,positive_control_at:control,positive_control_http:200,positive_control_identity:1},{});
assert.equal(verified.upstreamIdentityVerified,true);
assert.equal(verified.providerAuditExecuted,false,'One known order is not a complete gap audit');
assert.equal(verified.missingOrderCount,null);
for(const patch of [{positive_control_http:403},{positive_control_identity:0},{positive_control_at:'PRIVATE_CONTROL_PAYLOAD'},
  {positive_control_at:'2020-01-01T00:00:00Z',last_cron_at:'2020-01-01T00:00:01Z'},
  {last_cron_at:new Date(Date.now()+60000).toISOString()}]){
  const failed=summarizeCandidate({...row,last_cron_at:cron,positive_control_at:control,positive_control_http:200,positive_control_identity:1,...patch},{});
  assert.equal(failed.upstreamIdentityVerified,false,'Missing, stale, future, failed and foreign controls never prove identity');
  assert.ok(!JSON.stringify(failed).includes('PRIVATE_CONTROL_PAYLOAD'));
}
