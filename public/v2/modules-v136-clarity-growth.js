/* Kun Online v137.1 — interpretable Clarity insights, evidence and actions per store */
(function(){
'use strict';
const ROOT=()=>document.getElementById('root'),V={active:false,tab:'overview',data:null,search:'',request:0,busy:false,days:1};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const tx=v=>String(v??'').trim(),n=v=>v==null||v===''?'—':Number(v).toLocaleString('ar-EG',{maximumFractionDigits:2}),pct=v=>v==null?'—':n(v)+'%';
const view=()=>document.querySelector('.nav button.active[data-view]')?.dataset.view||'';
const tabs={overview:'الملخص التنفيذي',growth:'الإعلانات والفرص',pages:'صفحات المتجر',audience:'الجمهور والأجهزة',friction:'مشكلات التفاعل',health:'جودة البيانات',metrics:'المقاييس الخام'};
const dims={Campaign:'الحملات',Source:'مصادر الزيارات',Device:'الأجهزة',URL:'صفحات المتجر',Medium:'UTM Medium',Channel:'قنوات الزيارة',Browser:'المتصفحات',OS:'أنظمة التشغيل','Country/Region':'الدول والمناطق'};
const issues={RageClickCount:'Rage Clicks',DeadClickCount:'Dead Clicks',QuickbackClick:'Quickback',ScriptErrorCount:'Script Errors',ErrorClickCount:'Error Clicks',ExcessiveScroll:'Excessive Scroll'};
const status={meta_source_detected:'المصدر Meta حسب Clarity (ليس إثبات دفع)',utm_missing:'اسم الحملة غير ظاهر في Clarity',source_missing:'المصدر غير محدد',source_not_meta:'المصدر ليس Meta'};
const toast=m=>window.showToast?window.showToast(m):console.log(m);
async function context(){
 const clientId=tx(await window.kunClientId?.()),storeId=tx(await window.kunStoreId?.());
 if(!clientId)throw Error('حدد حساب العميل');
 if(!storeId)throw Error('حدد متجرًا واحدًا من أعلى الصفحة؛ تحليلات Clarity معزولة لكل متجر');
 return {clientId,storeId};
}
async function api(path,options={}){
 const p=await context(),u=new URL(path,location.origin);
 u.searchParams.set('clientId',p.clientId);u.searchParams.set('storeId',p.storeId);
 const r=await fetch(u.pathname+u.search,{credentials:'include',headers:{'Content-Type':'application/json'},...options});
 const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'HTTP '+r.status);return d;
}
function style(){
 if(document.getElementById('cl136-css'))return;
 const st=document.createElement('style');st.id='cl136-css';
 st.textContent=[
 '.cl136{direction:rtl;color:var(--ink,#1b2636);font-family:inherit}',
 '.cl136 .head{background:linear-gradient(125deg,#271747,#7945b2);color:#fff;border-radius:20px;padding:21px;display:flex;gap:14px;flex-wrap:wrap;align-items:center}',
 '.cl136 .head h2{font-size:25px;margin:0 0 6px;font-weight:900}.cl136 .head p{font-size:12px;opacity:.85;line-height:1.9;margin:0}.cl136 .space{flex:1}',
 '.cl136 button,.cl136 a.action{border:1px solid var(--line,#d6cde3);background:var(--surface,#fff);color:var(--ink,#1b2636);font-family:inherit;font-size:12px;border-radius:11px;padding:9px 13px;font-weight:800;cursor:pointer;text-decoration:none}',
 '.cl136 select{border-radius:9px;background:#fff;color:#261b39;font:inherit;font-size:12px;padding:9px;border:1px solid #cfc3df}.cl136 button:disabled{opacity:.5}.cl136 .tabs{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0}.cl136 .tabs .sel{background:#713aac;color:#fff;border-color:#713aac}',
 '.cl136 .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin:12px 0}',
 '.cl136 .metric,.cl136 .box{border:1px solid var(--line,#dcd9e7);background:var(--surface,#fff);border-radius:15px;padding:17px;margin:11px 0}',
 '.cl136 .metric{margin:0}.cl136 .metric span{font-size:12px;opacity:.7;display:block}.cl136 .metric strong{font-size:24px;font-weight:900;display:block;margin:8px 0}',
 '.cl136 .box h3{font-size:16px;font-weight:900;margin:0 0 10px}.cl136 .box p{font-size:12px;opacity:.82;line-height:1.85}',
 '.cl136 .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:12px}.cl136 .grid .box{margin:0}',
 '.cl136 .scroll{overflow:auto}.cl136 table{border-collapse:collapse;text-align:right;width:100%;min-width:620px;font-size:12px}',
 '.cl136 th,.cl136 td{padding:11px;border-bottom:1px solid var(--line,#e0dce8);vertical-align:top}',
 '.cl136 th{white-space:nowrap;background:rgba(105,58,175,.07)}.cl136 .muted{font-size:11px;opacity:.7;line-height:1.8}',
 '.cl136 .note{background:rgba(116,67,173,.07);padding:12px;border-radius:11px;font-size:12px;line-height:1.9;margin:11px 0}',
 '.cl136 .warning{background:rgba(207,150,55,.12)}.cl136 .bar{height:7px;background:rgba(128,77,178,.12);border-radius:9px;overflow:hidden;margin:5px 0}',
 '.cl136 .bar i{display:block;height:100%;background:#7f47b3}.cl136 .recommendations{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:10px}',
 '.cl136 .rec{padding:15px;border-radius:13px;border:1px solid var(--line,#ddd);border-right:4px solid #8d62bd}.cl136 .rec.high{border-right-color:#c74740}',
 '.cl136 .rec h4{font-size:14px;margin:8px 0}.cl136 .rec p{font-size:12px}.cl136 input{border:1px solid #cfc5e1;border-radius:11px;padding:10px;background:var(--surface,#fff);color:var(--ink,#1b2636);width:min(400px,100%);font:inherit}',
 '.cl136 pre{white-space:pre-wrap;overflow-wrap:anywhere;direction:ltr;text-align:left;font-size:11px;max-height:210px;overflow:auto}',
 '.cl136 .head{background:linear-gradient(120deg,#112a40,#254c69);border:1px solid #42627d;padding:25px;box-shadow:0 14px 32px rgba(19,43,72,.1)}',
 '.cl136 .head h2{font-size:23px;line-height:1.5}.cl136 .head p{font-size:13px;opacity:.9}.cl136 .tabs{overflow-x:auto;flex-wrap:nowrap;scrollbar-width:thin;padding-bottom:6px}.cl136 .tabs button{flex:0 0 auto;white-space:nowrap}.cl136 .tabs .sel{background:#164d6c;border-color:#164d6c}',
 '.cl136 .box{margin:12px 0}.cl136 .metric{box-shadow:0 2px 9px rgba(16,33,50,.035)}.cl136 .metric strong{font-size:23px;font-variant-numeric:tabular-nums}.cl136 .metric span:last-child{line-height:1.75}',
 '.cl136 .read-title{margin:21px 0 10px;font-weight:900;font-size:18px}.cl136 .read-sub{font-size:12px;color:var(--muted,#64748b);line-height:1.9;margin:0 0 12px}',
 '.cl136 .read-scope{border:1px solid var(--line,#dcd9e7);border-radius:13px;padding:12px 15px;background:var(--surface,#fff);display:flex;align-items:center;gap:12px;flex-wrap:wrap;font-size:11px;line-height:1.9;margin-top:13px}',
 '.cl136 .read-scope strong{font-size:12px;color:var(--ink,#1b2636)}.cl136 .read-scope .read-sep{width:1px;height:21px;background:var(--line,#dcd9e7)}',
 '.cl136 .brief-cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.cl136 .brief-card{padding:15px;border-radius:14px;border:1px solid var(--line,#dcd9e7);background:var(--surface,#fff);min-width:0}',
 '.cl136 .brief-card span{font-size:11px;color:var(--muted,#64748b);display:block}.cl136 .brief-card strong{font-size:25px;display:block;margin:9px 0;font-weight:900;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}.cl136 .brief-card small{font-size:10px;color:var(--muted,#64748b);line-height:1.75;display:block}',
 '.cl136 .brief-signals{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.cl136 .brief-signal{border:1px solid var(--line,#dcd9e7);background:var(--surface,#fff);padding:17px;border-radius:16px;display:flex;flex-direction:column;gap:10px;min-width:0}',
 '.cl136 .brief-signal.is-important{border-inline-start:3px solid #d97706}.cl136 .brief-signal.is-urgent{border-inline-start:3px solid #b91c1c}.cl136 .brief-signal.is-normal{border-inline-start:3px solid #0e7490}',
 '.cl136 .brief-top{display:flex;align-items:center;gap:8px;justify-content:space-between;flex-wrap:wrap}.cl136 .brief-tag{font-size:10px;color:var(--ink,#1b2636);font-weight:850;background:var(--bg,#f1f5f9);border:1px solid var(--line,#dcd9e7);border-radius:6px;padding:4px 8px}',
 '.cl136 .brief-signal h4{font-size:14px;font-weight:900;margin:0;line-height:1.65;overflow-wrap:anywhere}.cl136 .brief-signal .brief-line{font-size:12px;line-height:1.9;margin:0;color:var(--ink,#1b2636)}',
 '.cl136 .brief-signal .brief-line b{font-weight:850;color:var(--ink,#1b2636)}.cl136 .brief-evidence{padding:10px 12px;background:var(--bg,#f5f7fa);border-radius:10px;font-size:11px;line-height:1.85;color:var(--ink,#1b2636)}',
 '.cl136 .brief-next{display:flex;align-items:center;justify-content:space-between;gap:7px;margin-top:auto;padding-top:8px;border-top:1px solid var(--line,#dcd9e7)}.cl136 .brief-next button{border-color:#cbd5e1;background:transparent}',
 '.cl136 .brief-guide{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.cl136 .brief-guide .box{margin:0}.cl136 .brief-guide ul{padding-inline-start:22px;line-height:2.2;font-size:12px;margin:5px 0}',
 '.cl136 .brief-definition{border:1px solid var(--line,#dcd9e7);background:var(--surface,#fff);border-radius:12px;padding:14px}.cl136 .brief-definition b{font-size:13px;display:block;margin-bottom:6px}.cl136 .brief-definition p{margin:0;font-size:11px;line-height:1.9}',
 '.cl136 .brief-definitions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:12px 0}',
 '.cl136 details.read-more{border:1px solid var(--line,#dcd9e7);border-radius:14px;background:var(--surface,#fff);margin:12px 0;padding:12px 15px}',
 '.cl136 details.read-more>summary{font-size:13px;font-weight:850;cursor:pointer;line-height:1.8;padding:4px 0}.cl136 details.read-more[open]>summary{margin-bottom:12px}',
 '.cl136 .rec{background:var(--surface,#fff)}.cl136 .rec small{color:var(--muted,#64748b);font-size:10px}.cl136 .rec .rec-meaning{padding:10px;background:var(--bg,#f5f7fa);border-radius:9px}',
 '.cl136 .read-empty{padding:20px;border:1px dashed var(--line,#cbd5e1);border-radius:14px;color:var(--muted,#64748b);font-size:12px;line-height:1.9}',
 'body[data-theme="dark"] .cl136 .brief-evidence,body[data-theme="dark"] .cl136 .rec .rec-meaning{background:var(--panel,#172033)}',
 '@media(max-width:1050px){.cl136 .brief-cards{grid-template-columns:repeat(2,minmax(0,1fr))}}',
 '@media(max-width:720px){.cl136 .brief-signals,.cl136 .brief-guide,.cl136 .brief-definitions{grid-template-columns:1fr}}',
 '@media(max-width:600px){.cl136 .head h2{font-size:20px}.cl136 .grid{grid-template-columns:1fr}.cl136 .brief-cards{grid-template-columns:repeat(2,minmax(0,1fr))}.cl136 .brief-card{padding:12px}.cl136 .brief-card strong{font-size:21px}.cl136 .read-scope{gap:6px}.cl136 .read-scope .read-sep{display:none}}'
 ].join('');
 document.head.appendChild(st);
}
const metric=(label,value,note)=>'<div class="metric"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong><span>'+esc(note||'')+'</span></div>';
const table=(heads,rows)=>'<div class="scroll"><table><thead><tr>'+heads.map(x=>'<th>'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+(rows.length?rows.join(''):'<tr><td colspan="'+heads.length+'">لا توجد بيانات متاحة.</td></tr>')+'</tbody></table></div>';
function breakdown(dim,rows,limit=25){
 const list=(rows||[]).slice(0,limit),maximum=Math.max(1,...list.map(x=>Number(x.sessions)||0));
 return '<section class="box"><h3>'+esc(dims[dim]||dim)+'</h3>'+table(['الاسم','الجلسات','البوت'],
 list.map(x=>'<tr><td><b>'+esc(x.name)+'</b></td><td>'+n(x.sessions)+'<div class="bar"><i style="width:'+Math.round((Number(x.sessions)||0)/maximum*100)+'%"></i></div></td><td>'+n(x.botSessions)+'</td></tr>'))+'</section>';
}
function summary(d){
 const m=d.latest?.metrics||{},g=d.growth||{},paid=(m.campaigns||[]).reduce((total,x)=>total+(Number(x.paidSessions)||0),0);
 return '<div class="cards">'+metric('جلسات Clarity',n(m.totals?.sessions),'آخر '+(m.snapshotHours||24)+' ساعة UTC')+
 metric('جلسات البوت',n(m.totals?.botSessions),'وفق تصنيف Clarity')+
 metric('جلسات مصدر Meta',n(paid),'حسب مصدر Clarity، قد يشمل زيارات عضوية')+
 metric('الحملات',n(m.dimensions?.Campaign?.length),'الأسماء الظاهرة بالتقسيم')+
 metric('حملات Meta',n(g.campaigns?.length),'بما فيها غير المطابقة')+
 metric('آخر سحب',d.latest?.syncedAt?new Date(d.latest.syncedAt).toLocaleString('ar-EG'):'—','بيانات مخزنة من API')+'</div>';
}
// Interpretable, deterministic observations backed by data exported by Clarity.
// Numeric cutoffs below are product prioritization rules, not Clarity diagnoses.
const numberOrNull=value=>value===null||value===undefined||value===''||!Number.isFinite(Number(value))?null:Number(value);
function clockLabel(value){
 const parsed=Date.parse(String(value||''));return Number.isFinite(parsed)?new Date(parsed).toLocaleString('ar-EG'):'غير متاح';
}
function reportScope(d){
 const hours=d.latest?.metrics?.snapshotHours||V.days*24;
 const elapsed=Date.now()-Date.parse(String(d.latest?.syncedAt||''));
 const stale=Number.isFinite(elapsed)&&elapsed>24*3600000;
 const limited=Object.values(d.latest?.sampleCoverage||{}).some(x=>Number(x)>=1000);
 return '<div class="read-scope" data-clarity-report-scope><strong>المصدر: Microsoft Clarity Data Export API</strong><span class="read-sep"></span><span>نافذة التحليل: آخر '+n(hours)+' ساعة (UTC)</span><span class="read-sep"></span><span>آخر سحب: '+esc(clockLabel(d.latest?.syncedAt))+'</span>'+
 (stale?'<span class="brief-tag">البيانات تحتاج تحديثًا</span>':'')+
 (limited?'<span class="brief-tag">بعض العينات قد تكون ناقصة (حد API)</span>':'')+'</div>';
}
function readSignal({level='normal',title,source='Clarity',evidence,meaning,action,jump,scope}){
 return '<article class="brief-signal is-'+esc(level)+'"><div class="brief-top"><span class="brief-tag">'+esc(source)+'</span><span class="muted">'+esc(scope||'ملاحظة تشخيصية')+'</span></div>'+
 '<h4>'+esc(title)+'</h4><div class="brief-evidence"><b>الدليل من البيانات:</b> '+esc(evidence)+'</div>'+
 '<p class="brief-line"><b>ماذا يعني؟</b> '+esc(meaning)+'</p>'+
 '<p class="brief-line"><b>الخطوة المقترحة:</b> '+esc(action)+'</p>'+
 (jump?'<div class="brief-next"><span class="muted">استنتاج مبدئي، وليس إثباتًا لسبب المشكلة</span><button type="button" data-cl136-jump="'+esc(jump)+'">راجع التفاصيل ←</button></div>':'')+
 '</article>';
}
function evidenceSignals(d){
 const m=d.latest?.metrics||{},c=m.coverage||{},g=d.growth||{},arr=[];
 const cMeta=numberOrNull(c.metaWithoutCampaignSessions);
 if(cMeta!==null&&cMeta>0)arr.push({
   level:'important',title:'جلسات من Meta بدون اسم حملة',source:'Clarity · جودة UTM',
   evidence:n(cMeta)+' جلسة مصدرها Facebook أو Instagram لم يظهر لها utm_campaign في نافذة '+n(m.snapshotHours||V.days*24)+' ساعة.',
   meaning:'المقارنة بين الحملة وسلوك الزوار ممكن تكون ناقصة، ولا يمكن إسناد كل جلسة لإعلان بعينه.',
   action:'راجع utm_campaign وutm_source في روابط الإعلانات، ثم أعد فحص التقرير بعد تحديث البيانات.',jump:'health'
 });
 const campaigns=(g.campaigns||[]).filter(x=>numberOrNull(x.claritySessions)>=30);
 const kinds=[
   {key:'rageRate',cutoff:15,term:'نقرات متكررة',hint:'قد تكون هناك عناصر أو خطوات تسبب إحباطًا لدى بعض الزوار.',fix:'شاهد تسجيلات جلسات الحملة واختبر أزرار المنتج والطلب، خصوصًا على الجوال.'},
   {key:'deadRate',cutoff:20,term:'نقرات غير فعّالة',hint:'قد يتوقع العميل استجابة من عنصر لا يتفاعل بالشكل المعتاد.',fix:'اختبر أزرار الشراء والقوائم وحالات التحميل، ثم راجع الخرائط الحرارية.'},
   {key:'scriptErrorRate',cutoff:5,term:'أخطاء JavaScript',hint:'قد تؤثر أخطاء البرمجة في التصفح أو إتمام الطلب؛ لا تثبت وحدها حدوث فقد مبيعات.',fix:'افحص Console وأخطاء المتصفح في صفحات الهبوط والـCheckout المرتبطة بالحملة.'}
 ];
 for(const kind of kinds){
   const candidates=campaigns.filter(x=>numberOrNull(x[kind.key])!==null&&Number(x[kind.key])>=kind.cutoff)
       .sort((a,b)=>Number(b[kind.key])-Number(a[kind.key]));
   const item=candidates[0];if(!item)continue;
   arr.push({level:'urgent',title:kind.term+' في حملة «'+item.name+'»',source:'Clarity · UTM Campaign',
     evidence:pct(item[kind.key])+' من جلسات المقياس المعروضة لهذه الحملة · '+n(item.claritySessions)+' جلسة Clarity مسجلة ضمن تقسيم الحملة.',
     meaning:kind.hint,action:kind.fix,jump:'friction',scope:'قاعدة مراجعة: ≥ '+n(kind.cutoff)+'%، بعينة 30 جلسة أو أكثر'});
 }
 const pages=(m.pagesDetail||[]).filter(x=>numberOrNull(x.sessions)>=30)
   .filter(x=>(numberOrNull(x.rageRate)>=15)||(numberOrNull(x.deadRate)>=20))
   .sort((a,b)=>Math.max(Number(b.rageRate)||0,Number(b.deadRate)||0)-Math.max(Number(a.rageRate)||0,Number(a.deadRate)||0));
 if(pages.length){
   const p=pages[0],label=numberOrNull(p.rageRate)>=15?'Rage Clicks':'Dead Clicks',rate=label==='Rage Clicks'?p.rageRate:p.deadRate;
   arr.push({level:'important',title:'صفحة زيارة تستحق مراجعة: '+String(p.name||'').slice(0,65),source:'Clarity · تقسيم URL',
     evidence:n(p.sessions)+' جلسة مرتبطة بالصفحة · '+label+' '+pct(rate)+'.',
     meaning:'إشارة تستدعي مراجعة تجربة الصفحة، وليست دليلًا منفردًا على سبب انخفاض التحويل.',
     action:'راجع التسجيلات الخاصة بهذه الصفحة على الجوال والكمبيوتر، ثم اختبر العنصر محل المشكلة.',jump:'pages'});
 }
 if(!arr.length)arr.push({
   level:'normal',title:'لا توجد إشارة أولوية قوية في العينة المتاحة',source:'Clarity · قراءة أولية',
   evidence:n(m.totals?.sessions)+' جلسة في النافذة المختارة، مع فحص الإشارات التي أعادها التصدير فقط.',
   meaning:'غياب إشارات فوق الحدود الاسترشادية لا يعني أن تجربة الشراء خالية من المشكلات؛ وقد تكون بعض المقاييس غير متاحة.',
   action:'ابدأ بأكثر الصفحات زيارةً، وشاهد تسجيلات حقيقية، وراجع تسمية الحملات وجودة التتبع.',jump:'pages'
 });
 return arr.slice(0,4);
}
function readingBrief(d){
 const signals=evidenceSignals(d);
 return '<h3 class="read-title">ماذا تقول بيانات Clarity؟</h3><p class="read-sub">كل ملاحظة هنا مرتبطة بدليل، وتفسير محتمل، وخطوة عملية. التنبيهات مبنية على قواعد تشخيص وليست قرارات ذكاء اصطناعي مؤكدة أو قياسًا مباشرًا للمبيعات.</p>'+
 '<div class="brief-signals" data-clarity-evidence-cards>'+signals.map(readSignal).join('')+'</div>';
}
function briefStats(d){
 const m=d.latest?.metrics||{},c=m.coverage||{},sourceCount=(m.dimensions?.Source||[]).length,
 count=m.totals?.sessions,bot=m.totals?.botSessions,taggedMeta=c.metaSourceSessions,utmLoss=c.metaWithoutCampaignSessions;
 const items=[
  ['جلسات Clarity',n(count),'عدد جلسات في نافذة التصدير، وليس عدد العملاء الفريدين'],
  ['جلسات البوت',n(bot),'جلسات صنّفها Clarity آلية؛ لا تُجمع فوق الإجمالي'],
  ['جلسات مصدر Meta',n(taggedMeta),'Facebook/Instagram حسب Clarity، ولا تعني بالضرورة زيارات مدفوعة'],
  ['Meta بدون اسم حملة',n(utmLoss),'جلسات تحتاج مراجعة UTM Campaign']
 ];
 return '<div class="brief-cards" data-clarity-kpis>'+items.map(x=>'<article class="brief-card"><span>'+esc(x[0])+'</span><strong>'+esc(x[1])+'</strong><small>'+esc(x[2])+'</small></article>').join('')+'</div>';
}
function readingGuide(d){
 const limitations=(d.latest?.metrics?.limitations||[]).slice(0,3);
 return '<div class="brief-guide"><section class="box"><h3>كيف تحوّل القراءة إلى تحسين؟</h3><ul>'+
 '<li>ابدأ بالملاحظة الأكثر تكرارًا وبعينة واضحة، ثم افتح تسجيلات الجلسات.</li>'+
 '<li>حدد الصفحة أو العنصر المؤثر، وغيّر شيئًا واحدًا ثم اختبر أثره.</li>'+
 '<li>قارن نتائج الأوردرات والتسليم من كن أونلاين بعد التعديل؛ لا تستخدم الجلسات وحدها كمقياس للربحية.</li>'+
 '</ul></section><section class="box"><h3>درجة اكتمال الدليل</h3><p>جلسات Clarity ترصد سلوك الزائر؛ Meta يعرض أداء الإعلانات؛ وكن أونلاين يعرض الطلبات. المقارنة بينها للمراجعة، وليست ربطًا فرديًا لكل جلسة بأوردر.</p>'+
 (limitations.length?limitations.map(x=>'<div class="muted">• '+esc(x)+'</div>').join(''):'<p class="muted">الفترة محدودة بنافذة Data Export؛ تحقق من التسجيلات قبل اتخاذ قرار.</p>')+
 '</section></div>';
}
function caveats(d){return '<section class="box"><h3>حدود البيانات وجودة التقرير</h3>'+(d.latest?.metrics?.limitations||[]).map(t=>'<div class="note warning">'+esc(t)+'</div>').join('')+
 '<div class="note">أرقام Clarity ليست زيارات Meta الفريدة أو أوردرات. لا يمكن حساب ROAS أو Funnel أو نسبة التحويل الصحيحة من جلسات Clarity وحدها.</div></section>';}
function overview(d){
 const m=d.latest.metrics||{},v=m.dimensions||{},g=d.growth||{};
 return reportScope(d)+briefStats(d)+readingBrief(d)+readingGuide(d)+
 '<h3 class="read-title">من أين تأتي الجلسات؟</h3><p class="read-sub">جداول تفصيلية للمصادر والأجهزة. تختلف الجلسات عن عدد الأوردرات.</p>'+
 '<div class="grid">'+breakdown('Source',v.Source,8)+breakdown('Device',v.Device,8)+'</div>'+
 '<section class="box"><h3>ماذا نعرف عن الإعلانات والمبيعات؟</h3>'+
 (g.metaConnected?'<div class="cards">'+metric('إنفاق Meta',n(g.metaTotals?.spend),'من Meta، وفق نطاقها الزمني')+
 metric('أوردرات فعلية',n(g.metaTotals?.realOrders),'من بيانات كن أونلاين')+
 metric('Real ROAS',g.metaTotals?.realRoas==null?'—':n(g.metaTotals.realRoas)+'x','إيرادات الطلبات المُسلَّمة ÷ الصرف وفق تقرير Meta × كن أونلاين')+'</div>':'<p>بيانات Meta غير مرتبطة أو غير متاحة. تقارير Clarity السلوكية تظل قابلة للعرض، ولكن لا يمكن استنتاج أداء الإنفاق الإعلاني منها وحدها.</p>')+
 '<p class="muted">تنبيه: اختلاف توقيت Clarity وMeta يمنع الاستدلال المباشر على إسناد جلسة لأوردر.</p></section>'+
 '<details class="read-more"><summary>حدود التصدير وملاحظات جودة البيانات</summary>'+caveats(d)+'</details>';
}
function recommendationCard(r){
 const category=String(r.category||'');
 const isMeta=category==='meta_expert';
 const evidence=tx(r.detail);
 const action=tx(r.action)||(category==='landing'?'راجع جلسات الزوار وأزرار صفحة الهبوط قبل زيادة الإنفاق':
   category==='errors'?'افحص أخطاء JavaScript في صفحة الطلب والمنتج':
   category.includes('utm')||category==='attribution'?'صحح وسوم UTM، ثم أعد جمع البيانات وقارن النتائج':
   'افتح التقرير التفصيلي واختبر الفرضية على المتجر');
 const meaning=category==='landing'?'قد يكون التفاعل مع صفحة الوصول غير مريح لبعض الزوار':
   category==='errors'?'الأخطاء التقنية تستحق الفحص قبل أي قرار بالتوسع':
   category==='attribution'||category==='utm_health'?'مطابقة الحملات غير مكتملة، فلا يمكن ربط هذه الزيارات بالإعلانات بثقة':
   isMeta?'قراءة أداء Meta مستقلة عن جلسات Clarity':
   'إشارة للمراجعة وليست دليلًا قاطعًا على السبب';
 return '<article class="rec'+(r.priority==='high'?' high':'')+'"><small>'+(r.priority==='high'?'يستحق أولوية في المراجعة':'ملاحظة للمراجعة')+
 ' · '+(isMeta?'مصدر التحليل: Meta':'مصدر التحليل: Clarity / UTM')+'</small><h4>'+esc(r.title)+'</h4>'+
 (r.campaign?'<div class="muted">الحملة: '+esc(r.campaign)+'</div>':'')+
 '<p class="rec-meaning"><b>الدليل:</b> '+esc(evidence||'تفاصيل القياس غير متاحة في هذا المؤشر')+'</p>'+
 '<p><b>القراءة المحتملة:</b> '+esc(meaning)+'</p><p><b>الإجراء المقترح:</b> '+esc(action)+'</p></article>';
}
function growth(d){
 const g=d.growth||{},rows=(g.campaigns||[]).filter(x=>!V.search||tx(x.name).toLowerCase().includes(V.search.toLowerCase()));
 const recommendations=(g.recommendations||[]).slice().sort((a,b)=>(a.priority==='high'?0:1)-(b.priority==='high'?0:1));
 const lines=rows.map(x=>'<tr><td><b>'+esc(x.name)+'</b><div class="muted">'+esc(status[x.sourceStatus]||'')+'</div></td>'+
 '<td>'+n(x.spend)+'</td><td>'+pct(x.ctr)+'</td><td>'+n(x.platformPurchases)+'</td><td>'+n(x.realOrders)+'</td><td>'+n(x.deliveredOrders)+'</td>'+
 '<td>'+(x.realRoas==null?'—':n(x.realRoas)+'x')+'</td><td>'+n(x.claritySessions)+'</td><td>'+n(x.metaSourceSessions)+'</td><td>'+pct(x.rageRate)+'</td><td>'+pct(x.deadRate)+'</td><td>'+pct(x.scriptErrorRate)+'</td></tr>');
 return reportScope(d)+
 '<h3 class="read-title">أين توجد فرص التحسين؟</h3><p class="read-sub">إشارات مراجعة من سلوك Clarity، وبعضها من تحليل Meta المنفصل. لا تُحسب كل جلسة باعتبارها أوردرًا أو ضياع مبيعات.</p>'+
 (recommendations.length?'<div class="recommendations">'+recommendations.slice(0,8).map(recommendationCard).join('')+'</div>':
 '<div class="read-empty">لا توجد توصيات قابلة للاستخراج من هذه النافذة. قد تكون بيانات الإنفاق غير متصلة أو حجم العينة محدودًا؛ راجع بيانات Clarity الأولية.</div>')+
 (recommendations.length>8?'<details class="read-more"><summary>عرض بقية الملاحظات ('+n(recommendations.length-8)+')</summary><div class="recommendations">'+recommendations.slice(8).map(recommendationCard).join('')+'</div></details>':'')+
 '<details class="read-more"><summary>جدول مقارنة كل الحملات: Meta × Clarity × طلبات كن أونلاين</summary>'+
 '<div class="note warning">'+esc(g.attributionWarning||'فترات ومناهج القياس مختلفة؛ المطابقة بالاسم فقط')+'</div>'+
 '<input id="cl136-search" placeholder="ابحث باسم الحملة..." aria-label="البحث عن الحملة" value="'+esc(V.search)+'">'+
 table(['الحملة وUTM','صرف Meta','CTR','مشتريات Meta','أوردرات النظام','تم التسليم','ROAS الفعلي','جلسات Clarity','جلسات مصدر Meta','Rage %','Dead %','أخطاء JS %'],lines)+
 '</details>'+
 '<details class="read-more"><summary>تفصيل الإعلانات والمجموعات من Meta (بيانات مستقلة عن جلسات Clarity)</summary>'+
 table(['الإعلان','المجموعة','الحملة','صرف Meta','Purchases','CPP','ROAS'],(g.ads||[]).slice(0,70).map(r=>'<tr><td>'+esc(r.name)+'</td><td>'+esc(r.adsetName)+'</td><td>'+esc(r.campaignName)+'</td><td>'+n(r.spend)+'</td><td>'+n(r.purchases)+'</td><td>'+n(r.cpp)+'</td><td>'+n(r.roas)+'x</td></tr>'))+
 '</details>';
}
function pages(d){
 const m=d.latest.metrics||{},dim=m.dimensions||{},details=m.pagesDetail||[];
 const cells=details.slice(0,100).map(p=>'<tr><td><b>'+esc(p.name)+'</b></td>'+
 '<td>'+n(p.sessions)+'</td><td>'+n(p.botSessions)+'</td><td>'+pct(p.scrollDepth)+'</td><td>'+n(p.engagementTime)+'</td><td>'+pct(p.rageRate)+'</td><td>'+pct(p.deadRate)+'</td></tr>');
 const prioritised=details.filter(x=>numberOrNull(x.sessions)>=30&&
 (numberOrNull(x.rageRate)>=15||numberOrNull(x.deadRate)>=20))
 .sort((a,b)=>Math.max(Number(b.rageRate)||0,Number(b.deadRate)||0)-Math.max(Number(a.rageRate)||0,Number(a.deadRate)||0)).slice(0,5);
 return reportScope(d)+
 '<h3 class="read-title">صفحات تستحق المراجعة</h3><p class="read-sub">نبرز الصفحات التي لديها 30 جلسة على الأقل ومؤشر تفاعل غير طبيعي تجاوز حدًا استرشاديًا. لا تُفسر كل نقرة بوصفها خطأ مؤكدًا.</p>'+
 (prioritised.length?'<div class="brief-signals">'+prioritised.map(p=>readSignal({
   level:'important',source:'Clarity · صفحات URL',
   title:'مراجعة '+String(p.name||'صفحة').slice(0,90),
   evidence:n(p.sessions)+' جلسة · Rage '+pct(p.rageRate)+' · Dead '+pct(p.deadRate),
   meaning:'قد يجد بعض الزوار صعوبة في فهم أو الضغط على عناصر الصفحة.',
   action:'افتح تسجيلات هذه الصفحة وخرائط الحرارة، وتحقق من الأزرار والتصفح على الهاتف.',
   jump:'friction',scope:'عينة 30 جلسة أو أكثر'
 })).join('')+'</div>':
 '<div class="read-empty">لا توجد صفحات تجاوزت حدود التنبيه مع عينة 30 جلسة أو أكثر. لو قيم Clarity ناقصة فهذا لا يعني أن معدل الاحتكاك صفر.</div>')+
 '<h3 class="read-title">ماذا يعني كل مؤشر في الصفحة؟</h3>'+
 '<div class="brief-definitions">'+
 '<div class="brief-definition"><b>عمق التمرير Scroll Depth</b><p>متوسط مدى النزول داخل الصفحة إن وفر Clarity المقياس. لا يثبت أن العميل شاهد كل المحتوى.</p></div>'+
 '<div class="brief-definition"><b>وقت التفاعل Engagement</b><p>مؤشر تفاعل بحسب Clarity، وليس مدة الجلسة كلها. الوحدة تتبع حقل التصدير عند توفره.</p></div>'+
 '<div class="brief-definition"><b>النقرات غير الفعالة Dead Clicks</b><p>قد تشير لعناصر يتوقع الزائر تفاعلها. راجع التسجيلات أولًا لمعرفة السبب.</p></div></div>'+
 '<details class="read-more"><summary>عرض جدول جميع الصفحات والقياسات الخام</summary>'+
 '<div class="note warning">تقسيم URL ليس Funnel تحويلًا، ولا يعني جلسات فريدة. «—» تعني أن Clarity لم يُرجع قيمة قابلة للحساب.</div>'+
 table(['صفحة URL','جلسات','بوت','Scroll Depth','Engagement Time','Rage %','Dead %'],cells)+'</details>'+
 '<div class="grid">'+breakdown('Medium',dim.Medium,30)+breakdown('Channel',dim.Channel,30)+'</div>'+
 '<section class="box"><h3>الخطوة التالية لتطوير صفحة المنتج والشراء</h3><p>ابدأ بأكثر صفحات المنتج والشراء زيارة، وافحص أزرار إتمام الطلب وعناصر اختيار المقاس أو الكمية وأخطاء التحميل؛ قارن نتيجة أي تعديل بأوردرات حقيقية داخل كن أونلاين.</p>'+
 '<a class="action" href="https://clarity.microsoft.com/" target="_blank" rel="noopener noreferrer">افتح التسجيلات وخرائط الحرارة في Microsoft Clarity ↗</a></section>';
}
function audience(d){
 const dimsData=d.latest.metrics.dimensions||{};
 return '<div class="grid">'+['Source','Channel','Medium','Device','Browser','OS','Country/Region','Campaign'].map(x=>breakdown(x,dimsData[x],30)).join('')+'</div>';
}
function friction(d){
 const m=d.latest.metrics||{},campaigns=(m.campaigns||[]);
 const definitions=[
 ['Rage Clicks · نقرات متكررة','تكرار الضغط سريعًا على نفس الموضع قد يعكس صعوبة في التفاعل، لكنه لا يثبت وجود خطأ تقني.'],
 ['Dead Clicks · نقرات بلا استجابة','ضغط على عنصر لم يترتب عليه تغير متوقع في الصفحة؛ يلزم مراجعة التسجيل لتمييزه عن التفاعل الطبيعي.'],
 ['Quickback · رجوع سريع','عودة الزائر بسرعة بعد الانتقال، وقد تشير إلى اختلاف المتوقع عن المحتوى.'],
 ['Script Errors · أخطاء برمجية','إشارات لأخطاء JavaScript يجب فحصها في Console وربطها بالصفحة والجهاز.'],
 ['Excessive Scroll · تمرير مفرط','سلوك تمرير متكرر قد يعني صعوبة العثور على المحتوى؛ ليس دليلًا منفردًا على مشكلة.'],
 ['نِسَب مفقودة · —','إذا لم يُرجع Clarity النسبة مع حجم عينة صالح فلن نحولها إلى صفر أو نخترع متوسطًا.']
 ];
 const rows=campaigns.filter(x=>numberOrNull(x.sessions)>=30).filter(x=>numberOrNull(x.RageClickCount)>=15||
 numberOrNull(x.DeadClickCount)>=20||numberOrNull(x.ScriptErrorCount)>=5)
 .sort((a,b)=>Math.max(Number(b.RageClickCount)||0,Number(b.DeadClickCount)||0)-Math.max(Number(a.RageClickCount)||0,Number(a.DeadClickCount)||0)).slice(0,6);
 return reportScope(d)+
 '<h3 class="read-title">قراءة مشاكل التفاعل بشكل مفهوم</h3><p class="read-sub">هذه مؤشرات سلوكية وليست أخطاء مؤكدة في المتجر. اعتمد على تسجيلات الجلسات لاختبار الفرضية وتحديد الصفحة أو العنصر.</p>'+
 '<div class="brief-definitions">'+definitions.map(x=>'<div class="brief-definition"><b>'+esc(x[0])+'</b><p>'+esc(x[1])+'</p></div>').join('')+'</div>'+
 '<h3 class="read-title">الحملات التي تستحق الفحص أولًا</h3>'+
 (rows.length?'<div class="brief-signals">'+rows.map(r=>readSignal({
   level:'important',title:'مراجعة تفاعل حملة '+r.name,source:'Clarity · UTM Campaign',
   evidence:n(r.sessions)+' جلسة · Rage '+pct(r.RageClickCount)+' · Dead '+pct(r.DeadClickCount)+' · أخطاء JS '+pct(r.ScriptErrorCount),
   meaning:'ظهرت إشارة واحدة أو أكثر أعلى الحدود الاسترشادية. لا نعرف الصفحة أو المشكلة الدقيقة قبل مشاهدة الجلسات.',
   action:'شاهد تسجيلات الحملة وابحث عن الصفحة المتكررة، ثم افحص العنصر أو الخطأ على الجهاز الأكثر استخدامًا.',
   jump:'pages',scope:'قاعدة تشخيص · 30 جلسة فأكثر'
 })).join('')+'</div>':
 '<div class="read-empty">لا توجد حملة في العينة الحالية تجاوزت حدود الفحص مع 30 جلسة أو أكثر؛ وقد تكون بعض المؤشرات غير متاحة.</div>')+
 '<details class="read-more"><summary>التفاصيل الفنية لكل مؤشرات الاحتكاك</summary>'+
 '<div class="grid">'+(m.diagnostics||[]).map(b=>'<section class="box"><h3>'+esc(b.label||issues[b.metric]||b.metric)+'</h3>'+
 table(['الحملة','الجلسات المقيسة','النسبة الموزونة'],(b.segments||[]).slice(0,30).map(r=>'<tr><td>'+esc(r.name)+'</td><td>'+n(r.sessions)+'</td><td>'+pct(r.rate)+'</td></tr>'))+'</section>').join('')+'</div>'+
 '<section class="box"><h3>جدول مقارنة مؤشرات كل حملة</h3>'+
 table(['الحملة','جلسات','Rage','Dead','Quickback','Script Errors'],campaigns.slice(0,70).map(r=>'<tr><td>'+esc(r.name)+'</td><td>'+n(r.sessions)+'</td><td>'+pct(r.RageClickCount)+'</td><td>'+pct(r.DeadClickCount)+'</td><td>'+pct(r.QuickbackClick)+'</td><td>'+pct(r.ScriptErrorCount)+'</td></tr>'))+
 '</section></details>';
}
function health(d){
 const c=d.latest.metrics?.coverage||{},sample=d.latest.sampleCoverage||{},info=d.status||{};
 const age=info.lastSyncAt?Math.max(0,(Date.now()-Date.parse(info.lastSyncAt))/3600000):null;
 const flags=[];
 if((c.metaWithoutCampaignSessions||0)>0)flags.push('يوجد '+n(c.metaWithoutCampaignSessions)+' جلسات مصدرها Meta من غير utm_campaign؛ راجع Parameter URLs للإعلانات.');
 if((sample.campaignRows||0)>=1000||(sample.pagesRows||0)>=1000||(sample.technologyRows||0)>=1000)flags.push('هناك نتيجة وصلت 1000 صف؛ بعض التقسيمات مقطوعة حسب سقف Data Export API.');
 if(age!=null&&age>24)flags.push('البيانات المخزنة أقدم من 24 ساعة؛ اختبر التوكن وحد المزامنة.');
 if((c.metaSourceSessions||0)===0&&(c.sessions||0)>0)flags.push('لم يرصد Clarity مصدر Facebook أو Instagram في النافذة المختارة. تأكد من UTM Source أولًا.');
 return '<div class="cards">'+metric('جلسات مصدر Meta',n(c.metaSourceSessions),'حسب Clarity، لا تثبت نقرة مدفوعة')+
 metric('Meta بلا اسم حملة',n(c.metaWithoutCampaignSessions),'تحتاج utm_campaign')+
 metric('نسبة تسمية كل الجلسات',pct(c.taggedRate),'Organic قد يكون غير موسوم طبيعيًا')+
 metric('زيارات بلا مصدر',n(c.unknownSourceSessions),'ليس بالضرورة فقدان التتبع')+
 metric('جودة تسمية Meta',c.metaUntaggedRate==null?'—':pct(100-c.metaUntaggedRate),'وجود اسم حملة في تقسيم Clarity')+
 metric('عمر آخر مزامنة',age==null?'—':n(age)+' ساعة','آخر نجاح، وليس آخر زيارة')+'</div>'+
 '<section class="box"><h3>فحص دقة التقارير</h3>'+
 (flags.length?flags.map(m=>'<div class="note warning">'+esc(m)+'</div>').join(''):'<div class="note">لا توجد إشارات خلل مؤكدة بالبيانات المتاحة؛ راجع Live Sessions داخل Clarity.</div>')+
 '<div class="note">حد API عشرة طلبات للمشروع يوميًا. يحتفظ كن أونلاين بطلبين كاحتياطي؛ كل مزامنة موسعة تستخدم 3 طلبات.</div></section>'+
 '<section class="box"><h3>حجم العينات المتاحة</h3>'+table(['التقسيم','الصفوف','التغطية'],
 [['الحملات والمصادر',sample.campaignRows],['الصفحات',sample.pagesRows],['التقنية',sample.technologyRows]].map(x=>'<tr><td>'+esc(x[0])+'</td><td>'+n(x[1])+'</td><td>'+(Number(x[1])>=1000?'ربما ناقصة (حد API)':'حسب استجابة Clarity')+'</td></tr>'))+'</section>'+caveats(d);
}
function metrics(d){
 const catalog=d.latest.metrics?.catalog||[];
 return '<section class="box"><h3>مكتبة مؤشرات Microsoft Clarity</h3><p>كل Metric أعاده Data Export API مع عدد سجلاته، وأمثلة حقول محدودة. لا يمكن استخراج فيديوهات التسجيلات أو الصور الحرارية من هذا API.</p>'+
 table(['المقياس','مجموعة البيانات','عدد الصفوف','الحد'],catalog.map(x=>'<tr><td>'+esc(x.label)+'<div class="muted">'+esc(x.metric)+'</div></td><td>'+esc(x.scope)+'</td><td>'+n(x.rows)+'</td><td>'+esc(x.limited?'ربما 1000':'—')+'</td></tr>'))+'</section>'+
 '<div class="grid">'+catalog.map(x=>'<section class="box"><h3>'+esc(x.label)+'</h3><div class="muted">'+esc(x.scope)+'</div><pre>'+esc(JSON.stringify(x.example,null,2))+'</pre></section>').join('')+'</div>';
}
function history(d){return '<section class="box"><h3>تاريخ المزامنات</h3><p>كل نقطة تمثل نافذة متحركة وقت سحبها؛ الفترات متداخلة ولا تُجمع لإجمالي شهري.</p>'+
 table(['وقت العينة','الجلسات في نافذة '+(V.days*24)+' ساعة'],(d.history||[]).slice(0,30).map(x=>'<tr><td>'+esc(new Date(x.syncedAt).toLocaleString('ar-EG'))+'</td><td>'+n(x.campaignSessions)+'</td></tr>'))+'</section>';}
function csv(){
 const d=V.data;if(!d?.latest)return;
 let keys=['name','sessions','botSessions'],rows=d.latest.metrics.dimensions.Campaign||[];
 if(V.tab==='growth'){keys=['name','spend','ctr','platformPurchases','realOrders','deliveredOrders','realRoas','claritySessions','metaSourceSessions','rageRate','deadRate','scriptErrorRate','sourceStatus'];rows=d.growth?.campaigns||[];}
 if(V.tab==='pages'){keys=['name','sessions','botSessions','scrollDepth','engagementTime','rageRate','deadRate'];rows=d.latest.metrics.pagesDetail||[];}
 if(V.tab==='audience'){keys=['dimension','name','sessions','botSessions'];rows=Object.entries(d.latest.metrics.dimensions).flatMap(([dimension,list])=>list.map(x=>({...x,dimension})));}
 if(V.tab==='friction'){keys=['name','sessions',...Object.keys(issues)];rows=d.latest.metrics.campaigns||[];}
 if(V.tab==='health'){keys=['metric','value'];rows=Object.entries(d.latest.metrics.coverage||{}).map(([metric,value])=>({metric,value}));}
 if(V.tab==='metrics'){keys=['metric','label','scope','rows','limited'];rows=d.latest.metrics.catalog||[];}
 const safe=v=>String(v??'').replace(/"/g,'""').replace(/^[=+\-@]/,"'$&");
 const lines=[keys,...rows.map(x=>keys.map(k=>x[k]))],txt='\uFEFF'+lines.map(r=>r.map(v=>'"'+safe(v)+'"').join(',')).join('\r\n');
 const url=URL.createObjectURL(new Blob([txt],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='clarity-kun-online-'+V.tab+'.csv';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),800);
}
function render(){
 if(!V.active||view()!=='analytics')return;
 const el=ROOT();if(!el)return;style();
 const d=V.data,missing=!d?.latest;
 el.innerHTML='<div class="cl136"><header class="head"><div><h2>◈ تحليل سلوك العملاء · Microsoft Clarity</h2><p>من سلوك الزائر إلى قرار تحسين واضح: دليل ← تفسير محتمل ← إجراء قابل للاختبار</p></div><span class="space"></span>'+
 '<button id="cl136-system">التقارير العامة</button><label style="font-size:12px;font-weight:800">الفترة <select id="cl136-days" aria-label="فترة Clarity"><option value="1" '+(V.days===1?'selected':'')+'>24 ساعة</option><option value="2" '+(V.days===2?'selected':'')+'>48 ساعة</option><option value="3" '+(V.days===3?'selected':'')+'>72 ساعة</option></select></label><button id="cl136-sync">مزامنة Clarity</button><button id="cl136-csv">CSV</button></header>'+
 '<nav class="tabs">'+Object.entries(tabs).map(([id,label])=>'<button data-tab="'+esc(id)+'" class="'+(V.tab===id?'sel':'')+'">'+esc(label)+'</button>').join('')+'</nav>'+
 (missing?'<section class="box"><h3>لا توجد بيانات مخزنة لفترة '+(V.days*24)+' ساعة</h3><p>لو الربط متصل، اضغط مزامنة Clarity لسحب النافذة المختارة (3 طلبات API). وإن لم يكن متصلًا فراجعه داخل التكاملات.</p><button id="cl136-setup">فتح التكاملات</button></section>':
 (V.tab==='overview'?overview(d):V.tab==='growth'?growth(d):V.tab==='pages'?pages(d):V.tab==='audience'?audience(d):V.tab==='friction'?friction(d):V.tab==='health'?health(d)+'<details class="read-more"><summary>تاريخ المزامنات (عينات متداخلة)</summary>'+history(d)+'</details>':metrics(d)))+
 '<section class="box"><p>آخر مزامنة '+esc(d?.status?.lastSyncAt?new Date(d.status.lastSyncAt).toLocaleString('ar-EG'):'—')+
 ' · استهلاك API: '+n(d?.status?.quotaUsedToday||0)+' / '+n(d?.status?.quotaBudget||8)+
 ' · 3 طلبات لكل مزامنة موسعة، مع احتياطي لحدود Clarity.</p><a class="action" target="_blank" rel="noopener noreferrer" href="https://clarity.microsoft.com/">افتح Microsoft Clarity ↗</a></section></div>';
 el.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{V.tab=b.dataset.tab;V.search='';render();});
 el.querySelectorAll('[data-cl136-jump]').forEach(b=>b.onclick=()=>{V.tab=tabs[b.dataset.cl136Jump]?b.dataset.cl136Jump:'overview';V.search='';render();window.scrollTo?.({top:0,behavior:'smooth'});});
 el.querySelector('#cl136-system').onclick=()=>{V.active=false;V.request++;document.querySelector('.nav button[data-view="analytics"]')?.click();};
 el.querySelector('#cl136-csv').onclick=csv;
 el.querySelector('#cl136-days').onchange=e=>{V.days=Number(e.target.value)||1;V.data=null;const el=ROOT();if(el)el.innerHTML='<div class="cl136"><div class="box">جاري تحميل الفترة من البيانات المخزنة...</div></div>';reload().catch(err=>{toast(err.message);render();});};
 el.querySelector('#cl136-setup')?.addEventListener('click',()=>document.querySelector('.nav button[data-view="integrations"]')?.click());
 el.querySelector('#cl136-sync').onclick=async e=>{
  if(V.busy)return;V.busy=true;e.target.disabled=true;
  try{const synced=await api('/api/clarity/sync',{method:'POST',body:JSON.stringify({days:V.days})});toast(synced.skipped?'البيانات حديثة؛ تم استخدام النسخة المخزنة':'تمت مزامنة Clarity');await reload();}
  catch(ex){toast(ex.message);e.target.disabled=false;}finally{V.busy=false;}
 };
 const input=el.querySelector('#cl136-search');if(input)input.oninput=e=>{V.search=e.target.value;const rows=input.closest('details')?.querySelectorAll('table tbody tr')||[];rows.forEach(row=>{row.hidden=!!V.search&&!row.cells?.[0]?.textContent?.toLowerCase().includes(V.search.toLowerCase());});};
}
async function reload(){
 const rid=++V.request;const d=await api('/api/clarity/growth?days='+V.days);if(rid!==V.request)return;V.data=d;render();
}
function open(which='overview',depth=0){
 if(view()!=='analytics'){
   if(depth>3){toast('تعذر فتح قسم التحليلات؛ افتح التحليلات من القائمة أولًا');return;}
   document.querySelector('.nav button[data-view="analytics"]')?.click();
   setTimeout(()=>open(which,depth+1),140);
   return;
 }
 V.active=true;V.tab=tabs[which]?which:'overview';
 const r=ROOT();if(r)r.innerHTML='<section class="cl136"><div class="box">جاري تجهيز تقارير Clarity مع Meta والطلبات...</div></section>';
 reload().catch(e=>{if(!V.active||view()!=='analytics')return;ROOT().innerHTML='<div class="cl136"><div class="box"><h3>تعذر تحميل البيانات</h3><p>'+esc(e.message)+'</p><button id="cl136-retry">إعادة المحاولة</button></div></div>';ROOT().querySelector('#cl136-retry').onclick=()=>open(which);});
}
function shortcut(){
 if(V.active)return;
 const current=view(),r=ROOT(),head=r?.querySelector('.page-head');if(!head)return;
 if(current==='analytics'&&!head.querySelector('#cl136-open')){
   const b=document.createElement('button');b.id='cl136-open';b.className='btn primary';b.textContent='◈ داشبورد Clarity التفصيلية';b.onclick=()=>open('overview');head.appendChild(b);
 }
 if((current==='marketing'||current==='campaigns')&&!head.querySelector('#cl136-grow')){
   const b=document.createElement('button');b.id='cl136-grow';b.className='btn soft';b.textContent='◈ تحليلات Meta × Clarity';b.onclick=()=>open('growth');head.appendChild(b);
 }
}
function hook(){
 style();if(!ROOT())return;
 let t;
 new MutationObserver(()=>{if(!V.active){clearTimeout(t);t=setTimeout(shortcut,80);}}).observe(ROOT(),{childList:true,subtree:false});
 document.addEventListener('click',e=>{if(e.target.closest('.nav button[data-view]')){V.active=false;V.request++;setTimeout(shortcut,130);}},true);
 document.getElementById('storeBtn')?.addEventListener('change',()=>{V.data=null;if(V.active)open(V.tab);});
 setTimeout(shortcut,150);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',hook,{once:true});else hook();
window.KunClarityGrowthV136={open,version:'137.1'};
})();