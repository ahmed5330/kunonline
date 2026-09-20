/* Kun Online v108.0 — prevent late Returns/Exchanges async renders from overwriting a newer active workspace. */
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

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
  window.KunReturnsViewRaceGuardV108={version:'108.0',install,recover,activeView};
})();
