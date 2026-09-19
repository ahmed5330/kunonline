/* Kun Online v97.4 — keep the exact active workspace on real browser reload. */
(function(){
  'use strict';
  if(window.KunViewPersistenceV97)return;

  const VIEW_KEY='kun:v2:last-view';
  const STATUS_KEY='kun:v2:last-status';
  const safe=v=>{const value=String(v||'').trim();return /^[a-z0-9][a-z0-9_-]{0,79}$/i.test(value)?value:'';};
  const navigationType=()=>{try{return String(performance.getEntriesByType?.('navigation')?.[0]?.type||'');}catch(_){return '';}};
  const shouldRestore=()=>['reload','back_forward'].includes(navigationType());
  const navButton=v=>{
    const value=safe(v);if(!value)return null;
    return [...document.querySelectorAll('.nav button[data-view]')].find(b=>String(b.dataset.view||'')===value)||null;
  };
  const visible=b=>Boolean(b&&!b.hidden&&b.style.display!=='none'&&b.getAttribute('aria-hidden')!=='true');
  const readKey=key=>{try{return safe(sessionStorage.getItem(key)||'');}catch(_){return '';}};
  const writeKey=(key,value)=>{const clean=safe(value);if(!clean)return false;try{sessionStorage.setItem(key,clean);return true;}catch(_){return false;}};
  const read=()=>readKey(VIEW_KEY);
  const save=v=>writeKey(VIEW_KEY,v);
  const readStatus=()=>readKey(STATUS_KEY);
  const saveStatus=v=>writeKey(STATUS_KEY,v);
  const sync=v=>document.querySelectorAll('.nav button[data-view]').forEach(b=>b.classList.toggle('active',String(b.dataset.view||'')===String(v||'')));

  function allowed(saved){
    const api=window.KunPermissionNavigationV51;
    if(!api?.snapshot?.role)return true;
    if(Array.isArray(api.allowed))return api.allowed.includes(saved);
    return typeof api.allowedView==='function'?api.allowedView(saved,api.snapshot):true;
  }

  function restore(){
    if(!shouldRestore())return false;
    const saved=read();
    if(saved){
      try{view=saved;}catch(_){}
      sync(saved);
    }
    const savedStatus=readStatus();
    if(savedStatus){try{status=savedStatus;}catch(_){} }
    return Boolean(saved||savedStatus);
  }

  restore();

  const originalSetView=typeof window.setView==='function'?window.setView:(typeof setView==='function'?setView:null);
  if(originalSetView){
    const wrapped=function(next){
      const value=safe(next);if(value)save(value);
      return originalSetView.apply(this,arguments);
    };
    try{setView=wrapped;}catch(_){}
    window.setView=wrapped;
  }

  document.addEventListener('click',event=>{
    const route=event.target.closest?.('.nav button[data-view],[data-go]');
    const next=safe(route?.dataset?.view||route?.dataset?.go||'');
    if(next)save(next);
    const tab=event.target.closest?.('[data-status]');
    const nextStatus=safe(tab?.dataset?.status||'');
    if(nextStatus)saveStatus(nextStatus);
  },true);

  window.addEventListener('pagehide',()=>{
    try{save(view);}catch(_){}
    try{saveStatus(status);}catch(_){}
  });

  let activated=false;
  function activateSaved(){
    if(!shouldRestore())return false;
    const saved=read();if(!saved)return false;
    if(!allowed(saved)){
      try{sessionStorage.removeItem(VIEW_KEY);}catch(_){}
      return false;
    }
    const target=navButton(saved);
    if(!visible(target))return false;
    target.click();
    activated=true;return true;
  }

  function retryRestore(){
    if(!shouldRestore())return;
    const delays=[0,80,220,500,900,1500,2500];
    delays.forEach(delay=>setTimeout(()=>{if(!activated)activateSaved();},delay));
  }

  window.addEventListener('load',retryRestore,{once:true});
  const nav=document.querySelector('.nav');
  if(nav&&typeof MutationObserver==='function'&&shouldRestore()){
    const observer=new MutationObserver(()=>{if(!activated)activateSaved();});
    observer.observe(nav,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','style','aria-hidden','class']});
    setTimeout(()=>observer.disconnect(),4000);
  }

  window.KunViewPersistenceV97={
    version:'97.4',
    key:VIEW_KEY,
    statusKey:STATUS_KEY,
    navigationType,
    shouldRestore,
    restore,
    save,
    saveStatus,
    activateSaved,
    get current(){try{return String(view||'');}catch(_){return '';}}
  };
})();

/* v105 loader — section Back/Previous controls stay globally available without coupling to any workspace renderer. */
(function(){
  if(document.getElementById('kunSectionNavActionsV105Loader'))return;
  const script=document.createElement('script');
  script.id='kunSectionNavActionsV105Loader';
  script.src='/v2/modules-v105-section-nav-actions.js?v=105.0';
  script.async=false;
  document.head.appendChild(script);
})();

/* v106 loader — move the real safety undo bar into the section header and keep Dashboard Meta KPIs near-live. */
(function(){
  if(document.getElementById('kunUndoDashboardLiveV106Loader'))return;
  const script=document.createElement('script');
  script.id='kunUndoDashboardLiveV106Loader';
  script.src='/v2/modules-v106-undo-dashboard-live.js?v=106.1';
  script.async=false;
  document.head.appendChild(script);
})();
