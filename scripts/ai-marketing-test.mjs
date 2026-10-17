import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {safeMarketingFacts,parseMarketingReport,marketingReportQuality,handleAIMarketing} from '../src/ai-marketing-analyst.js';

const facts=safeMarketingFacts({latest:{metrics:{totals:{sessions:90,botSessions:4},dimensions:{Source:[{name:'facebook',sessions:55}],URL:[{name:'https://shop.test/order?phone=01012345678',sessions:30}]},coverage:{metaSourceSessions:55,taggedRate:64},limitations:['Clarity آخر 24 ساعة']}},growth:{metaConnected:true,metaRange:{from:'2026-10-09',to:'2026-10-09'},metaTotals:{spend:300,realRoas:1.6,realOrders:18,deliveredOrders:9},campaigns:[{name:'Try offer john@example.com',spend:300,realRoas:1.6,realOrders:18,deliveredOrders:9,claritySessions:45}]}},{finance:{netProfit:1200,expenses:150,productCost:500},overview:{periodOrders:18}},1);
assert.equal(facts.meta.spend,300);
assert.equal(facts.meta.campaigns.length,1);
assert.equal(facts.business.netProfit,1200);
assert.equal(facts.clarity.sources[0].sessions,55);
assert.ok(!JSON.stringify(facts).includes('john@example.com'));
assert.ok(!JSON.stringify(facts).includes('01012345678'));
assert.ok(!JSON.stringify(facts).includes('phone='));
const message={summary:'الإنفاق ثابت مع فجوة تسليم',findings:[{title:'قوة النقرات',evidence:'55 جلسة',hypothesis:'التتبع محتمل',confidence:'medium'}],actions:[{priority:'high',title:'اختبر صفحة المنتج',why:'فجوة',how:'تجربة واحدة',successMetric:'تكلفة الطلب المسلم',confidence:'low'}],experiments:[{name:'A/B',change:'عنوان',control:'الصورة',measurement:'CR',guardrail:'لا تغير الميزانية'}],caveats:['المدة مختلفة']};
const report=parseMarketingReport('\n'+JSON.stringify(message)+'\n');
assert.equal(report.summary,message.summary);
assert.equal(report.findings[0].confidence,'medium');
assert.equal(report.actions[0].priority,'high');
assert.throws(()=>parseMarketingReport('not JSON'),/JSON|غير صالح/);
assert.throws(()=>parseMarketingReport(JSON.stringify({summary:'x',actions:[]})),/ناقص/);

const worthless={summary:'حسناً',findings:[{title:'النفقات الإجمالية',evidence:'26718.7',hypothesis:'النفقات الإجمالية للفترة'}],actions:[{title:'تقييم النفقات',why:'تحديد النفقات',how:'تقييم النفقات الإجمالية',successMetric:'النفقات الإجمالية'}]};
assert.equal(marketingReportQuality(worthless,{clarity:{sessions:120}}).valid,false,'shallow old-style reports must not be considered valid');
const validExample={summary:'توضح البيانات أن عدد الزيارات كبير بالنسبة إلى حجم الجلسات المعروفة المصدر؛ راجع تصنيف UTM وصفحات شراء المنتجات قبل تعديل الحملات، حيث لا توجد مطابقة مباشرة مع الطلبات.',
  findings:[{title:'ضعف وضوح مصدر الزيارات',evidence:'120 جلسة Clarity و70 جلسة مصدر Meta خلال 24 ساعة',hypothesis:'ربما هناك جلسات قادمة من مصادر أخرى أو عناوين لا تحمل وسوم UTM، ولا نستطيع التأكد إلا بالمراجعة.',confidence:'medium'}],
  actions:[{title:'مراجعة إعدادات الوسوم',why:'عدم وضوح اسم الحملة يمنع اتخاذ قرارات صحيحة حول جودة زيارات الإعلانات المدفوعة.',how:'راجع رابط كل إعلان، وصحح utm_campaign، واترك البيانات تتجمع يومًا كاملًا ثم أعد المقارنة.',successMetric:'نسبة الجلسات المعروفة باسم الحملة',confidence:'medium'}]};
assert.equal(marketingReportQuality(validExample,{clarity:{sessions:120}}).valid,true,'specific actionable analysis should be accepted');
assert.equal(marketingReportQuality({...validExample,findings:[{...validExample.findings[0],evidence:'توجد مشكلة عامة'}]},{clarity:{sessions:120}}).valid,false,'observed figures are required when facts have numbers');

const denied=await handleAIMarketing({request:new Request('https://kun.test/api/ai/marketing-status?storeId=s1'),env:{},ctx:{},delegate:{fetch:async()=>new Response(JSON.stringify({error:'unauthenticated'}),{status:401})}});
assert.equal(denied.status,401);
assert.equal((await denied.json()).code,'AUTH_REQUIRED');
const ui=readFileSync(new URL('../public/v2/modules-v138-ai-marketing.js',import.meta.url),'utf8');new Function(ui);
for(const label of ['AI Marketing Analyst','marketing-analyze','marketing-status','realAI','confidence','successMetric'])assert.ok(ui.includes(label));
assert.ok(ui.includes('kai-layout')&&ui.includes('data-kai-bad-report')&&ui.includes('data-kai-facts'),'AI UI needs mobile-friendly layout, low quality handling and fact cards');
assert.ok(ui.includes("version:'153.0'"),'new version export required');
const html=readFileSync(new URL('../public/v2/index.html',import.meta.url),'utf8');
assert.ok(html.includes('modules-v138-ai-marketing.js?v=153.0'));
const server=readFileSync(new URL('../src/ai-marketing-analyst.js',import.meta.url),'utf8');
assert.ok(server.includes('env.AI.run'));
assert.ok(server.includes('llama-3.3-70b-instruct-fp8-fast')&&server.includes('AI_LOW_QUALITY'),'real higher-capacity model and output validation required');
assert.ok(server.includes('INSERT OR IGNORE INTO ai_marketing_reports'));
assert.ok(!server.includes('OPENAI_API_KEY'));
const prod=readFileSync(new URL('../src/index-production-mobile-update.js',import.meta.url),'utf8');
const prodConfig=readFileSync(new URL('../wrangler.production.toml',import.meta.url),'utf8');
assert.ok(prod.includes("import {handleAIMarketing} from './ai-marketing-analyst.js'"),'Production imports the updated AI analyst');
assert.ok(prod.includes("const aiMarketing=await handleAIMarketing({request,env:dataEnv,ctx,delegate})"),'Production must handle AI locally before forwarding APIs to Preview');
assert.ok(prod.indexOf("const aiMarketing=await handleAIMarketing")<prod.indexOf("if(shouldUsePreviewBackend(request))"),'AI must intercept before Preview fallback');
assert.ok(prodConfig.includes('[ai]')&&prodConfig.includes('binding = "AI"'),'Production requires an actual Workers AI binding');
console.log('AI Marketing Analyst v138 contract tests passed');
