/* Kun Online v103 — deterministic accounting route activation + stuck-loading recovery. */
(function(){
  'use strict';
  if(window.KunAccountingNavigationGuardV103)return;

  const VIEW='accounting';
  let routeTimer=0,watchTimer=0,diagnosing=false,lastAttempt=0;
  const root=()=>document.getElementById('root');
  const active=()=>document.querySelector('.nav button.active[data-view]')?.dataset.view===VIEW;
  const month=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit'}).format(new Date());
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const loadingText=()=>String(root()?.innerText||'');
  const isLoading=()=>/جارٍ تحميل الحسابات الشهرية|جارٍ تجميع حساب الشهر/.test(loadingText());

  function allowed(){
    const nav=window.KunPermissionNavigationV51;
    if(!nav)return true;
    const list=Array.isArray(nav.allowed)?nav.allowed:[];
    return list.includes(VIEW);
  }

  function activate(){
    if(active())return true;
    if(!allowed())return false;
    try{if(typeof window.setView==='function')window.setView(VIEW);}catch(error){console.warn('Accounting route activation',error);}
    return active();
  }

  function render(){
    if(!activate())return false;
    try{
      if(window.KunAccountingV100?.render){window.KunAccountingV100.render();return true;}
    }catch(error){console.warn('Accounting render',error);}
    return false;
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
        // Backend is healthy: the problem was a stale/incorrect UI route. Re-activate once and render from scratch.
        const now=Date.now();if(now-lastAttempt>2500){lastAttempt=now;activate();window.KunAccountingV100?.render?.();scheduleWatch(5000);}
        return;
      }
      const el=root();if(el)el.innerHTML=`<div class="card"><strong>تعذر إكمال تحميل الحسابات</strong><div class="sub mt">${failures.map(esc).join('<br>')}</div><div class="mt"><button class="btn primary" id="acc103Retry">إعادة المحاولة</button></div></div>`;
      document.getElementById('acc103Retry')?.addEventListener('click',()=>scheduleRoute(0));
    }finally{diagnosing=false;}
  }

  function scheduleWatch(delay=6500){clearTimeout(watchTimer);watchTimer=setTimeout(()=>{if(active()&&isLoading())diagnose();},delay);}
  function scheduleRoute(delay=0){
    clearTimeout(routeTimer);routeTimer=setTimeout(()=>{
      if(!allowed())return;
      const ok=activate();if(!ok)return;
      // Let the base router finish its own render first, then make accounting the final renderer.
      setTimeout(()=>{if(active()){render();scheduleWatch();}},20);
    },delay);
  }

  function boot(){
    document.addEventListener('click',event=>{
      const target=event.target.closest?.('[data-view="accounting"],[data-go="accounting"]');if(!target)return;
      // Do not stop propagation: permission navigation must remain authoritative.
      scheduleRoute(0);
    },true);
    window.addEventListener('pageshow',()=>{if(active())scheduleRoute(40);});
    document.addEventListener('kun:section-reloaded',event=>{if(event.detail?.view===VIEW||active())scheduleRoute(20);});
    if(active())scheduleRoute(40);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
  window.KunAccountingNavigationGuardV103={version:'103.0',activate,render,retry:()=>scheduleRoute(0),diagnose};
})();
