/* Kun Online v116.1 — confirmed orders remain visible in Customer Service AND Printing. */
(function(){
  const PRINTING_STATES=new Set(['confirmed','preparing']);
  function install(){
    const api=window.KunCustomerServiceV31;
    if(!api||api.__printingRoutingV116)return false;
    const original=typeof api.moveState==='function'?api.moveState.bind(api):null;
    api.moveState=function(orderId,state,deferUntil){
      // One canonical order, two views: NEVER remove its Customer Service card on confirmation.
      const moved=original?.(orderId,state,deferUntil);
      if(moved&&PRINTING_STATES.has(String(state||''))){
        window.dispatchEvent(new CustomEvent('kun:printing-ready',{detail:{orderId,state}}));
      }
      return moved;
    };
    api.__printingRoutingV116=true;
    return true;
  }
  if(!install()){
    let tries=0;const timer=setInterval(()=>{tries+=1;if(install()||tries>80)clearInterval(timer);},100);
  }
  window.KunPrintRoutingV116={install,version:'116.1'};
})();
