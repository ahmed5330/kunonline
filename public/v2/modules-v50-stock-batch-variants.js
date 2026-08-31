/* Kun Online v50.1 — compact variant-aware stock batch entry with bulk quantity fill. */
(function(){
  const K=window.KunActionsV23;if(!K)return;
  const today=()=>{const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()),g=t=>p.find(x=>x.type===t)?.value||'';return `${g('year')}-${g('month')}-${g('day')}`;};
  const num=value=>Number.isFinite(Number(value))?Number(value):0;
  const qs=(cid,sid)=>`clientId=${encodeURIComponent(cid)}${sid?`&storeId=${encodeURIComponent(sid)}`:''}`;
  function ensureStyles(){
    if(document.getElementById('v50StockBatchStyles'))return;
    const style=document.createElement('style');
    style.id='v50StockBatchStyles';
    style.textContent=`
      #drawer:has(.v50-stock-batch-drawer){width:min(1040px,96vw)}
      .v50-stock-batch-drawer{min-width:0}
      .v50-stock-batch-drawer .v50-batch-wrap{overflow-x:hidden}
      .v50-stock-batch-drawer .v50-batch-table{width:100%;min-width:0!important;table-layout:fixed}
      .v50-stock-batch-drawer .v50-batch-table th,.v50-stock-batch-drawer .v50-batch-table td{padding:10px 12px;vertical-align:middle;white-space:normal;overflow-wrap:anywhere}
      .v50-stock-batch-drawer .v50-batch-table th:nth-child(1),.v50-stock-batch-drawer .v50-batch-table td:nth-child(1){width:58%}
      .v50-stock-batch-drawer .v50-batch-table th:nth-child(2),.v50-stock-batch-drawer .v50-batch-table td:nth-child(2){width:17%;text-align:center;white-space:nowrap}
      .v50-stock-batch-drawer .v50-batch-table th:nth-child(3),.v50-stock-batch-drawer .v50-batch-table td:nth-child(3){width:25%;text-align:center}
      .v50-stock-batch-drawer .v50-batch-table [data-v50-batch-qty]{width:100%;max-width:145px;min-width:76px;margin-inline:auto;text-align:center;padding:8px 10px}
      .v50-stock-batch-drawer .v50-product-name{display:block;line-height:1.45}
      .v50-stock-batch-drawer .v50-variant-name{margin-top:3px;font-size:11px;line-height:1.45}
      .v50-bulk-bar{display:grid;grid-template-columns:minmax(220px,1fr) 130px auto auto;gap:9px;align-items:center;margin-top:14px;padding:11px 12px;border:1px solid var(--line);border-radius:12px;background:var(--bg,#f7f9fc)}
      .v50-bulk-copy{min-width:0}
      .v50-bulk-copy b{display:block;font-size:12px}
      .v50-bulk-copy span{display:block;margin-top:2px;color:var(--muted);font-size:10px;line-height:1.45}
      .v50-bulk-bar .input{min-width:0;text-align:center}
      .v50-bulk-bar .btn{white-space:nowrap}
      .v50-batch-count{display:inline-flex;align-items:center;margin-inline-start:7px;padding:3px 7px;border-radius:999px;background:#eef5fd;color:var(--blue);font-size:10px;font-weight:800}
      @media(max-width:720px){
        #drawer:has(.v50-stock-batch-drawer){width:96vw;padding:14px}
        .v50-bulk-bar{grid-template-columns:1fr 105px;gap:7px}
        .v50-bulk-copy{grid-column:1/-1}
        .v50-bulk-bar .btn{padding:9px 8px;font-size:11px}
        .v50-stock-batch-drawer .v50-batch-table th,.v50-stock-batch-drawer .v50-batch-table td{padding:8px 6px;font-size:11px}
        .v50-stock-batch-drawer .v50-batch-table th:nth-child(1),.v50-stock-batch-drawer .v50-batch-table td:nth-child(1){width:54%}
        .v50-stock-batch-drawer .v50-batch-table th:nth-child(2),.v50-stock-batch-drawer .v50-batch-table td:nth-child(2){width:17%}
        .v50-stock-batch-drawer .v50-batch-table th:nth-child(3),.v50-stock-batch-drawer .v50-batch-table td:nth-child(3){width:29%}
        .v50-stock-batch-drawer .v50-batch-table [data-v50-batch-qty]{min-width:58px;padding:7px 5px}
        .v50-stock-batch-drawer .v50-variant-name{font-size:10px}
      }
    `;
    document.head.appendChild(style);
  }
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
    return `<tr data-v50-batch-row="1"><td><b class="v50-product-name">${K.esc(row.productName)}</b><div class="meta v50-variant-name"><b>${K.esc(row.variantLabel)}</b>${row.sku?` · SKU: ${K.esc(row.sku)}`:''}</div></td><td><b>${K.money(row.stock)}</b></td><td><input class="input" type="number" min="0" step="1" inputmode="numeric" value="0" aria-label="الكمية الجديدة لـ ${K.esc(row.productName)} ${K.esc(row.variantLabel)}" data-v50-batch-qty="1" data-v50-product-id="${K.esc(row.productId)}" ${row.variantId?`data-v50-variant-id="${K.esc(row.variantId)}"`:''}></td></tr>`;
  }
  async function openVariantStockBatch(){
    ensureStyles();
    const {cid,sid}=await K.scope();
    if(!sid)throw new Error('اختار متجرًا من أعلى قبل إضافة استوك جديد');
    const data=await K.api(`/api/catalog/products?${qs(cid,sid)}`),rows=rowsFromCatalog(data.products||[]);
    K.drawer('إضافة استوك جديد',`<div class="v50-stock-batch-drawer"><div class="card"><div class="v27-form">
      <label>اسم/تسمية الاستوك<input class="input" id="v50BatchName" placeholder="مثال: أول استوك"></label>
      <label>تاريخ إضافة المخزون<input class="input" id="v50BatchDate" type="date" value="${today()}"><div class="meta">ينفع تختار تاريخ قديم لو البضاعة دخلت قبل يوم التسجيل.</div></label>
      <label class="wide">ملاحظة (اختياري)<input class="input" id="v50BatchNote" placeholder="المورد / رقم الفاتورة / أي ملاحظة"></label>
    </div></div>
    <div class="card mt"><h3>كميات المنتجات والمتغيرات داخل هذا الاستوك <span class="v50-batch-count">${rows.length} صف</span></h3><div class="sub">كل لون / مقاس / متغير من Easy Orders يظهر بكمية مستقلة. الأعمدة الثلاثة ظاهرة معًا، وتقدر تدخل الكمية لكل سطر أو تطبق نفس الكمية على الكل مرة واحدة.</div>
      <div class="v50-bulk-bar">
        <div class="v50-bulk-copy"><b>إضافة نفس الكمية للكل</b><span>اكتب الكمية مرة واحدة ثم اضغط تطبيق على الكل. بعد التطبيق تقدر تعدّل أي منتج أو متغير بشكل منفصل.</span></div>
        <input class="input" id="v50BulkQty" type="number" min="0" step="1" inputmode="numeric" placeholder="الكمية" aria-label="الكمية الموحدة لكل المنتجات والمتغيرات">
        <button class="btn soft" id="v50ApplyAll" type="button">تطبيق على الكل</button>
        <button class="btn soft" id="v50ClearAll" type="button">تصفير الكل</button>
      </div>
      <div class="table-wrap mt v50-batch-wrap"><table class="table compact v50-batch-table"><colgroup><col style="width:58%"><col style="width:17%"><col style="width:25%"></colgroup><thead><tr><th>المنتج / المتغير</th><th>المتاح حاليًا</th><th>الكمية الجديدة</th></tr></thead><tbody>${rows.map(rowHtml).join('')||'<tr><td colspan="3" class="empty">لا توجد منتجات أو متغيرات. شغّل مزامنة Easy Orders من قسم المخزون أولًا.</td></tr>'}</tbody></table></div>
      <button class="btn primary mt" id="v50SaveBatch">حفظ الاستوك والكميات</button>
    </div></div>`);
    const btn=document.getElementById('v50SaveBatch');
    if(!btn)return;
    const qtyInputs=()=>[...document.querySelectorAll('[data-v50-batch-qty]')];
    const bulk=document.getElementById('v50BulkQty'),apply=document.getElementById('v50ApplyAll'),clear=document.getElementById('v50ClearAll');
    if(apply)apply.onclick=()=>{
      const value=Number(bulk?.value);
      if(!Number.isInteger(value)||value<0){K.notify('اكتب كمية صحيحة صفر أو أكبر');return;}
      const inputs=qtyInputs();inputs.forEach(input=>{input.value=String(value);});
      K.notify(`تم تطبيق كمية ${value} على ${inputs.length} صف`);
    };
    if(bulk)bulk.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();apply?.click();}});
    if(clear)clear.onclick=()=>{
      qtyInputs().forEach(input=>{input.value='0';});
      if(bulk)bulk.value='';
      K.notify('تم تصفير كل الكميات الجديدة');
    };
    btn.onclick=async()=>{
      try{
        const name=K.val('v50BatchName').trim(),stockDate=K.val('v50BatchDate');
        const items=qtyInputs().map(input=>({productId:input.dataset.v50ProductId,...(input.dataset.v50VariantId?{variantId:input.dataset.v50VariantId}:{}),qty:Number(input.value)})).filter(item=>Number.isFinite(item.qty)&&item.qty>0);
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
  window.KunStockBatchVariantsV50={open:openVariantStockBatch,rowsFromCatalog,version:'50.1'};
  document.documentElement.dataset.stockBatchVariants='v50-ready';
})();
