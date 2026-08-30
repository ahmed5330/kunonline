/* Kun Online v50 — variant-aware named stock batch entry. */
(function(){
  const K=window.KunActionsV23;if(!K)return;
  const today=()=>{const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()),g=t=>p.find(x=>x.type===t)?.value||'';return `${g('year')}-${g('month')}-${g('day')}`;};
  const num=value=>Number.isFinite(Number(value))?Number(value):0;
  const qs=(cid,sid)=>`clientId=${encodeURIComponent(cid)}${sid?`&storeId=${encodeURIComponent(sid)}`:''}`;
  const optionText=variant=>{
    const values=variant?.optionValues;
    if(values&&typeof values==='object'&&!Array.isArray(values)){
      const parts=Object.entries(values).filter(([,value])=>String(value??'').trim()).map(([name,value])=>`${name}: ${value}`);
      if(parts.length)return parts.join(' — ');
    }
    if(Array.isArray(values)){
      const parts=values.map(item=>typeof item==='string'?item:(item?.value||item?.name||'')).filter(Boolean);
      if(parts.length)return parts.join(' — ');
    }
    return String(variant?.name||'المتغير الأساسي').trim()||'المتغير الأساسي';
  };
  function rowsFromCatalog(products){
    const rows=[];
    for(const product of products||[]){
      if(product?.active===false)continue;
      const variants=(product?.variants||[]).filter(variant=>variant?.active!==false);
      if(variants.length){
        for(const variant of variants)rows.push({productId:product.id,variantId:variant.id,productName:product.name||'',variantLabel:optionText(variant),sku:variant.sku||product.sku||'',stock:Math.max(0,num(variant.stock))});
      }else rows.push({productId:product.id,variantId:null,productName:product.name||'',variantLabel:'بدون متغيرات',sku:product.sku||'',stock:Math.max(0,num(product.stock))});
    }
    return rows;
  }
  function rowHtml(row){
    return `<tr data-v50-batch-row="1"><td><b>${K.esc(row.productName)}</b><div class="meta" style="margin-top:4px"><b>${K.esc(row.variantLabel)}</b>${row.sku?` · SKU: ${K.esc(row.sku)}`:''}</div></td><td><b>${K.money(row.stock)}</b></td><td><input class="input" type="number" min="0" step="1" inputmode="numeric" value="0" data-v50-batch-qty="1" data-v50-product-id="${K.esc(row.productId)}" ${row.variantId?`data-v50-variant-id="${K.esc(row.variantId)}"`:''}></td></tr>`;
  }
  async function openVariantStockBatch(){
    const {cid,sid}=await K.scope();
    if(!sid)throw new Error('اختار متجرًا من أعلى قبل إضافة استوك جديد');
    const data=await K.api(`/api/catalog/products?${qs(cid,sid)}`),rows=rowsFromCatalog(data.products||[]);
    K.drawer('إضافة استوك جديد',`<div class="card"><div class="v27-form">
      <label>اسم/تسمية الاستوك<input class="input" id="v50BatchName" placeholder="مثال: أول استوك"></label>
      <label>تاريخ إضافة المخزون<input class="input" id="v50BatchDate" type="date" value="${today()}"><div class="meta">ينفع تختار تاريخ قديم لو البضاعة دخلت قبل يوم التسجيل.</div></label>
      <label class="wide">ملاحظة (اختياري)<input class="input" id="v50BatchNote" placeholder="المورد / رقم الفاتورة / أي ملاحظة"></label>
    </div></div>
    <div class="card mt"><h3>كميات المنتجات والمتغيرات داخل هذا الاستوك</h3><div class="sub">كل لون / مقاس / متغير من Easy Orders يظهر كسطر مستقل بكمية مستقلة. اكتب فقط الكمية التي أضيفت في هذه الدفعة؛ السطر الذي تتركه صفر لن يدخل في الاستوك.</div><div class="table-wrap mt"><table class="table compact"><thead><tr><th>المنتج / المتغير</th><th>المتاح حاليًا</th><th>الكمية الجديدة</th></tr></thead><tbody>${rows.map(rowHtml).join('')||'<tr><td colspan="3" class="empty">لا توجد منتجات أو متغيرات. شغّل مزامنة Easy Orders من قسم المخزون أولًا.</td></tr>'}</tbody></table></div><button class="btn primary mt" id="v50SaveBatch">حفظ الاستوك والكميات</button></div>`);
    const btn=document.getElementById('v50SaveBatch');
    if(!btn)return;
    btn.onclick=async()=>{
      try{
        const name=K.val('v50BatchName').trim(),stockDate=K.val('v50BatchDate');
        const items=[...document.querySelectorAll('[data-v50-batch-qty]')].map(input=>({productId:input.dataset.v50ProductId,...(input.dataset.v50VariantId?{variantId:input.dataset.v50VariantId}:{}),qty:Number(input.value)})).filter(item=>Number.isFinite(item.qty)&&item.qty>0);
        if(!name)throw new Error('اكتب اسم/تسمية الاستوك');
        if(!stockDate)throw new Error('حدد تاريخ إضافة المخزون');
        if(!items.length)throw new Error('اكتب كمية لمتغير أو منتج واحد على الأقل');
        btn.disabled=true;btn.textContent='جاري الحفظ...';
        await K.api('/api/inventory/batches',{method:'POST',body:JSON.stringify({clientId:cid,storeId:sid,name,stockDate,note:K.val('v50BatchNote'),items})});
        K.notify(`تم إضافة الاستوك: ${name}`);K.refresh();
      }catch(error){K.notify(error.message);if(btn?.isConnected){btn.disabled=false;btn.textContent='حفظ الاستوك والكميات';}}
    };
  }
  document.addEventListener('click',event=>{
    const trigger=event.target.closest?.('#v39NewBatch,#v39NewBatchInside');
    if(!trigger)return;
    event.preventDefault();event.stopImmediatePropagation();
    openVariantStockBatch().catch(error=>K.notify(error.message));
  },true);
  window.KunStockBatchVariantsV50={open:openVariantStockBatch,rowsFromCatalog,version:'50.0'};
  document.documentElement.dataset.stockBatchVariants='v50-ready';
})();
