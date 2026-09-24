/* Kun Online v118.0 — preserve an early Customer Service navigation click until v31 is ready. */
(function(){
  'use strict';
  const VERSION='118.0';
  let requestId=0;

  function ready(button){
    return Boolean(button?.isConnected&&button.classList.contains('is-visible')&&typeof window.KunCustomerServiceV31?.render==='function');
  }

  function replayWhenReady(button,id){
    let attempts=0;
    const retry=()=>{
      if(id!==requestId||!button?.isConnected)return;
      if(ready(button)){
        window.KunCustomerServiceV31.render();
        document.documentElement.dataset.customerServiceNavReady='replayed';
        return;
      }
      if(++attempts<80)setTimeout(retry,100);
    };
    setTimeout(retry,0);
  }

  document.addEventListener('click',event=>{
    const button=event.target?.closest?.('button[data-view="customer-service"]');
    if(!button)return;
    if(ready(button))return;
    const id=++requestId;
    document.documentElement.dataset.customerServiceNavReady='pending';
    replayWhenReady(button,id);
  },true);

  document.documentElement.dataset.customerServiceNavGuard=VERSION;
  window.KunCustomerServiceNavReadyV118={version:VERSION,ready:()=>ready(document.querySelector('button[data-view="customer-service"]'))};
})();
