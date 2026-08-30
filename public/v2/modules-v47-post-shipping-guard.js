/* Kun Online v47 guard — keep the four-stage post-shipping UI authoritative over legacy handlers. */
(function(){
  document.addEventListener('click',event=>{
    const nav=event.target.closest?.('.nav button[data-view="post-shipping"]');
    if(!nav||!window.KunPostShippingV47?.render)return;
    event.preventDefault();event.stopImmediatePropagation();
    document.querySelectorAll('.nav button').forEach(button=>button.classList.toggle('active',button===nav));
    window.KunPostShippingV47.render();
  },true);
})();
