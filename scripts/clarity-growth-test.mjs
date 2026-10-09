import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {reportFromCapture,segmentTraffic,segmentMetric,mergeMetaWithClarity,METRIC_LABELS} from '../src/clarity-growth-insights.js';

const traffic=(information)=>({name:'Traffic',information});
const campaign=[
  traffic([
    {Campaign:'Paid Alpha',Source:'facebook',Device:'Mobile',totalSessionCount:'20',totalBotSessionCount:'2'},
    {Campaign:'Paid Alpha',Source:'instagram',Device:'Desktop',totalSessionCount:'10',totalBotSessionCount:'1'},
    {Campaign:'Organic',Source:'google',Device:'Mobile',totalSessionCount:'5',totalBotSessionCount:'0'}
  ]),
  {name:'RageClickCount',information:[{Campaign:'Paid Alpha',sessionsCount:'20',sessionsWithMetricPercentage:'40'},{Campaign:'Paid Alpha',sessionsCount:'10',sessionsWithMetricPercentage:'10'}]},
  {name:'DeadClickCount',information:[{Campaign:'Paid Alpha',sessionsCount:'30',sessionsWithMetricPercentage:'20'}]},
  {name:'ScriptErrorCount',information:[{Campaign:'Paid Alpha',sessionsCount:'30',sessionsWithMetricPercentage:'6'}]}
];
const pages=[
  traffic([{URL:'https://test.example/products/red?email=test@example.com&phone=01234',Medium:'paid',Channel:'Social',totalSessionCount:'25',totalBotSessionCount:'1'}]),
  {name:'ScrollDepth',information:[{URL:'https://test.example/products/red?secret=123',averageScrollDepth:'46'}]}
];
const technology=[
  traffic([{Browser:'Chrome',OS:'Android','Country/Region':'Egypt',totalSessionCount:'35',totalBotSessionCount:'3'}]),
  {name:'EngagementTime',information:[{Browser:'Chrome',averageEngagementTime:'35'}]}
];
assert.equal(segmentTraffic(campaign,'Campaign')[0].sessions,30);
assert.equal(segmentMetric(campaign,'Campaign','RageClickCount')[0].rate,30);
assert.equal(segmentMetric(campaign,'Campaign','not-real').length,0);
const report=reportFromCapture({campaign,pages,technology});
assert.equal(report.totals.sessions,35);
assert.equal(report.totals.botSessions,3);
assert.equal(report.dimensions.Campaign[0].name,'Paid Alpha');
assert.equal(report.dimensions.Device[0].sessions,25);
assert.equal(report.dimensions.Browser[0].sessions,35);
assert.equal(report.dimensions.OS[0].name,'Android');
assert.equal(report.dimensions['Country/Region'][0].name,'Egypt');
assert.equal(report.dimensions.Medium[0].name,'paid');
assert.equal(report.dimensions.Channel[0].name,'Social');
assert.equal(report.dimensions.URL[0].name,'test.example/products/red');
assert.ok(!JSON.stringify(report).includes('test@example.com'));
assert.ok(!JSON.stringify(report).includes('secret='));
assert.equal(report.campaigns[0].RageClickCount,30);
assert.equal(report.campaigns[0].DeadClickCount,20);
assert.equal(report.campaigns[0].paidSessions,30);
assert.equal(report.campaigns[0].unknownSourceSessions,0);
assert.ok(report.catalog.some(x=>x.metric==='EngagementTime'));
assert.equal(METRIC_LABELS.ScrollDepth,'عمق التمرير');
const meta={
 connected:true,lastSyncAt:'2026-10-08T20:00:00Z',from:'2026-10-08',to:'2026-10-09',
 campaigns:{total:{spend:1000,realOrders:10,realRoas:1.7},rows:[
  {name:'Paid Alpha',spend:800,impressions:10000,ctr:2,platformPurchases:7,realOrders:4,deliveredOrders:3,realRoas:1.4},
  {name:'Paid Beta',spend:200,impressions:5000,ctr:1.1,platformPurchases:1,realOrders:0,deliveredOrders:0,realRoas:0}
 ]},adsets:{rows:[]},ads:{rows:[]},expert:{recommendations:[]}
};
const joined=mergeMetaWithClarity(report,meta);
assert.equal(joined.campaigns.length,2);
assert.equal(joined.campaigns[0].metaSourceSessions,30);
assert.equal(joined.campaigns[0].rageRate,30);
assert.equal(joined.campaigns[0].realRoas,1.4);
assert.equal(joined.campaigns[1].sourceStatus,'utm_missing');
assert.equal(joined.campaigns[1].claritySessions,null);
assert.ok(joined.recommendations.some(x=>x.category==='landing'&&x.title.includes('احتكاك'))===true);
assert.ok(joined.recommendations.some(x=>x.category==='attribution'&&x.campaign==='Paid Beta'));
assert.ok(joined.attributionWarning.includes('24 ساعة'));
assert.ok(report.limitations.some(x=>x.includes('متداخلة')));

const frontend=readFileSync(new URL('../public/v2/modules-v136-clarity-growth.js',import.meta.url),'utf8');
new Function(frontend);
for(const marker of ['analytics','marketing','campaigns','/api/clarity/growth','/api/clarity/sync','csv','pages','growth','audience','friction','metrics'])assert.ok(frontend.includes(marker),marker);
const v135=readFileSync(new URL('../public/v2/modules-v135-clarity.js',import.meta.url),'utf8');
assert.ok(v135.includes('window.KunClarityGrowthV136'));
const html=readFileSync(new URL('../public/v2/index.html',import.meta.url),'utf8');
assert.ok(html.includes('modules-v136-clarity-growth.js'));
const server=readFileSync(new URL('../src/clarity-integration.js',import.meta.url),'utf8');
for(const d of ['Campaign','Source','Device','URL','Medium','Channel','Browser','OS','Country/Region'])assert.ok(server.includes("'"+d+"'"),d);
assert.ok(server.includes('action===\'growth\''));
assert.ok(server.includes('quota_count<=5'));
assert.ok(server.includes('last_attempt_at'));
console.log('Clarity V136 growth analytics contract tests passed');
