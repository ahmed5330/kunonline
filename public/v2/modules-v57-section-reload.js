/* Kun Online v57.1 — one reload control per main workspace section, without browser-page reload. */
(function(){
  const K=window.KunActionsV23||{};
  const root=document.getElementById('root');
  if(!root)return;
  const registry=new Map();
  let injecting=false;

  const notify=message=>K.notify?K.notify(message):(window.showToast?.(message)||console.log(message));
  const activeNav=()=>document.querySelector('.nav button.active[data-view]');
  const activeView=()=>activeNav()?.dataset.view||'';
  const viewLabel=()=>activeNav()?.textContent?.trim()||'القسم';

  function ensureStyle(){
    if(document.getElementById('kunSectionReloadV57Style'))return;
    const style=document.createElement('style');style.id='kunSectionReloadV57Style';style.textContent=`
      .kun-section-reload{display:inline-flex;align-items:center;justify-content:center;gap:6px;white-space:nowrap}
      .kun-section-reload .kun-reload-icon{display:inline-block;font-size:15px;line-height:1}
      .kun-section-reload.is-loading{opacity:.72;cursor:wait}
      .kun-section-reload.is-loading .kun-reload-icon{animation:kunReloadSpin .8s linear infinite}
      .kun-section-reload-head{margin-bottom:12px;min-height:40px}
      @keyframes kunReloadSpin{to{transform:rotate(-360deg)}}
      @media(max-width:640px){.kun-section-reload .kun-reload-text{display:none}.kun-section-reload{min-width:38px;padding-inline:10px}}
    `;document.head.appendChild(style);
  }

  function pageHead(){
    const direct=[...root.children];
    for(const child of direct)if(child.matches?.('.page-head,.dash-hero'))return child;
    for(const child of direct){const head=[...child.children].find(node=>node.matches?.('.page-head,.dash-hero'));if(head)return head;}
    const nested=root.querySelector('.page-head,.dash-hero');if(nested)return nested;
    const fallback=document.createElement('div');fallback.className='page-head kun-section-reload-head';fallback.dataset.kunReloadFallbackHead='1';fallback.innerHTML='<div class="spacer"></div>';root.prepend(fallback);return fallback;
  }

  function nativeReload(head){
    return [...head.querySelectorAll('button')].find(button=>{
      const id=String(button.id||'');const text=String(button.textContent||'').trim();
      return /reload|refresh/i.test(id)||text==='تحديث'||text==='إعادة تحميل'||text==='إعادة المحاولة';
    })||null;
  }

  function decorateNative(button){
    if(!button||button.dataset.kunSectionReloadNative==='1')return;
    button.dataset.kunSectionReloadNative='1';button.classList.add('kun-section-reload');button.title=button.title||'تحديث هذا القسم فقط';
    if(!button.querySelector('.kun-reload-icon'))button.insertAdjacentHTML('afterbegin','<span class="kun-reload-icon" aria-hidden="true">↻</span>');
  }

  function waitForRootSettled(timeout=5000,quiet=180){
    return new Promise(resolve=>{
      let done=false,timer=null,hard=null;
      const finish=()=>{if(done)return;done=true;observer.disconnect();clearTimeout(timer);clearTimeout(hard);resolve();};
      const observer=new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(finish,quiet);});
      observer.observe(root,{childList:true,subtree:false});timer=setTimeout(finish,quiet);hard=setTimeout(finish,timeout);
    });
  }

  async function reloadBaseState(){
    if(typeof load==='function'){await load();return true;}
    if(typeof render==='function'){render();return true;}
    return false;
  }

  async function reloadCurrentSection(view=activeView()){
    const custom=registry.get(view);if(custom){await custom();return;}
    if(view==='dashboard'&&window.KunDashboardV33?.reload){await window.KunDashboardV33.reload();return;}
    if(view==='customer-service'&&window.KunCustomerServiceV31?.render){await window.KunCustomerServiceV31.render();return;}
    if(view==='post-shipping'&&window.KunPostShippingV47?.render){await window.KunPostShippingV47.render();return;}
    if(view==='returns-exchanges'&&window.KunReturnsExchangesV56?.render){await window.KunReturnsExchangesV56.render();return;}
    if(view==='inventory'&&window.KunVariantInventoryV46?.refresh){await window.KunVariantInventoryV46.refresh();return;}
    if(view==='products'){
      await window.KunProductCatalogV43?.catalog?.(true).catch?.(()=>{});
      if(await reloadBaseState())return;
    }
    if(view==='orders'||view==='customers'){
      if(await reloadBaseState())return;
    }
    const escaped=window.CSS?.escape?CSS.escape(String(view||'')):String(view||'').replace(/"/g,'\\"');
    const nav=document.querySelector(`.nav button[data-view="${escaped}"]`)||activeNav();
    if(nav){const settled=waitForRootSettled();nav.click();await settled;return;}
    if(await reloadBaseState())return;
    throw new Error('تعذر إعادة تحميل هذا القسم');
  }

  async function clickReload(button){
    if(button.dataset.kunReloadBusy==='1')return;
    const view=activeView(),label=viewLabel();button.dataset.kunReloadBusy='1';button.disabled=true;button.classList.add('is-loading');
    try{
      await reloadCurrentSection(view);
      window.dispatchEvent(new CustomEvent('kun:section-reloaded',{detail:{view,at:new Date().toISOString()}}));
      notify(`تم تحديث قسم ${label}`);
    }catch(error){notify(error?.message||'تعذر تحديث القسم');}
    finally{if(button.isConnected){button.disabled=false;button.classList.remove('is-loading');button.dataset.kunReloadBusy='0';}setTimeout(ensureButton,0);}
  }

  function ensureButton(){
    if(injecting)return;injecting=true;
    try{
      ensureStyle();const head=pageHead();
      const native=nativeReload(head);if(native){decorateNative(native);return;}
      if(head.querySelector('[data-kun-section-reload="1"]'))return;
      const button=document.createElement('button');button.type='button';button.className='btn soft kun-section-reload';button.dataset.kunSectionReload='1';button.title='تحديث بيانات هذا القسم فقط';button.setAttribute('aria-label','تحديث بيانات هذا القسم فقط');button.innerHTML='<span class="kun-reload-icon" aria-hidden="true">↻</span><span class="kun-reload-text">تحديث</span>';button.onclick=()=>clickReload(button);
      const spacer=[...head.children].find(node=>node.classList?.contains('spacer'));if(spacer)spacer.after(button);else head.appendChild(button);
    }finally{injecting=false;}
  }

  const observer=new MutationObserver(()=>ensureButton());observer.observe(root,{childList:true,subtree:false});
  document.addEventListener('click',event=>{if(event.target.closest?.('.nav button[data-view]'))setTimeout(ensureButton,0);},true);
  window.addEventListener('kun:order-workflow-updated',()=>setTimeout(ensureButton,0));
  window.KunSectionReloadV57={
    reload:view=>reloadCurrentSection(view||activeView()),
    register:(view,handler)=>{if(view&&typeof handler==='function')registry.set(String(view),handler);},
    ensure:ensureButton,
    activeView,
    version:'57.1'
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ensureButton,{once:true});else setTimeout(ensureButton,0);
  document.documentElement.dataset.sectionReload='v57.1-ready';
})();

