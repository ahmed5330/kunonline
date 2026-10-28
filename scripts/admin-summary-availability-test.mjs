import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {adminClientCommandCenter} from '../src/admin-client-command-center.js';

const range={from:'2026-10-28',to:'2026-10-28'};
function fixture(failedSource){
  return {DB:{prepare(sql){return {
    bind(){return this;},
    async first(){
      if(sql.includes('SELECT json FROM state'))return {json:'{"clients":[]}'};
      return {};
    },
    async all(){
      if(sql.includes('SELECT client_id FROM tenant_settings UNION'))return {results:[{client_id:'QA-AVAILABILITY'}]};
      if((failedSource==='marketing'&&sql.includes('FROM campaign_daily_metrics'))||
         (failedSource==='finance'&&sql.includes('FROM transactions')))
        throw new Error('PRIVATE_DATABASE_DETAIL_MUST_NOT_ESCAPE');
      return {results:[]};
    }
  };}}};
}
for(const source of ['marketing','finance']){
  await assert.rejects(adminClientCommandCenter(fixture(source),{me:{role:'admin'},range}),error=>{
    assert.equal(error.status,503);
    assert.equal(error.code,'ADMIN_SUMMARY_DATA_UNAVAILABLE');
    assert.match(error.message,/غير متاح/);
    assert.ok(!error.message.includes('PRIVATE_DATABASE_DETAIL'));
    return true;
  },`${source} query failure cannot become a zero-valued summary`);
}
const empty=await adminClientCommandCenter(fixture(),{me:{role:'admin'},range});
assert.equal(empty.ok,true,'successful empty reads remain valid');
assert.equal(empty.clients.length,1);
assert.equal(empty.clients[0].finance.expenses,0);
assert.equal(empty.clients[0].marketing.spend,0);
assert.equal(empty.totals.spend,0);
// Exercise the shipped UI: failed reads show unavailable + retry, never zero KPIs.
const root={dataset:{},innerHTML:''},timers=[];let retry,calls=0;
const K={root:()=>root,esc:v=>String(v??''),money:v=>String(v),api:async()=>{
  calls++;return adminClientCommandCenter(fixture('finance'),{me:{role:'admin'},range});
}};
const document={body:{},documentElement:{dataset:{}},addEventListener(){},querySelector:()=>({}),
  getElementById:id=>id==='admin74Style'?{}:id==='admin74Retry'?{addEventListener(event,callback){retry=callback;}}:null};
runInNewContext(readFileSync(new URL('../public/v2/modules-v74-admin-client-command-center.js',import.meta.url),'utf8'),{
  window:{KunActionsV23:K},document,URLSearchParams,setTimeout:fn=>timers.push(fn),MutationObserver:class{observe(){}}
});
for(const timer of timers)timer();
await new Promise(setImmediate);
assert.equal(root.dataset.admin74,'error');
assert.match(root.innerHTML,/غير متاح/);
assert.doesNotMatch(root.innerHTML,/admin74-summary|admin74-kpi/);
assert.equal(typeof retry,'function');
await retry();
assert.equal(calls,2,'retry performs a fresh read');
assert.equal(root.dataset.admin74,'error','repeated failure never becomes a successful zero summary');
console.log('Admin summary availability PASS: finance/ad failures reject safely; valid empty data still returns zero.');
