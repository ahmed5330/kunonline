import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {handleProductionPreviewParity} from '../src/production-preview-parity.js';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const req=new Request('https://kun.example/health/preview-parity');
let reads=0;
const database={prepare(){reads++;throw new Error('database must not be accessed before auth');}};
const env={DB:database,PREVIEW_DB:database};
let r=await handleProductionPreviewParity(req,env);
assert.equal(r.status,403,'direct unauthenticated handler must fail closed');
assert.equal(reads,0,'no query may run without an authorizer');
r=await handleProductionPreviewParity(req,env,{authorizeAdmin:async()=>null});
assert.equal(r.status,401,'missing session rejected');
assert.equal(reads,0);
r=await handleProductionPreviewParity(req,env,{authorizeAdmin:async()=>({role:'client'})});
assert.equal(r.status,403,'client role rejected');
assert.equal(reads,0);
r=await handleProductionPreviewParity(req,{},{authorizeAdmin:async()=>({role:'admin'})});
assert.equal(r.status,503,'admin reaches binding validation only after auth');
r=await handleProductionPreviewParity(new Request('https://kun.example/health/not-parity'),env);
assert.equal(r,null,'unrelated routes are untouched');

const gateway=read('src/index-production-mobile-update.js');
assert.match(gateway,/handleProductionPreviewParity\(request,env,\{/,'gateway must supply authenticated identity');
assert.match(gateway,/new URL\('\/api\/me',sourceRequest\.url\)/,'gateway authorizer uses server session');
assert.match(gateway,/COD_READ_PATHS/,'COD route fallback handles legacy preview');
assert.match(gateway,/request\.method==='GET'&&COD_READ_PATHS/,'no financial writes may be replayed');

const legacy=read('public/v2/modules-v20.js');
assert.match(legacy,/function orderForm\(\)\{[\s\S]*?KunActionsV23\?\.openCreateOrder/,'legacy toolbar delegates to J&T form');
assert.doesNotMatch(legacy,/api\('\/api\/orders',\{method:'POST'/,'old order endpoint must not be used by legacy toolbar');
const modern=read('public/v2/modules-v106-manual-jnt-order.js');
assert.match(modern,/api\/orders\/manual-jnt/,'authoritative order endpoint preserved');

const supplier=read('public/v2/modules-v21.js');
for(const marker of ['QA_INV_001','QA_PAY_001'])assert.ok(!supplier.includes(marker),'test-prefill cannot appear: '+marker);
for(const marker of ['id="qaInvoiceNumber" placeholder=','id="qaInvoiceTotal" type="number" min="0.01"','id="qaPaymentReference" placeholder=','!invoiceNumber','!paymentReference'])assert.ok(supplier.includes(marker),'supplier financial validation missing: '+marker);

const finance=read('public/v2/modules-v96-finance-command-center.js');
assert.match(finance,/pendingCod===null\?'غير متاح'/,'COD error must not render as zero');
assert.match(finance,/d\.errors\?\.codSummary/,'missing COD summary must be reported');

const ads=read('src/meta-ads-expert.js');
assert.match(ads,/البيانات غير كافية لتحليل الأداء/,'missing ad data is not a healthy-performance signal');
assert.match(ads,/اربط حساب Meta Ads ثم زامن/,'explain how to obtain usable campaign data');
const team=read('public/v2/modules-v24-team.js');
assert.match(team,/أعضاء الفريق \(دون المالك\)/,'team counts explain owner exclusion');
assert.match(team,/نشطون \(دون المالك\)/,'active counts explain owner exclusion');

const windows=read('scripts/customer-service-board-print-void-test.mjs');
assert.match(windows,/fileURLToPath\(new URL/,'Windows-compatible file paths');
console.log('Audit regression PASS: SEC-01, ORD-01, FIN-01, FIN-02, ANA-01, UX-02, TST-01.');
