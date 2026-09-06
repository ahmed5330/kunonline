/* Kun Online v53 — clear all product/variant stock while preserving batch history. */
(function(){
  const K=window.KunActionsV23;if(!K)return;
  let mePromise=null,pending=false;
  const me=()=>mePromise||(mePromise=K.api('/api/me').catch(()=>null));
  const canManage=async()=>['admin','client','ops'].includes((await me())?.role);
  const qs=(cid,sid)=>`clientId=${encodeURIComponent(cid)}${sid?`&storeId=${encodeURIComponent(sid)}`:''}`;
  function ensureStyle(){
    if(document.getElementById('v53StockClearStyle'))return;
    const style=document.createElement('style');style.id='v53StockClearStyle';style.textContent=`
      .v53-clear-stock{margin-inline-start:6px!important;color:#B54708!important;background:#FFFAEB!important;border:1px solid #FEC84B!important;white-space:nowrap}
      .v53-clear-stock:disabled{opacity:.55;cursor:wait}
    `;document.head.appendChild(style);
  }
  async function clearAllStock(productId,button){
    if(!confirm('تصفير كل كمية هذا المنتج؟\n\nسيتم تصفير المخزون الأساسي وكل المتغيرات وكل الرصيد المتبقي داخل دفعات الاستوك المسماة.\nسيظل سجل الدفعات والحركات القديمة محفوظًا للمراجعة.'))return;
    const old=button.textContent;button.disabled=true;button.textContent='جاري التصفير...';
    try{
      const {cid,sid}=await K.scope(),result=await K.api(`/api/inventory/products/${encodeURIComponent(productId)}/clear?${qs(cid,sid)}`,{method:'POST',body:JSON.stringify({clientId:cid,...(sid?{storeId:sid}:{})})});
      const qty=Number(result?.clearedQty||0),batches=Number(result?.affectedBatches||0);
      K.notify(qty>0?`تم تصفير كل كمية المنتج: ${qty} قطعة من ${batches} دفعة استوك`:'الكمية بالفعل صفر');
      K.refresh();
    }catch(error){button.disabled=false;button.textContent=old;K.notify(error?.message||'تعذر تصفير كمية المنتج');}
  }
  function appendClearButton(cell,productId){
    if(!cell||!productId||cell.querySelector(`[data-v53-clear-stock="${CSS.escape(String(productId))}"]`))return;
    const button=document.createElement('button');button.type='button';button.className='btn soft v53-clear-stock';button.textContent='تصفير الكمية';button.dataset.v53ClearStock=String(productId);button.title='تصفير المخزون الأساسي والمتغيرات ودفعات الاستوك لهذا المنتج';
    const deleteButton=cell.querySelector('[data-v39-product-delete]');if(deleteButton)cell.insertBefore(button,deleteButton);else cell.appendChild(button);
  }
  async function inject(){
    pending=false;ensureStyle();
    if(typeof view==='undefined'||view!=='inventory'||typeof state==='undefined'||!Array.isArray(state?.products)||!await canManage())return;
    const rows=document.querySelectorAll('#root .grid.split .card.table-wrap table tbody > tr');
    rows.forEach((row,index)=>{const product=state.products[index],cell=row.cells?.[0];if(product&&cell)appendClearButton(cell,product.id);});
  }
  function schedule(){if(pending)return;pending=true;queueMicrotask(()=>inject().catch(()=>{pending=false;}));}
  document.addEventListener('click',event=>{
    const button=event.target.closest?.('[data-v53-clear-stock]');if(!button)return;
    event.preventDefault();event.stopImmediatePropagation();clearAllStock(button.dataset.v53ClearStock,button);
  },true);
  document.addEventListener('click',event=>{if(event.target.closest?.('[data-view="inventory"]'))setTimeout(schedule,0);},true);
  const root=document.getElementById('root');if(root)new MutationObserver(schedule).observe(root,{childList:true,subtree:true});
  schedule();
  window.KunStockClearV53={inject,clearAllStock,version:'53.0'};
})();
