/* Kun Online v104.2 — static-assets bootstrap for Automation + operational modules. */
(function(){
  'use strict';
  if(window.KunV2OperationalBootstrapV104)return;
  window.KunV2OperationalBootstrapV104={version:'104.2',startedAt:Date.now()};

  const modules=[
    {id:'kun-v104-automation-core',src:'/v2/modules-v104-automation-core.js?v=104.2',ready:()=>Boolean(window.KunAutomationV104)},
    {id:'kun-v105-customer-service-claim',src:'/v2/modules-v105-customer-service-claim.js?v=105.2',ready:()=>Boolean(window.KunCustomerServiceClaimV105)},
    {id:'kun-v105-section-nav-actions',src:'/v2/modules-v105-section-nav-actions.js?v=105.1',ready:()=>Boolean(window.KunSectionNavActionsV105)},
    {id:'kun-v106-manual-jnt-order',src:'/v2/modules-v106-manual-jnt-order.js?v=106.0',ready:()=>Boolean(document.querySelector('script[data-kun-v106-loaded="1"]'))},
    {id:'kun-v107-mobile-app-update',src:'/v2/modules-v107-mobile-app-update.js?v=107.0',ready:()=>Boolean(window.KunMobileAppUpdateV107)}
  ];

  function markReady(item,script){
    if(item.id==='kun-v106-manual-jnt-order')script.dataset.kunV106Loaded='1';
  }
  function loadAt(index){
    if(index>=modules.length){
      document.documentElement.dataset.kunOperationalBootstrap='v104.2-ready';
      window.dispatchEvent(new CustomEvent('kun:operational-bootstrap-ready'));
      return;
    }
    const item=modules[index];
    if(item.ready?.()){loadAt(index+1);return;}
    const existing=document.getElementById(item.id);
    if(existing){
      if(existing.dataset.loaded==='1'){markReady(item,existing);loadAt(index+1);return;}
      existing.addEventListener('load',()=>{markReady(item,existing);loadAt(index+1);},{once:true});
      existing.addEventListener('error',()=>loadAt(index+1),{once:true});
      return;
    }
    const script=document.createElement('script');
    script.id=item.id;script.src=item.src;script.async=false;script.dataset.kunOperationalBootstrap='1';
    script.addEventListener('load',()=>{script.dataset.loaded='1';markReady(item,script);loadAt(index+1);},{once:true});
    script.addEventListener('error',()=>{console.error('Kun Online module load failed',item.src);loadAt(index+1);},{once:true});
    document.body.appendChild(script);
  }

  loadAt(0);
})();
