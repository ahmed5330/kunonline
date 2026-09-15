/* Kun Online v38 — explicit order delete action inside Orders table */
(function(){
  const K=window.KunActionsV23;if(!K)throw new Error('KunActionsV23 core missing');
  let mePromise=null;
  const currentMe=()=>mePromise||(mePromise=K.api('/api/me').catch(()=>null));
  const allowed=async()=>['admin','client','ops'].includes((await currentMe())?.role);
  const styleDelete=button=>{
    button.style.color='#B42318';
    button.style.background='#FFF1F0';
    button.style.border='1px solid #FDA29B';
    button.style.marginInlineStart='6px';
  };
  async function deleteOrder(orderId,button){
    if(!orderId)return;
    if(!confirm(`هل أنت متأكد من حذف الطلب ${orderId}؟\nالحذف نهائي ولا يمكن التراجع عنه.`))return;
    if(button)button.disabled=true;
    try{
      const {cid,sid}=await K.scope();
      await K.api(`/api/customer-service/orders/${encodeURIComponent(orderId)}/delete`,{
        method:'DELETE',
        body:JSON.stringify({clientId:cid,...(sid?{storeId:sid}:{})})
      });
      K.notify('تم حذف الطلب بنجاح');
      try{if(typeof closeDrawer==='function')closeDrawer()}catch{}
      if(typeof load==='function')await load();else location.reload();
    }catch(error){
      if(button)button.disabled=false;
      K.notify(error?.message||'تعذر حذف الطلب');
    }
  }
  async function injectDeleteButtons(){
    if(!await allowed())return;
    document.querySelectorAll('#root button[data-order]').forEach(openButton=>{
      const orderId=String(openButton.dataset.order||'').trim();
      if(!orderId)return;
      const cell=openButton.parentElement;if(!cell||cell.querySelector(`[data-v38-order-delete="${CSS.escape(orderId)}"]`))return;
      const button=document.createElement('button');
      button.type='button';button.className='btn soft';button.textContent='حذف';
      button.dataset.v38OrderDelete=orderId;button.title='حذف الأوردر نهائيًا';button.setAttribute('aria-label',`حذف الطلب ${orderId}`);
      styleDelete(button);cell.appendChild(button);
    });
  }
  document.addEventListener('click',event=>{
    const button=event.target.closest?.('[data-v38-order-delete]');if(!button)return;
    event.preventDefault();event.stopImmediatePropagation();
    deleteOrder(button.dataset.v38OrderDelete,button);
  },true);
  const root=document.getElementById('root')||document.body;
  const observer=new MutationObserver(()=>{injectDeleteButtons().catch(()=>{})});
  observer.observe(root,{subtree:true,childList:true});
  setTimeout(()=>injectDeleteButtons().catch(()=>{}),0);
  document.documentElement.dataset.orderDeleteUi='v38-ready';
})();
