/* Kun Online v71 — reliable Breakdown controls: delegated events, busy state, cancellation and stale-response protection. */
(function(){
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]));
  const clean=v=>String(v??'').trim();
  let sequence=0,activeController=null,activeKey='';

  function hub(){return window.KunCampaignHubV66||null;}
  function adState(){return hub()?.state?.sections?.ad||null;}
  function selected(){const el=document.getElementById('campaign66Breakdown');return {el,value:clean(el?.value||hub()?.state?.breakdown||'image_asset'),label:clean(el?.selectedOptions?.[0]?.textContent||el?.value||'Breakdown')};}
  function daysBetween(from,to){const a=new Date(`${from}T00:00:00Z`),b=new Date(`${to}T00:00:00Z`);return Math.max(1,Math.min(90,Math.round((b-a)/86400000)+1));}
  function style(){if(document.getElementById('kunBreakdownControlsV71Style'))return;const s=document.createElement('style');s.id='kunBreakdownControlsV71Style';s.textContent=`
    .campaign66 #campaign66BreakdownLoad[aria-busy="true"]{opacity:.72;cursor:wait;pointer-events:none}
    .campaign66 .ux71-status{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 12px;margin:8px 0;border:1px dashed var(--line,#e5e7eb);border-radius:10px;background:color-mix(in srgb,var(--card,#fff) 96%,#2563eb 4%);font-size:12px;color:var(--muted,#64748b)}
    .campaign66 .ux71-status b{color:inherit}.campaign66 .ux71-error{border-color:#fecaca;background:#fef2f2;color:#991b1b}.campaign66 .ux71-retry{margin-inline-start:auto}
  `;document.head.appendChild(s);}
  function ensureButtons(){document.querySelectorAll('.campaign66 button:not([type])').forEach(b=>b.type='button');const box=document.getElementById('campaign66BreakdownBox');if(box)box.setAttribute('aria-live','polite');}
  function setBusy(value,label=''){const button=document.getElementById('campaign66BreakdownLoad');if(!button)return;button.disabled=Boolean(value);button.setAttribute('aria-busy',value?'true':'false');button.textContent=value?`جاري تحميل ${label||'الـBreakdown'}...`:'تحميل الـBreakdown';}
  function statusHtml(message,{error=false,retry=false}={}){return `<div class="ux71-status ${error?'ux71-error':''}"><span>${esc(message)}</span>${retry?'<button type="button" class="btn soft ux71-retry" id="campaign71BreakdownRetry">إعادة المحاولة</button>':''}</div>`;}
  function boxStatus(message,options){const box=document.getElementById('campaign66BreakdownBox');if(box)box.innerHTML=statusHtml(message,options);}
  function enhanceSoon(){setTimeout(()=>{ensureButtons();window.KunBreakdownAnalysisV68?.enhance?.();window.KunBreakdownMeasurementsV70?.render?.();decorateError();},0);}
  function decorateError(){const state=adState(),box=document.getElementById('campaign66BreakdownBox');if(!box||!state?.breakdownData?.error||box.querySelector('#campaign71BreakdownRetry'))return;const {label}=selected(),code=clean(state.breakdownData.code),message=`تعذر تحميل «${label}». ${state.breakdownData.error}${code?` (${code})`:''}`;box.innerHTML=statusHtml(message,{error:true,retry:true});}
  function cancel(reason='cancelled'){
    sequence++;
    if(activeController){try{activeController.abort(reason);}catch{}activeController=null;}
    activeKey='';setBusy(false);
  }
  async function context(){return {clientId:window.kunClientId?await window.kunClientId():'',storeId:window.kunStoreId?await window.kunStoreId():''};}
  async function repaint(){const h=hub();if(!h?.render)return;await h.render();enhanceSoon();}
  function currentRequestKey(dimension){const h=hub(),r=h?.rangeFor?.('ad')||{},status=clean(h?.state?.status||'active');return [dimension,status,r.from||'',r.to||''].join('|');}
  async function loadSelected(){
    const h=hub(),state=adState(),choice=selected();if(!h||!state||!choice.el)return;
    cancel('new-breakdown-request');
    const requestId=++sequence,controller=new AbortController();activeController=controller;h.state.breakdown=choice.value;state.breakdownData=null;
    const range=h.rangeFor?.('ad')||{},key=currentRequestKey(choice.value);activeKey=key;setBusy(true,`«${choice.label}»`);boxStatus(`جارٍ تحميل «${choice.label}» من Meta...`);window.KunBreakdownMeasurementsV70?.render?.();window.KunBreakdownAnalysisV68?.enhance?.();
    try{
      const ctx=await context();if(requestId!==sequence||controller.signal.aborted)return;
      const params=new URLSearchParams({clientId:ctx.clientId,from:range.from||'',to:range.to||'',dimension:choice.value,status:clean(h.state.status||'active'),days:String(daysBetween(range.from,range.to))});if(ctx.storeId)params.set('storeId',ctx.storeId);
      const response=await fetch(`/api/integrations/meta-ads/breakdowns?${params}`,{credentials:'include',headers:{'Cache-Control':'no-cache'},signal:controller.signal}),text=await response.text();let data={};try{data=JSON.parse(text)}catch{data={error:text||`HTTP ${response.status}`};}
      if(requestId!==sequence||controller.signal.aborted||activeKey!==key||currentRequestKey(choice.value)!==key)return;
      if(!response.ok){state.breakdownData={error:clean(data?.error)||`HTTP ${response.status}`,code:clean(data?.code),status:response.status,rows:[]};await repaint();return;}
      state.breakdownData=data;await repaint();
    }catch(error){
      if(error?.name==='AbortError'||requestId!==sequence)return;
      state.breakdownData={error:clean(error?.message)||'تعذر تحميل الـBreakdown',code:clean(error?.code),rows:[]};await repaint();
    }finally{
      if(requestId===sequence){activeController=null;activeKey='';setBusy(false);enhanceSoon();}
    }
  }
  function changeSelection(select){
    cancel('breakdown-selection-changed');const h=hub(),state=adState();if(!h||!state)return;h.state.breakdown=clean(select.value)||'image_asset';state.breakdownData=null;const label=clean(select.selectedOptions?.[0]?.textContent||select.value||'Breakdown');boxStatus(`تم اختيار «${label}». اضغط تحميل الـBreakdown لعرض البيانات.`);window.KunBreakdownMeasurementsV70?.render?.();enhanceSoon();
  }
  document.addEventListener('change',event=>{
    if(event.target?.id!=='campaign66Breakdown')return;
    event.stopImmediatePropagation();changeSelection(event.target);
  },true);
  document.addEventListener('click',event=>{
    const target=event.target?.closest?.('#campaign66BreakdownLoad,#campaign71BreakdownRetry');
    if(target){event.preventDefault();event.stopImmediatePropagation();loadSelected();return;}
    if(event.target?.closest?.('.campaign66 [data-status],.campaign66 [data-date-preset],.campaign66 [data-campaign-section],.campaign66 [data-section-mode],#campaign66ApplyCustom'))cancel('campaign-controls-changed');
  },true);
  const observer=new MutationObserver(()=>{ensureButtons();decorateError();});observer.observe(document.documentElement,{childList:true,subtree:true});
  window.addEventListener('kun:section-reloaded',()=>{cancel('section-reloaded');enhanceSoon();});
  window.KunBreakdownControlsV71={loadSelected,cancel,changeSelection,currentRequestKey,version:'71.0'};document.documentElement.dataset.breakdownControls='v71-ready';style();ensureButtons();enhanceSoon();
})();
