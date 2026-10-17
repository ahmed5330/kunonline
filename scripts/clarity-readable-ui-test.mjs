import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../public/v2/modules-v136-clarity-growth.js',import.meta.url),'utf8');
const inject="window.KunClarityGrowthV136={open,version:'152.0'};";
assert.ok(source.includes(inject),'production exports expected version');
const compiled=source.replace(inject,`globalThis.__testClarity={overview,evidenceSignals,readSignal,growth,pages,friction,reportScope,readingBrief,numberOrNull,clDecisionBoard,clExplain,cl152PageInsightPanel,cl152PageKind};${inject}`);
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
assert.ok(html.includes('أولويات التحسين')&&html.includes('ما معنى الرقم؟'),'overview should surface decisions and on-card help');
const decision=api.clDecisionBoard(fixture);
assert.ok(decision.includes('store.test/products/item')&&decision.includes('utm_campaign'),'decision board must link recommendations to evidence and measurable next steps');
assert.ok(!decision.includes('store.test/cart'),'small-sample page cannot become high priority');
assert.ok(api.clExplain('جلسات Clarity').includes('ما فائدته؟'),'KPI help explains practical purpose');

for(const x of ['جلسات Clarity','جلسات البوت','ماذا تقول بيانات Clarity؟','الدليل من البيانات:','ماذا يعني؟','الخطوة المقترحة:','حدود التصدير'])assert.ok(html.includes(x),`overview missing ${x}`);
assert.ok(html.includes(new Intl.NumberFormat('ar-EG').format(75))&&html.includes(new Intl.NumberFormat('ar-EG').format(55)),'must display real fixture figures, not invented values');
assert.ok(!html.includes('—</strong><small>جلسات'),'available sessions must display a value');
assert.ok(!api.numberOrNull(null)&&api.numberOrNull(null)!==0,'null percentage must be unknown, not zero');
const growth=api.growth(fixture);
assert.ok(growth.includes('الدليل:')&&growth.includes('القراءة المحتملة:')&&growth.includes('الإجراء المقترح:'),'marketing recommendations must be actionable');
assert.ok(growth.includes('جدول مقارنة كل الحملات'),'complex campaign table must be available on demand');
const native=api.cl152PageInsightPanel(fixture.latest.metrics.pagesDetail);
assert.ok(native.includes('تحليل صفحات المتجر داخل كن أونلاين')&&native.includes('data-clarity-native-insights'),'native page insights should be shown within Kun Online');
assert.ok(native.includes('store.test/products/item')&&native.includes('Rage Clicks')&&native.includes('Dead Clicks'),'API-backed source page and friction metrics must be available');
assert.ok(native.includes('عينة صغيرة'),'below-30-session page cannot be promoted as actionable critical issue');
assert.ok(native.includes('ليست خرائط حرارية')&&native.includes('لا يمكن استيراده'),'heatmap and replay API limits must remain transparent');
assert.ok(native.includes('data-cl136-jump="friction"'),'user should have in-product drilldown');
assert.ok(api.cl152PageKind('https://store.test/cart')==='سلة التسوق','page grouping should be inferred safely from URL');
assert.ok(!api.cl152PageInsightPanel([{name:'<img src=x onerror=alert(1)>',sessions:60}]).includes('<img'),'untrusted page URL must be HTML escaped');
const pages=api.pages(fixture);
assert.ok(pages.includes('store.test/products/item'),'eligible page must be visible');
assert.ok(!pages.includes('مراجعة https://store.test/cart'),'low-sample page must not become an automatic priority');
assert.ok(pages.includes('ماذا يعني كل مؤشر'),'metrics need explanatory framework');
assert.ok(pages.includes('data-clarity-native-insights'),'page reports must expose native analysis');
assert.ok(!pages.includes('الخطوة التالية لتطوير صفحة المنتج والشراء'),'old offsite-first CTA must be removed');
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
