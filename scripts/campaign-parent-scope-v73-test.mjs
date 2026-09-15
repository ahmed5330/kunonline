import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const [source,loader]=await Promise.all([
  readFile(new URL('../public/v2/modules-v73-campaign-parent-scope.js',import.meta.url),'utf8'),
  readFile(new URL('../public/v2/modules-v57-section-reload.js',import.meta.url),'utf8')
]);
const assert=(ok,message)=>{if(!ok)throw new Error(message)};
new Function(source);
for(const marker of ['الحملة المراد تحليل مجموعاتها','المجموعة المراد تحليل إعلاناتها','نطاق تحليل المجموعات','نطاق تحليل الإعلانات','filterHubPayload','filterComparisonPayload','parentScopeApplied',"version:'73.0'"])assert(source.includes(marker),`Campaign parent scope marker missing: ${marker}`);

const sandbox={window:{KunCampaignHubV66:{state:{level:'adset',status:'all'}}},console,URL,URLSearchParams,Response,Headers};
vm.runInNewContext(source,sandbox,{filename:'modules-v73-campaign-parent-scope.js'});
const api=sandbox.window.KunCampaignParentScopeV73;
assert(api?.version==='73.0','Campaign parent scope API not exposed');
const fixture={
  campaigns:{rows:[
    {id:'LOCAL-A',externalCampaignId:'CAMP-A',name:'Campaign A',status:'active'},
    {id:'LOCAL-B',externalCampaignId:'CAMP-B',name:'Campaign B',status:'active'}
  ]},
  adsets:{rows:[
    {id:'SET-A1',externalId:'SET-A1',externalCampaignId:'CAMP-A',name:'Set A1',status:'active'},
    {id:'SET-A2',externalId:'SET-A2',externalCampaignId:'CAMP-A',name:'Set A2',status:'active'},
    {id:'SET-B1',externalId:'SET-B1',externalCampaignId:'CAMP-B',name:'Set B1',status:'active'}
  ]},
  ads:{rows:[
    {id:'AD-A1',externalId:'AD-A1',externalCampaignId:'CAMP-A',externalAdsetId:'SET-A1',name:'Ad A1',status:'active'},
    {id:'AD-A2',externalId:'AD-A2',externalCampaignId:'CAMP-A',externalAdsetId:'SET-A2',name:'Ad A2',status:'active'},
    {id:'AD-B1',externalId:'AD-B1',externalCampaignId:'CAMP-B',externalAdsetId:'SET-B1',name:'Ad B1',status:'active'}
  ]}
};
api._testSetHubCache(fixture);
api.state.adset.campaignId='CAMP-A';
let filtered=api.filterHubPayload(fixture,'adset');
assert(filtered.adsets.rows.length===2&&filtered.adsets.rows.every(row=>row.externalCampaignId==='CAMP-A'),'Ad Set analysis must filter to the chosen Campaign');
let comparison=api.filterComparisonPayload({rows:[{id:'SET-A1'},{id:'SET-A2'},{id:'SET-B1'}]},'adset');
assert(comparison.rows.length===2&&comparison.parentScopeApplied===true,'Ad Set comparison must use the same chosen Campaign scope');

api.state.ad.campaignId='CAMP-A';api.state.ad.adsetId='SET-A2';
filtered=api.filterHubPayload(fixture,'ad');
assert(filtered.ads.rows.length===1&&filtered.ads.rows[0].id==='AD-A2','Ads analysis must filter to the chosen Ad Set');
comparison=api.filterComparisonPayload({rows:[{id:'AD-A1'},{id:'AD-A2'},{id:'AD-B1'}]},'ad');
assert(comparison.rows.length===1&&comparison.rows[0].id==='AD-A2','Ads comparison must use the same chosen Ad Set scope');
const bSets=api.optionsForAdsets('CAMP-B');
assert(bSets.length===1&&bSets[0].id==='SET-B1','Ads Ad Set selector must be cascaded by Campaign');
assert(api.optionsForCampaigns().length===2,'Campaign selector must expose available Campaigns');

assert(loader.includes('/v2/modules-v73-campaign-parent-scope.js?v=73.0'),'Campaign layered loader must load v73 after the visual-density layer');
console.log('Campaign parent scope v73 passed: Ad Set analysis/comparison can be scoped by Campaign, Ads analysis/comparison can be scoped by cascaded Campaign + Ad Set, while all-parent defaults remain available.');
