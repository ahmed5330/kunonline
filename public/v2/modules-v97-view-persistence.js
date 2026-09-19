/* Kun Online v97.1 — keep the active workspace after browser reload. */
(function(){
  'use strict';
  if(window.KunViewPersistenceV97)return;

  const KEY='kun:v2:last-view';
  const navButton=v=>{
    const value=String(v||'').trim();
    if(!value)return null;
    return [...document.querySelectorAll('.nav button[data-view]')].find(b=>String(b.dataset.view||'')===value)||null;
  };
  const read=()=>{try{return String(sessionStorage.getItem(KEY)||'').trim();}catch(_){return '';}};
  const save=v=>{const value=String(v||'').trim();if(!navButton(value))return false;try{sessionStorage.setItem(KEY,value);return true;}catch(_){return false;}};
  const sync=v=>document.querySelectorAll('.nav button[data-view]').forEach(b=>b.classList.toggle('active',String(b.dataset.view||'')===String(v||'')));

  function restore(){
    const saved=read();
    if(!saved||!navButton(saved))return false;
    try{view=saved;}catch(_){return false;}
    sync(saved);
    return true;
  }

  restore();

  const originalSetView=typeof window.setView==='function'?window.setView:(typeof setView==='function'?setView:null);
  if(originalSetView){
    const wrapped=function(next){
      const value=String(next||'').trim();
      if(navButton(value))save(value);
      return originalSetView.apply(this,arguments);
    };
    try{setView=wrapped;}catch(_){}
    window.setView=wrapped;
  }

  document.addEventListener('click',event=>{
    const target=event.target.closest?.('.nav button[data-view],[data-go]');
    const next=String(target?.dataset?.view||target?.dataset?.go||'').trim();
    if(next&&navButton(next))save(next);
  },true);

  window.addEventListener('pagehide',()=>{
    try{save(view);}catch(_){}
  });

  /* Re-enter the restored workspace once all feature bundles are loaded.
     This matters for workspaces whose renderer is installed by a later bundle. */
  window.addEventListener('load',()=>{
    setTimeout(()=>{
      let current='';
      try{current=String(view||'').trim();}catch(_){}
      const saved=read();
      const target=navButton(current||saved);
      if(!target||target.hidden||target.style.display==='none')return;
      if(saved&&current&&saved!==current)return;
      target.click();
    },0);
  },{once:true});

  window.KunViewPersistenceV97={
    version:'97.1',
    key:KEY,
    restore,
    save,
    get current(){try{return String(view||'');}catch(_){return '';}}
  };
})();
