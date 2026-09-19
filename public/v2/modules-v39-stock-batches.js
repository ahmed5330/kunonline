/* Kun Online v39 — explicit destructive actions + named stock batches and CS stock allocation. */
(function(){
  const K=window.KunActionsV23;if(!K)return;
  let mePromise=null,batchLoadSeq=0;
  const me=()=>mePromise||(mePromise=K.api('/api/me').catch(()=>null));
  const canManage=async()=>['admin','client','ops'].includes((await me())?.role);
  const today=()=>{const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()),g=t=>p.find(x=>x.type===t)?.value||'';return `${g('year')}-${g('month')}-${g('day')}`;};
  const norm=v=>String(v||'').trim().replace(/\s+/g,' ').toLowerCase();
  const danger=b=>{b.style.color='#B42318';b.style.background='#FFF1F0';b.style.border='1px solid #FDA29B';b.style.marginInlineStart='6px';};
  const qs=(cid,sid)=>`clientId=${encodeURIComponent(cid)}${sid?`&storeId=${encodeURIComponent(sid)}`:''}`;

  async function deleteOrder(id,button){
    if(!confirm(`هل أنت متأكد من حذف الطلب ${id}؟\nالحذف نهائي ولا يمكن التراجع عنه.`))return;
    button.disabled=true;try{const {cid,sid}=await K.scope();await K.api(`/api/customer-service/orders/${encodeURIComponent(id)}/delete`,{method:'DELETE',body:JSON.stringify({clientId:cid,...(sid?{storeId:sid}:{})})});K.notify('تم حذف الطلب');if(typeof load==='function')await load();else K.refresh();}catch(e){button.disabled=false;K.notify(e.message||'تعذر حذف الطلب');}
  }
  async function deleteProduct(id,button){
    if(!confirm('هل أنت متأكد من حذف المنتج من السيستم؟\nلن يتم الحذف لو ما زال له رصيد داخل استوك مسمى.'))return;
    button.disabled=true;try{const {cid,sid}=await K.scope();await K.api(`/api/products/${encodeURIComponent(id)}?${qs(cid,sid)}`,{method:'DELETE'});K.notify('تم حذف المنتج');K.refresh();}catch(e){button.disabled=false;K.notify(e.message||'تعذر حذف المنتج');}
  }
  function appendDelete(cell,id,type){
    if(!cell||!id||cell.querySelector(`[data-v39-${type}-delete="${CSS.escape(String(id))}"]`))return;
    const b=document.createElement('button');b.type='button';b.className='btn soft';b.textContent=type==='order'?'حذف':'حذف المنتج';b.dataset[`v39${type[0].toUpperCase()+type.slice(1)}Delete`]=String(id);danger(b);cell.appendChild(b);
  }
  async function injectDestructiveActions(){
    if(!await canManage())return;
    document.querySelectorAll('#root [data-order-v27],#root [data-order]').forEach(open=>{const id=open.dataset.orderV27||open.dataset.order;appendDelete(open.parentElement,id,'order');});
    if(typeof view!=='undefined'&&view==='products')document.querySelectorAll('#root button[data-product]').forEach(open=>appendDelete(open.parentElement,open.dataset.product,'product'));
    if(typeof view!=='undefined'&&view==='inventory'&&typeof state!=='undefined'&&Array.isArray(state?.products)){
      const rows=document.querySelectorAll('#root .grid.split .card.table-wrap table tbody > tr');rows.forEach((row,i)=>{const p=state.products[i],cell=row.cells?.[0];if(p&&cell)appendDelete(cell,p.id,'product');});
    }
  }

  async function openNamedStockBatch(){
    const {cid,sid}=await K.scope();if(!sid)throw new Error('اختار متجرًا من أعلى قبل إضافة استوك جديد');const data=await K.api(`/api/state?${qs(cid,sid)}`),products=data.products||[];
    K.drawer('إضافة استوك جديد',`<div class="card"><div class="v27-form">
      <label>اسم/تسمية الاستوك<input class="input" id="v39BatchName" placeholder="مثال: أول استوك"></label>
      <label>تاريخ إضافة المخزون<input class="input" id="v39BatchDate" type="date" value="${today()}"><div class="meta">ينفع تختار تاريخ قديم لو البضاعة دخلت قبل يوم التسجيل.</div></label>
      <label class="wide">ملاحظة (اختياري)<input class="input" id="v39BatchNote" placeholder="المورد / رقم الفاتورة / أي ملاحظة"></label>
    </div></div>
    <div class="card mt"><h3>كميات المنتجات داخل هذا الاستوك</h3><div class="sub">اكتب فقط الكمية التي أضيفت في هذه الدفعة. المنتج الذي تتركه صفر لن يدخل في الاستوك.</div><div class="table-wrap mt"><table class="table compact"><thead><tr><th>المنتج</th><th>المتاح حاليًا</th><th>الكمية الجديدة</th></tr></thead><tbody>${products.map(p=>`<tr><td><b>${K.esc(p.name)}</b><div class="meta">${K.esc(p.sku||'')}</div></td><td>${K.money(p.stock)}</td><td><input class="input" type="number" min="0" step="1" value="0" data-v39-batch-qty="${K.esc(p.id)}"></td></tr>`).join('')||'<tr><td colspan="3" class="empty">لا توجد منتجات. أضف المنتجات أولًا.</td></tr>'}</tbody></table></div><button class="btn primary mt" id="v39SaveBatch">حفظ الاستوك والكميات</button></div>`);
    document.getElementById('v39SaveBatch').onclick=async()=>{const btn=document.getElementById('v39SaveBatch');try{const name=K.val('v39BatchName').trim(),stockDate=K.val('v39BatchDate'),items=[...document.querySelectorAll('[data-v39-batch-qty]')].map(x=>({productId:x.dataset.v39BatchQty,qty:Number(x.value)})).filter(x=>Number.isFinite(x.qty)&&x.qty>0);if(!name)throw new Error('اكتب اسم/تسمية الاستوك');if(!stockDate)throw new Error('حدد تاريخ إضافة المخزون');if(!items.length)throw new Error('اكتب كمية لمنتج واحد على الأقل');btn.disabled=true;btn.textContent='جاري الحفظ...';await K.api('/api/inventory/batches',{method:'POST',body:JSON.stringify({clientId:cid,storeId:sid,name,stockDate,note:K.val('v39BatchNote'),items})});K.notify(`تم إضافة الاستوك: ${name}`);K.refresh();}catch(e){K.notify(e.message);if(btn?.isConnected){btn.disabled=false;btn.textContent='حفظ الاستوك والكميات';}}};
  }
  function batchItemsTable(batch){return `<div class="table-wrap mt"><table class="table compact"><thead><tr><th>المنتج</th><th>أضيف</th><th>المتبقي</th></tr></thead><tbody>${(batch.items||[]).map(i=>`<tr><td>${K.esc(i.productName)}</td><td>${K.money(i.initialQty)}</td><td><b>${K.money(i.remainingQty)}</b></td></tr>`).join('')}</tbody></table></div>`;}
  async function injectBatchInventory(){
    if(typeof view!=='undefined'&&view!=='inventory')return;const root=document.getElementById('root');if(!root)return;
    const head=root.querySelector('.page-head');if(head&&!document.getElementById('v39NewBatch')){const b=document.createElement('button');b.id='v39NewBatch';b.className='btn primary';b.textContent='+ إضافة استوك جديد';const spacer=head.querySelector('.spacer');if(spacer)spacer.after(b);else head.appendChild(b);b.onclick=()=>openNamedStockBatch().catch(e=>K.notify(e.message));}
    if(document.getElementById('v39BatchList'))return;const section=document.createElement('section');section.id='v39BatchList';section.className='card mt';section.innerHTML='<div class="title" style="font-size:18px">دفعات / تسميات المخزون</div><div class="sub">جارٍ تحميل الاستوكات...</div>';root.appendChild(section);const seq=++batchLoadSeq;
    try{const {cid,sid}=await K.scope(),d=await K.api(`/api/inventory/batches?${qs(cid,sid)}`);if(seq!==batchLoadSeq||!section.isConnected)return;const batches=d.batches||[];section.innerHTML=`<div class="page-head"><div><div class="title" style="font-size:18px">دفعات / تسميات المخزون</div><div class="sub">كل استوك له اسمه وتاريخه ورصيده المستقل. الرصيد هو الذي يتم اختياره عند شحن الأوردر.</div></div><div class="spacer"></div><button class="btn primary" id="v39NewBatchInside">+ إضافة استوك جديد</button></div>${batches.length?batches.map(b=>`<div class="card mt"><div class="rowline"><div><b>${K.esc(b.name)}</b><div class="meta">تاريخ الإضافة: ${K.esc(b.stockDate)} · ${b.status==='active'?'متاح':'منتهي'}</div></div><div><b>${K.money(b.totalRemaining)}</b> متبقي من ${K.money(b.totalInitial)}</div></div>${batchItemsTable(b)}</div>`).join(''):'<div class="empty">لسه مفيش استوكات مسماة. اضغط «إضافة استوك جديد» وابدأ بأول دفعة.</div>'}`;document.getElementById('v39NewBatchInside')?.addEventListener('click',()=>openNamedStockBatch().catch(e=>K.notify(e.message)));}catch(e){section.innerHTML=`<div class="title" style="font-size:18px">دفعات / تسميات المخزون</div><div class="sub">${K.esc(e.message)}</div>`;}
  }

  function closeBatchModal(){document.getElementById('v39StockBatchModal')?.remove();}
  function matchingItem(batch,order){if(order.productId){return (batch.items||[]).find(i=>String(i.productId)===String(order.productId)&&(!order.variantId||String(i.variantId||'')===String(order.variantId)));}const target=norm(order.product);return (batch.items||[]).find(i=>norm(i.productName)===target);}
  async function chooseBatchForShipping(orderId,select){
    const {cid}=await K.scope(),h=await K.api(`/api/customer-service/orders/${encodeURIComponent(orderId)}/history?clientId=${encodeURIComponent(cid)}`),order=h.order;if(!order?.storeId)throw new Error('الأوردر غير مربوط بمتجر');const d=await K.api(`/api/inventory/batches?clientId=${encodeURIComponent(cid)}&storeId=${encodeURIComponent(order.storeId)}&activeOnly=1`),batches=d.batches||[];
    const back=document.createElement('div');back.id='v39StockBatchModal';back.className='cs-modal-back';back.innerHTML=`<div class="cs-modal" role="dialog" aria-modal="true"><h2>اختيار الاستوك — ${K.esc(order.name||orderId)}</h2><div class="sub">الأوردر: ${K.esc(order.product||'بدون منتج')} · الكمية ${K.money(order.qty||1)}</div>${batches.length?`<label class="cs-field" style="display:block;margin-top:15px">اسم الاستوك<select class="select" id="v39ShipBatch"><option value="">— اختر الاستوك —</option>${batches.map(b=>`<option value="${K.esc(b.id)}">${K.esc(b.name)} — متبقي ${K.money(b.totalRemaining)}</option>`).join('')}</select></label><div id="v39ShipBatchItems" class="mt"></div><div class="cs-modal-actions"><button class="btn primary" id="v39ConfirmShipBatch" disabled>اختيار الاستوك ونقل لجاري الشحن</button><button class="btn soft" data-v39-close>إلغاء</button></div>`:'<div class="insight warn mt">لا يوجد استوك مسمى فيه كميات متاحة لهذا المتجر. أضف استوك جديد من قسم المخزون أولًا.</div><div class="cs-modal-actions"><button class="btn soft" data-v39-close>قفل</button></div>'}</div>`;document.body.appendChild(back);back.querySelectorAll('[data-v39-close]').forEach(x=>x.onclick=closeBatchModal);back.onclick=e=>{if(e.target===back)closeBatchModal();};if(!batches.length)return;
    const chooser=back.querySelector('#v39ShipBatch'),box=back.querySelector('#v39ShipBatchItems'),confirm=back.querySelector('#v39ConfirmShipBatch');chooser.onchange=()=>{const batch=batches.find(x=>x.id===chooser.value);if(!batch){box.innerHTML='';confirm.disabled=true;return;}const item=matchingItem(batch,order),enough=item&&Number(item.remainingQty)>=Number(order.qty||1);box.innerHTML=`<div class="card"><div class="rowline"><div><b>${K.esc(batch.name)}</b><div class="meta">تاريخ الاستوك ${K.esc(batch.stockDate)}</div></div><div>${K.money(batch.totalRemaining)} قطعة متاحة</div></div>${batchItemsTable(batch)}<div class="insight ${enough?'ok':'danger'}">${enough?`المنتج متاح: ${K.money(item.remainingQty)} قطعة — سيتم خصم ${K.money(order.qty||1)}.`:'الاستوك المختار لا يحتوي كمية كافية من منتج الأوردر.'}</div></div>`;confirm.disabled=!enough;};
    confirm.onclick=async()=>{const batch=batches.find(x=>x.id===chooser.value);if(!batch)return;confirm.disabled=true;confirm.textContent='جاري الخصم والنقل...';try{await K.api(`/api/customer-service/orders/${encodeURIComponent(orderId)}/state?clientId=${encodeURIComponent(cid)}&storeId=${encodeURIComponent(order.storeId)}`,{method:'PATCH',body:JSON.stringify({clientId:cid,storeId:order.storeId,state:'shipped',stockBatchId:batch.id})});K.notify(`تم خصم الأوردر من ${batch.name} ونقله إلى جاري الشحن`);closeBatchModal();document.getElementById('csReload')?.click();}catch(e){K.notify(e.message);confirm.disabled=false;confirm.textContent='اختيار الاستوك ونقل لجاري الشحن';}};
  }

  document.addEventListener('change',e=>{const s=e.target.closest?.('[data-cs-state]');if(!s||s.value!=='shipped'||s.dataset.current==='shipped')return;e.preventDefault();e.stopImmediatePropagation();const card=s.closest('[data-cs-order]'),id=card?.dataset.csOrder;s.value=s.dataset.current||'preparing';if(id)chooseBatchForShipping(id,s).catch(err=>K.notify(err.message));},true);
  document.addEventListener('click',e=>{const od=e.target.closest?.('[data-v39-order-delete]');if(od){e.preventDefault();e.stopImmediatePropagation();return deleteOrder(od.dataset.v39OrderDelete,od);}const pd=e.target.closest?.('[data-v39-product-delete]');if(pd){e.preventDefault();e.stopImmediatePropagation();return deleteProduct(pd.dataset.v39ProductDelete,pd);}},true);

  function enhance(){injectDestructiveActions().catch(()=>{});injectBatchInventory().catch(()=>{});}
  const observer=new MutationObserver(enhance);observer.observe(document.body,{subtree:true,childList:true});setTimeout(enhance,0);
  document.documentElement.dataset.stockBatches='v39-ready';
})();
