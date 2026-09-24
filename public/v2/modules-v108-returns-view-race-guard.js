/* Kun Online v108.1 — prevent stale Returns renders and guarantee collaboration assets on the static v2 shell. */
(function(){
  if(window.KunReturnsViewRaceGuardV108)return;
  let observer=null,recovering=false,recoverTimer=0;
  const activeButton=()=>document.querySelector('.nav button.active[data-view]');
  const activeView=()=>String(activeButton()?.dataset?.view||'');
  const root=()=>document.getElementById('root');
  const staleReturnsNode=target=>target?.querySelector?.('.rx-page,.rx-board,[data-v56-column]')||null;

  function recover(){
    const target=root(),button=activeButton(),view=String(button?.dataset?.view||'');
    const stale=staleReturnsNode(target);
    if(!target||!button||!view||view==='returns-exchanges'||!stale)return false;

    // Remove stale Returns content from layout immediately so it cannot remain
    // reachable/off-screen while the intended workspace is restored.
    const page=stale.closest?.('.rx-page')||target.querySelector('.rx-page');
    if(page)page.style.setProperty('display','none','important');
    else stale.style?.setProperty?.('display','none','important');
    if(recovering)return true;

    recovering=true;
    queueMicrotask(()=>{
      const current=activeButton(),currentView=String(current?.dataset?.view||''),currentRoot=root();
      if(current&&currentView&&currentView!=='returns-exchanges'&&staleReturnsNode(currentRoot)){
        try{current.click();}catch{}
        setTimeout(()=>{
          const afterRoot=root();
          if(activeView()===currentView&&staleReturnsNode(afterRoot)&&typeof window.setView==='function'){
            try{window.setView(currentView);}catch{}
          }
        },80);
      }
      clearTimeout(recoverTimer);
      recoverTimer=setTimeout(()=>{recovering=false;recover();},1200);
    });
    return true;
  }

  function install(){
    const target=root();
    if(!target||target.dataset.kunReturnsRaceGuard==='1')return false;
    observer=new MutationObserver(()=>recover());
    observer.observe(target,{childList:true,subtree:true});
    target.dataset.kunReturnsRaceGuard='1';
    document.addEventListener('click',event=>{
      const button=event.target.closest?.('.nav button[data-view]');
      if(button&&String(button.dataset.view||'')!=='returns-exchanges')queueMicrotask(recover);
    },true);
    recover();
    return true;
  }

  function appendScript(src,marker,ready){
    if(ready?.())return Promise.resolve(true);
    const old=document.querySelector(`script[${marker}]`);
    if(old&&ready?.())return Promise.resolve(true);
    if(old&&!ready?.())old.remove();
    return new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.src=src;script.async=false;script.setAttribute(marker,'1');
      script.onload=()=>resolve(true);
      script.onerror=()=>reject(new Error(`تعذر تحميل ${src}`));
      document.body.appendChild(script);
    });
  }

  async function ensureCollaborationAssets(){
    if(window.KunCollaborationOrderLinkV119&&window.KunCollaborationSidebarV117&&window.KunCollaborationV117){
      document.documentElement.dataset.collaborationAssetsFallback='ready';
      return true;
    }
    if(document.documentElement.dataset.collaborationAssetsFallback==='loading')return false;
    document.documentElement.dataset.collaborationAssetsFallback='loading';
    try{
      if(!document.querySelector('script[data-kun-collaboration-root="1"]'))await appendScript('/v2/modules-v117-collaboration-root.js?v=117.0','data-kun-collaboration-root',()=>false);
      await appendScript('/v2/modules-v117-collaboration.js?v=117.0','data-kun-collaboration',()=>Boolean(window.KunCollaborationV117));
      await appendScript('/v2/modules-v117-collaboration-sidebar.js?v=117.3','data-kun-collaboration-sidebar',()=>Boolean(window.KunCollaborationSidebarV117));
      await appendScript('/v2/modules-v119-collaboration-order-link.js?v=119.0','data-kun-collaboration-order-link',()=>Boolean(window.KunCollaborationOrderLinkV119));
      window.KunCollaborationSidebarV117?.place?.();
      document.documentElement.dataset.collaborationAssetsFallback='ready';
      return true;
    }catch(error){
      console.warn('Collaboration static-shell bootstrap failed',error);
      document.documentElement.dataset.collaborationAssetsFallback='failed';
      return false;
    }
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
  if(document.readyState==='complete')ensureCollaborationAssets();else window.addEventListener('load',ensureCollaborationAssets,{once:true});
  window.KunReturnsViewRaceGuardV108={version:'108.1',install,recover,activeView,ensureCollaborationAssets};
})();
