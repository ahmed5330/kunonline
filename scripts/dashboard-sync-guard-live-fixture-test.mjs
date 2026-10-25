import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {inspectDashboardSyncLive} from './dashboard-sync-guard-live-test.mjs';

// Derive the current guard version from the checked-out source. This is a
// synthetic release-gate fixture, NEVER evidence of a deployed Cloudflare version.
const localGuard=await readFile(new URL('../public/v2/modules-v121-dashboard-sync-guard.js',import.meta.url),'utf8');
const expected=localGuard.match(/version:'([0-9.]+)'/)?.[1];
assert.ok(expected,'checked-out dashboard source must specify a version');

const fixture={
  ok:true,source:'preview',mode:'preview-canonical',status:'error',
  canonical:{connections:2,errorConnections:2},
  runtimeDiagnostics:{failureCode:'EASYORDERS_SYNC_ERROR',secret:'NEVER_PRINT_PROVIDER_SECRET'},
  privateId:'NEVER_PRINT_PRIVATE_CONNECTION',
  tenants:[{clientId:'NEVER_PRINT_CLIENT_ID'}]
};
function fakeLive(version,{scopedStatus=401,parityStatus=401,platform=fixture}={}){
  const calls=[];
  async function fetchImpl(url,options){
    const u=new URL(url);
    calls.push({path:u.pathname,search:u.search,method:options.method,credentials:options.credentials});
    assert.equal(u.protocol,'https:');
    assert.equal(options.method,'GET','Live public diagnostic must never mutate data');
    assert.equal(options.credentials,'omit','Live probe must not authenticate as a customer');
    if(u.pathname==='/health/preview-parity')return Response.json({error:'AUTH_REQUIRED'},{status:parityStatus});
    if(u.pathname==='/health/easyorders-sync')return Response.json(platform);
    if(u.pathname==='/v2/')return new Response('<script src="/v2/modules-v121-dashboard-sync-guard.js?v='+version+'"></script>',{status:200});
    if(u.pathname==='/v2/modules-v121-dashboard-sync-guard.js')return new Response("window.KunDashboardSyncGuardV121={version:'"+version+"'};",{status:200});
    if(u.pathname==='/api/integrations/easyorders/dashboard-health')return Response.json({error:'AUTH_REQUIRED'},{status:scopedStatus});
    throw Error('Unexpected read-only URL '+url);
  }
  return {calls,fetchImpl};
}
const old=fakeLive('121.1');
const legacy=await inspectDashboardSyncLive({base:'https://qa.example.test',fetchImpl:old.fetchImpl,nonce:10});
assert.equal(legacy.currentReleaseDeployed,false);
assert.equal(legacy.tenantHealthVerified,false);
assert.equal(legacy.anonymousScopedAccess,'not_checked_pre_release');
assert.equal(legacy.platformAggregateOnly.status,'error');
assert.equal(legacy.platformAggregateOnly.connectionCount,2);
assert.equal(legacy.platformAggregateOnly.failureCode,'EASYORDERS_SYNC_ERROR');
assert.equal(old.calls.length,3,'Do not test a tenant route before the rollout');
assert.doesNotMatch(JSON.stringify(legacy),/NEVER_PRINT_/,'Do not output sensitive provider or tenant details');
await assert.rejects(
  inspectDashboardSyncLive({base:'https://qa.example.test',fetchImpl:old.fetchImpl,requireCurrent:true}),
  /Release is not deployed/,
  'Strict release acceptance must not pass on deployed legacy version'
);
const now=fakeLive(expected);
const current=await inspectDashboardSyncLive({base:'https://qa.example.test',fetchImpl:now.fetchImpl,nonce:11,requireCurrent:true});
assert.equal(current.currentReleaseDeployed,true);
assert.equal(current.anonymousScopedAccess,'denied_401');
assert.equal(current.tenantHealthVerified,false,'Anonymous check can never establish authenticated tenant correctness');
assert.equal(now.calls.length,5);
assert.equal(current.privateParityAccess,'denied_401');
assert.ok(now.calls.some(x=>x.path==='/api/integrations/easyorders/dashboard-health'));
assert.ok(now.calls.every(x=>x.method==='GET'&&x.credentials==='omit'));
const insecure=fakeLive(expected,{scopedStatus:200});
await assert.rejects(
  inspectDashboardSyncLive({base:'https://qa.example.test',fetchImpl:insecure.fetchImpl}),
  /Anonymous caller must not receive tenant-specific/,
  'Public tenant health exposure must fail the release gate'
);
await assert.rejects(
  inspectDashboardSyncLive({base:'http://qa.example.test',fetchImpl:now.fetchImpl}),
  /requires an HTTPS endpoint/,
  'No insecure public HTTP diagnostics'
);
console.log('Dashboard live-probe fixture PASS: legacy rollout pending, aggregate is not tenant health, new anonymous tenant route must deny, and no live writes.');

await assert.rejects(()=>inspectDashboardSyncLive({base:'https://qa.example.test',fetchImpl:fakeLive(expected,{parityStatus:200}).fetchImpl,requireCurrent:true}),/Private parity diagnostics/);
