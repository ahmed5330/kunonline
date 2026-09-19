/* Kun Online v103.1 — deterministic accounting route activation + stuck-loading recovery. */
(function(){
  'use strict';
  if(window.KunAccountingNavigationGuardV103)return;

  const VIEW='accounting';
  let routeTimer=0,watchTimer=0,diagnosing=false,lastAttempt=0,routeGeneration=0;
  const root=()=>document.getElementById('root');
  const active=()=>document.querySelector('.nav button.active[data-view]')?.dataset.view===VIEW;
  const month=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit'}).format(new Date());
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const loadingText=()=>String(root()?.innerText||'');
  const isLoading=()=>/جارٍ تحميل الحسابات الشهرية|جارٍ تجميع حساب الشهر/.test(loadingText());
  const accountingVisible=()=>Boolean(root()?.querySelector?.('.acc100')||isLoading());

  function permissionState(){
    const nav=window.KunPermissionNavigationV51;
    if(!nav)return 'allowed';
    const snapshot=nav.snapshot;
    if(!snapshot?.role)return 'pending';
    if(typeof nav.allowedView==='function')return nav.allowedView(VIEW,snapshot)?'allowed':'denied';
    const list=Array.isArray(nav.allowed)?nav.allowed:[];
    return list.includes(VIEW)?'allowed':'denied';
  }
  const allowed=()=>permissionState()==='allowed';

  function syncActive(){
    document.querySelectorAll('.nav button[data-view]').forEach(button=>button.classList.toggle('active',String(button.dataset.view||'')===VIEW));
  }

  function activate(){
    if(active())return true;
    if(!allowed())return false;
    try{
      if(typeof window.setView==='function')window.setView(VIEW);
      else if(typeof setView==='function')setView(VIEW);
    }catch(error){console.warn('Accounting route activation',error);}
    if(!active()){
      try{view=VIEW;}catch(_){}
      syncActive();
      try{if(typeof render==='function')render();}catch(error){console.warn('Accounting base render fallback',error);}
    }
    window.KunViewPersistenceV97?.save?.(VIEW);
    return active();
  }

  function render(){
    if(!activate())return false;
    try{
      if(window.KunAccountingV100?.render){window.KunAccountingV100.render();return true;}
    }catch(error){console.warn('Accounting render',error);}
    return false;
  }

  function stabilize(generation){
    for(const delay of [35,140,420])setTimeout(()=>{
      if(generation!==routeGeneration||permissionState()!=='allowed')return;
      if(!active())activate();
      if(active()&&!accountingVisible())render();
    },delay);
  }

  function routeAccounting(generation=routeGeneration,attempt=0){
    if(generation!==routeGeneration)return false;
    const permission=permissionState();
    if(permission==='pending'){
      if(attempt<30)setTimeout(()=>routeAccounting(generation,attempt+1),50);
      return false;
    }
    if(permission==='denied'){
      window.showToast?.('القسم غير متاح ضمن صلاحيات حسابك');
      return false;
    }
    const ok=activate();if(!ok)return false;
    render();scheduleWatch();stabilize(generation);return true;
  }

  function xhrJson(path,timeout=7000){
    return new Promise((resolve,reject)=>{
      const xhr=new XMLHttpRequest();xhr.open('GET',path,true);xhr.withCredentials=true;xhr.timeout=timeout;
      xhr.onload=()=>{let data={};try{data=JSON.parse(xhr.responseText||'{}')}catch{}if(xhr.status>=200&&xhr.status<300)resolve(data);else reject(new Error(data.error||`HTTP ${xhr.status}`));};
      xhr.onerror=()=>reject(new Error('تعذر الاتصال بالخادم'));xhr.ontimeout=()=>reject(new Error('انتهت مهلة الاتصال'));xhr.send();
    });
  }

  async function diagnose(){
    if(diagnosing||!active()||!isLoading())return;diagnosing=true;
    try{
      const clientId=String(window.KunClientContextV24?.cachedClientId||localStorage.getItem('kunActiveClient')||'');
      const storeId=String(document.getElementById('storeBtn')?.value||'');
      const scoped=(path)=>{const u=new URL(path,location.origin);if(clientId)u.searchParams.set('clientId',clientId);if(storeId)u.searchParams.set('storeId',storeId);return u.pathname+u.search;};
      const checks=[['الجلسة','/api/me'],['كتالوج الحسابات',scoped('/api/accounting/catalog')],['الحساب الشهري',scoped(`/api/accounting/monthly?month=${encodeURIComponent(month())}`)]];
      const failures=[];
      for(const [label,path] of checks){try{await xhrJson(path);}catch(error){failures.push(`${label}: ${error.message}`);}}
      if(!active()||!isLoading())return;
      if(!failures.length){
        const now=Date.now();if(now-lastAttempt>2500){lastAttempt=now;activate();window.KunAccountingV100?.render?.();scheduleWatch(5000);}
        return;
      }
      const el=root();if(el)el.innerHTML=`<div class="card"><strong>تعذر إكمال تحميل الحسابات</strong><div class="sub mt">${failures.map(esc).join('<br>')}</div><div class="mt"><button class="btn primary" id="acc103Retry">إعادة المحاولة</button></div></div>`;
      document.getElementById('acc103Retry')?.addEventListener('click',()=>scheduleRoute(0));
    }finally{diagnosing=false;}
  }

  function scheduleWatch(delay=6500){clearTimeout(watchTimer);watchTimer=setTimeout(()=>{if(active()&&isLoading())diagnose();},delay);}
  function scheduleRoute(delay=0){
    const generation=++routeGeneration;
    clearTimeout(routeTimer);routeTimer=setTimeout(()=>routeAccounting(generation),delay);
  }

  function boot(){
    document.addEventListener('click',event=>{
      const route=event.target.closest?.('.nav button[data-view],[data-go]');if(!route)return;
      const next=String(route.dataset.view||route.dataset.go||'');
      const generation=++routeGeneration;
      if(next!==VIEW)return;
      // Permission navigation is registered earlier and remains authoritative for denied routes.
      // Once the route is allowed, stop competing legacy handlers and make accounting the sole final renderer.
      event.preventDefault();event.stopImmediatePropagation();
      clearTimeout(routeTimer);routeAccounting(generation);
    },true);
    window.addEventListener('pageshow',()=>{if(active())scheduleRoute(40);});
    document.addEventListener('kun:section-reloaded',event=>{if(event.detail?.view===VIEW||active())scheduleRoute(20);});
    if(active())scheduleRoute(40);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
  window.KunAccountingNavigationGuardV103={version:'103.1',activate,render,navigate:()=>scheduleRoute(0),retry:()=>scheduleRoute(0),diagnose,permissionState};
})();
