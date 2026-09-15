/* Kun Online v89.3 — isolate stale async writes, protect specialized views from late base renders and keep rapid Campaign Hub mode switches deterministic. */
(function(){
  if(window.KunStaleAsyncGuardV89)return;
  const guarded=new Set([
    '#qaSaleSession','#qaSaleProduct','#qaPosSessions','#qaPosSales',
    '#qaFlows','#qaCampaignKpis','#qaCampaigns',
    '#qaInvoiceSupplier','#qaPaymentSupplier','#qaInvoicePo','#qaPaymentInvoice',
    '#qaSupplierBalances','#qaSupplierFinanceRows'
  ]);
  const sinks=new Map(),metaReadInflight=new Map();
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
  installMetaReadDedupe();installBaseRenderGuard();
  document.addEventListener('click',releaseCampaignModeLoading,true);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
  window.KunStaleAsyncGuardV89={version:'89.3',install,installMetaReadDedupe,installBaseRenderGuard,specializedViewReady,guarded:[...guarded],metaReadInflight,releaseCampaignModeLoading};
})();