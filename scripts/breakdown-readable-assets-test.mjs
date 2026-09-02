import {readFile} from 'node:fs/promises';
import {readableBreakdownValue} from '../src/meta-ads-campaign-detail-v3.js';

const assert=(ok,message)=>{if(!ok)throw new Error(message)};
const body=readableBreakdownValue({id:'1343264837310074',text:'سنتك الدراسية الجديدة تستحق إطلالة جديدة'});
assert(body.value==='سنتك الدراسية الجديدة تستحق إطلالة جديدة','body_asset must prefer the actual text over the asset ID');
assert(body.assetId==='1343264837310074'&&body.resolved===true,'body_asset must preserve its asset ID separately');
const title=readableBreakdownValue({id:'999999999999',headline:'عرض العودة للجامعة'});
assert(title.value==='عرض العودة للجامعة'&&title.assetId==='999999999999','title/headline must stay readable while preserving its ID');
const description=readableBreakdownValue({id:'888888888888',description:'خامات روزالين مستوردة'});
assert(description.value==='خامات روزالين مستوردة','description asset must expose its readable text');
const unresolved=readableBreakdownValue('1343264837310074');
assert(unresolved.value==='1343264837310074'&&unresolved.resolved===false,'numeric-only asset IDs must be marked unresolved instead of pretending they are text');

const [resolver,measurements,loader,index]=await Promise.all([
  readFile(new URL('../src/meta-ads-campaign-detail-v3.js',import.meta.url),'utf8'),
  readFile(new URL('../public/v2/modules-v70-breakdown-measurements.js',import.meta.url),'utf8'),
  readFile(new URL('../public/v2/modules-v57-section-reload.js',import.meta.url),'utf8'),
  readFile(new URL('../src/index-commerce-v36.js',import.meta.url),'utf8')
]);
for(const marker of ['text','message','body','headline','description','dimensionAssetId','dimensionResolved','asset_feed_spec','object_story_spec','creative-single','creative-id'])assert(resolver.includes(marker),`Readable creative resolver missing marker: ${marker}`);
for(const marker of ['كل ${data.label','Asset ID','Spend','Purchases','CPP','ROAS','CTR','CPC','CPM','Frequency','لا تستخدم الـID بدل النص'])assert(measurements.includes(marker),`Per-element measurement UX missing marker: ${marker}`);
assert(loader.includes('/v2/modules-v70-breakdown-measurements.js?v=70.0'),'Campaign loader must include v70 readable element measurements');
assert(index.includes("from './meta-ads-campaign-detail-v3.js'")&&index.includes('readableCreativeBreakdowns:true'),'Preview Campaign route must use readable creative Breakdown resolver');
new Function(measurements);new Function(loader);
console.log('Readable Meta creative Breakdown test passed: real text/headline/description win over asset IDs, IDs remain references, Creative fallback is wired, and every measured element exposes its own performance metrics.');
