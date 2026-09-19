/* Kun Online v106.2 — compact system undo in section header + readiness-gated near-live Dashboard Meta refresh. */
(function(){
  'use strict';
  if(window.KunUndoDashboardLiveV106)return;

  const FRESH_MS=90*1000;
  const AUTO_MS=120*1000;
  const READINESS_MS=60*1000;
  const lastFresh=new Map();
  let metaInflight=null,readinessInflight=null,readinessAt=0,readinessReady=false,scheduled=false,sourceRefreshPending=false;

  const activeView=()=>document.querySelector('.nav button.active[data-view]')?.dataset.view||'';
  const dashboardActive=()=>activeView()==='dashboard';
  const root=()=>document.getElementById('root');
  const notify=message=>window.showToast?.(message)||console.info(message);

  function ensureStyle(){
    if(document.getElementById('kunUndoDashboardLiveV106Style'))return;
    const style=document.createElement('style');
    style.id='kunUndoDashboardLiveV106Style';
    style.textContent=`
      #kunUndo85.kun106-undo-source{display:none!important}
      #kunUndo106Top{position:static!important;display:inline-flex!important;align-items:center!important;justify-content:flex-start!important;gap:5px!important;width:auto!important;max-width:max-content!important;margin:0!important;margin-inline-start:20px!important;padding:0!important;padding-inline-start:16px!important;border:0!important;border-inline-start:1px solid rgba(148,163,184,.35)!important;border-radius:0!important;background:transparent!important;box-shadow:none!important;flex:none!important}
      #kunUndo106Top[hidden]{display:none!important}
      #kunUndo106Top .kun106-undo-count{min-width:22px!important;width:22px!important;height:22px!important;border-radius:999px!important;display:inline-grid!important;place-items:center!important;background:#eef4ff!important;font-size:10px!important;font-weight:800!important;flex:none!important}
      #kunUndo106Top .btn{width:auto!important;min-width:0!important;max-width:none!important;min-height:29px!important;height:29px!important;padding:3px 9px!important;margin:0!important;border-radius:8px!important;font-size:11.5px!important;line-height:1!important;white-space:nowrap!important;flex:none!important}
      #kunUndo106Top .btn.primary{box-shadow:none!important}
      @media(max-width:640px){#kunUndo106Top{margin-inline-start:15px!important;padding-inline-start:12px!important;gap:4px!important}#kunUndo106Top .btn{height:27px!important;min-height:27px!important;padding:2px 7px!important;font-size:11px!important}#kunUndo106Top .kun106-undo-count{width:20px!important;min-width:20px!important;height:20px!important;font-size:9px!important}}
    `;
    document.head.appendChild(style);
  }

  function pageHead(){
    const r=root();if(!r)return null;
    const direct=[...r.children];
    for(const child of direct)if(child.matches?.('.page-head,.dash-hero'))return child;
    for(const child of direct){const nested=[...child.children].find(node=>node.matches?.('.page-head,.dash-hero'));if(nested)return nested;}
    return r.querySelector('.page-head,.dash-hero');
  }

  function reloadButton(head){
    if(!head)return null;
    return [...head.querySelectorAll('button')].find(button=>button.matches?.('[data-kun-section-reload],.kun-section-reload')||/reload|refresh/i.test(String(button.id||''))||['تحديث','إعادة تحميل','إعادة المحاولة'].includes(String(button.textContent||'').trim()))||null;
  }

  function ensureSource(){
    const source=document.getElementById('kunUndo85');
    if(source)return source;
    if(!sourceRefreshPending&&window.KunSafety85?.refreshUndo){
      sourceRefreshPending=true;
      Promise.resolve(window.KunSafety85.refreshUndo()).catch(()=>{}).finally(()=>{sourceRefreshPending=false;scheduleMount();});
    }
    return null;
  }

  function proxyButton(original){
    const button=document.createElement('button');
    button.type='button';
    button.className=`btn ${original.classList.contains('primary')?'primary':'soft'}`;
    button.textContent=String(original.textContent||'').trim();
    button.title=original.title||button.textContent;
    button.setAttribute('aria-label',button.title||button.textContent);
    button.disabled=original.disabled;
    button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();if(original.isConnected&&!original.disabled)original.click();});
    return button;
  }

  function renderUndoProxy(source,head){
    let proxy=document.getElementById('kunUndo106Top');
    const originals=[...source.querySelectorAll('[data-kun85-undo]')];
    const visible=!source.hidden&&originals.length>0;
    if(!visible){proxy?.remove();return null;}
    if(!proxy){proxy=document.createElement('div');proxy.id='kunUndo106Top';proxy.setAttribute('aria-label','الرجوع عن آخر التعديلات');}
    const count=source.querySelector('.kun85-undo-count')?.textContent?.trim()||String(originals.length);
    const signature=`${count}|${originals.map(x=>`${x.dataset.kun85Undo}:${x.textContent}:${x.disabled?'1':'0'}`).join('|')}`;
    if(proxy.dataset.signature!==signature){
      proxy.dataset.signature=signature;
      const badge=document.createElement('span');badge.className='kun106-undo-count';badge.textContent=count;
      proxy.replaceChildren(badge,...originals.map(proxyButton));
    }
    const reload=reloadButton(head);
    if(reload){if(proxy.previousElementSibling!==reload)reload.after(proxy);}
    else{
      const spacer=[...head.children].find(node=>node.classList?.contains('spacer'));
      if(spacer){if(proxy.previousElementSibling!==spacer)spacer.after(proxy);}else if(proxy.parentElement!==head)head.appendChild(proxy);
    }
    return proxy;
  }

  function mountUndo(){
    ensureStyle();
    const source=ensureSource();if(!source)return;
    source.classList.add('kun106-undo-source');
    window.KunSectionReloadV57?.ensure?.();
    const head=pageHead();if(!head){document.getElementById('kunUndo106Top')?.remove();return;}
    renderUndoProxy(source,head);
  }

  function scheduleMount(){if(scheduled)return;scheduled=true;setTimeout(()=>{scheduled=false;mountUndo();},0);}

  function syncDays(){
    const r=window.KunDashboardV33?.range?.();
    if(!r?.from||!r?.to||r.from==='beginning')return 30;
    const from=new Date(`${r.from}T00:00:00Z`),to=new Date(`${r.to}T00:00:00Z`);
    const days=Math.floor((to-from)/86400000)+1;
    return Math.max(1,Math.min(90,Number.isFinite(days)?days:30));
  }

  async function contextKey(){
    const client=window.kunClientId?String(await window.kunClientId()||''):'';
    const store=window.kunStoreId?String(await window.kunStoreId()||''):'';
    return `${client}:${store||'all'}`;
  }

  function readinessRows(data){
    if(Array.isArray(data))return data;
    if(Array.isArray(data?.providers))return data.providers;
    if(Array.isArray(data?.integrations))return data.integrations;
    if(Array.isArray(data?.items))return data.items;
    return [];
  }

  async function metaSyncReady({force=false}={}){
    if(!force&&Date.now()-readinessAt<READINESS_MS)return readinessReady;
    if(readinessInflight)return readinessInflight;
    readinessInflight=(async()=>{
      try{
        const response=await fetch('/api/integrations/readiness',{credentials:'include',headers:{Accept:'application/json'}});
        if(!response.ok){readinessReady=false;return false;}
        const rows=readinessRows(await response.json().catch(()=>[]));
        const meta=rows.find(row=>String(row?.id||row?.provider||row?.providerId||'').toLowerCase()==='meta_ads');
        readinessReady=Boolean(meta&&String(meta.readiness||'').toLowerCase()==='connected');
        return readinessReady;
      }catch(_){readinessReady=false;return false;}
      finally{readinessAt=Date.now();readinessInflight=null;}
    })();
    return readinessInflight;
  }

  async function freshMeta({force=false,quiet=true}={}){
    if(!dashboardActive()||!window.KunMetaAdsLive?.sync)return {synced:false,reason:'unavailable'};
    const key=await contextKey();if(!key||key===':all')return {synced:false,reason:'no-context'};
    const elapsed=Date.now()-(lastFresh.get(key)||0);
    if(!force&&elapsed<FRESH_MS)return {synced:false,reason:'fresh'};
    if(!(await metaSyncReady({force:false}))){lastFresh.set(key,Date.now());return {synced:false,reason:'meta-not-ready'};}
    if(metaInflight)return metaInflight;
    metaInflight=(async()=>{
      try{
        const result=await window.KunMetaAdsLive.sync(syncDays(),{silent:true});
        lastFresh.set(key,Date.now());
        document.documentElement.dataset.dashboardMetaLastSync=new Date().toISOString();
        return {synced:true,result};
      }catch(error){
        const expected=['META_ADS_NOT_CONNECTED','META_TOKEN_MISSING','META_AD_ACCOUNT_MISSING','META_AD_ACCOUNT_CONFIRMATION_REQUIRED'];
        if(expected.includes(String(error?.code||''))){readinessReady=false;readinessAt=Date.now();}
        if(!quiet&&!expected.includes(String(error?.code||'')))notify(`تعذر تحديث Meta: ${error?.message||'خطأ غير معروف'}`);
        return {synced:false,error};
      }finally{metaInflight=null;}
    })();
    return metaInflight;
  }

  function patchDashboardReload(){
    const D=window.KunDashboardV33;if(!D||D.__kun106Patched)return false;
    const originalReload=D.reload?.bind(D),originalSection=D.reloadSection?.bind(D);
    if(typeof originalReload!=='function')return false;
    D.__kun106Patched=true;
    D.reload=async()=>{await freshMeta({force:true,quiet:false});return originalReload();};
    D.kun106OriginalReload=originalReload;
    D.kun106OriginalSection=originalSection;
    window.KunSectionReloadV57?.register?.('dashboard',D.reload);
    return true;
  }

  async function refreshDashboardFromMeta({force=false,quiet=true}={}){
    if(!dashboardActive())return;
    patchDashboardReload();
    const result=await freshMeta({force,quiet});
    if(result.synced&&dashboardActive())await window.KunDashboardV33?.kun106OriginalReload?.();
  }

  function boot(){
    ensureStyle();scheduleMount();
    let attempts=0;const patchTimer=setInterval(()=>{attempts++;if(patchDashboardReload()||attempts>50)clearInterval(patchTimer);},100);
    setTimeout(()=>refreshDashboardFromMeta({force:false,quiet:true}),350);
    setInterval(()=>{if(document.visibilityState==='visible'&&dashboardActive())refreshDashboardFromMeta({force:false,quiet:true});},AUTO_MS);

    const observer=new MutationObserver(scheduleMount);
    observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','class','disabled']});

    document.addEventListener('click',event=>{
      const nav=event.target.closest?.('.nav button[data-view="dashboard"]');
      if(nav)setTimeout(()=>refreshDashboardFromMeta({force:false,quiet:true}),250);
      const dashReload=event.target.closest?.('[data-dash-reload]');
      if(dashReload&&dashboardActive()){
        event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
        const section=dashReload.dataset.dashReload;
        dashReload.disabled=true;dashReload.classList.add('spinning');
        (async()=>{
          await freshMeta({force:true,quiet:false});
          const fn=window.KunDashboardV33?.kun106OriginalSection||window.KunDashboardV33?.reloadSection;
          if(typeof fn==='function')await fn(section,dashReload);
        })().catch(error=>notify(error?.message||'تعذر تحديث الداشبورد')).finally(()=>{if(dashReload.isConnected){dashReload.disabled=false;dashReload.classList.remove('spinning');}});
      }
    },true);

    document.getElementById('storeBtn')?.addEventListener('change',()=>{lastFresh.clear();readinessAt=0;setTimeout(()=>refreshDashboardFromMeta({force:true,quiet:true}),250);});
    window.addEventListener('kun:system-undo',scheduleMount);
    window.addEventListener('kun:section-reloaded',scheduleMount);
    document.documentElement.dataset.undoDashboardLive='v106.2-ready';
  }

  window.KunUndoDashboardLiveV106={version:'106.2',mountUndo,freshMeta,refreshDashboardFromMeta,metaSyncReady,lastFresh};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
