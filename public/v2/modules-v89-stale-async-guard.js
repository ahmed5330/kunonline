/* Kun Online v89.1 — isolate stale async writes and prevent old Campaign Hub loads from blocking a newly selected mode. */
(function(){
  if(window.KunStaleAsyncGuardV89)return;
  const guarded=new Set([
    '#qaSaleSession','#qaSaleProduct','#qaPosSessions','#qaPosSales',
    '#qaFlows','#qaCampaignKpis','#qaCampaigns',
    '#qaInvoiceSupplier','#qaPaymentSupplier','#qaInvoicePo','#qaPaymentInvoice',
    '#qaSupplierBalances','#qaSupplierFinanceRows'
  ]);
  const sinks=new Map();
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
  function releaseCampaignModeLoading(event){
    const button=event.target.closest?.('.campaign66 [data-section-mode]');if(!button)return;
    const hub=window.KunCampaignHubV66,state=hub?.state,section=state?.sections?.[state?.level],next=String(button.dataset.sectionMode||'');
    if(!section||!next||section.mode===next)return;
    section.loading=false;
  }
  document.addEventListener('click',releaseCampaignModeLoading,true);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
  window.KunStaleAsyncGuardV89={version:'89.1',install,guarded:[...guarded],releaseCampaignModeLoading};
})();
