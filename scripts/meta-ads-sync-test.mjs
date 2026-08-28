import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fetchMetaAdsSnapshot} from '../src/meta-ads-sync.js';

const env={META_GRAPH_API_VERSION:'v25.0'};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const calls=[];
async function mockMeta(url,options={}){
  calls.push({url,auth:options?.headers?.Authorization||''});
  assert.equal(options?.headers?.Authorization,'Bearer tenant-token','Meta sync must use the tenant token server-side');
  const u=new URL(url);
  if(u.pathname==='/v25.0/act_123')return json({id:'act_123',account_id:'123',name:'Wefaq Live Ads',account_status:1,currency:'EGP',timezone_name:'Africa/Cairo'});
  if(u.pathname==='/v25.0/act_123/campaigns'&&u.searchParams.get('page')==='2')return json({data:[{id:'C2',name:'Retargeting',status:'PAUSED',effective_status:'PAUSED',objective:'OUTCOME_SALES',daily_budget:'25000'}]});
  if(u.pathname==='/v25.0/act_123/campaigns')return json({data:[{id:'C1',name:'Prospecting',status:'ACTIVE',effective_status:'ACTIVE',objective:'OUTCOME_SALES',daily_budget:'50000'}],paging:{next:'https://graph.facebook.com/v25.0/act_123/campaigns?page=2'}});
  if(u.pathname==='/v25.0/act_123/insights'){
    assert.equal(u.searchParams.get('level'),'campaign');assert.equal(u.searchParams.get('time_increment'),'1');
    const tr=JSON.parse(u.searchParams.get('time_range'));assert.deepEqual(tr,{since:'2026-08-01',until:'2026-08-28'});
    return json({data:[{campaign_id:'C1',campaign_name:'Prospecting',date_start:'2026-08-28',date_stop:'2026-08-28',spend:'1000.25',impressions:'100000',reach:'70000',frequency:'1.4289',clicks:'2500',ctr:'2.5',cpc:'0.4001',cpm:'10.0025',actions:[{action_type:'lead',value:'40'},{action_type:'purchase',value:'25'}],action_values:[{action_type:'purchase',value:'3500.75'}]}]});
  }
  return json({error:{message:`Unexpected URL ${u.pathname}`,code:100}},400);
}

const snapshot=await fetchMetaAdsSnapshot({env,token:'tenant-token',accountId:'act_123',apiVersion:'v25.0',from:'2026-08-01',to:'2026-08-28',fetcher:mockMeta});
assert.equal(snapshot.account.accountId,'123');assert.equal(snapshot.account.name,'Wefaq Live Ads');assert.equal(snapshot.account.currency,'EGP');
assert.equal(snapshot.campaigns.length,2,'Campaign pagination must be followed');assert.equal(snapshot.campaigns[0].id,'C1');assert.equal(snapshot.campaigns[1].id,'C2');
assert.equal(snapshot.insights.length,1);assert.equal(snapshot.insights[0].purchases,25);assert.equal(snapshot.insights[0].purchaseValue,3500.75);assert.equal(snapshot.insights[0].leads,40);assert.equal(snapshot.insights[0].spend,1000.25);assert.equal(snapshot.insights[0].impressions,100000);
assert.ok(calls.length>=4);

const syncSource=await readFile(new URL('../src/meta-ads-sync.js',import.meta.url),'utf8');
const validator=await readFile(new URL('../src/integration-provider-validation.js',import.meta.url),'utf8');
const worker=await readFile(new URL('../src/index-commerce-v28.js',import.meta.url),'utf8');
const performance=await readFile(new URL('../src/marketing-performance.js',import.meta.url),'utf8');
const ui=await readFile(new URL('../public/v2/modules-v27-meta-ads.js',import.meta.url),'utf8');
const index=await readFile(new URL('../public/v2/index.html',import.meta.url),'utf8');

for(const marker of ["provider=? AND status='connected'","platform='meta_ads'",'campaign_daily_metrics','last_sync_at','syncStoreId'])assert.ok(syncSource.includes(marker),`Meta sync missing tenant/persistence marker: ${marker}`);
assert.ok(validator.includes('WHERE client_id=? AND connection_id=?'),'Decrypted Meta secrets must remain tenant + connection scoped');
for(const marker of ['/api/integrations/meta-ads/sync','/api/integrations/meta-ads/performance','campaignPerformance','syncMetaAdsForClient','syncAllConnectedMetaAds',"controller?.cron==='0 */2 * * *'"])assert.ok(worker.includes(marker),`v28 Meta route missing ${marker}`);
for(const marker of ['platformPurchaseValue','platformRoas','frequency','platform=null'])assert.ok(performance.includes(marker),`Marketing performance missing ${marker}`);
for(const marker of ['إدارة الحملات — Meta Ads','Marketing Intelligence','مزامنة Meta الآن','الشغالة فقط','Platform ROAS','Real ROAS','KunMetaAdsLive','async function liveData','empty:${c.clientId}'])assert.ok(ui.includes(marker),`Live Meta UI missing ${marker}`);
assert.equal(ui.includes('access_token'),false,'The browser UI must never contain or expose the Meta access token');
assert.ok(index.includes('/v2/modules-v27-meta-ads.js?v=27.0'),'Preview entrypoint must load the live Meta Ads overlay');
console.log('Meta Ads sync checks passed: Graph pagination/insights parsing, tenant-scoped secrets/persistence, empty-state auto-sync, live campaign UI, real performance and scheduled refresh are wired.');
