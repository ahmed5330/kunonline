import assert from 'node:assert/strict';
import {inspectPublicEasyOrdersRuntime} from './easyorders-public-runtime-health-get.mjs';

const call=[];
const fetcher=async (url,options)=>{
 call.push({url,options});
 assert.equal(options.method,'GET');
 assert.equal(options.credentials,'omit');
 assert.equal(options.redirect,'error');
 assert.equal(options.headers['Cache-Control'],'no-cache');
 assert.match(url,/^https:\/\//);
 assert.ok(!options.headers.Authorization,'No Cloudflare token or customer session attached');
 if(url.endsWith('/healthz'))return Response.json({
  ok:true,service:'kunonline-sync-preview',build:'synthetic-scheduler',
  upstream:{ok:true,sensitive:'DO_NOT_EXPOSE_PRIVATE_TENANT_ID'},
  policy:{easyOrdersRecovery:'every-5-minutes'}
 });
 if(url.endsWith('/api/preview/version'))return Response.json({
  ok:true,build:'synthetic-preview',entrypoint:'index-commerce-v34.js',
  environment:'preview',customer:'DO_NOT_EXPOSE_PRIVATE_TENANT_ID'});
 return Response.json({ok:true,status:'scheduler_stale',source:'preview',
  canonical:{connections:4,errorConnections:0},
  runtimeDiagnostics:{failureCode:'EASYORDERS_RECOVERY_STALE',
   invalidApiKeyClients:0,unreadableKeyClients:1,
   staleRecoveryConnections:3,neverRanRecoveryConnections:1,staleAfterMinutes:20,
   customerData:'DO_NOT_EXPOSE_PRIVATE_TENANT_ID'}});
};
const result=await inspectPublicEasyOrdersRuntime({fetcher});
assert.equal(result.allPublicEndpointsReachable,true);
assert.equal(result.noLiveWrites,true);
assert.equal(result.checks.scheduler.upstreamHealthResponded,true);
assert.equal(result.checks.scheduler.cronExecutionProven,false,'Health RPC is NOT proof of scheduled executions');
assert.equal(result.checks.production.connectedIntegrations,4);
assert.equal(result.checks.production.staleRecoveryConnections,3);
assert.equal(result.checks.production.invalidApiKeyIntegrations,0);
assert.equal(result.checks.production.unreadableApiKeyIntegrations,1);
assert.equal(result.checks.production.errorIntegrations,0);
assert.equal(call.length,3,'Only 3 public GET probes permitted');
assert.ok(!JSON.stringify(result).includes('DO_NOT_EXPOSE_PRIVATE_TENANT_ID'));
const deny=await inspectPublicEasyOrdersRuntime({fetcher:async()=>new Response('DO_NOT_PRINT_SECRET',{status:403})});
assert.equal(deny.allPublicEndpointsReachable,false);
assert.ok(!JSON.stringify(deny).includes('DO_NOT_PRINT_SECRET'));
const unreachable=await inspectPublicEasyOrdersRuntime({fetcher:async()=>{throw Error('DO_NOT_PRINT_SECRET');}});
assert.equal(unreachable.allPublicEndpointsReachable,false);
assert.ok(!JSON.stringify(unreachable).includes('DO_NOT_PRINT_SECRET'));
console.log('Public runtime health OFFLINE QA PASS: three GETs only, no cookies, safe redaction, no claim of cron execution.');
