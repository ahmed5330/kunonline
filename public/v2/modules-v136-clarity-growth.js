/* Kun Online V136 — Arabic, tenant-scoped Clarity / Meta Growth Analytics */
(function(){
'use strict';
const ROOT=()=>document.getElementById('root'),V={active:false,tab:'overview',data:null,search:'',request:0,busy:false};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const tx=v=>String(v??'').trim(),n=v=>v==null||v===''?'—':Number(v).toLocaleString('ar-EG',{maximumFractionDigits:2}),pct=v=>v==null?'—':n(v)+'%';
const view=()=>document.querySelector('.nav button.active[data-view]')?.dataset.view||'';
const tabs={overview:'نظرة عامة',growth:'تحليل الإعلانات والنمو',pages:'الصفحات وتجربة الشراء',audience:'الزوار والأجهزة',friction:'النقرات والمشكلات',metrics:'كل المقاييس'};
const dims={Campaign:'الحملات',Source:'مصادر الزيارات',Device:'الأجهزة',URL:'صفحات المتجر',Medium:'UTM Medium',Channel:'قنوات الزيارة',Browser:'المتصفحات',OS:'أنظمة التشغيل','Country/Region':'الدول والمناطق'};
const issues={RageClickCount:'Rage Clicks',DeadClickCount:'Dead Clicks',QuickbackClick:'Quickback',ScriptErrorCount:'Script Errors',ErrorClickCount:'Error Clicks',ExcessiveScroll:'Excessive Scroll'};
const status={meta_source_detected:'مصدر Meta مؤكد من UTM',utm_missing:'اسم الحملة غير ظاهر في Clarity',source_missing:'المصدر غير محدد',source_not_meta:'المصدر ليس Meta'};
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
 '.cl136 button:disabled{opacity:.5}.cl136 .tabs{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0}.cl136 .tabs .sel{background:#713aac;color:#fff;border-color:#713aac}',
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
 '@media(max-width:600px){.cl136 .head h2{font-size:20px}.cl136 .grid{grid-template-columns:1fr}}'
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
 return '<div class="cards">'+metric('جلسات Clarity',n(m.totals?.sessions),'آخر 24 ساعة UTC')+
 metric('جلسات البوت',n(m.totals?.botSessions),'وفق تصنيف Clarity')+
 metric('جلسات مصدر Meta',n(paid),'مصدر facebook/instagram ضمن UTM')+
 metric('الحملات',n(m.dimensions?.Campaign?.length),'الأسماء الظاهرة بالتقسيم')+
 metric('حملات Meta',n(g.campaigns?.length),'بما فيها غير المطابقة')+
 metric('آخر سحب',d.latest?.syncedAt?new Date(d.latest.syncedAt).toLocaleString('ar-EG'):'—','بيانات مخزنة من API')+'</div>';
}
function caveats(d){return '<section class="box"><h3>حدود البيانات وجودة التقرير</h3>'+(d.latest?.metrics?.limitations||[]).map(t=>'<div class="note warning">'+esc(t)+'</div>').join('')+
 '<div class="note">أرقام Clarity ليست زيارات Meta الفريدة أو أوردرات. لا يمكن حساب ROAS أو Funnel أو نسبة التحويل الصحيحة من جلسات Clarity وحدها.</div></section>';}
function overview(d){
 const m=d.latest.metrics,g=d.growth||{},v=m.dimensions||{};
 return summary(d)+'<div class="grid">'+['Campaign','Source','Device','Channel'].map(x=>breakdown(x,v[x],12)).join('')+'</div>'+
 '<section class="box"><h3>الوضع التجاري في Meta + كن أونلاين</h3>'+
 (g.metaConnected?'<div class="cards">'+metric('إجمالي الإنفاق',n(g.metaTotals?.spend),'Meta حسب النطاق اليومي')+metric('Real ROAS',n(g.metaTotals?.realRoas)+'x','الإيرادات المسلمة ÷ الصرف')+
 metric('أوردرات فعلية',n(g.metaTotals?.realOrders),'متجر كن أونلاين')+metric('Meta Purchases',n(g.metaTotals?.platformPurchases),'من Meta')+'</div>':'<p>اربط حساب Meta Ads في التكاملات لتفعيل الربط بالنمو والإنفاق.</p>')+
 '<p>المقارنة تشخيصية وليست إسنادًا لجلسات Clarity إلى الطلبات.</p></section>'+caveats(d);
}
function growth(d){
 const g=d.growth||{};
 const a=(g.campaigns||[]).filter(x=>!V.search||x.name.toLowerCase().includes(V.search.toLowerCase()));
 const lines=a.map(x=>'<tr><td><b>'+esc(x.name)+'</b><div class="muted">'+esc(status[x.sourceStatus]||'')+'</div>'+((x.landingPages||[]).length?'<div class="muted">صفحات وصول: '+(x.landingPages||[]).slice(0,2).map(p=>esc(p.url)+' ('+n(p.sessions)+')').join('، ')+'</div>':'')+'</td>'+
 '<td>'+n(x.spend)+'</td><td>'+pct(x.ctr)+'</td><td>'+n(x.platformPurchases)+'</td><td>'+n(x.realOrders)+'</td><td>'+n(x.deliveredOrders)+'</td>'+
 '<td>'+n(x.realRoas)+'x</td><td>'+n(x.claritySessions)+'</td><td>'+n(x.metaSourceSessions)+'</td><td>'+pct(x.rageRate)+'</td><td>'+pct(x.deadRate)+'</td><td>'+pct(x.scriptErrorRate)+'</td></tr>');
 return '<section class="box"><h3>توليفة التسويق: Meta × Clarity × نتائج الطلبات</h3><div class="note warning">'+esc(g.attributionWarning||'بيانات Meta/Clarity منفصلة في أوقات ومناهج القياس')+'</div>'+
 '<input id="cl136-search" placeholder="ابحث باسم الحملة..." value="'+esc(V.search)+'">'+table(['الحملة وUTM','Spend','CTR','Meta Purchases','Real Orders','تم التسليم','Real ROAS','جلسات Clarity','جلسات مصدر Meta','Rage %','Dead %','أخطاء JS %'],lines)+'</section>'+
 '<section class="box"><h3>فرص النمو والأولويات</h3><div class="recommendations">'+(g.recommendations||[]).map(r=>'<div class="rec '+(r.priority==='high'?'high':'')+'"><small>'+esc(r.priority==='high'?'أولوية عالية':'مراجعة')+'</small><h4>'+esc(r.title)+'</h4><p>'+esc(r.campaign||'')+'</p><p>'+esc(r.detail||'')+'</p>'+(r.action?'<p><b>الإجراء:</b> '+esc(r.action)+'</p>':'')+'</div>').join('')+'</div></section>'+
 '<section class="box"><h3>مجموعات الإعلانات والإعلانات</h3><p>البيانات أدناه من Meta فقط؛ لا ننسب مؤشرات Clarity إلى Ad Set أو Creative بدون click ID/UTM مخصص على مستوى الإعلان.</p>'+
 table(['الإعلان','المجموعة','الحملة','Spend','Purchases','CPP','ROAS'],(g.ads||[]).slice(0,70).map(r=>'<tr><td>'+esc(r.name)+'</td><td>'+esc(r.adsetName)+'</td><td>'+esc(r.campaignName)+'</td><td>'+n(r.spend)+'</td><td>'+n(r.purchases)+'</td><td>'+n(r.cpp)+'</td><td>'+n(r.roas)+'x</td></tr>'))+'</section>';
}
function pages(d){
 const m=d.latest.metrics||{},dim=m.dimensions||{},details=m.pagesDetail||[];
 const linked=new Map();
 for(const campaign of m.campaigns||[])for(const p of campaign.landingPages||[]){
   const list=linked.get(p.url)||[];list.push({name:campaign.name,sessions:p.sessions});linked.set(p.url,list);
 }
 const cells=details.slice(0,100).map(p=>'<tr><td><b>'+esc(p.name)+'</b><div class="muted">'+(linked.get(p.name)||[]).sort((a,b)=>b.sessions-a.sessions).slice(0,3).map(x=>esc(x.name)+' ('+n(x.sessions)+')').join('، ')+'</div></td>'+
 '<td>'+n(p.sessions)+'</td><td>'+n(p.botSessions)+'</td><td>'+pct(p.scrollDepth)+'</td><td>'+n(p.engagementTime)+'</td><td>'+pct(p.rageRate)+'</td><td>'+pct(p.deadRate)+'</td></tr>');
 return '<div class="note warning">جلسات الصفحة ليست Funnel تحويلًا ولا زوارًا فريدين. أرقام متوسط التمرير والتفاعل تظهر فقط إن وفر Clarity القيم والأوزان اللازمة. لو المصدر غير كافٍ يظهر «—».</div>'+
 '<section class="box"><h3>تحليل صفحات الوصول وتجربة الشراء</h3>'+
 table(['الصفحة / أبرز حملات UTM','جلسات','بوت','Scroll Depth','Engagement Time','Rage %','Dead %'],cells)+'</section>'+
 '<div class="grid">'+breakdown('Medium',dim.Medium,45)+breakdown('Channel',dim.Channel,45)+'</div>'+
 '<section class="box"><h3>تحسين صفحة المنتج والـ Checkout</h3><p>راجع النقرات غير الفعالة والتمرير والتفاعل وأخطاء التحميل في صفحة وصول كل حملة، خاصة على الجوال. استخدم Funnel حقيقي من Clarity أو حدث شراء موثق؛ لا تستنتج نسبة تحويل من مشاهدات الصفحات.</p>'+
 '<a class="action" href="https://clarity.microsoft.com/" target="_blank" rel="noopener noreferrer">التسجيلات والـ Heatmaps والـ Funnels ↗</a></section>';
}
function audience(d){
 const dimsData=d.latest.metrics.dimensions||{};
 return '<div class="grid">'+['Source','Channel','Medium','Device','Browser','OS','Country/Region','Campaign'].map(x=>breakdown(x,dimsData[x],30)).join('')+'</div>';
}
function friction(d){
 const m=d.latest.metrics||{};
 return '<div class="note">المقاييس التي لا يقدّم Clarity حقول النسبة وعدد الجلسات الخاصة بها تظهر بدون نسبة. القيمة «—» ليست صفرًا.</div>'+
 '<div class="grid">'+(m.diagnostics||[]).map(b=>'<section class="box"><h3>'+esc(b.label||issues[b.metric]||b.metric)+'</h3>'+
 table(['الحملة','حجم العينة','النسبة الموزونة'],(b.segments||[]).slice(0,30).map(r=>'<tr><td>'+esc(r.name)+'</td><td>'+n(r.sessions)+'</td><td>'+pct(r.rate)+'</td></tr>'))+'</section>').join('')+'</div>'+
 '<section class="box"><h3>أولوية مشكلات الحملات</h3>'+table(['الحملة','الجلسات','Rage','Dead','Quickback','Script Errors'],
 (m.campaigns||[]).slice(0,70).map(r=>'<tr><td>'+esc(r.name)+'</td><td>'+n(r.sessions)+'</td><td>'+pct(r.RageClickCount)+'</td><td>'+pct(r.DeadClickCount)+'</td><td>'+pct(r.QuickbackClick)+'</td><td>'+pct(r.ScriptErrorCount)+'</td></tr>'))+'</section>';
}
function metrics(d){
 const catalog=d.latest.metrics?.catalog||[];
 return '<section class="box"><h3>مكتبة مؤشرات Microsoft Clarity</h3><p>كل Metric أعاده Data Export API مع عدد سجلاته، وأمثلة حقول محدودة. لا يمكن استخراج فيديوهات التسجيلات أو الصور الحرارية من هذا API.</p>'+
 table(['المقياس','مجموعة البيانات','عدد الصفوف','الحد'],catalog.map(x=>'<tr><td>'+esc(x.label)+'<div class="muted">'+esc(x.metric)+'</div></td><td>'+esc(x.scope)+'</td><td>'+n(x.rows)+'</td><td>'+esc(x.limited?'ربما 1000':'—')+'</td></tr>'))+'</section>'+
 '<div class="grid">'+catalog.map(x=>'<section class="box"><h3>'+esc(x.label)+'</h3><div class="muted">'+esc(x.scope)+'</div><pre>'+esc(JSON.stringify(x.example,null,2))+'</pre></section>').join('')+'</div>';
}
function history(d){return '<section class="box"><h3>تاريخ المزامنات</h3><p>كل نقطة تمثل آخر 24 ساعة وقت سحبها؛ الفترات متداخلة ولا تُجمع لإجمالي شهري.</p>'+
 table(['وقت العينة','الجلسات في نافذة 24 ساعة'],(d.history||[]).slice(0,30).map(x=>'<tr><td>'+esc(new Date(x.syncedAt).toLocaleString('ar-EG'))+'</td><td>'+n(x.campaignSessions)+'</td></tr>'))+'</section>';}
function csv(){
 const d=V.data;if(!d?.latest)return;
 let keys=['name','sessions','botSessions'],rows=d.latest.metrics.dimensions.Campaign||[];
 if(V.tab==='growth'){keys=['name','spend','ctr','platformPurchases','realOrders','deliveredOrders','realRoas','claritySessions','metaSourceSessions','rageRate','deadRate','scriptErrorRate','sourceStatus'];rows=d.growth?.campaigns||[];}
 if(V.tab==='pages'){keys=['name','sessions','botSessions','scrollDepth','engagementTime','rageRate','deadRate'];rows=d.latest.metrics.pagesDetail||[];}
 if(V.tab==='audience'){keys=['dimension','name','sessions','botSessions'];rows=Object.entries(d.latest.metrics.dimensions).flatMap(([dimension,list])=>list.map(x=>({...x,dimension})));}
 if(V.tab==='friction'){keys=['name','sessions',...Object.keys(issues)];rows=d.latest.metrics.campaigns||[];}
 if(V.tab==='metrics'){keys=['metric','label','scope','rows','limited'];rows=d.latest.metrics.catalog||[];}
 const safe=v=>String(v??'').replace(/"/g,'""').replace(/^[=+\-@]/,"'$&");
 const lines=[keys,...rows.map(x=>keys.map(k=>x[k]))],txt='\uFEFF'+lines.map(r=>r.map(v=>'"'+safe(v)+'"').join(',')).join('\r\n');
 const url=URL.createObjectURL(new Blob([txt],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='clarity-kun-online-'+V.tab+'.csv';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),800);
}
function render(){
 if(!V.active||view()!=='analytics')return;
 const el=ROOT();if(!el)return;style();
 const d=V.data,missing=!d?.latest;
 el.innerHTML='<div class="cl136"><header class="head"><div><h2>◈ Clarity Intelligence</h2><p>مركز التحليلات التفصيلية وسلوك العميل والنمو من Meta Ads</p></div><span class="space"></span>'+
 '<button id="cl136-system">التقارير العامة</button><button id="cl136-sync">مزامنة Clarity</button><button id="cl136-csv">CSV</button></header>'+
 '<nav class="tabs">'+Object.entries(tabs).map(([id,label])=>'<button data-tab="'+esc(id)+'" class="'+(V.tab===id?'sel':'')+'">'+esc(label)+'</button>').join('')+'</nav>'+
 (missing?'<section class="box"><h3>لا توجد بيانات لهذا المتجر حتى الآن</h3><p>اربط Project ID وData Export API Token داخل التكاملات ثم اختبر الاتصال.</p><button id="cl136-setup">فتح التكاملات</button></section>':
 (V.tab==='overview'?overview(d):V.tab==='growth'?growth(d):V.tab==='pages'?pages(d):V.tab==='audience'?audience(d):V.tab==='friction'?friction(d):metrics(d))+history(d))+
 '<section class="box"><p>آخر مزامنة '+esc(d?.status?.lastSyncAt?new Date(d.status.lastSyncAt).toLocaleString('ar-EG'):'—')+
 ' · استهلاك API: '+n(d?.status?.quotaUsedToday||0)+' / '+n(d?.status?.quotaBudget||8)+
 ' · 3 طلبات لكل مزامنة موسعة، مع احتياطي لحدود Clarity.</p><a class="action" target="_blank" rel="noopener noreferrer" href="https://clarity.microsoft.com/">افتح Microsoft Clarity ↗</a></section></div>';
 el.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{V.tab=b.dataset.tab;V.search='';render();});
 el.querySelector('#cl136-system').onclick=()=>{V.active=false;V.request++;document.querySelector('.nav button[data-view="analytics"]')?.click();};
 el.querySelector('#cl136-csv').onclick=csv;
 el.querySelector('#cl136-setup')?.addEventListener('click',()=>document.querySelector('.nav button[data-view="integrations"]')?.click());
 el.querySelector('#cl136-sync').onclick=async e=>{
  if(V.busy)return;V.busy=true;e.target.disabled=true;
  try{const synced=await api('/api/clarity/sync',{method:'POST',body:'{}'});toast(synced.skipped?'البيانات حديثة؛ تم استخدام النسخة المخزنة':'تمت مزامنة Clarity');await reload();}
  catch(ex){toast(ex.message);e.target.disabled=false;}finally{V.busy=false;}
 };
 const input=el.querySelector('#cl136-search');if(input)input.oninput=e=>{V.search=e.target.value;const selection=e.target.selectionStart;render();const again=ROOT().querySelector('#cl136-search');again?.focus();again?.setSelectionRange(selection,selection);};
}
async function reload(){
 const rid=++V.request;const d=await api('/api/clarity/growth');if(rid!==V.request)return;V.data=d;render();
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
window.KunClarityGrowthV136={open,version:'136.0'};
})();