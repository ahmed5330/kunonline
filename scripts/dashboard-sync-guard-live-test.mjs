/* Public, read-only diagnostic of the deployed dashboard Easy Orders guard.
 * Platform aggregate health is NOT tenant health. Anonymous GET only.
 * Pass --require-current for release acceptance; an older deployed build is
 * reported as pending rather than misdiagnosing a customer's integration. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const local=await readFile(new URL('../public/v2/modules-v121-dashboard-sync-guard.js',import.meta.url),'utf8');
const expectedVersion=local.match(/version:'([0-9.]+)'/)?.[1];
assert.ok(expectedVersion,'Current dashboard guard must expose a version');

export async function inspectDashboardSyncLive({
  base='https://app.kun-online.com',fetchImpl=fetch,nonce=Date.now(),requireCurrent=false
}={}){
  const origin=new URL(base);
  assert.equal(origin.protocol,'https:','Live diagnostic requires an HTTPS endpoint');
  const prefix=origin.origin;
  const visited=[];
  async function get(path){
    const url=prefix+path;
    visited.push(path);
    return fetchImpl(url,{
      method:'GET',credentials:'omit',redirect:'manual',
      headers:{'Accept':path.includes('/v2/')?'text/html,application/javascript':'application/json','Cache-Control':'no-cache'}
    });
  }
  const [globalResponse,pageResponse]=await Promise.all([
    get('/health/easyorders-sync?audit='+encodeURIComponent(nonce)),
    get('/v2/index.html?audit='+encodeURIComponent(nonce))
  ]);
  assert.ok([200,503].includes(globalResponse.status),'Unexpected platform health HTTP status');
  assert.equal(pageResponse.status,200,'The public V2 shell must be readable');
  const [globalHealth,page]=await Promise.all([globalResponse.json(),pageResponse.text()]);
  assert.equal(globalHealth.source,'preview','Platform health must disclose its aggregate source');
  const match=page.match(/modules-v121-dashboard-sync-guard\.js\?v=([0-9.]+)/);
  assert.ok(match,'The V2 shell must include the dashboard sync guard');
  const deployedVersion=match[1];
  const scriptResponse=await get('/v2/modules-v121-dashboard-sync-guard.js?v='+encodeURIComponent(deployedVersion)+'&audit='+encodeURIComponent(nonce));
  assert.equal(scriptResponse.status,200,'Versioned guard JavaScript must load');
  const served=await scriptResponse.text();
  assert.ok(served.includes("version:'"+deployedVersion+"'"),'HTML and deployed guard versions must agree');
  const current=deployedVersion===expectedVersion;
  if(requireCurrent)assert.ok(current,'Release is not deployed: expected dashboard guard '+expectedVersion+', found '+deployedVersion);
  let anonymousScopedAccess='not_checked_pre_release';
  if(current){
    const response=await get('/api/integrations/easyorders/dashboard-health?audit='+encodeURIComponent(nonce));
    assert.equal(response.status,401,'Anonymous caller must not receive tenant-specific Easy Orders state');
    anonymousScopedAccess='denied_401';
  }
  const safe={
    expectedVersion,deployedVersion,currentReleaseDeployed:current,
    tenantHealthVerified:false,
    anonymousScopedAccess,
    platformAggregateOnly:{
      source:'preview',
      status:String(globalHealth.status||'unknown'),
      connectionCount:Number(globalHealth.canonical?.connections)||0,
      failedConnectionCount:Number(globalHealth.canonical?.errorConnections)||0,
      failureCode:String(globalHealth.runtimeDiagnostics?.failureCode||'')
    },
    visited
  };
  // No tenant identity, connection identifiers, raw errors, credentials or
  // live account state are printed or returned by this anonymous diagnostic.
  assert.ok(!visited.some(path=>path.includes('clientId=')||path.includes('storeId=')));
  return safe;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const output=await inspectDashboardSyncLive({
    base:process.env.DASHBOARD_LIVE_BASE||'https://app.kun-online.com',
    requireCurrent:process.argv.includes('--require-current')
  });
  console.log(JSON.stringify(output));
  if(!output.currentReleaseDeployed)console.warn('Dashboard tenant-scoped guard not yet deployed: public platform health cannot validate any customer warning.');
  else console.log('Dashboard sync public release checks passed. Authenticated tenant health still requires isolated end-to-end QA.');
}
