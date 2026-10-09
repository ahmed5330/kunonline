/* Kun Online v138 AI Marketing Analyst — actual LLM inference, never fake rule-based AI. */
(function(){
'use strict';
const ID='kun-ai-marketing-v138';
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
const t=x=>String(x??'').trim(),scope=async()=>({clientId:t(await window.kunClientId?.()),storeId:t(await window.kunStoreId?.())});
const state={data:null,selected:null,busy:false,days:1};
async function request(path,options={}){
 const s=await scope();if(!s.clientId||!s.storeId)throw Error('اختار العميل والمتجر من أعلى الشاشة أولًا');
 const url=new URL(path,location.origin);url.searchParams.set('clientId',s.clientId);url.searchParams.set('storeId',s.storeId);
 const r=await fetch(url.pathname+url.search,{credentials:'include',headers:{'Content-Type':'application/json'},...options});
 const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||d.message||'HTTP '+r.status);return d;
}
function css(){if(document.getElementById('kai138-css'))return;const s=document.createElement('style');s.id='kai138-css';s.textContent=[
 '#'+ID+'{position:fixed;inset:0;z-index:1000000;overflow:auto;background:rgba(9,15,29,.73);padding:16px;direction:rtl}',
 '#'+ID+' .kai-window{background:var(--surface,#fff);color:var(--ink,#151b28);max-width:1120px;margin:25px auto;border-radius:22px;padding:23px;min-height:440px;box-shadow:0 20px 70px rgba(0,0,0,.2)}',
 '#'+ID+' .kai-top{display:flex;gap:14px;align-items:center;flex-wrap:wrap}#'+ID+' .kai-top h2{font-size:23px;margin:0}#'+ID+' .kai-top p{font-size:12px;opacity:.75;margin:8px 0;line-height:1.7}',
 '#'+ID+' button{border:1px solid var(--line,#d9d5e0);border-radius:11px;padding:10px 15px;font:inherit;font-size:12px;font-weight:800;cursor:pointer;background:var(--surface,#fff);color:var(--ink,#141421)}',
 '#'+ID+' button.kai-main{background:#673ca2;color:white;border-color:#673ca2}#'+ID+' button:disabled{opacity:.55;cursor:wait}',
 '#'+ID+' .kai-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:12px;margin-top:15px}#'+ID+' .kai-card{background:var(--surface,#fff);padding:16px;border:1px solid var(--line,#ddd);border-radius:15px}',
 '#'+ID+' .kai-card h3{font-size:16px;margin:0 0 12px}#'+ID+' .kai-card h4{font-size:13px;margin:10px 0}',
 '#'+ID+' .kai-card p,#'+ID+' .kai-card li{font-size:13px;line-height:2}#'+ID+' .kai-card ul{padding-right:18px}',
 '#'+ID+' .kai-meta{font-size:11px;color:var(--ink-2,#777);line-height:1.8}#'+ID+' .kai-pill{border-radius:40px;padding:4px 10px;background:rgba(113,66,171,.1);font-size:11px;font-weight:800}',
 '#'+ID+' .kai-ctrl{display:flex;gap:9px;flex-wrap:wrap;margin:15px 0;align-items:center}#'+ID+' select{border:1px solid #c6bdce;border-radius:9px;font:inherit;padding:8px;background:var(--surface,#fff);color:var(--ink,#151b28)}',
 '#'+ID+' .kai-notice{padding:12px;border-radius:12px;background:rgba(107,66,171,.09);font-size:12px;line-height:2;margin:12px 0}#'+ID+' .kai-error{color:#ba3333}',
 '#'+ID+' .kai-item{border-top:1px solid var(--line,#e7e0e7);padding:14px 0}#'+ID+' .kai-item:first-of-type{border-top:0}'
].join('');document.head.appendChild(s);}
const p=(x)=>'<p>'+esc(x||'لا يوجد')+'</p>';
const confidence={high:'ثقة عالية',medium:'ثقة متوسطة',low:'ثقة محدودة'};
function reportHTML(result){
 if(!result?.realAI||!result.report)return '<div class="kai-notice">لا يوجد تقرير مولد بواسطة نموذج AI فعلي بعد.</div>';
 const r=result.report,findings=r.findings||[],actions=r.actions||[],experiments=r.experiments||[];
 return '<div class="kai-notice">التقرير مولّد فعليًا بواسطة '+esc(result.model)+' · '+esc(new Date(result.createdAt).toLocaleString('ar-EG'))+' · مبني على بيانات مجمعة وليس تسجيلات العملاء أو صور الإعلانات.</div>'+
 '<section class="kai-card"><h3>الملخص التنفيذي</h3>'+p(r.summary)+'</section>'+
 '<div class="kai-grid"><section class="kai-card"><h3>التشخيص والأدلة</h3>'+findings.map(x=>'<div class="kai-item"><h4>'+esc(x.title)+' <span class="kai-pill">'+esc(confidence[x.confidence]||confidence.low)+'</span></h4><b>الدليل:</b>'+p(x.evidence)+'<b>فرضية:</b>'+p(x.hypothesis)+'</div>').join('')+'</section>'+
 '<section class="kai-card"><h3>خطة الإجراءات بالأولوية</h3>'+actions.map(x=>'<div class="kai-item"><h4>'+esc(x.title)+' <span class="kai-pill">'+esc(x.priority==='high'?'عالية':x.priority==='medium'?'متوسطة':'منخفضة')+'</span></h4><b>السبب:</b>'+p(x.why)+'<b>التنفيذ:</b>'+p(x.how)+'<b>مقياس النجاح:</b>'+p(x.successMetric)+'<span class="kai-meta">'+esc(confidence[x.confidence]||confidence.low)+'</span></div>').join('')+'</section></div>'+
 '<section class="kai-card"><h3>اختبارات النمو المقترحة</h3><div class="kai-grid">'+experiments.map(x=>'<div><h4>'+esc(x.name)+'</h4><b>المتغير:</b>'+p(x.change)+'<b>الثابت:</b>'+p(x.control)+'<b>القياس:</b>'+p(x.measurement)+'<b>شرط الأمان:</b>'+p(x.guardrail)+'</div>').join('')+'</div></section>'+
 '<section class="kai-card"><h3>قيود التحليل ومصادر عدم اليقين</h3><ul>'+(r.caveats||[]).map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul><p class="kai-meta">التوصيات مقترحات فقط. لن يغير المحلل الحملات أو الميزانيات تلقائيًا، ولا يثبت علاقة سببية بين جلسات Clarity والطلبات.</p></section>';
}
function panel(){
 let el=document.getElementById(ID);if(el)return el;
 css();el=document.createElement('div');el.id=ID;el.setAttribute('role','dialog');el.setAttribute('aria-modal','true');el.setAttribute('aria-label','AI Marketing Analyst');
 el.innerHTML='<div class="kai-window"><div class="kai-top"><div style="flex:1"><h2>✦ AI Marketing Analyst</h2><p>محلل ذكاء اصطناعي حقيقي · Meta Ads + Microsoft Clarity + نتائج الطلبات والربحية</p></div><button id="kai-close" aria-label="إغلاق">إغلاق ×</button></div><div class="kai-ctrl"><label>نافذة البيانات <select id="kai-days"><option value="1">24 ساعة</option><option value="2">48 ساعة</option><option value="3">72 ساعة</option></select></label><button class="kai-main" id="kai-run">حلّل متجري بالذكاء الاصطناعي</button><button id="kai-refresh">تحديث سجل التحليلات</button><span id="kai-limit" class="kai-pill">تحميل...</span></div><div id="kai-message" aria-live="polite" class="kai-meta"></div><div class="kai-grid"><div class="kai-card"><h3>سجل التحليلات</h3><div id="kai-history">جاري التحميل...</div></div><div id="kai-report" style="min-width:0">اختر تحليلًا محفوظًا أو شغّل نموذج الذكاء الاصطناعي.</div></div></div>';
 document.body.appendChild(el);
 el.querySelector('#kai-close').onclick=()=>el.remove();
 el.addEventListener('click',e=>{if(e.target===el)el.remove()});
 el.querySelector('#kai-days').value=String(state.days);
 el.querySelector('#kai-days').onchange=e=>{state.days=Number(e.target.value);};
 el.querySelector('#kai-refresh').onclick=refresh;
 el.querySelector('#kai-run').onclick=analyze;
 return el;
}
function message(s,err=false){const el=document.querySelector('#kai-message');if(el){el.textContent=s;el.classList.toggle('kai-error',err);}}
async function refresh(){
 const el=document.getElementById(ID);if(!el)return;
 try{
  const d=await request('/api/ai/marketing-status');state.data=d;
  document.querySelector('#kai-limit').textContent=(d.usedToday??0)+' / '+(d.dailyLimit??3)+' تحليلات اليوم';
  const h=document.querySelector('#kai-history');
  h.innerHTML=(d.results?.length?d.results.map((x,i)=>'<div class="kai-item"><button data-kai-record="'+i+'">'+esc(new Date(x.createdAt).toLocaleString('ar-EG'))+' · '+(x.days*24)+' ساعة · '+esc(x.status==='ready'?'مكتمل AI':x.status==='failed'?'فشل': 'جارٍ')+'</button></div>').join(''):'لا يوجد تحليل محفوظ بعد.');
  h.querySelectorAll('[data-kai-record]').forEach(b=>b.onclick=()=>{const x=d.results[Number(b.dataset.kaiRecord)];document.querySelector('#kai-report').innerHTML=reportHTML(x)});
  if(!d.configured)message('تفعيل Cloudflare Workers AI على السيرفر مطلوب لتشغيل نموذج حقيقي.',true);
  if(!state.selected){const latest=d.results?.find(x=>x.status==='ready');if(latest)document.querySelector('#kai-report').innerHTML=reportHTML(latest);}
 }catch(e){message(e.message,true);}
}
async function analyze(){
 if(state.busy)return;
 const el=document.getElementById(ID);if(!el)return;state.busy=true;const b=el.querySelector('#kai-run');b.disabled=true;b.textContent='جاري التحليل الفعلي...';
 message('بنجهّز مؤشرات الحملات والتتبع والربحية، ثم نرسل البيانات المجمعة فقط للنموذج.');
 try{
   const data=await request('/api/ai/marketing-analyze',{method:'POST',body:JSON.stringify({days:state.days})});
   if(!data?.result?.realAI)throw Error('لا يوجد تأكيد أن النموذج اشتغل');
   state.selected=data.result.id;
   el.querySelector('#kai-report').innerHTML=reportHTML(data.result);
   message(data.cached?'تم استرجاع أحدث تقرير AI محفوظ.':'تم إنتاج تقرير بواسطة النموذج الحقيقي.');
   await refresh();
 }catch(e){message(e.message,true);}finally{state.busy=false;b.disabled=false;b.textContent='حلّل متجري بالذكاء الاصطناعي';}
}
function open(){const e=panel();refresh();e.querySelector('#kai-run').focus();}
function shortcut(){
 if(document.getElementById(ID))return;
 const container=document.getElementById('root');if(!container)return;
 const view=document.querySelector('.nav button.active[data-view]')?.dataset.view||'';
 if(!['analytics','campaigns','marketing'].includes(view))return;
 const host=container.querySelector('.cl136 .head')||container.querySelector('.page-head');if(!host||host.querySelector('#kai-open'))return;
 const b=document.createElement('button');b.id='kai-open';b.textContent='✦ AI Marketing Analyst';b.className='btn primary';b.onclick=open;host.appendChild(b);
}
function init(){
 if(!document.getElementById('root'))return;let timer;
 new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(shortcut,85)}).observe(document.getElementById('root'),{childList:true,subtree:false});
 document.addEventListener('click',e=>{if(e.target.closest('.nav button[data-view]'))setTimeout(shortcut,180)});
 setTimeout(shortcut,200);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
window.KunAIMarketingV138={open,version:'138.0'};
})();