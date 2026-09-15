/* Kun Online v41 — multi-select and bulk deletion for Orders table */
(function(){
  const K=window.KunActionsV23;if(!K)throw new Error('KunActionsV23 core missing');
  const selected=new Set();
  let mePromise=null,injecting=false,deleting=false;
  const currentMe=()=>mePromise||(mePromise=K.api('/api/me').catch(()=>null));
  const allowed=async()=>['admin','client','ops'].includes((await currentMe())?.role);
  const orderButtons=()=>[...document.querySelectorAll('#root button[data-order]')].filter(button=>button.closest('table'));
  const visibleIds=()=>[...new Set(orderButtons().map(button=>String(button.dataset.order||'').trim()).filter(Boolean))];
  const styleBar=bar=>{
    bar.style.display='flex';bar.style.flexWrap='wrap';bar.style.alignItems='center';bar.style.gap='8px';bar.style.margin='0 0 12px';bar.style.padding='10px 12px';
    bar.style.border='1px solid var(--line,#E5E7EB)';bar.style.borderRadius='12px';bar.style.background='var(--card,#fff)';
  };
  const styleDanger=button=>{
    button.style.color='#B42318';button.style.background='#FFF1F0';button.style.border='1px solid #FDA29B';
  };
  function ensureBar(table){
    let bar=document.querySelector('[data-v41-order-bulk-bar]');
    if(bar)return bar;
    bar=document.createElement('div');bar.dataset.v41OrderBulkBar='1';styleBar(bar);
    bar.innerHTML='<button type="button" class="btn soft" data-v41-select-visible>تحديد كل الظاهر</button><button type="button" class="btn soft" data-v41-clear-selection disabled>إلغاء التحديد</button><span data-v41-selected-count style="font-weight:700">لم يتم تحديد طلبات</span><span style="flex:1"></span><button type="button" class="btn soft" data-v41-delete-selected disabled>حذف المحدد</button>';
    styleDanger(bar.querySelector('[data-v41-delete-selected]'));
    const card=table.closest('.card.table-wrap')||table.parentElement;card?.parentElement?.insertBefore(bar,card);
    return bar;
  }
  function ensureHeader(table){
    const row=table.querySelector('thead tr');if(!row||row.querySelector('[data-v41-order-select-head]'))return;
    const th=document.createElement('th');th.dataset.v41OrderSelectHead='1';th.style.width='42px';
    th.innerHTML='<input type="checkbox" data-v41-order-select-all aria-label="تحديد كل الطلبات الظاهرة" title="تحديد كل الطلبات الظاهرة">';
    row.insertBefore(th,row.firstElementChild);
  }
  function ensureRows(table){
    orderButtons().filter(button=>button.closest('table')===table).forEach(openButton=>{
      const orderId=String(openButton.dataset.order||'').trim(),row=openButton.closest('tr');if(!orderId||!row)return;
      let input=row.querySelector('[data-v41-order-select]');
      if(!input){
        const td=document.createElement('td');td.dataset.v41OrderSelectCell='1';td.style.width='42px';
        input=document.createElement('input');input.type='checkbox';input.dataset.v41OrderSelect=orderId;input.setAttribute('aria-label',`تحديد الطلب ${orderId}`);input.title=`تحديد الطلب ${orderId}`;
        td.appendChild(input);row.insertBefore(td,row.firstElementChild);
      }
      input.checked=selected.has(orderId);
    });
  }
  function syncControls(){
    const ids=visibleIds(),visibleSet=new Set(ids);
    [...selected].forEach(id=>{if(!visibleSet.has(id))selected.delete(id)});
    document.querySelectorAll('[data-v41-order-select]').forEach(input=>{input.checked=selected.has(String(input.dataset.v41OrderSelect||''))});
    const all=document.querySelector('[data-v41-order-select-all]'),count=selected.size;
    if(all){all.checked=ids.length>0&&ids.every(id=>selected.has(id));all.indeterminate=count>0&&!all.checked;all.disabled=!ids.length||deleting;}
    const counter=document.querySelector('[data-v41-selected-count]');if(counter)counter.textContent=count?`تم تحديد ${count} طلب`:'لم يتم تحديد طلبات';
    const del=document.querySelector('[data-v41-delete-selected]'),clear=document.querySelector('[data-v41-clear-selection]'),selectAll=document.querySelector('[data-v41-select-visible]');
    if(del)del.disabled=!count||deleting;if(clear)clear.disabled=!count||deleting;if(selectAll)selectAll.disabled=!ids.length||deleting;
  }
  async function inject(){
    if(injecting||!await allowed())return;injecting=true;
    try{
      const buttons=orderButtons();if(!buttons.length)return;
      const table=buttons[0].closest('table');if(!table)return;
      ensureBar(table);ensureHeader(table);ensureRows(table);syncControls();
    }finally{injecting=false}
  }
  async function deleteSelected(){
    if(deleting)return;syncControls();const ids=[...selected];if(!ids.length)return;
    if(!confirm(`هل أنت متأكد من حذف ${ids.length} طلب؟\nالحذف نهائي ولا يمكن التراجع عنه.`))return;
    deleting=true;syncControls();
    const ok=[],failed=[],queue=[...ids],workerCount=Math.min(6,queue.length);
    try{
      const {cid,sid}=await K.scope();
      const workers=Array.from({length:workerCount},async()=>{
        while(queue.length){
          const orderId=queue.shift();if(!orderId)continue;
          try{
            await K.api(`/api/customer-service/orders/${encodeURIComponent(orderId)}/delete`,{method:'DELETE',body:JSON.stringify({clientId:cid,...(sid?{storeId:sid}:{})})});
            ok.push(orderId);selected.delete(orderId);
          }catch(error){failed.push({id:orderId,message:error?.message||'تعذر الحذف'})}
        }
      });
      await Promise.all(workers);
      if(ok.length&&failed.length)K.notify(`تم حذف ${ok.length} طلب، وتعذر حذف ${failed.length}`);
      else if(ok.length)K.notify(`تم حذف ${ok.length} طلب بنجاح`);
      else K.notify(failed[0]?.message||'تعذر حذف الطلبات المحددة');
      if(typeof load==='function')await load();else location.reload();
    }finally{deleting=false;setTimeout(()=>inject().catch(()=>{}),0)}
  }
  document.addEventListener('change',event=>{
    const row=event.target.closest?.('[data-v41-order-select]');
    if(row){const id=String(row.dataset.v41OrderSelect||'');if(row.checked)selected.add(id);else selected.delete(id);syncControls();return;}
    const all=event.target.closest?.('[data-v41-order-select-all]');
    if(all){visibleIds().forEach(id=>all.checked?selected.add(id):selected.delete(id));syncControls();}
  },true);
  document.addEventListener('click',event=>{
    const selectAll=event.target.closest?.('[data-v41-select-visible]');
    if(selectAll){event.preventDefault();visibleIds().forEach(id=>selected.add(id));syncControls();return;}
    const clear=event.target.closest?.('[data-v41-clear-selection]');
    if(clear){event.preventDefault();selected.clear();syncControls();return;}
    const del=event.target.closest?.('[data-v41-delete-selected]');
    if(del){event.preventDefault();deleteSelected().catch(error=>{deleting=false;syncControls();K.notify(error?.message||'تعذر حذف الطلبات المحددة')});}
  },true);
  const root=document.getElementById('root')||document.body;
  let timer=null;const observer=new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(()=>inject().catch(()=>{}),20)});
  observer.observe(root,{subtree:true,childList:true});
  setTimeout(()=>inject().catch(()=>{}),0);
  document.documentElement.dataset.orderBulkDeleteUi='v41-ready';
})();
