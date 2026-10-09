import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {clarityProjectId,clarityTraffic,clarityMetrics,handleClarityApi} from '../src/clarity-integration.js';

const tagId='pqr45ABC89';
assert.equal(clarityProjectId(tagId),tagId);
assert.equal(clarityProjectId('https://www.clarity.ms/tag/'+tagId),tagId);
assert.equal(clarityProjectId('(window,document,"clarity","script","'+tagId+'");'),tagId);
assert.throws(()=>clarityProjectId('<script>bad</script>'));
assert.throws(()=>clarityProjectId('a'));

const sample=[{metricName:'Traffic',information:[
  {Campaign:'Launch A',Source:'facebook',Device:'Mobile',totalSessionCount:'35',totalBotSessionCount:'5'},
  {Campaign:'Launch A',Source:'instagram',Device:'Desktop',totalSessionCount:'5',totalBotSessionCount:'1'},
  {Campaign:'Launch B',Source:'facebook',Device:'Desktop',totalSessionCount:'10',totalBotSessionCount:'0'},
]},{metricName:'RageClickCount',information:[{Campaign:'Launch A',sessionsWithMetricPercentage:17}]}];
const campaign=clarityTraffic(sample,'Campaign');
assert.deepEqual(campaign.map(x=>[x.name,x.sessions,x.botSessions]),[['Launch A',40,6],['Launch B',10,0]]);
assert.deepEqual(clarityTraffic(sample,'Source').map(x=>[x.name,x.sessions]),[['facebook',45],['instagram',5]]);
assert.deepEqual(clarityTraffic(sample,'Device').map(x=>x.sessions),[35,15]);
assert.equal(clarityMetrics(sample)[1].name,'RageClickCount');

const unauthorized=await handleClarityApi({
  request:new Request('https://example.test/api/clarity/status?clientId=other&storeId=test'),
  env:{},ctx:{},delegate:{fetch:async()=>new Response(JSON.stringify({error:'not logged in'}),{status:401,headers:{'content-type':'application/json'}})}
});
assert.equal(unauthorized.status,401);
assert.equal((await unauthorized.json()).code,'AUTH_REQUIRED');

const scope=await handleClarityApi({
  request:new Request('https://example.test/api/clarity/insights?clientId=other&storeId=test'),
  env:{},ctx:{},delegate:{fetch:async()=>new Response(JSON.stringify({role:'client',clientId:'mine'}),{status:200,headers:{'content-type':'application/json'}})}
});
assert.equal(scope.status,403);
assert.equal((await scope.json()).code,'TENANT_ISOLATION');

const missingStore=await handleClarityApi({
  request:new Request('https://example.test/api/clarity/status?clientId=mine'),
  env:{},ctx:{},delegate:{fetch:async()=>new Response(JSON.stringify({role:'client',clientId:'mine'}),{status:200,headers:{'content-type':'application/json'}})}
});
assert.equal(missingStore.status,400);
assert.equal((await missingStore.json()).code,'CLARITY_STORE_REQUIRED');

const frontend=readFileSync(new URL('../public/v2/modules-v135-clarity.js',import.meta.url),'utf8');
new Function(frontend);
assert.match(frontend,/api\/clarity\/connect/);
assert.match(frontend,/api\/clarity\/insights/);
assert.match(frontend,/api\/integrations\/meta-ads\/performance/);
const html=readFileSync(new URL('../public/v2/index.html',import.meta.url),'utf8');
assert.match(html,/modules-v135-clarity\.js/);
console.log('Microsoft Clarity contract tests passed');
