/* Competitor Intelligence v139: RTL market research and real Workers AI analysis. */
(function(){
'use strict';
const ID='kun-competitor-v139',state={data:null,busy:false};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const el=id=>document.getElementById('kc-'+id);
const value=id=>el(id)?.value||'';
const scope=async()=>({clientId:String(await window.kunClientId?.()||''),storeId:String(await window.kunStoreId?.()||'')});
async function api(path,body){
  const s=await scope();if(!s.clientId||!s.storeId)throw Error('اختار متجرًا أولًا');
  const u=new URL(path,location.origin);u.searchParams.set('clientId',s.clientId);u.searchParams.set('storeId',s.storeId);
  const r=await fetch(u.pathname+u.search,{method:body?'POST':'GET',credentials:'include',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'HTTP '+r.status);return d;
}
function css(){
 if(document.getElementById('kc-style'))return;
 const s=document.createElement('style');s.id='kc-style';
 s.textContent=[
 '#kun-competitor-v139{position:fixed;inset:0;z-index:1000002;overflow:auto;background:rgba(8,14,27,.75);padding:14px;direction:rtl}',
 '#kun-competitor-v139 .kc-window{max-width:1180px;margin:auto;background:var(--surface,#fff);color:var(--ink,#182131);padding:22px;border-radius:18px;line-height:1.8}',
 '#kun-competitor-v139 .kc-head,#kun-competitor-v139 .kc-ctrl{display:flex;gap:10px;flex-wrap:wrap;align-items:center}',
 '#kun-competitor-v139 h2{margin:0;font-size:22px}#kun-competitor-v139 h3{margin:0 0 12px;font-size:17px}',
 '#kun-competitor-v139 .kc-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:13px}',
 '#kun-competitor-v139 .kc-card{background:var(--surface,#fff);border:1px solid var(--line,#d8d9e1);border-radius:14px;padding:15px;margin:12px 0;min-width:0}',
 '#kun-competitor-v139 label{display:block;font-size:12px;font-weight:700;margin:10px 0 4px}',
 '#kun-competitor-v139 input,#kun-competitor-v139 textarea,#kun-competitor-v139 select{display:block;width:100%;background:var(--surface,#fff);color:var(--ink,#182131);border:1px solid var(--line,#c3c5d1);border-radius:9px;font:inherit;padding:9px;font-size:13px}',
 '#kun-competitor-v139 textarea{min-height:82px;resize:vertical}',
 '#kun-competitor-v139 button,#kun-competitor-v139 .kc-link{background:var(--surface,#fff);color:var(--ink,#182131);border:1px solid var(--line,#d2d2d8);border-radius:9px;padding:10px;font:inherit;font-weight:800;font-size:12px;cursor:pointer;text-decoration:none}',
 '#kun-competitor-v139 button:disabled{opacity:.5;cursor:wait}#kun-competitor-v139 .kc-main{background:#643c9d;color:white;border-color:#643c9d}',
 '#kun-competitor-v139 .kc-note{background:rgba(102,79,157,.09);border-radius:9px;padding:11px;margin:10px 0;font-size:12px}',
 '#kun-competitor-v139 .kc-item{padding:12px 0;border-bottom:1px solid var(--line,#d7d7df);overflow-wrap:anywhere;font-size:13px}',
 '#kun-competitor-v139 p{font-size:13px;line-height:1.85}#kun-competitor-v139 .kc-muted{font-size:12px;opacity:.76}',
 '#kun-competitor-v139 .kc-error{color:#ba3737;font-weight:700}',
 '@media(max-width:630px){#kun-competitor-v139{padding:0}#kun-competitor-v139 .kc-window{min-height:100%;border-radius:0;padding:12px}}'
 ].join('');document.head.appendChild(s);
}
const para=s=>'<p>'+esc(s||'غير متاح')+'</p>';
function report(x){
 if(!x?.realAI||!x.report)return '<div class="kc-note">لا يوجد تحليل صادر من نموذج AI حتى الآن.</div>';
 const r=x.report;
 return '<div class="kc-note">تحليل فعلي بواسطة '+esc(x.model)+' · '+esc(new Date(x.createdAt).toLocaleString('ar-EG'))+' · بناءً على النص والوصف، بدون مشاهدة الصور أو الفيديو تلقائيًا.</div>'+
 '<section class="kc-card"><h3>الملخص والتمركز التسويقي</h3>'+para(r.summary)+para(r.positioning)+'</section>'+
 '<div class="kc-grid"><section class="kc-card"><h3>الزوايا والأدلة</h3>'+(r.angles||[]).map(z=>'<div class="kc-item"><b>'+esc(z.angle)+'</b> · '+esc(z.confidence)+para(z.evidence)+'</div>').join('')+'</section>'+
 '<section class="kc-card"><h3>الـHooks والعرض</h3>'+(r.hooks||[]).map(z=>'<div class="kc-item">'+esc(z)+'</div>').join('')+'<h3>تحليل العرض</h3>'+para(r.offerAnalysis)+'</section></div>'+
 '<section class="kc-card"><h3>الفرص والفجوات</h3>'+para(r.gaps)+'<h3>مقارنة بمتجرك عند وجود البيانات</h3>'+para(r.comparison)+'</section>'+
 '<section class="kc-card"><h3>اختبارات النمو المقترحة</h3>'+(r.tests||[]).map(z=>'<div class="kc-item"><b>'+esc(z.idea)+'</b><div>التغيير: '+esc(z.change)+'</div><div>المقياس: '+esc(z.metric)+'</div><div>الخطر: '+esc(z.risk)+'</div></div>').join('')+'</section>'+
 '<section class="kc-card"><h3>القيود</h3>'+(r.caveats||[]).map(para).join('')+'<p>لا توجد بيانات أرباح أو مبيعات منافس في Meta Ad Library، ومدة التشغيل لا تثبت النجاح المالي.</p>'+
 (x.adUrl?'<a href="'+esc(x.adUrl)+'" target="_blank" rel="noopener noreferrer">عرض إعلان المنافس ↗</a>':'')+'</section>';
}
function msg(s,error=false){if(el('message')){el('message').textContent=s;el('message').classList.toggle('kc-error',error)}}
function collect(){return {name:value('name'),country:value('country'),adUrl:value('url'),adCopy:value('copy'),headline:value('headline'),offer:value('offer'),creativeNotes:value('visual'),cta:value('cta'),format:value('format'),startDate:value('start')}}
function form(){
 let root=document.getElementById(ID);if(root)return root;
 css();root=document.createElement('div');root.id=ID;root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');
 root.innerHTML='<div class="kc-window"><header class="kc-head"><div style="flex:1"><h2>◈ تحليل إعلانات المنافسين</h2><div class="kc-muted">Competitor Intelligence · AI Marketing Analyst</div></div><button id="kc-close">إغلاق ×</button></header>'+
 '<div class="kc-note">في مصر والسعودية: افتح مكتبة Meta وانسخ نص الإعلان ووصف محتوى الصورة أو الفيديو. الرابط وحده لا يتيح للذكاء الاصطناعي مشاهدة الكرياتيف. البحث الآلي الرسمي عن الإعلانات التجارية متاح فقط لدول EU/UK عند توفر توكن مخصص.</div>'+
 '<div class="kc-ctrl"><a class="kc-link" target="_blank" rel="noopener noreferrer" href="https://www.facebook.com/ads/library/">افتح مكتبة إعلانات Meta ↗</a><span id="kc-usage" class="kc-muted">جارٍ التحميل...</span></div>'+
 '<div class="kc-grid"><div><section class="kc-card"><h3>بيانات المنافس والكرياتيف</h3>'+
 '<label for="kc-name">اسم المنافس *</label><input id="kc-name" maxlength="110" placeholder="اسم المتجر المنافس">'+
 '<label for="kc-country">السوق</label><select id="kc-country"><option value="EG">مصر</option><option value="SA">السعودية</option><option value="GB">المملكة المتحدة</option><option value="DE">ألمانيا</option><option value="FR">فرنسا</option><option value="IT">إيطاليا</option><option value="ES">إسبانيا</option></select>'+
 '<label for="kc-url">رابط إعلان Meta Ad Library</label><input type="url" id="kc-url" maxlength="1500" placeholder="https://www.facebook.com/ads/library/?id=...">'+
 '<label for="kc-copy">النص الإعلاني</label><textarea id="kc-copy" maxlength="3200" placeholder="الصق Primary Text هنا"></textarea>'+
 '<label for="kc-headline">عنوان الإعلان</label><input id="kc-headline" maxlength="250" placeholder="Headline">'+
 '<label for="kc-offer">العرض / السعر / الباندل</label><textarea id="kc-offer" maxlength="550"></textarea>'+
 '<label for="kc-visual">وصف الصورة أو الفيديو</label><textarea id="kc-visual" maxlength="1400" placeholder="اشرح المشاهد والمنتج وأول ثوانٍ من الفيديو"></textarea>'+
 '<div class="kc-grid"><div><label for="kc-format">النوع</label><select id="kc-format"><option value="unknown">غير محدد</option><option value="image">صورة</option><option value="video">فيديو</option><option value="carousel">كاروسيل</option></select></div><div><label for="kc-cta">CTA</label><input id="kc-cta" maxlength="100"></div></div>'+
 '<label for="kc-start">تاريخ بدء الإعلان (اختياري)</label><input id="kc-start" type="date">'+
 '<div class="kc-ctrl" style="margin-top:14px"><button class="kc-main" id="kc-run">✦ حلّل الإعلان بالذكاء الاصطناعي</button><button id="kc-refresh">تحديث السجل</button></div><div id="kc-message" aria-live="polite" class="kc-muted"></div>'+
 '</section><section class="kc-card"><h3>بحث Meta الرسمي — EU/UK</h3><p class="kc-muted">مصر والسعودية غير مشمولتين في البحث التجاري العام بالـAPI.</p>'+
 '<label for="kc-query">اسم المنافس / كلمة بحث</label><input id="kc-query" maxlength="90">'+
 '<label for="kc-page">Page ID (اختياري)</label><input id="kc-page" maxlength="30">'+
 '<button id="kc-search">بحث إعلانات السوق المختار</button><div id="kc-search-results" class="kc-muted"></div></section></div>'+
 '<div><section class="kc-card"><h3>التقرير</h3><div id="kc-report">اختر الإعلان واضغط تحليل.</div></section><section class="kc-card"><h3>سجل تحليلات المنافسين</h3><div id="kc-history">جاري التحميل...</div></section></div></div></div>';
 document.body.appendChild(root);
 el('close').onclick=()=>root.remove();
 root.addEventListener('click',e=>{if(e.target===root)root.remove()});
 el('run').onclick=analyze;el('refresh').onclick=refresh;el('search').onclick=search;el('country').onchange=searchAvailability;
 return root;
}
function searchAvailability(){
 const region=value('country'),allowed=state.data?.officialSearchRegions?.includes(region),token=state.data?.officialApiConfigured;
 if(el('search'))el('search').disabled=!allowed||!token;
 if(el('search-results'))el('search-results').textContent=!allowed?'مصر والسعودية: انسخ النص مباشرة من مكتبة Meta.':!token?'مطلوب META_AD_LIBRARY_ACCESS_TOKEN على السيرفر لتشغيل البحث الرسمي.':'يمكنك البحث رسميًا في الإعلانات التجارية المتاحة لهذه الدولة.';
}
async function refresh(){
 try{const d=await api('/api/competitors/status');state.data=d;if(!document.getElementById(ID))return;
 el('usage').textContent=(d.usedToday||0)+' / '+d.dailyLimit+' تحليلات اليوم';
 searchAvailability();
 el('history').innerHTML=(d.results?.length?d.results.map((x,i)=>'<div class="kc-item"><button data-kc-report="'+i+'">'+esc(x.name)+' · '+esc(x.country)+' · '+esc(new Date(x.createdAt).toLocaleDateString('ar-EG'))+' · '+esc(x.status)+'</button></div>').join(''):'لا توجد تقارير محفوظة.');
 el('history').querySelectorAll('[data-kc-report]').forEach(b=>b.onclick=()=>{el('report').innerHTML=report(d.results[Number(b.dataset.kcReport)])});
 }catch(e){msg(e.message,true)}
}
async function analyze(){
 if(state.busy)return;state.busy=true;el('run').disabled=true;msg('جاري تحليل الأدلة بواسطة نموذج الذكاء الاصطناعي...');
 try{const result=await api('/api/competitors/analyze',collect());if(!result.result?.realAI)throw Error('لم يتم تأكيد تشغيل نموذج AI');
 el('report').innerHTML=report(result.result);msg(result.cached?'تم استرجاع آخر تقرير محفوظ.':'تم إنشاء تقرير AI فعلي.');await refresh();
 }catch(e){msg(e.message,true)}finally{state.busy=false;el('run').disabled=false}
}
async function search(){
 el('search').disabled=true;el('search-results').textContent='جاري البحث...';
 try{const d=await api('/api/competitors/library-search',{country:value('country'),query:value('query'),pageId:value('page')});
 el('search-results').innerHTML=d.ads?.length?d.ads.map((a,i)=>'<div class="kc-item"><b>'+esc(a.name)+'</b>'+para(a.headline)+para(a.adCopy)+'<button data-kc-use="'+i+'">استخدم هذا الإعلان</button></div>').join(''):'لا توجد إعلانات في تغطية Meta الرسمية.';
 el('search-results').querySelectorAll('[data-kc-use]').forEach(b=>b.onclick=()=>{const a=d.ads[Number(b.dataset.kcUse)];el('name').value=a.name;el('url').value=a.adUrl||'';el('copy').value=a.adCopy;el('headline').value=a.headline;el('offer').value=a.offer;el('start').value=a.startDate||'';msg('تم إدراج نص الإعلان؛ أضف وصف الصورة أو الفيديو لو متاح.')});
 }catch(e){el('search-results').textContent=e.message;msg(e.message,true)}finally{searchAvailability()}
}
function open(){const root=form();refresh();el('name')?.focus();return root}
function shortcut(){
 if(document.getElementById(ID))return;
 const root=document.getElementById('root'),view=document.querySelector('.nav button.active[data-view]')?.dataset.view;
 if(!root||!['analytics','marketing','campaigns'].includes(view))return;
 const head=root.querySelector('.cl136 .head')||root.querySelector('.page-head');if(!head||head.querySelector('#kc139-open'))return;
 const b=document.createElement('button');b.id='kc139-open';b.className='btn soft';b.textContent='◈ تحليل إعلانات المنافسين';b.onclick=open;head.appendChild(b);
}
function init(){const root=document.getElementById('root');if(!root)return;let timer;new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(shortcut,90)}).observe(root,{childList:true,subtree:false});
 document.addEventListener('click',e=>{if(e.target.closest('.nav button[data-view]'))setTimeout(shortcut,170)},true);setTimeout(shortcut,190);}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
window.KunCompetitorIntelligenceV139={open,version:'139.0'};
})();
