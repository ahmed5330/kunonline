/* Simulates optional finance/ad SELECT failures with synthetic data only. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {adminClientCommandCenter,resolveAdminBriefRange} from '../src/admin-client-command-center.js';

function syntheticEnv({ads=false,finance=false,orders=false}={}){
  const reads=[];
  return {reads,DB:{prepare(sql){
    reads.push(sql);
    return {
      bind(){return this;},
      async first(){
        if(sql.includes('SELECT json FROM state'))return {json:'{"clients":[]}'};
        throw Error('Unexpected SQL first '+sql);
      },
      async all(){
        if(sql.includes('SELECT client_id FROM tenant_settings UNION'))return {results:[]};
        if(sql.includes('FROM orders WHERE date(')){
          if(orders)throw Error('synthetic main orders failure');
          return {results:[]};
        }
        if(sql.includes('FROM products WHERE active=1'))return {results:[]};
        if(sql.includes('FROM campaign_daily_metrics')){
          if(ads)throw Error('synthetic optional ad failure');
          return {results:[]};
        }
        if(sql.includes('FROM transactions WHERE date(')){
          if(finance)throw Error('synthetic optional ledger failure');
          return {results:[]};
        }
        throw Error('Unexpected SQL all '+sql);
      },
      async run(){throw Error('Read-only Admin report attempted DB write');}
    };
  }}};
}
const period=resolveAdminBriefRange({preset:'30d',now:new Date('2026-10-23T12:00:00Z')});
const normal=await adminClientCommandCenter(syntheticEnv(),{me:{role:'admin',uid:'fake-admin'},range:period});
assert.deepEqual(normal.sourceAvailability,{ads:'ok',finance:'ok'});
assert.equal(normal.totals.orders,0,'legitimate empty source can return actual zero');
for(const scenario of [{ads:true},{finance:true},{ads:true,finance:true}]){
  const result=await adminClientCommandCenter(syntheticEnv(scenario),{me:{role:'admin',uid:'fake-admin'},range:period});
  assert.equal(result.ok,true,'unrelated sources should continue loading');
  assert.equal(result.sourceAvailability.ads,scenario.ads?'unavailable':'ok');
  assert.equal(result.sourceAvailability.finance,scenario.finance?'unavailable':'ok');
  assert.deepEqual(result.clients,[]);
}
await assert.rejects(
  ()=>adminClientCommandCenter(syntheticEnv({orders:true}),{me:{role:'admin',uid:'fake-admin'},range:period}),
  /synthetic main orders failure/,
  'mandatory order data errors cannot masquerade as zero'
);
const ui=await readFile(new URL('../public/v2/modules-v74-admin-client-command-center.js',import.meta.url),'utf8');
assert.doesNotThrow(()=>new Function(ui));
for(const literal of ['sourceAvailability?.ads','sourceAvailability?.finance','warningHtml','غير متاح','role="alert"']){
  assert.ok(ui.includes(literal),'missing unavailable-source UI indicator '+literal);
}
assert.match(ui,/S\.adSourceAvailable===false\?'غير متاح':money\(m\.spend\)/);
assert.match(ui,/adsAvailable\?money\(t\.spend\)\+' ج':'غير متاح'/);
console.log('Admin optional-source safety PASS: finance/ad outage explicitly labeled, true empty remains zero, required orders outage propagates, no DB writes.');
