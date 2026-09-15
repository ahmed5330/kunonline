/* Kun Online v89.4 — isolate stale async writes, protect specialized views from late base renders, keep rapid Campaign Hub mode switches deterministic, and harden admin password reset transport. */
(function(){
  if(window.KunStaleAsyncGuardV89)return;
  const guarded=new Set([
    '#qaSaleSession','#qaSaleProduct','#qaPosSessions','#qaPosSales',
    '#qaFlows','#qaCampaignKpis','#qaCampaigns',
    '#qaInvoiceSupplier','#qaPaymentSupplier','#qaInvoicePo','#qaPaymentInvoice',
    '#qaSupplierBalances','#qaSupplierFinanceRows'
  ]);
  const sinks=new Map(),metaReadInflight=new Map();
  let adminResetClientId='';
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
  function activeView(){return document.querySelector('.nav button.active[data-view]')?.dataset.view||'';}
  function specializedViewReady(view){
    const root=document.getElementById('root');if(!root)return false;
    if(view==='integrations')return Boolean(window.KunIntegrationsV16&&root.querySelector('#intGroups,#intSetupPanel .form-grid'));
    return false;
  }
  function installBaseRenderGuard(){
    const upstream=window.render;if(typeof upstream!=='function'||upstream.__kunBaseRenderGuard)return false;
    const wrapped=function(...args){
      const view=activeView();
      if(specializedViewReady(view))return;
      return upstream.apply(this,args);
    };
    Object.defineProperty(wrapped,'__kunBaseRenderGuard',{value:true});
    Object.defineProperty(wrapped,'__kunBaseRenderUpstream',{value:upstream});
    window.render=wrapped;return true;
  }
  function releaseCampaignModeLoading(event){
    const button=event.target.closest?.('.campaign66 [data-section-mode]');if(!button)return;
    const hub=window.KunCampaignHubV66,state=hub?.state,section=state?.sections?.[state?.level],next=String(button.dataset.sectionMode||'');
    if(!section||!next||section.mode===next)return;
    section.loading=false;
  }
  function directJsonRequest(path,{method='GET',body=null,timeout=20000}={}){
    return new Promise((resolve,reject)=>{
      const xhr=new XMLHttpRequest();
      xhr.open(method,path,true);xhr.withCredentials=true;xhr.timeout=timeout;
      xhr.setRequestHeader('Accept','application/json');
      if(body!==null)xhr.setRequestHeader('Content-Type','application/json');
      xhr.onload=()=>{
        let data={};try{data=JSON.parse(xhr.responseText||'{}')}catch{data={raw:xhr.responseText||''}}
        if(xhr.status>=200&&xhr.status<300){resolve(data);return;}
        const error=new Error(data?.error||`HTTP ${xhr.status}`);error.status=xhr.status;error.code=data?.code;error.data=data;reject(error);
      };
      xhr.onerror=()=>reject(Object.assign(new Error('تعذر الاتصال بالسيرفر'),{code:'NETWORK_ERROR'}));
      xhr.ontimeout=()=>reject(Object.assign(new Error('الاتصال اتأخر وتم إلغاء المحاولة. جرّب مرة أخرى.'),{code:'TIMEOUT'}));
      xhr.send(body===null?null:JSON.stringify(body));
    });
  }
  function installDirectAdminPasswordReset(){
    const K=window.KunActionsV23;if(!K)return false;
    if(typeof K.enhanceClientDrawer==='function'&&!K.enhanceClientDrawer.__kunDirectResetClientTrack){
      const upstream=K.enhanceClientDrawer;
      const wrapped=async function(clientId,...args){adminResetClientId=String(clientId||'');return upstream.apply(this,[clientId,...args]);};
      Object.defineProperty(wrapped,'__kunDirectResetClientTrack',{value:true});
      Object.defineProperty(wrapped,'__kunDirectResetUpstream',{value:upstream});
      K.enhanceClientDrawer=wrapped;
    }
    if(document.documentElement.dataset.kunDirectAdminReset==='1')return true;
    document.documentElement.dataset.kunDirectAdminReset='1';
    document.addEventListener('click',event=>{
      const opener=event.target.closest?.('.v27ClientOpen[data-id]');if(opener?.dataset?.id)adminResetClientId=String(opener.dataset.id);
    },true);
    document.addEventListener('click',async event=>{
      const resetBtn=event.target.closest?.('#v23ResetOwner');if(!resetBtn)return;
      event.preventDefault();event.stopImmediatePropagation();
      if(resetBtn.dataset.busy==='1')return;
      const resetInput=document.getElementById('v23ResetPassword'),password=String(resetInput?.value||'').trim();
      if(password.length<8){K.notify('كلمة المرور لازم تكون 8 حروف على الأقل');resetInput?.focus();return;}
      const clientId=String(adminResetClientId||'').trim();
      if(!clientId){K.notify('أغلق حساب العميل وافتحه من جديد ثم أعد المحاولة');return;}
      const idleText=resetBtn.textContent;
      resetBtn.dataset.busy='1';resetBtn.disabled=true;resetBtn.setAttribute('aria-busy','true');resetBtn.textContent='جاري تغيير كلمة المرور...';resetInput?.blur();
      try{
        const result=await directJsonRequest(`/api/admin/clients/${encodeURIComponent(clientId)}/reset-owner-password`,{method:'POST',body:{password},timeout:20000});
        if(result?.ok===false)throw new Error(result?.error||'تعذر تغيير كلمة المرور');
        if(resetInput)resetInput.value='';
        K.notify('تم تغيير كلمة مرور صاحب الحساب ومسح محاولات الدخول');
      }catch(error){
        const status=Number(error?.status||0),message=status===401?'جلسة الإدارة انتهت. سجّل دخول الإدارة من جديد.':status===403?'الحساب الحالي لا يملك صلاحية Admin.':error?.message||'تعذر تغيير كلمة المرور';
        K.notify(message);
      }finally{
        if(resetBtn.isConnected){resetBtn.dataset.busy='0';resetBtn.disabled=false;resetBtn.removeAttribute('aria-busy');resetBtn.textContent=idleText;}
      }
    },true);
    return true;
  }
  installMetaReadDedupe();installBaseRenderGuard();installDirectAdminPasswordReset();
  document.addEventListener('click',releaseCampaignModeLoading,true);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{install();installDirectAdminPasswordReset();},{once:true});else install();
  window.KunStaleAsyncGuardV89={version:'89.4',install,installMetaReadDedupe,installBaseRenderGuard,installDirectAdminPasswordReset,specializedViewReady,guarded:[...guarded],metaReadInflight,releaseCampaignModeLoading,directJsonRequest};
})();