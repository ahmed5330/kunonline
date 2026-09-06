import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../src/meta-ads-campaign-detail-v3.js',import.meta.url),'utf8');
const withoutImports=source.replace(/^import \{readConnectionSecrets\}[\s\S]*?from '\.\/meta-ads-campaign-detail-v2\.js';\s*/m,'');
const executable=withoutImports
  .replace('export const META_BREAKDOWN_CATALOG=','const META_BREAKDOWN_CATALOG=')
  .replace('export {metaAdsDailyComparison};','')
  .replace('export function readableBreakdownValue','function readableBreakdownValue')
  .replace('export async function metaAdsBreakdown','async function metaAdsBreakdown');

const sdkCatalog=[
  {id:'impression_device',group:'platform',key:'impression_device',label:'device',param:'breakdowns'},
  {id:'platform_position',group:'platform',key:'platform_position',label:'placement',param:'breakdowns'},
  {id:'hourly_stats_aggregated_by_advertiser_time_zone',group:'time',key:'hourly_stats_aggregated_by_advertiser_time_zone',label:'hour',param:'breakdowns'},
  {id:'body_asset',group:'creative',key:'body_asset',label:'body',param:'breakdowns'},
  {id:'action__action_type',group:'actions',key:'action_type',label:'action',param:'action_breakdowns'}
];
const factory=new Function('readConnectionSecrets','metaAdsDailyComparison','baseBreakdown','SDK_BREAKDOWN_CATALOG',`${executable}\nreturn {compatibleFetcher,META_BREAKDOWN_CATALOG};`);
const {compatibleFetcher,META_BREAKDOWN_CATALOG}=factory(async()=>({}),()=>{},async()=>({}),sdkCatalog);
const assert=(ok,message)=>{if(!ok)throw new Error(message);};
const byId=new Map(META_BREAKDOWN_CATALOG.map(x=>[x.id,x]));

async function rewritten(dimension,{breakdowns=dimension,fields='campaign_id,ad_id,spend,impressions,reach,clicks,actions,action_values',param='breakdowns'}={}){
  const url=new URL('https://graph.facebook.com/v25.0/act_123/insights');
  url.searchParams.set('level','ad');url.searchParams.set('fields',fields);url.searchParams.set(param,breakdowns);
  let captured='';
  const wrapped=compatibleFetcher(async input=>{captured=String(input);return new Response(JSON.stringify({data:[]}),{status:200,headers:{'Content-Type':'application/json'}});},dimension);
  await wrapped(url.toString(),{});
  return new URL(captured);
}

const device=await rewritten('impression_device');
assert(device.searchParams.get('breakdowns')==='publisher_platform,impression_device',`impression_device rewrite wrong: ${device.searchParams.get('breakdowns')}`);
assert(!device.searchParams.get('fields').split(',').includes('reach'),'impression_device must remove unsupported reach');
assert(byId.get('impression_device')?.support==='compatible-composite','impression_device must be labeled auto-compatible');
assert(byId.get('impression_device')?.metricAvailability?.frequency===false,'impression_device must hide derived Frequency');

const placement=await rewritten('platform_position');
assert(placement.searchParams.get('breakdowns')==='publisher_platform,platform_position',`platform_position rewrite wrong: ${placement.searchParams.get('breakdowns')}`);
assert(!placement.searchParams.get('fields').split(',').includes('reach'),'platform_position must remove unsupported reach');
assert(byId.get('platform_position')?.support==='compatible-composite','platform_position must be labeled auto-compatible');

const hourly=await rewritten('hourly_stats_aggregated_by_advertiser_time_zone');
assert(hourly.searchParams.get('breakdowns')==='hourly_stats_aggregated_by_advertiser_time_zone','hourly breakdown key must remain intact');
assert(!hourly.searchParams.get('fields').split(',').includes('reach'),'hourly breakdown must remove reach');
assert(!hourly.searchParams.get('fields').split(',').includes('frequency'),'hourly breakdown must remove frequency if supplied');
assert(byId.get('hourly_stats_aggregated_by_advertiser_time_zone')?.support==='conditional','hourly breakdown must be marked conditional');

const body=await rewritten('body_asset');
assert(body.searchParams.get('breakdowns')==='body_asset','standard body_asset must remain a single breakdown');
assert(body.searchParams.get('fields').split(',').includes('reach'),'standard body_asset must keep supported reach');
assert(byId.get('body_asset')?.support==='standard','body_asset must remain standard');

const action=await rewritten('action__action_type',{breakdowns:'action_type',param:'action_breakdowns'});
assert(action.searchParams.get('action_breakdowns')==='action_type','Action Breakdown parameter must remain action_breakdowns');
assert(action.searchParams.get('breakdowns')===null,'Action Breakdown must not be converted into delivery breakdowns');

let untouched='';
const nonInsights=compatibleFetcher(async input=>{untouched=String(input);return new Response('{}',{status:200});},'impression_device');
await nonInsights('https://graph.facebook.com/v25.0/123?fields=id,name',{});
assert(new URL(untouched).searchParams.get('breakdowns')===null,'Non-insights Meta calls must not be rewritten');

console.log('Meta Breakdown request rewrite behavior passed: device/placement composite requests, hourly metric pruning, standard creative preservation, Action Breakdown preservation and non-insights isolation all use the production compatibleFetcher implementation.');