// Campaign Hub keeps v66 workspaces and layers comparison v67, analysis v68, readable measurements v70.1, reliable controls v71.2 and compact visual density v72.
{
  const hubId='kunCampaignHubV66Loader',uxId='kunCampaignUXV67Loader',breakdownId='kunBreakdownAnalysisV68Loader',measureId='kunBreakdownMeasurementsV70Loader',controlsId='kunBreakdownControlsV71Loader',visualId='kunCampaignVisualDensityV72Loader';
  const loadVisual=()=>{
    if(document.getElementById(visualId))return;
    const visual=document.createElement('script');visual.id=visualId;visual.src='/v2/modules-v72-campaign-visual-density.js?v=72.0';visual.async=false;document.head.appendChild(visual);
  };
  const loadControls=()=>{
    const existing=document.getElementById(controlsId);
    if(existing){if(window.KunBreakdownControlsV71)loadVisual();else existing.addEventListener('load',loadVisual,{once:true});return;}
    const controls=document.createElement('script');controls.id=controlsId;controls.src='/v2/modules-v71-breakdown-controls.js?v=71.2';controls.async=false;controls.addEventListener('load',loadVisual,{once:true});document.head.appendChild(controls);
  };
  const loadMeasurements=()=>{
    const existing=document.getElementById(measureId);
    if(existing){if(window.KunBreakdownMeasurementsV70)loadControls();else existing.addEventListener('load',loadControls,{once:true});return;}
    const measure=document.createElement('script');measure.id=measureId;measure.src='/v2/modules-v70-breakdown-measurements.js?v=70.1';measure.async=false;measure.addEventListener('load',loadControls,{once:true});document.head.appendChild(measure);
  };
  const loadBreakdownUX=()=>{
    const existing=document.getElementById(breakdownId);
    if(existing){if(window.KunBreakdownAnalysisV68)loadMeasurements();else existing.addEventListener('load',loadMeasurements,{once:true});return;}
    const breakdown=document.createElement('script');breakdown.id=breakdownId;breakdown.src='/v2/modules-v68-breakdown-analysis-ux.js?v=68.1';breakdown.async=false;breakdown.addEventListener('load',loadMeasurements,{once:true});document.head.appendChild(breakdown);
  };
  const loadUX=()=>{
    const existingUX=document.getElementById(uxId);
    if(existingUX){if(window.KunCampaignComparisonUXV67)loadBreakdownUX();else existingUX.addEventListener('load',loadBreakdownUX,{once:true});return;}
    const ux=document.createElement('script');ux.id=uxId;ux.src='/v2/modules-v67-campaign-comparison-ux.js?v=67.0';ux.async=false;ux.addEventListener('load',loadBreakdownUX,{once:true});document.head.appendChild(ux);
  };
  const existing=document.getElementById(hubId);
  if(!existing){
    const module=document.createElement('script');module.id=hubId;module.src='/v2/modules-v66-campaign-hub.js?v=66.0';module.async=false;module.addEventListener('load',loadUX,{once:true});document.head.appendChild(module);
  }else if(window.KunCampaignHubV66)loadUX();else existing.addEventListener('load',loadUX,{once:true});
}