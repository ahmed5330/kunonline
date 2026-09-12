/* Kun Online v88.1 — phone shell hardening + Customer Service resume safety after native phone actions. */
(function(){
  if(window.KunMobileUXV88)return;
  const mobile=()=>window.matchMedia?.('(max-width: 820px)').matches??window.innerWidth<=820;
  const root=()=>document.getElementById('root');
  const activeView=()=>document.querySelector('.nav button.active[data-view]')?.dataset.view||'';
  const customerServiceSelected=()=>activeView()==='customer-service';
  const activeCustomerService=()=>customerServiceSelected()&&Boolean(root()?.querySelector('.cs-page'));
  let resumeSnapshot=null,restoring=false;

  function visibleOrderIds(){return [...(root()?.querySelectorAll('.cs-order[data-cs-order]')||[])].map(card=>String(card.dataset.csOrder||'')).filter(Boolean);}
  function focusedOrderId(){return String(document.activeElement?.closest?.('.cs-order[data-cs-order]')?.dataset?.csOrder||'');}
  function captureScroll(){
    if(window.KunCustomerServiceNoReloadV77?.captureScroll)return window.KunCustomerServiceNoReloadV77.captureScroll();
    return {windowY:window.scrollY,windowX:window.scrollX,nodes:[]};
  }
  function restoreScroll(snapshot){
    if(window.KunCustomerServiceNoReloadV77?.restoreScroll){window.KunCustomerServiceNoReloadV77.restoreScroll(snapshot);return;}
    requestAnimationFrame(()=>window.scrollTo({top:Number(snapshot?.windowY)||0,left:Number(snapshot?.windowX)||0,behavior:'auto'}));
  }
  function rememberResumePoint(explicitOrderId=''){
    if(!mobile()||!activeCustomerService())return false;
    const ids=visibleOrderIds(),requested=String(explicitOrderId||'').trim();
    resumeSnapshot={ids,focusedOrderId:requested||focusedOrderId()||ids[0]||'',scroll:captureScroll(),at:Date.now()};
    return true;
  }
  function callLinks(scope=document){
    scope.querySelectorAll?.('a[data-cs-action="call"]').forEach(link=>{
      link.dataset.mobileSafeCall='1';
      if(!link.getAttribute('aria-label'))link.setAttribute('aria-label','الاتصال بالعميل');
    });
  }
  function highlight(card){
    if(!card)return;card.classList.remove('kun-mobile-call-restore');void card.offsetWidth;card.classList.add('kun-mobile-call-restore');setTimeout(()=>card.classList.remove('kun-mobile-call-restore'),1300);
  }
  async function restoreCustomerService(){
    const snapshot=resumeSnapshot;if(!snapshot||restoring||!mobile()||!customerServiceSelected())return false;
    if(Date.now()-snapshot.at>5*60*1000){resumeSnapshot=null;return false;}
    restoring=true;
    try{
      const selector=id=>`.cs-order[data-cs-order="${CSS.escape(String(id))}"]`;
      const missing=snapshot.ids.filter(id=>!root()?.querySelector(selector(id)));
      if(missing.length||!root()?.querySelector('.cs-page')){
        await Promise.resolve(window.KunCustomerServiceV31?.render?.()).catch(()=>{});
        for(let i=0;i<30&&!root()?.querySelector('.cs-page');i++)await new Promise(resolve=>setTimeout(resolve,100));
      }
      callLinks(root()||document);
      restoreScroll(snapshot.scroll);
      const card=snapshot.focusedOrderId?root()?.querySelector(selector(snapshot.focusedOrderId)):null;
      if(card){highlight(card);requestAnimationFrame(()=>card.scrollIntoView({block:'nearest',inline:'nearest',behavior:'auto'}));}
      resumeSnapshot=null;
      return Boolean(root()?.querySelector('.cs-page'));
    }finally{restoring=false;}
  }
  function syncNavLock(){
    const side=document.querySelector('.side'),open=Boolean(side?.classList.contains('mobile-open')&&mobile());
    document.body.classList.toggle('kun-mobile-nav-open',open);
    const button=document.getElementById('mobileMenuBtn');if(button)button.setAttribute('aria-expanded',open?'true':'false');
  }
  function boot(){
    callLinks();syncNavLock();
    const bodyObserver=new MutationObserver(mutations=>{
      let calls=false,nav=false;
      for(const mutation of mutations){
        if(mutation.type==='attributes'&&mutation.target?.classList?.contains('side'))nav=true;
        if(mutation.type==='childList'&&mutation.addedNodes.length)calls=true;
      }
      if(calls)callLinks();if(nav)syncNavLock();
    });
    bodyObserver.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
    document.addEventListener('pointerdown',event=>{const call=event.target.closest?.('a[data-cs-action="call"]');if(call)rememberResumePoint(call.closest?.('[data-cs-order]')?.dataset?.csOrder||'');},true);
    window.addEventListener('blur',()=>rememberResumePoint(),{passive:true});
    document.addEventListener('visibilitychange',()=>{if(document.hidden)rememberResumePoint();else void restoreCustomerService();},{passive:true});
    window.addEventListener('focus',()=>{if(!document.hidden)void restoreCustomerService();},{passive:true});
    window.addEventListener('pageshow',()=>void restoreCustomerService(),{passive:true});
    window.addEventListener('resize',()=>{syncNavLock();callLinks();},{passive:true});
    window.addEventListener('orientationchange',()=>setTimeout(()=>{syncNavLock();callLinks();},80),{passive:true});
    document.documentElement.dataset.mobileUx='v88-ready';
  }
  window.KunMobileUXV88={version:'88.1',rememberResumePoint,restoreCustomerService,decorateCallLinks:callLinks,syncNavLock};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
