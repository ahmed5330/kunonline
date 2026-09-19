/* Kun Online v102 — mobile post-shipping containment fix. */
(function(){
  'use strict';
  if(document.getElementById('kunPostShippingMobileV102'))return;
  const style=document.createElement('style');
  style.id='kunPostShippingMobileV102';
  style.textContent=`
    @media(max-width:600px){
      .ps-page,.ps-board.ps-v47{min-width:0!important;max-width:100%!important;width:100%!important;}
      .ps-board.ps-v47{grid-template-columns:minmax(0,1fr)!important;overflow-x:visible!important;overflow-y:visible!important;}
      .ps-board.ps-v47>.ps-column,.ps-board.ps-v47 .ps-column-head,.ps-board.ps-v47 .ps-list,.ps-board.ps-v47 .ps-order,.ps-board.ps-v47 .cs-order-head{min-width:0!important;max-width:100%!important;width:100%!important;box-sizing:border-box!important;}
      .ps-board.ps-v47 .ps-order,.ps-board.ps-v47 .ps-column{overflow-wrap:anywhere;word-break:break-word;}
      .ps-board.ps-v47 .cs-actions{flex-wrap:wrap;}
      .ps-board.ps-v47 .cs-actions>.btn,.ps-board.ps-v47 .cs-actions>a.btn{min-width:0;max-width:100%;}
    }
  `;
  document.head.appendChild(style);
  window.KunPostShippingMobileV102={version:'102.0'};
})();
