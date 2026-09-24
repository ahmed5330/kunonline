/* Kun Online v108.2 — prevent stale Returns renders and guarantee a top-level collaboration route on every v2 shell. */
(function(){
  if(window.KunReturnsViewRaceGuardV108)return;
  let observer=null,recovering=false,recoverTimer=0,collabPromise=null;
  const activeButton=()=>document.querySelector('.nav button.active[data-view]');
  const activeView=()=>String(activeButton()?.dataset?.view||'');
  const root=()=>document.getElementById('root');
  const staleReturnsNode=target=>target?.querySelector?.('.rx-page,.rx-board,[data-v56-column]')||null;

  function recover(){
    const target=root(),button=activeButton(),view=String(button?.dataset?.view||'');
    const stale=staleReturnsNode(target);
    if(!target||!button||!view||view==='returns-exchanges'||!stale)return false;
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

  function collaborationAllowed(){
    const permission=window.KunPermissionNavigationV51;
    if(!permission?.snapshot?.role||typeof permission.allowedView!=='function')return true;
    return Boolean(permission.allowedView('collaboration',permission.snapshot));
  }

  function ensureCollaborationRoute(){
    const nav=document.querySelector('.nav');if(!nav)return false;
    let button=nav.querySelector('button[data-view="collaboration"]');
    if(!button){
      button=document.createElement('button');button.type='button';button.dataset.view='collaboration';
      button.innerHTML='<span class="nav-item-icon" aria-hidden="true">💬</span><span class="nav-item-label">تواصل الفريق</span><span class="kc-nav-badge" hidden>0</span>';
    }
    button.classList.remove('nav-subitem');button.classList.add('nav-standalone','nav-collaboration');button.removeAttribute('data-nav-parent');
    button.dataset.navDecorated='v99';button.dataset.collaborationStandalone='108.2';button.style.setProperty('--nav-accent','#4da3ff');
    const ok=collaborationAllowed();button.hidden=!ok;button.style.display=ok?'':'none';button.setAttribute('aria-hidden',ok?'false':'true');button.tabIndex=ok?0:-1;
    const shortcuts=nav.querySelector('[data-kun-shortcuts-nav]'),dashboard=nav.querySelector(':scope > button[data-view="dashboard"]'),firstGroup=nav.querySelector(':scope > .nav-group');
    if(button.parentElement!==nav){
      if(shortcuts?.parentElement===nav)shortcuts.insertAdjacentElement('afterend',button);
      else if(dashboard?.parentElement===nav)dashboard.insertAdjacentElement('afterend',button);
      else nav.insertBefore(button,firstGroup||nav.firstElementChild||null);
    }else if(shortcuts?.parentElement===nav&&shortcuts.nextElementSibling!==button)shortcuts.insertAdjacentElement('afterend',button);
    else if(!shortcuts&&dashboard?.parentElement===nav&&dashboard.nextElementSibling!==button)dashboard.insertAdjacentElement('afterend',button);
    document.documentElement.dataset.collaborationSidebar='ready';
    document.documentElement.dataset.collaborationSidebarVersion='108.2-failsafe';
    return true;
  }

  function appendScript(src,marker,ready){
    if(ready?.())return Promise.resolve(true);
    const old=document.querySelector(`script[${marker}]`);
    if(old&&ready?.())return Promise.resolve(true);
    if(old&&!ready?.())old.remove();
    return new Promise((resolve,reject)=>{
      const script=document.createElement('script');script.src=src;script.async=false;script.setAttribute(marker,'1');
      script.onload=()=>resolve(true);script.onerror=()=>reject(new Error(`تعذر تحميل ${src}`));document.body.appendChild(script);
    });
  }

  async function loadCollaborationAssets(){
    if(window.KunCollaborationOrderLinkV119&&window.KunCollaborationV117)return true;
    if(collabPromise)return collabPromise;
    collabPromise=(async()=>{
      try{
        if(!document.querySelector('script[data-kun-collaboration-root="1"]'))await appendScript('/v2/modules-v117-collaboration-root.js?v=117.0','data-kun-collaboration-root',()=>false);
        await appendScript('/v2/modules-v117-collaboration.js?v=117.0','data-kun-collaboration',()=>Boolean(window.KunCollaborationV117));
        await appendScript('/v2/modules-v117-collaboration-sidebar.js?v=117.3','data-kun-collaboration-sidebar',()=>Boolean(window.KunCollaborationSidebarV117));
        await appendScript('/v2/modules-v119-collaboration-order-link.js?v=119.0','data-kun-collaboration-order-link',()=>Boolean(window.KunCollaborationOrderLinkV119));
        window.KunCollaborationSidebarV117?.place?.();ensureCollaborationRoute();
        document.documentElement.dataset.collaborationAssetsFallback='ready';return true;
      }catch(error){console.warn('Collaboration static-shell bootstrap failed',error);document.documentElement.dataset.collaborationAssetsFallback='failed';return false;}
      finally{collabPromise=null;}
    })();
    return collabPromise;
  }

  async function ensureCollaborationAssets(){
    ensureCollaborationRoute();
    if(window.KunCollaborationOrderLinkV119&&window.KunCollaborationV117){document.documentElement.dataset.collaborationAssetsFallback='ready';return true;}
    document.documentElement.dataset.collaborationAssetsFallback='loading';return loadCollaborationAssets();
  }

  document.addEventListener('click',event=>{
    const button=event.target.closest?.('.nav > button[data-view="collaboration"]');if(!button)return;
    if(window.KunCollaborationV117?.open)return;
    event.preventDefault();event.stopImmediatePropagation();
    ensureCollaborationAssets().then(()=>window.KunCollaborationV117?.open?.());
  },true);

  const boot=()=>{install();ensureCollaborationRoute();setTimeout(ensureCollaborationRoute,250);setTimeout(ensureCollaborationRoute,900);};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
  if(document.readyState==='complete')ensureCollaborationAssets();else window.addEventListener('load',ensureCollaborationAssets,{once:true});
  window.KunReturnsViewRaceGuardV108={version:'108.2',install,recover,activeView,ensureCollaborationRoute,ensureCollaborationAssets};
})();
