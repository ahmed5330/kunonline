/* Kun Online v116.0 — confirmed Customer Service orders leave the board and appear in Printing. */
(function(){
  const PRINTING_STATES=new Set(['confirmed','preparing']);
  function install(){
    const api=window.KunCustomerServiceV31;
    if(!api||api.__printingRoutingV116)return false;
    const original=typeof api.moveState==='function'?api.moveState.bind(api):null;
    api.moveState=function(orderId,state){
      if(PRINTING_STATES.has(String(state||''))){
        document.querySelectorAll('[data-cs-order]').forEach(card=>{if(String(card.dataset.csOrder||'')===String(orderId))card.remove();});
        window.showToast?.('تم تأكيد الأوردر ونقله تلقائيًا إلى قسم الطباعة');
        window.dispatchEvent(new CustomEvent('kun:printing-ready',{detail:{orderId,state}}));
        setTimeout(()=>api.render?.(),40);
        return true;
      }
      return original?.(orderId,state);
    };
    api.__printingRoutingV116=true;
    return true;
  }
  if(!install()){
    let tries=0;const timer=setInterval(()=>{tries+=1;if(install()||tries>80)clearInterval(timer);},100);
  }
  window.KunPrintRoutingV116={install,version:'116.0'};
})();
