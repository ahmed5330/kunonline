/* Kun Online v89.3 — isolate stale async writes, keep rapid Campaign Hub mode switches deterministic, and harden mobile Admin password reset. */
(function(){
  if(window.KunStaleAsyncGuardV89)return;
  const guarded=new Set([
    '#qaSaleSession','#qaSaleProduct','#qaPosSessions','#qaPosSales',
    '#qaFlows','#qaCampaignKpis','#qaCampaigns',
    '#qaInvoiceSupplier','#qaPaymentSupplier','#qaInvoicePo','#qaPaymentInvoice',
    '#qaSupplierBalances','#qaSupplierFinanceRows'
  ]);
  const sinks=new Map(),metaReadInflight=new Map();
  const PASSWORD_RESET_TIMEOUT_MS=15000;
  function makeSink(selector){
    if(sinks.has(selector))return sinks.get(selector);
    const tag=['#qaSaleSession','#qaSaleProduct','#qaInvoiceSupplier','#qaPaymentSupplier','#qaInvoicePo','#qaPaymentInvoice'].includes(selector)?'select':'div';
    const node=document.createElement(tag);node.dataset.kunStaleAsyncSink='1';node.setAttribute('aria-hidden','true');sinks.set(selector,node);return node;
  }
  function install(){
    const root=document.getElementById('root');if(!root||root.dataset.kunStaleAsyncGuard==='1')return false;
    const nativeQuery=Element.prototype.querySelector;
    Object.defineProperty(root,'querySelector',{configurable:true,writable:true,value:function(selector){
      const found=nativeQuery.call(this,selector);if(found||!guarded.has(String(selector)))return found;
      return makeSink(String(selector));
    }});
    root.dataset.kunStaleAsyncGuard='1';return true;
  }
  function metaReadKey(input,init={}){
    const raw=typeof input==='string'||input instanceof URL?String(input):input?.url;if(!raw)return '';
    const method=String(init?.method||input?.method||'GET').toUpperCase();if(method!=='GET')return '';
    const url=new URL(raw,location.href);
    if(url.pathname!=='/api/integrations/meta-ads/campaign-hub'&&url.pathname!=='/api/integrations/meta-ads/daily-comparison')return '';
    return `${method} ${url.href}`;
  }
  function installMetaReadDedupe(){
    if(window.fetch?.__kunMetaReadDedupe)return false;
    const upstream=window.fetch.bind(window);
    const wrapped=function(input,init={}){
      const key=metaReadKey(input,init);if(!key)return upstream(input,init);
      let pending=metaReadInflight.get(key);
      if(!pending){
        pending=upstream(input,init);metaReadInflight.set(key,pending);
        pending.finally(()=>{if(metaReadInflight.get(key)===pending)metaReadInflight.delete(key);}).catch(()=>{});
      }
      return pending.then(response=>response.clone());
    };
    Object.defineProperty(wrapped,'__kunMetaReadDedupe',{value:true});window.fetch=wrapped;return true;
  }
  function releaseCampaignModeLoading(event){
    const button=event.target.closest?.('.campaign66 [data-section-mode]');if(!button)return;
    const hub=window.KunCampaignHubV66,state=hub?.state,section=state?.sections?.[state?.level],next=String(button.dataset.sectionMode||'');
    if(!section||!next||section.mode===next)return;
    section.loading=false;
  }
  function decorateAdminPasswordReset(scope=document){
    const btn=scope.querySelector?.('#v23ResetOwner'),input=scope.querySelector?.('#v23ResetPassword');
    if(!btn||!input||btn.dataset.kunMobilePasswordReset==='1'||typeof btn.onclick!=='function')return false;
    const original=btn.onclick,idleText=String(btn.textContent||'تغيير كلمة المرور');
    btn.dataset.kunMobilePasswordReset='1';btn.type='button';btn.style.touchAction='manipulation';
    input.setAttribute('autocomplete','new-password');input.setAttribute('autocapitalize','none');input.setAttribute('spellcheck','false');
    if(window.matchMedia?.('(max-width: 820px)').matches){btn.style.minHeight='46px';btn.style.flex='1 1 100%';}
    btn.onclick=async event=>{
      event?.preventDefault?.();event?.stopPropagation?.();
      if(btn.dataset.busy==='1')return;
      const password=String(input.value||'').trim();
      if(password.length<8){window.KunActionsV23?.notify?.('كلمة المرور لازم تكون 8 حروف على الأقل');input.focus();return;}
      btn.dataset.busy='1';btn.disabled=true;btn.setAttribute('aria-busy','true');btn.textContent='جاري تغيير كلمة المرور...';input.blur();
      let timer=0,timedOut=false;
      try{
        const timeout=new Promise(resolve=>{timer=setTimeout(()=>{timedOut=true;resolve();},PASSWORD_RESET_TIMEOUT_MS)});
        await Promise.race([Promise.resolve(original.call(btn,event)),timeout]);
        if(timedOut)window.KunActionsV23?.notify?.('الاتصال اتأخر. تم فك الزر ويمكنك المحاولة مرة أخرى.');
      }catch(error){window.KunActionsV23?.notify?.(error?.message||'تعذر تغيير كلمة المرور');}
      finally{
        if(timer)clearTimeout(timer);
        btn.dataset.busy='0';btn.disabled=false;btn.removeAttribute('aria-busy');btn.textContent=idleText;
      }
    };
    return true;
  }
  function installAdminPasswordResetGuard(){
    decorateAdminPasswordReset(document);
    if(document.documentElement.dataset.kunAdminPasswordResetObserver==='1')return false;
    document.documentElement.dataset.kunAdminPasswordResetObserver='1';
    const observer=new MutationObserver(mutations=>{for(const mutation of mutations){if(mutation.type==='childList'&&mutation.addedNodes.length){decorateAdminPasswordReset(document);break;}}});
    observer.observe(document.body,{childList:true,subtree:true});
    return true;
  }
  installMetaReadDedupe();
  installAdminPasswordResetGuard();
  document.addEventListener('click',releaseCampaignModeLoading,true);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{install();installAdminPasswordResetGuard();},{once:true});else install();
  window.KunStaleAsyncGuardV89={version:'89.3',install,installMetaReadDedupe,guarded:[...guarded],metaReadInflight,releaseCampaignModeLoading,decorateAdminPasswordReset,installAdminPasswordResetGuard,PASSWORD_RESET_TIMEOUT_MS};
})();