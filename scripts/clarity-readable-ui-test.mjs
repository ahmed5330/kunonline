import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../public/v2/modules-v136-clarity-growth.js',import.meta.url),'utf8');
const inject="window.KunClarityGrowthV136={open,version:'137.1'};";
assert.ok(source.includes(inject),'production exports expected version');
const compiled=source.replace(inject,`globalThis.__testClarity={overview,evidenceSignals,readSignal,growth,pages,friction,reportScope,readingBrief,numberOrNull};${inject}`);
const sandbox={window:{},document:{readyState:'loading',addEventListener(){}},console,Intl,Date,Number,Math,URL};
runInNewContext(compiled,sandbox,{timeout:2500});
const api=sandbox.__testClarity;
assert.ok(api&&typeof api.overview==='function','pure readable Clarity report helpers should evaluate');
const fixture={
 status:{lastSyncAt:'2026-10-11T09:00:00Z'},
 latest:{
  syncedAt:'2026-10-11T09:00:00Z',
  metrics:{
   snapshotHours:24,
   totals:{sessions:75,botSessions:4},
   coverage:{sessions:75,metaSourceSessions:55,metaWithoutCampaignSessions:12},
   dimensions:{
    Campaign:[{name:'Paid Alpha',sessions:35}],
    Source:[{name:'facebook',sessions:55,botSessions:4}],
    Device:[{name:'Mobile',sessions:70,botSessions:4}]
   },
   pagesDetail:[
    {name:'https://store.test/products/item',sessions:45,botSessions:1,rageRate:23,deadRate:null},
    {name:'https://store.test/cart',sessions:10,botSessions:0,rageRate:60,deadRate:60}
   ],
   campaigns:[{name:'Paid Alpha',sessions:35,RageClickCount:19,DeadClickCount:24,ScriptErrorCount:6}],
   diagnostics:[],
   limitations:['عينة جزئية'],
   catalog:[]
  },
  sampleCoverage:{campaignRows:15,pagesRows:4,technologyRows:8}
 },
 growth:{
  metaConnected:true,
  metaTotals:{spend:300,realOrders:5,realRoas:1.8},
  campaigns:[{name:'Paid Alpha',claritySessions:35,metaSourceSessions:35,rageRate:19,deadRate:24,scriptErrorRate:6,realRoas:1.8}],
  recommendations:[{priority:'high',category:'landing',title:'احتكاك شديد بعد الدخول',detail:'ظهر Rage Clicks مرتفع في جلسات الحملة',campaign:'Paid Alpha'}]
 }
};
const signals=Array.from(api.evidenceSignals(fixture));
assert.ok(signals.some(x=>x.source.includes('UTM')&&x.title.includes('بدون اسم حملة')),'missing Meta UTM must be visible with evidence');
assert.ok(signals.some(x=>x.title.includes('نقرات متكررة')&&x.evidence.includes(new Intl.NumberFormat('ar-EG').format(35))),'rage signal must include observed 35-session sample');
assert.ok(signals.every(x=>x.action&&x.evidence&&x.meaning),'every item needs evidence, interpretation, and action');
assert.ok(signals.length<=4,'do not overwhelm with a raw list of alerts');
const html=api.overview(fixture);
for(const x of ['جلسات Clarity','جلسات البوت','ماذا تقول بيانات Clarity؟','الدليل من البيانات:','ماذا يعني؟','الخطوة المقترحة:','حدود التصدير'])assert.ok(html.includes(x),`overview missing ${x}`);
assert.ok(html.includes(new Intl.NumberFormat('ar-EG').format(75))&&html.includes(new Intl.NumberFormat('ar-EG').format(55)),'must display real fixture figures, not invented values');
assert.ok(!html.includes('—</strong><small>جلسات'),'available sessions must display a value');
assert.ok(!api.numberOrNull(null)&&api.numberOrNull(null)!==0,'null percentage must be unknown, not zero');
const growth=api.growth(fixture);
assert.ok(growth.includes('الدليل:')&&growth.includes('القراءة المحتملة:')&&growth.includes('الإجراء المقترح:'),'marketing recommendations must be actionable');
assert.ok(growth.includes('جدول مقارنة كل الحملات'),'complex campaign table must be available on demand');
const pages=api.pages(fixture);
assert.ok(pages.includes('store.test/products/item'),'eligible page must be visible');
assert.ok(!pages.includes('مراجعة https://store.test/cart'),'low-sample page must not become an automatic priority');
assert.ok(pages.includes('ماذا يعني كل مؤشر'),'metrics need explanatory framework');
const friction=api.friction(fixture);
assert.ok(friction.includes('Rage Clicks · نقرات متكررة')&&friction.includes('جلسات')&&friction.includes('—'),'friction needs Arabic metric definitions and missing-value explanation');
const little=structuredClone(fixture);
little.latest.metrics.coverage.metaWithoutCampaignSessions=0;
little.latest.metrics.pagesDetail=[];
little.growth.campaigns[0].claritySessions=12;
const limited=Array.from(api.evidenceSignals(little));
assert.ok(!limited.some(x=>x.title.includes('Paid Alpha')),'12 sessions must not trigger high-priority campaign friction');
const adversarial={level:'normal',title:'<img src=x onerror=alert(1)>',evidence:'<b>unsafe</b>',meaning:'x',action:'x'};
assert.ok(!api.readSignal(adversarial).includes('<img'),'HTML fields must be safely escaped');
console.log('Clarity readable insight UI: rules, scope, safe labels and actionable evidence PASS');
