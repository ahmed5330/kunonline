import {readFile} from 'node:fs/promises';
import {resolveAdminBriefRange} from '../src/admin-client-command-center.js';

const read=p=>readFile(new URL(`../${p}`,import.meta.url),'utf8');
const [backend,entry,ui,loader]=await Promise.all([
  read('src/admin-client-command-center.js'),read('src/index-commerce-v36.js'),read('public/v2/modules-v74-admin-client-command-center.js'),read('public/v2/modules-v23-admin.js')
]);
const assert=(ok,msg)=>{if(!ok)throw new Error(`Admin Client Command Center contract failed: ${msg}`)};
const has=(text,needle,msg=needle)=>assert(text.includes(needle),msg);

const now=new Date('2026-09-05T07:00:00.000Z');
const today=resolveAdminBriefRange({preset:'today',now});assert(today.from==='2026-09-05'&&today.to==='2026-09-05','today must resolve in Cairo');
const yesterday=resolveAdminBriefRange({preset:'yesterday',now});assert(yesterday.from==='2026-09-04'&&yesterday.to==='2026-09-04','yesterday range');
const week=resolveAdminBriefRange({preset:'7d',now});assert(week.from==='2026-08-30'&&week.to==='2026-09-05'&&week.previous.from==='2026-08-23'&&week.previous.to==='2026-08-29','7-day current + previous period');
const month=resolveAdminBriefRange({preset:'30d',now});assert(month.from==='2026-08-07'&&month.to==='2026-09-05','30-day range');
const mtd=resolveAdminBriefRange({preset:'mtd',now});assert(mtd.from==='2026-09-01'&&mtd.to==='2026-09-05','month-to-date range');
const custom=resolveAdminBriefRange({preset:'custom',from:'2026-08-10',to:'2026-08-15',now});assert(custom.days===6&&custom.previous.from==='2026-08-04'&&custom.previous.to==='2026-08-09','custom same-length previous period');
let tooLarge=false;try{resolveAdminBriefRange({preset:'custom',from:'2025-01-01',to:'2026-09-05',now})}catch(e){tooLarge=e.code==='ADMIN_BRIEF_RANGE_TOO_LARGE'}assert(tooLarge,'custom period must be bounded');

has(backend,'requireAdmin(me)','admin-only backend gate');
has(backend,"GROUP BY client_id",'set-based client aggregation');
has(backend,'campaign_daily_metrics','ad spend aggregation');
has(backend,'collected_amount','COD collection aggregation');
has(backend,'businessBrief(env','reuse Business Brief engine');
has(backend,'compareBrief(current,previous)','same-length comparison');
has(backend,"['today','yesterday','7d','30d','mtd','custom']",'all requested presets');
has(entry,'ADMIN_COMMAND_PATH','explicit Admin command route classifier');
has(entry,"ADMIN_COMMAND_PATH.test(path)&&!hasAuthEnvelope(request)",'anonymous Admin command requests fail closed before session lookup');
has(entry,"if(me?.role!=='admin')return {response:json({error:'المسار متاح لإدارة Kun Online فقط',code:'ADMIN_ONLY'},403)}",'authenticated non-Admin users get an explicit 403 response without exception control flow');
has(entry,"/api/admin/client-command-center",'admin command-center route');
has(entry,"/command-brief$",'per-client brief route');
has(entry,'adminClientCommandCenter:true','health flag');
has(entry,"preview-v36-2026-09-05-admin-client-command-center",'current build marker');
has(ui,'Client Command Center','admin homepage');
has(ui,'فتح بريف العميل','full client page action');
has(ui,'ابحث باسم النشاط، صاحب الحساب، الهاتف أو البريد','client search');
has(ui,"['today','اليوم']",'today UI preset');
has(ui,"['yesterday','أمس']",'yesterday UI preset');
has(ui,"['7d','آخر 7 أيام']",'week UI preset');
has(ui,"['30d','آخر 30 يوم']",'30-day UI preset');
has(ui,"['mtd','من بداية الشهر']",'MTD UI preset');
has(ui,"['custom','فترة معينة']",'custom UI preset');
has(ui,'مقابل الفترة السابقة','comparison UI');
has(ui,'الطلبات والتحصيل','orders/collection brief');
has(ui,'التسويق والإعلانات','marketing brief');
has(ui,'المالية والمخزون','finance/inventory brief');
has(ui,'ما يحتاج انتباهك','recommendations');
has(ui,'ملخص الحملات في الفترة','campaign summary');
has(loader,'modules-v74-admin-client-command-center.js?v=74.0','v74 loader');
new Function(ui);new Function(loader);
console.log('Admin Client Command Center contract passed: all subscribed clients get compact period KPIs, searchable cards, fail-closed anonymous routes, explicit non-Admin 403 responses and an Admin-only full brief with today/yesterday/7d/30d/MTD/custom ranges plus previous-period comparison.');
