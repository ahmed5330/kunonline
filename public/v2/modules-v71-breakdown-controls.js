/* Kun Online v71 — reliable Breakdown controls: delegated events, busy state, cancellation and stale-response protection. */
(function(){
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clean=v=>String(v??'').trim();
  let sequence=0,activeController=null,activeKey='';

  function hub(){return window.KunCampaignHubV66||null;}
  function adState(){return hub()?.state?.sections?.ad||null;}
  function catalogList(){const state=adState();return Array.isArray(state?.breakdownData?.catalog)&&state.breakdownData.catalog.length?state.breakdownData.catalog:Array.isArray(state?.expert?.breakdownCatalog)?state.expert.breakdownCatalog:[];}
  function catalogItem(id){return catalogList().find(item=>clean(item?.id)===clean(id))||null;}
  function selected(){const el=document.getElementById('campaign66Breakdown'),value=clean(el?.value||hub()?.state?.breakdown||'image_asset'),item=catalogItem(value),rawLabel=clean(el?.selectedOptions?.[0]?.dataset?.kunBaseLabel||el?.selectedOptions?.[0]?.textContent||el?.value||'Breakdown');return {el,value,label:clean(item?.label)||rawLabel,item};}
  function daysBetween(from,to){const a=new Date(`${from}T00:00:00Z`),b=new Date(`${to}T00:00:00Z`);return Math.max(1,Math.min(90,Math.round((b-a)/86400000)+1));}
  function style(){if(document.getElementById('kunBreakdownControlsV71Style'))return;const s=document.createElement('style');s.id='kunBreakdownControlsV71Style';s.textContent=`
    .campaign66 #campaign66BreakdownLoad[aria-busy="true"]{opacity:.72;cursor:wait;pointer-events:none}
    .campaign66 .ux71-status{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 12px;margin:8px 0;border:1px dashed var(--line,#e5e7eb);border-radius:10px;background:color-mix(in srgb,var(--card,#fff) 96%,#2563eb 4%);font-size:12px;color:var(--muted,#64748b);line-height:1.7}
    .campaign66 .ux71-status b{color:inherit}.campaign66 .ux71-error{border-color:#fecaca;background:#fef2f2;color:#991b1b}.campaign66 .ux71-info{border-color:#bfdbfe;background:#eff6ff;color:#1e3a8a}.campaign66 .ux71-retry{margin-inline-start:auto}
  `;document.head.appendChild(s);}
  function decorateCatalog(){const byId=new Map(catalogList().map(item=>[clean(item?.id),item]));document.querySelectorAll('#campaign66Breakdown option').forEach(option=>{const item=byId.get(clean(option.value));if(!option.dataset.kunBaseLabel)option.dataset.kunBaseLabel=clean(item?.label||option.textContent);const base=option.dataset.kunBaseLabel;if(item?.support==='conditional')option.textContent=`${base} · مشروط`;else if(item?.support==='compatible-composite')option.textContent=`${base} · متوافق تلقائيًا`;else option.textContent=base;option.title=clean(item?.hint);});}
  function ensureButtons(){document.querySelectorAll('.campaign66 button:not([type])').forEach(b=>b.type='button');const box=document.getElementById('campaign66BreakdownBox');if(box)box.setAttribute('aria-live','polite');decorateCatalog();}
  function setBusy(value,label=''){const button=document.getElementById('campaign66BreakdownLoad');if(!button)return;button.disabled=Boolean(value);button.setAttribute('aria-busy',value?'true':'false');button.textContent=value?`جاري تحميل ${label||'الـBreakdown'}...`:'تحميل الـBreakdown';}
  function statusHtml(message,{error=false,retry=false,info=false}={}){return `<div class="ux71-status ${error?'ux71-error':info?'ux71-info':''}"><span>${esc(message)}</span>${retry?'<button type="button" class="btn soft ux71-retry" id="campaign71BreakdownRetry">إعادة المحاولة</button>':''}</div>`;}
  function boxStatus(message,options){const box=document.getElementById('campaign66BreakdownBox');if(box)box.innerHTML=statusHtml(message,options);}
  function enhanceSoon(){setTimeout(()=>{ensureButtons();window.KunBreakdownAnalysisV68?.enhance?.();window.KunBreakdownMeasurementsV70?.render?.();decorateError();decorateEmpty();},0);}
  function decorateError(){const state=adState(),box=document.getElementById('campaign66BreakdownBox');if(!box||!state?.breakdownData?.error||box.querySelector('#campaign71BreakdownRetry'))return;const {label,item}=selected(),code=clean(state.breakdownData.code),hint=clean(state.breakdownData.hint||item?.hint),message=`تعذر تحميل «${label}». ${state.breakdownData.error}${code?` (${code})`:''}${hint?` — ${hint}`:''}`;box.innerHTML=statusHtml(message,{error:true,retry:true});}
  function decorateEmpty(){const state=adState(),data=state?.breakdownData,box=document.getElementById('campaign66BreakdownBox');if(!box||!data||data.error||!Array.isArray(data.rows)||data.rows.length||box.querySelector('.ux71-empty-note'))return;const {label,item}=selected(),hint=clean(data.hint||item?.hint),node=document.createElement('div');node.className='ux71-status ux71-info ux71-empty-note';node.innerHTML=`<span>${esc(`الطلب اشتغل بنجاح، لكن Meta لم ترجع بيانات لـ«${label}» في الفترة والإعلانات الحالية.${hint?` ${hint}`:''}`)}</span>`;box.prepend(node);}
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
    const range=h.rangeFor?.('ad')||{},key=currentRequestKey(choice.value);activeKey=key;setBusy(true,`«${choice.label}»`);boxStatus(`جارٍ تحميل «${choice.label}» من Meta...${choice.item?.hint?` ${choice.item.hint}`:''}`,{info:true});window.KunBreakdownMeasurementsV70?.render?.();window.KunBreakdownAnalysisV68?.enhance?.();
    try{
      const ctx=await context();if(requestId!==sequence||controller.signal.aborted)return;
      const params=new URLSearchParams({clientId:ctx.clientId,from:range.from||'',to:range.to||'',dimension:choice.value,status:clean(h.state.status||'active'),days:String(daysBetween(range.from,range.to))});if(ctx.storeId)params.set('storeId',ctx.storeId);
      const response=await fetch(`/api/integrations/meta-ads/breakdowns?${params}`,{credentials:'include',headers:{'Cache-Control':'no-cache'},signal:controller.signal}),text=await response.text();let data={};try{data=JSON.parse(text)}catch{data={error:text||`HTTP ${response.status}`};}
      if(requestId!==sequence||controller.signal.aborted||activeKey!==key||currentRequestKey(choice.value)!==key)return;
      if(!response.ok){state.breakdownData={error:clean(data?.error)||`HTTP ${response.status}`,code:clean(data?.code),hint:clean(data?.hint||choice.item?.hint),status:response.status,rows:[]};await repaint();return;}
      state.breakdownData=data;await repaint();
    }catch(error){
      if(error?.name==='AbortError'||requestId!==sequence)return;
      state.breakdownData={error:clean(error?.message)||'تعذر تحميل الـBreakdown',code:clean(error?.code),hint:clean(choice.item?.hint),rows:[]};await repaint();
    }finally{
      if(requestId===sequence){activeController=null;activeKey='';setBusy(false);enhanceSoon();}
    }
  }
  function changeSelection(select){
    cancel('breakdown-selection-changed');const h=hub(),state=adState();if(!h||!state)return;h.state.breakdown=clean(select.value)||'image_asset';state.breakdownData=null;const choice=selected(),hint=clean(choice.item?.hint);boxStatus(`تم اختيار «${choice.label}». اضغط تحميل الـBreakdown لعرض البيانات.${hint?` ${hint}`:''}`,{info:Boolean(hint)});window.KunBreakdownMeasurementsV70?.render?.();enhanceSoon();
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
  const observer=new MutationObserver(()=>{ensureButtons();decorateError();decorateEmpty();});observer.observe(document.documentElement,{childList:true,subtree:true});
  window.addEventListener('kun:section-reloaded',()=>{cancel('section-reloaded');enhanceSoon();});
  window.KunBreakdownControlsV71={loadSelected,cancel,changeSelection,currentRequestKey,decorateCatalog,version:'71.1'};document.documentElement.dataset.breakdownControls='v71.1-ready';style();ensureButtons();enhanceSoon();
})();