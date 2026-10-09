/* Kun Online v141 — search-first Competitor Intelligence, honest Meta coverage. */
(function(){
'use strict';
const ID='kun-competitor-v139',state={data:null,ads:[],busy:false,searching:false,step:'search'};
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const el=id=>document.getElementById('kc-'+id);
const val=id=>String(el(id)?.value||'').trim();
const countryNames={EG:'مصر',SA:'السعودية',GB:'المملكة المتحدة',DE:'ألمانيا',FR:'فرنسا',IT:'إيطاليا',ES:'إسبانيا'};
const scope=async()=>({clientId:String(await window.kunClientId?.()||''),storeId:String(await window.kunStoreId?.()||'')});
async function api(path,body){
 const s=await scope();if(!s.clientId||!s.storeId)throw Error('اختار المتجر من أعلى الشاشة أولًا');
 const url=new URL(path,location.origin);url.searchParams.set('clientId',s.clientId);url.searchParams.set('storeId',s.storeId);
 const response=await fetch(url.pathname+url.search,{method:body?'POST':'GET',credentials:'include',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(data.error||'تعذر تحميل البيانات (HTTP '+response.status+')');
 return data;
}
function styles(){
 if(document.getElementById('kc-style'))return;
 const node=document.createElement('style');node.id='kc-style';
 node.textContent=[
 '#'+ID+'{position:fixed;inset:0;z-index:1000002;overflow:auto;background:rgba(8,14,27,.74);padding:18px;direction:rtl}',
 '#'+ID+' *{box-sizing:border-box}',
 '#'+ID+' .kc-window{max-width:780px;margin:15px auto;background:var(--surface,#fff);color:var(--ink,#182131);padding:25px;border-radius:20px;box-shadow:0 18px 70px #0004;line-height:1.8}',
 '#'+ID+' .kc-head,#'+ID+' .kc-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
 '#'+ID+' .kc-head h2{font-size:22px;margin:0}',
 '#'+ID+' h3{font-size:16px;margin:0 0 13px}',
 '#'+ID+' .kc-muted{font-size:12px;color:var(--ink-2,#737684)}',
 '#'+ID+' .kc-steps{display:flex;gap:8px;margin:21px 0 15px;flex-wrap:wrap}',
 '#'+ID+' .kc-step{font-size:12px;padding:6px 11px;border:1px solid var(--line,#d7d9e4);border-radius:25px;color:var(--ink-2,#6b7180)}',
 '#'+ID+' .kc-step.is-active{background:#643c9d;color:white;border-color:#643c9d}',
 '#'+ID+' .kc-card{border:1px solid var(--line,#e1e1e8);border-radius:15px;padding:18px;margin:12px 0;min-width:0}',
 '#'+ID+' .kc-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px}',
 '#'+ID+' label{display:block;font-size:12px;font-weight:750;margin:12px 0 5px}',
 '#'+ID+' input,#'+ID+' select,#'+ID+' textarea{display:block;width:100%;border:1px solid var(--line,#cbd0dd);border-radius:10px;padding:12px 13px;background:var(--surface,#fff);color:var(--ink,#182131);font:inherit;font-size:14px}',
 '#'+ID+' textarea{resize:vertical;min-height:100px}',
 '#'+ID+' button,#'+ID+' .kc-link{display:inline-flex;justify-content:center;align-items:center;gap:7px;border:1px solid var(--line,#d7d9e5);border-radius:10px;background:var(--surface,#fff);color:var(--ink,#182131);font:inherit;font-weight:750;font-size:13px;text-decoration:none;cursor:pointer;padding:11px 15px}',
 '#'+ID+' button:disabled{opacity:.55;cursor:wait}',
 '#'+ID+' .kc-main{background:#643c9d!important;border-color:#643c9d!important;color:#fff!important}',
 '#'+ID+' .kc-wide{width:100%;margin-top:16px}',
 '#'+ID+' .kc-note{padding:12px;border-radius:11px;background:rgba(111,88,165,.08);font-size:12px;margin:12px 0}',
 '#'+ID+' .kc-item{border-bottom:1px solid var(--line,#e3e4eb);padding:12px 0;font-size:13px;overflow-wrap:anywhere}',
 '#'+ID+' .kc-error{color:#bd3535!important;font-weight:750}',
 '#'+ID+' .kc-history{margin-top:16px;border-top:1px solid var(--line,#e1e1e9);padding-top:13px}',
 '#'+ID+' .kc-history summary{cursor:pointer;font-weight:750;font-size:13px}',
 '#'+ID+' p{font-size:13px;line-height:1.9;overflow-wrap:anywhere}',
 '#'+ID+' [hidden]{display:none!important}',
 '#'+ID+' .kc-optionals summary{font-size:13px;cursor:pointer;font-weight:750;margin:12px 0}',
 '#'+ID+' .kc-focus{outline-offset:3px}',
 '@media(max-width:640px){#'+ID+'{padding:0}#'+ID+' .kc-window{border-radius:0;min-height:100%;margin:0;padding:15px}#'+ID+' .kc-head h2{font-size:18px}#'+ID+' .kc-card{padding:13px}}'
 ].join('');
 document.head.appendChild(node);
}
const para=x=>'<p>'+esc(x||'غير متاح')+'</p>';
function renderReport(x){
 if(!x?.realAI||!x.report)return '<div class="kc-note">لا يوجد تحليل صادر من نموذج AI حتى الآن.</div>';
 const r=x.report;
 return '<div class="kc-note">تقرير ذكاء اصطناعي · '+esc(x.model)+' · '+esc(new Date(x.createdAt).toLocaleString('ar-EG'))+' · يعتمد على النص أو وصف الإعلان، وليس مشاهدة الفيديو تلقائيًا.</div>'+
 '<div class="kc-card"><h3>ملخص الإعلان</h3>'+para(r.summary)+para(r.positioning)+'</div>'+
 '<div class="kc-grid"><div class="kc-card"><h3>الزوايا التسويقية</h3>'+(r.angles||[]).map(z=>'<div class="kc-item"><b>'+esc(z.angle)+'</b> · ثقة '+esc(z.confidence)+para(z.evidence)+'</div>').join('')+'</div>'+
 '<div class="kc-card"><h3>الـHooks والعرض</h3>'+(r.hooks||[]).map(z=>'<div class="kc-item">'+esc(z)+'</div>').join('')+'<h3>تحليل العرض</h3>'+para(r.offerAnalysis)+'</div></div>'+
 '<div class="kc-card"><h3>الفرص والمقارنة بمتجرك</h3>'+para(r.gaps)+para(r.comparison)+'</div>'+
 '<div class="kc-card"><h3>اختبارات إعلانية مقترحة</h3>'+(r.tests||[]).map(z=>'<div class="kc-item"><b>'+esc(z.idea)+'</b><div>التغيير: '+esc(z.change)+'</div><div>القياس: '+esc(z.metric)+'</div><div>الحذر: '+esc(z.risk)+'</div></div>').join('')+'</div>'+
 '<div class="kc-card"><h3>حدود الاستنتاج</h3>'+(r.caveats||[]).map(para).join('')+'<p class="kc-muted">مكتبة Meta لا تكشف مبيعات المنافس أو ROAS، ولا يمكن الجزم بنجاح الإعلان من مدة تشغيله.</p>'+
 (x.adUrl?'<a href="'+esc(x.adUrl)+'" target="_blank" rel="noopener noreferrer">شاهد الإعلان في Meta ↗</a>':'')+'</div>';
}
function form(){
 let node=document.getElementById(ID);if(node)return node;
 styles();
 node=document.createElement('section');node.id=ID;node.setAttribute('role','dialog');node.setAttribute('aria-modal','true');node.setAttribute('aria-label','تحليل إعلانات المنافسين');
 node.innerHTML='<div class="kc-window">'+
 '<header class="kc-head"><div style="flex:1"><h2>◈ تحليل إعلانات المنافسين</h2><span class="kc-muted">Competitor Intelligence · AI Marketing Analyst</span></div><button id="kc-close" type="button" aria-label="إغلاق">إغلاق ×</button></header>'+
 '<div class="kc-steps"><span class="kc-step is-active" id="kc-step-search">1. البحث</span><span class="kc-step" id="kc-step-detail">2. اختيار الإعلان</span><span class="kc-step" id="kc-step-report">3. التحليل</span></div>'+
 '<section id="kc-search-panel"><div class="kc-card"><h3>ابحث عن إعلانات المنافسين</h3>'+
 '<label for="kc-category">فئة الإعلان</label><select id="kc-category"><option value="all">كل الإعلانات</option><option value="political_and_issue_ads">الإعلانات السياسية وقضايا المجتمع</option></select>'+
 '<label for="kc-country">الدولة</label><select id="kc-country"><option value="EG">مصر</option><option value="SA">السعودية</option><option value="GB">المملكة المتحدة</option><option value="DE">ألمانيا</option><option value="FR">فرنسا</option><option value="IT">إيطاليا</option><option value="ES">إسبانيا</option></select>'+
 '<label for="kc-query">اسم المنافس أو الكلمات في الإعلان</label><input id="kc-query" maxlength="90" placeholder="مثال: نظارات شمسية أو اسم متجر" autocomplete="off">'+
 '<button class="kc-main kc-wide" id="kc-search" type="button">⌕ ابحث عن الإعلانات</button>'+
 '<div id="kc-search-msg" class="kc-note" aria-live="polite">البحث يبدأ من مكتبة Meta الرسمية. السوق التجاري المصري والسعودي لا يدعمان سحب النتائج تلقائيًا عبر API العام.</div>'+
 '<a id="kc-meta-link" class="kc-link" href="https://www.facebook.com/ads/library/" target="_blank" rel="noopener noreferrer">افتح مكتبة إعلانات Meta ↗</a>'+
 '</div><div id="kc-results" class="kc-card" hidden><h3>نتائج البحث الرسمية المتاحة</h3><div id="kc-ads"></div></div>'+
 '<div class="kc-actions"><button id="kc-have-ad" type="button">عندي إعلان وعايز أحلّله ←</button><span id="kc-usage" class="kc-muted">جاري تحميل الرصيد...</span></div></section>'+
 '<section id="kc-detail-panel" hidden><div class="kc-actions"><button id="kc-back-search" type="button">→ رجوع للبحث</button></div>'+
 '<div class="kc-card"><h3>الإعلان اللي هيتحلل</h3>'+
 '<div class="kc-note" id="kc-detail-msg">البيانات الموجودة في الإعلان بس هي اللي محتاجينها. في مصر والسعودية انسخ نص الإعلان أو اكتب وصفًا قصيرًا له، لأن Meta لا تتيح سحبه تلقائيًا عبر API العام.</div>'+
 '<label for="kc-name">اسم المنافس *</label><input id="kc-name" maxlength="110" placeholder="اسم المتجر أو المعلن">'+
 '<label for="kc-url">رابط إعلان Meta (اختياري)</label><input id="kc-url" type="url" maxlength="1500" placeholder="https://www.facebook.com/ads/library/?id=...">'+
 '<label for="kc-copy">نص الإعلان أو وصفه *</label><textarea id="kc-copy" maxlength="3200" placeholder="انسخ النص الإعلاني، أو اكتب وصف الإعلان في سطرين على الأقل"></textarea>'+
 '<details class="kc-optionals"><summary>تفاصيل إضافية لتحليل أدق (اختيارية)</summary>'+
 '<label for="kc-headline">العنوان</label><input id="kc-headline" maxlength="250">'+
 '<label for="kc-offer">العرض والسعر</label><textarea id="kc-offer" maxlength="550"></textarea>'+
 '<label for="kc-visual">وصف الصورة أو الفيديو</label><textarea id="kc-visual" maxlength="1400" placeholder="مثال: فيديو يبدأ بعرض المنتج عن قرب"></textarea>'+
 '<label for="kc-format">نوع الإعلان</label><select id="kc-format"><option value="unknown">غير محدد</option><option value="image">صورة</option><option value="video">فيديو</option><option value="carousel">كاروسيل</option></select>'+
 '<label for="kc-cta">CTA</label><input id="kc-cta" maxlength="100">'+
 '<label for="kc-start">بداية الإعلان</label><input id="kc-start" type="date"></details>'+
 '<button class="kc-main kc-wide" id="kc-run" type="button">✦ حلّل الإعلان بالذكاء الاصطناعي</button><p id="kc-message" class="kc-muted" aria-live="polite"></p></div></section>'+
 '<section id="kc-report-panel" hidden><div class="kc-actions"><button id="kc-back-detail" type="button">→ العودة للتحليل</button></div><div id="kc-report"></div></section>'+
 '<details class="kc-history"><summary>سجل تحليلات المنافسين السابقة</summary><div class="kc-actions"><button id="kc-refresh" type="button">تحديث السجل</button></div><div id="kc-history" class="kc-muted">جاري التحميل...</div></details></div>';
 document.body.appendChild(node);
 el('close').onclick=close;
 node.addEventListener('click',e=>{if(e.target===node)close()});
 node.addEventListener('keydown',e=>{if(e.key==='Escape')close()});
 el('back-search').onclick=()=>step('search');
 el('back-detail').onclick=()=>step('detail');
 el('have-ad').onclick=()=>step('detail');
 el('run').onclick=analyze;
 el('search').onclick=search;
 el('refresh').onclick=refresh;
 el('query').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();search()}});
 for(const id of ['category','country','query'])el(id).addEventListener('change',updateMetaLink);
 el('query').addEventListener('input',updateMetaLink);
 updateMetaLink();
 return node;
}
function close(){document.getElementById(ID)?.remove();state.step='search'}
function step(next){
 state.step=next;
 for(const id of ['search','detail','report']){
  if(el(id+'-panel'))el(id+'-panel').hidden=id!==next;
  el('step-'+id)?.classList.toggle('is-active',id===next);
 }
 if(next==='detail'&&!val('name')&&val('query'))el('name').value=val('query').slice(0,110);
 if(next==='detail')el('name')?.focus();
}
function metaLink(){
 const u=new URL('https://www.facebook.com/ads/library/');
 u.searchParams.set('active_status','active');
 u.searchParams.set('ad_type',val('category')||'all');
 u.searchParams.set('country',val('country')||'EG');
 if(val('query'))u.searchParams.set('q',val('query'));
 return u.toString();
}
function updateMetaLink(){if(el('meta-link'))el('meta-link').href=metaLink()}
function canOfficialSearch(){return val('category')==='all'&&!!state.data?.officialApiConfigured&&!!state.data?.officialSearchRegions?.includes(val('country'))}
function searchNote(s,isError=false){const node=el('search-msg');if(node){node.textContent=s;node.classList.toggle('kc-error',isError)}}
function message(s,isError=false){const node=el('message');if(node){node.textContent=s;node.classList.toggle('kc-error',isError)}}
function chooseAd(ad){
 el('name').value=ad.name||val('query');
 el('url').value=ad.adUrl||'';
 el('copy').value=ad.adCopy||'';
 el('headline').value=ad.headline||'';
 el('offer').value=ad.offer||'';
 el('start').value=ad.startDate||'';
 el('visual').value='';
 step('detail');
 message('اتنقلت البيانات المتاحة من Meta. راجع النص وأضف وصف الفيديو لو محتاج تحليل بصري أشمل.');
}
async function search(){
 if(state.searching)return;
 const q=val('query');if(!q){searchNote('اكتب اسم المنافس أو كلمة بحث الأول.',true);el('query').focus();return}
 updateMetaLink();
 if(!canOfficialSearch()){
  // Direct user-initiated launch. No claims of scraping or reading closed commercial Meta data.
  el('meta-link').click();
  searchNote('فتحنا البحث في مكتبة Meta. اختار إعلانًا، وبعدها اضغط «عندي إعلان وعايز أحلّله». الرابط وحده لا يستخرج النص تلقائيًا.');
  el('have-ad').focus();return;
 }
 state.searching=true;el('search').disabled=true;searchNote('جاري البحث في النتائج المتاحة رسميًا من Meta...');
 try{
  const data=await api('/api/competitors/library-search',{country:val('country'),query:q});
  state.ads=Array.isArray(data.ads)?data.ads:[];
  el('results').hidden=false;
  el('ads').innerHTML=state.ads.length?state.ads.map((ad,i)=>'<div class="kc-item"><b>'+esc(ad.name)+'</b>'+para(ad.headline)+para(ad.adCopy)+'<button type="button" data-kc-use="'+i+'">اختار الإعلان للتحليل ←</button></div>').join(''):'لم تظهر إعلانات ضمن تغطية API الرسمية. تقدر تبحث في موقع Meta مباشرة.';
  el('ads').querySelectorAll('[data-kc-use]').forEach(button=>button.onclick=()=>chooseAd(state.ads[Number(button.dataset.kcUse)]));
  searchNote('النتائج من Meta API الرسمي ضمن التغطية المسموح بها. الصور والفيديوهات مش متاحة للتحليل البصري المباشر.');
 }catch(e){searchNote(e.message+' — تقدر تفتح مكتبة Meta وتكمل بإدخال الإعلان يدويًا.',true)}
 finally{state.searching=false;el('search').disabled=false}
}
function collect(){return {name:val('name'),country:val('country'),adUrl:val('url'),adCopy:val('copy'),headline:val('headline'),offer:val('offer'),creativeNotes:val('visual'),cta:val('cta'),format:val('format'),startDate:val('start')}}
async function analyze(){
 if(state.busy)return;
 if(!val('name')){message('اكتب اسم المعلن أو المنافس.',true);el('name').focus();return}
 const evidence=(val('copy')+val('headline')+val('offer')+val('visual')).trim();
 if(evidence.length<25){message('انسخ نص الإعلان أو اكتب وصفًا من 25 حرف على الأقل عشان التحليل يعتمد على دليل فعلي.',true);el('copy').focus();return}
 state.busy=true;el('run').disabled=true;message('بنحلل الإعلان بنموذج ذكاء اصطناعي حقيقي...');
 try{
  const data=await api('/api/competitors/analyze',collect());
  if(!data.result?.realAI)throw Error('لم يصل تأكيد إن نموذج الذكاء الاصطناعي اشتغل.');
  el('report').innerHTML=renderReport(data.result);
  step('report');await refresh();
 }catch(e){message(e.message,true)}finally{state.busy=false;el('run').disabled=false}
}
async function refresh(){
 try{
  const data=await api('/api/competitors/status');state.data=data;
  if(!document.getElementById(ID))return;
  el('usage').textContent=(data.usedToday||0)+' / '+data.dailyLimit+' تحليلات اليوم';
  el('history').innerHTML=data.results?.length?data.results.map((x,i)=>'<div class="kc-item"><button type="button" data-kc-report="'+i+'">'+esc(x.name)+' · '+esc(countryNames[x.country]||x.country)+' · '+esc(new Date(x.createdAt).toLocaleDateString('ar-EG'))+' · '+esc(x.status)+'</button></div>').join(''):'لا توجد تحليلات محفوظة.';
  el('history').querySelectorAll('[data-kc-report]').forEach(b=>b.onclick=()=>{el('report').innerHTML=renderReport(data.results[Number(b.dataset.kcReport)]);step('report')});
 }catch(e){if(el('usage'))el('usage').textContent='تعذر تحميل رصيد التحليل: '+e.message}
}
function open(){form();step('search');refresh();el('query').focus()}
function shortcut(){
 if(document.getElementById(ID))return;
 const root=document.getElementById('root'),view=document.querySelector('.nav button.active[data-view]')?.dataset.view;
 if(!root||!['analytics','marketing','campaigns'].includes(view))return;
 const head=root.querySelector('.cl136 .head')||root.querySelector('.page-head');if(!head||head.querySelector('#kc139-open'))return;
 const b=document.createElement('button');b.id='kc139-open';b.className='btn soft';b.textContent='◈ تحليل إعلانات المنافسين';b.onclick=open;head.appendChild(b);
}
function init(){
 const root=document.getElementById('root');if(!root)return;
 let timer;new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(shortcut,90)}).observe(root,{childList:true,subtree:false});
 document.addEventListener('click',e=>{if(e.target.closest('.nav button[data-view]'))setTimeout(shortcut,170)},true);
 setTimeout(shortcut,190);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
window.KunCompetitorIntelligenceV139={open,version:'141.0'};
})();