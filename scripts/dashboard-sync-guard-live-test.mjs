import assert from 'node:assert/strict';
import {renderGuard} from './dashboard-sync-guard-test.mjs';

const base=process.env.DASHBOARD_LIVE_BASE||'https://app.kun-online.com';
const nonce=Date.now();
const [healthResponse,pageResponse,scriptResponse]=await Promise.all([
  fetch(`${base}/health/easyorders-sync?verify=${nonce}`),
  fetch(`${base}/v2/index.html?verify=${nonce}`),
  fetch(`${base}/v2/modules-v121-dashboard-sync-guard.js?v=121.1&verify=${nonce}`)
]);
assert.equal(healthResponse.status,200);assert.equal(pageResponse.status,200);assert.equal(scriptResponse.status,200);
assert.equal(healthResponse.headers.get('X-Kun-Data-Source'),'preview');
const [health,page,script]=await Promise.all([healthResponse.json(),pageResponse.text(),scriptResponse.text()]);
assert.equal(health.mode,'preview-canonical');assert.equal(health.source,'preview');assert.equal(health.ok,true);
assert.equal(health.legacyFallback.active,false);assert.equal(health.canonical.ok,true);
assert.match(page,/modules-v121-dashboard-sync-guard.js\?v=121.1/);assert.match(script,/version:'121.1'/);
const {html}=await renderGuard(script,health);
assert.doesNotMatch(html,/مزامنة Easy Orders متوقفة|المحفوظ في Production/);
if(health.canonical.connections>0&&!health.runtimeDiagnostics.failureCode&&health.canonical.errorConnections===0)assert.equal(html,'');
else assert.notEqual(html,'','Actual integration issues must remain visible');
console.log(JSON.stringify({verified:true,source:health.source,status:health.status,connections:health.canonical.connections,failureCode:health.runtimeDiagnostics.failureCode,warningRendered:!!html,guardVersion:'121.1'}));
