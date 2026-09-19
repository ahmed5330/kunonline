/* Kun Online v37 — dated inventory adjustments + visible stock movement history. */
(function(){
  const K=window.KunActionsV23;if(!K)return;
  const today=()=>{const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()),g=t=>p.find(x=>x.type===t)?.value||'';return `${g('year')}-${g('month')}-${g('day')}`;};
  const signed=v=>{const n=Number(v)||0;return `${n>0?'+':''}${new Intl.NumberFormat('ar-EG').format(n)}`;};
  const dateTime=v=>{if(!v)return '—';try{return new Intl.DateTimeFormat('ar-EG',{timeZone:'Africa/Cairo',dateStyle:'short',timeStyle:'short'}).format(new Date(v));}catch{return K.esc(v);}};

  K.openStockAdjust=async()=>{
    const {cid,sid}=await K.scope(),q=`clientId=${encodeURIComponent(cid)}${sid?`&storeId=${encodeURIComponent(sid)}`:''}`;
    const [data,suppliers]=await Promise.all([K.api(`/api/state?${q}`),K.api(`/api/suppliers?${q}`).catch(()=>[])]),products=data.products||[];
    K.drawer('إضافة / تسوية مخزون',`<div class="card"><div class="v27-form">
      <label>المنتج<select class="select" id="v37StockProduct"><option value="">— اختر المنتج —</option>${products.map(p=>`<option value="${K.esc(p.id)}">${K.esc(p.name)} — المتاح ${K.money(p.stock)}</option>`).join('')}</select></label>
      <label>الكمية (+ إضافة / - خصم)<input class="input" id="v37StockDelta" type="number" step="1" placeholder="مثال: 50"></label>
      <label>تاريخ المخزون<input class="input" id="v37StockDate" type="date" value="${today()}"><div class="meta">تقدر تختار تاريخ التوريد الحقيقي حتى لو بتسجله اليوم.</div></label>
      <label>المورد (اختياري)<select class="select" id="v37StockSupplier"><option value="">بدون مورد محدد</option>${(Array.isArray(suppliers)?suppliers:[]).map(s=>`<option value="${K.esc(s.id)}">${K.esc(s.name)}</option>`).join('')}</select></label>
      <label class="wide">السبب / الملاحظة<input class="input" id="v37StockNote" placeholder="توريد جديد / تسوية / تلف / جرد..."></label>
    </div><div class="acc36-note mt">كل حركة هتتسجل بتاريخ المخزون المختار، مع وقت إدخالها الفعلي والمستخدم اللي سجلها.</div><button class="btn primary mt" id="v37ApplyStock">حفظ حركة المخزون</button></div>`);
    document.getElementById('v37ApplyStock').onclick=async()=>{const btn=document.getElementById('v37ApplyStock');try{const productId=K.val('v37StockProduct'),delta=Number(K.val('v37StockDelta')),stockDate=K.val('v37StockDate');if(!productId)throw new Error('اختر منتجًا');if(!Number.isFinite(delta)||delta===0)throw new Error('اكتب كمية غير صفرية');if(!stockDate)throw new Error('حدد تاريخ المخزون');btn.disabled=true;btn.textContent='جاري الحفظ...';await K.api('/api/inventory/stock-adjust',{method:'POST',body:JSON.stringify({clientId:cid,storeId:sid||undefined,productId,delta,stockDate,supplierId:K.val('v37StockSupplier')||undefined,note:K.val('v37StockNote')})});K.notify('تم تحديث المخزون وتسجيل التاريخ');K.refresh();}catch(e){K.notify(e.message);if(btn?.isConnected){btn.disabled=false;btn.textContent='حفظ حركة المخزون';}}};
  };

  async function loadInventoryHistory(){
    if(typeof view!=='undefined'&&view!=='inventory')return;const root=document.getElementById('root');if(!root||document.getElementById('v37InventoryHistory'))return;
    const card=document.createElement('section');card.id='v37InventoryHistory';card.className='card mt';card.innerHTML='<div class="title" style="font-size:18px">سجل إضافات المخزون</div><div class="sub">جارٍ تحميل حركات المخزون...</div>';root.appendChild(card);
    try{const {cid,sid}=await K.scope(),q=`clientId=${encodeURIComponent(cid)}${sid?`&storeId=${encodeURIComponent(sid)}`:''}`,d=await K.api(`/api/inventory/stock-log?${q}&limit=300`),rows=d.entries||[];card.innerHTML=`<div class="page-head"><div><div class="title" style="font-size:18px">سجل إضافات المخزون</div><div class="sub">تاريخ المخزون هو تاريخ التوريد/الحركة الذي تم اختياره، ووقت التسجيل يوضح متى تم إدخالها على Kun Online.</div></div><div class="spacer"></div><button class="btn primary" id="v37AddStockFromHistory">+ إضافة مخزون</button></div>${rows.length?`<div class="table-wrap"><table class="table compact"><thead><tr><th>تاريخ المخزون</th><th>المنتج</th><th>الكمية</th><th>الرصيد بعد الحركة</th><th>المورد</th><th>السبب</th><th>سجلها</th><th>وقت التسجيل</th></tr></thead><tbody>${rows.map(x=>`<tr><td><b>${K.esc(x.stock_date||String(x.created_at||'').slice(0,10)||'—')}</b></td><td>${K.esc(x.product_name||'—')}</td><td><b>${signed(x.delta)}</b></td><td>${K.money(x.new_stock)}</td><td>${K.esc(x.supplier_name||'—')}</td><td>${K.esc(x.note||'—')}</td><td>${K.esc(x.created_by||'—')}</td><td>${dateTime(x.created_at)}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">لسه مفيش حركات مخزون مسجلة.</div>'}`;document.getElementById('v37AddStockFromHistory')?.addEventListener('click',()=>K.openStockAdjust());}catch(e){card.innerHTML=`<div class="title" style="font-size:18px">سجل إضافات المخزون</div><div class="sub">${K.esc(e.message)}</div>`;}
  }

  if(typeof inventory==='function'){
    const baseInventory=inventory;
    inventory=function(){const html=baseInventory();queueMicrotask(loadInventoryHistory);return html;};
  }
  document.addEventListener('click',e=>{const b=e.target.closest?.('#stockAdjust');if(!b)return;e.preventDefault();e.stopImmediatePropagation();K.openStockAdjust().catch(err=>K.notify(err.message));},true);
  document.documentElement.dataset.inventoryV37='ready';
})();
