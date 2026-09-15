/* Kun Online v46.3 — variant-first inventory + governed Easy Orders cost review + inline selling-price and cost edit. */
(function(){
  const K=window.KunActionsV23;if(!K)return;
  let catalogPromise=null;
  const esc=value=>K.esc?K.esc(value):String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const num=value=>Number.isFinite(Number(value))?Number(value):0;
  const money=value=>new Intl.NumberFormat('ar-EG',{maximumFractionDigits:2}).format(num(value));
  const optionText=variant=>Object.entries(variant?.optionValues||{}).map(([name,value])=>`${name}: ${value}`).join(' — ')||variant?.name||'المتغير الأساسي';
  const threshold=(variant,product)=>Math.max(0,num(variant?.lowStockThreshold??product?.lowStockThreshold??5));

  async function scope(){return K.scope();}
  async function catalog(force=false){
    if(force)catalogPromise=null;
    if(catalogPromise)return catalogPromise;
    catalogPromise=(async()=>{
      const {cid,sid}=await scope(),q=`clientId=${encodeURIComponent(cid)}${sid?`&storeId=${encodeURIComponent(sid)}`:''}`;
      const data=await K.api(`/api/catalog/products?${q}`);
      return data.products||[];
    })().catch(error=>{catalogPromise=null;throw error;});
    return catalogPromise;
  }
  function inventoryRows(products){
    const rows=[];
    for(const product of products){
      const variants=(product.variants||[]).filter(item=>item.active!==false);
      if(variants.length){
        for(const variant of variants)rows.push({product,variant,stock:Math.max(0,num(variant.stock)),cost:num(variant.cost??product.cost),price:num(variant.price??product.price),compareAtPrice:variant.compareAtPrice??product.compareAtPrice??null,sku:variant.sku||product.sku||'',label:optionText(variant),low:threshold(variant,product)});
      }else{
        rows.push({product,variant:null,stock:Math.max(0,num(product.stock)),cost:num(product.cost),price:num(product.price),compareAtPrice:product.compareAtPrice??null,sku:product.sku||'',label:'بدون متغيرات',low:Math.max(0,num(product.lowStockThreshold??5))});
      }
    }
    return rows;
  }
  function stockState(row){return row.stock<=0?['danger','نفد']:row.stock<=row.low?['warn','منخفض']:['ok','جيد'];}
  function updateKpis(root,rows){
    const values=root.querySelectorAll('.grid.kpis .k-val');
    if(values.length<4)return;
    const units=rows.reduce((sum,row)=>sum+row.stock,0),value=rows.reduce((sum,row)=>sum+(row.stock*row.cost),0),low=rows.filter(row=>row.stock>0&&row.stock<=row.low).length,out=rows.filter(row=>row.stock<=0).length;
    values[0].textContent=money(units);values[1].textContent=`${money(value)} EGP`;values[2].textContent=money(low);values[3].textContent=money(out);
  }
  function priceCell(row){
    const compare=num(row.compareAtPrice),hasDiscount=compare>row.price;
    return `<div data-v46-price-display="1"><b>${money(row.price)} EGP</b>${hasDiscount?`<div class="meta"><s>${money(compare)} EGP</s> قبل الخصم</div>`:''}<button class="btn soft" style="margin-top:6px;padding:5px 9px" data-v46-price-edit="1" data-product-id="${esc(row.product.id)}" ${row.variant?`data-variant-id="${esc(row.variant.id)}"`:''} data-price="${esc(row.price)}">تعديل السعر</button></div>`;
  }
  function costCell(row){
    return `<div data-v46-cost-display="1"><b>${money(row.cost)} EGP</b><button class="btn soft" style="margin-top:6px;padding:5px 9px" data-v46-cost-edit="1" data-product-id="${esc(row.product.id)}" ${row.variant?`data-variant-id="${esc(row.variant.id)}"`:''} data-cost="${esc(row.cost)}">تعديل التكلفة</button></div>`;
  }
  function renderTable(rows){
    if(!rows.length)return '<div class="card empty">لا توجد منتجات أو متغيرات في المخزون حتى الآن.</div>';
    return `<div class="card table-wrap"><div class="page-head"><div><h3 style="margin:0">المخزون حسب المتغير</h3><div class="sub">كل لون / مقاس / اختيار يظهر بكمية مستقلة. سعر Easy Orders المعتمد هو سعر البيع بعد الخصم، وإن لم يوجد خصم يُستخدم السعر الأصلي.</div><div class="meta" style="margin-top:4px">يمكن تعديل سعر البيع وتكلفة الوحدة من هنا. زر مزامنة Easy Orders يفتح أولًا شاشة مراجعة داخل السيستم لإدخال التكاليف المطلوبة قبل تحديث المخزون.</div></div></div><table class="table compact"><thead><tr><th>المنتج</th><th>المتغير</th><th>SKU</th><th>سعر البيع</th><th>المتاح</th><th>حد التنبيه</th><th>تكلفة الوحدة</th><th>قيمة المخزون</th><th>الحالة</th><th></th></tr></thead><tbody>${rows.map(row=>{const [cls,label]=stockState(row);return `<tr><td><b>${esc(row.product.name)}</b></td><td>${row.variant?`<b>${esc(row.label)}</b>`:'<span class="meta">بدون متغيرات</span>'}</td><td>${esc(row.sku||'—')}</td><td data-v46-price-cell="1">${priceCell(row)}</td><td><b>${money(row.stock)}</b></td><td>${money(row.low)}</td><td data-v46-cost-cell="1">${costCell(row)}</td><td>${money(row.stock*row.cost)} EGP</td><td><span class="stock ${cls}">${label}</span></td><td><button class="btn soft" data-v46-adjust="1" data-product-id="${esc(row.product.id)}" ${row.variant?`data-variant-id="${esc(row.variant.id)}"`:''}>تسوية</button></td></tr>`;}).join('')}</tbody></table></div><div class="card"><h3>تنبيهات المتغيرات</h3>${rows.filter(row=>row.stock<=row.low).slice(0,8).map(row=>`<div class="insight ${row.stock<=0?'danger':'warn'}"><b>${esc(row.product.name)} — ${esc(row.label)}</b><div class="meta">المتاح ${money(row.stock)} — حد التنبيه ${money(row.low)}</div></div>`).join('')||'<div class="insight ok">لا توجد متغيرات منخفضة حاليًا.</div>'}</div>`;
  }
  async function easyOrdersProvider(){
    const {cid,sid}=await scope(),q=`clientId=${encodeURIComponent(cid)}${sid?`&storeId=${encodeURIComponent(sid)}`:''}`;
    const providers=await K.api(`/api/commerce/product-import/providers?${q}`).catch(()=>[]);
    return (providers||[]).find(item=>item.provider==='easyorders')||null;
  }
  async function syncEasyOrders(button){
    const provider=await easyOrdersProvider();
    if(!provider)throw new Error('ربط Easy Orders غير موجود أو لا يملك صلاحية قراءة المنتجات');
    const review=window.KunCommerceProductImportV29;
    if(!review?.open)throw new Error('شاشة مراجعة تكاليف Easy Orders غير جاهزة. حدّث الصفحة وحاول مرة أخرى.');
    const old=button?.textContent;if(button){button.disabled=true;button.textContent='جاري فتح مراجعة التكاليف...';}
    try{
      const opened=await review.open('easyorders');
      if(!opened)throw new Error('تعذر فتح شاشة مراجعة منتجات Easy Orders');
    }finally{if(button?.isConnected){button.disabled=false;button.textContent=old||'مزامنة Easy Orders';}}
  }
  async function savePrice(button){
    const cell=button.closest('[data-v46-price-cell]');if(!cell)return;
    const original=num(button.dataset.price),productId=button.dataset.productId,variantId=button.dataset.variantId||null;
    cell.innerHTML=`<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><input class="input" type="number" min="0" step="0.01" data-v46-price-input value="${esc(original)}" style="width:115px"><button class="btn primary" data-v46-price-save>حفظ</button><button class="btn soft" data-v46-price-cancel>إلغاء</button></div>`;
    const input=cell.querySelector('[data-v46-price-input]');input?.focus();input?.select();
    cell.querySelector('[data-v46-price-cancel]').onclick=()=>enhanceInventory(true).catch(error=>K.notify(error.message));
    cell.querySelector('[data-v46-price-save]').onclick=async()=>{
      const price=Number(input?.value);if(!Number.isFinite(price)||price<0){K.notify('اكتب سعر بيع صحيح');return;}
      const save=cell.querySelector('[data-v46-price-save]');if(save){save.disabled=true;save.textContent='جاري الحفظ...';}
      try{
        const {cid,sid}=await scope();
        await K.api('/api/inventory/price',{method:'PATCH',body:JSON.stringify({clientId:cid,storeId:sid||undefined,productId,variantId:variantId||undefined,price})});
        catalogPromise=null;K.notify('تم تحديث سعر البيع');await enhanceInventory(true);
      }catch(error){K.notify(error.message);if(save){save.disabled=false;save.textContent='حفظ';}}
    };
  }
  async function saveCost(button){
    const cell=button.closest('[data-v46-cost-cell]');if(!cell)return;
    const original=num(button.dataset.cost),productId=button.dataset.productId,variantId=button.dataset.variantId||null;
    cell.innerHTML=`<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><input class="input" type="number" min="0" step="0.01" data-v46-cost-input value="${esc(original)}" style="width:115px"><button class="btn primary" data-v46-cost-save>حفظ</button><button class="btn soft" data-v46-cost-cancel>إلغاء</button></div>`;
    const input=cell.querySelector('[data-v46-cost-input]');input?.focus();input?.select();
    cell.querySelector('[data-v46-cost-cancel]').onclick=()=>enhanceInventory(true).catch(error=>K.notify(error.message));
    cell.querySelector('[data-v46-cost-save]').onclick=async()=>{
      const cost=Number(input?.value);if(!Number.isFinite(cost)||cost<0){K.notify('اكتب تكلفة صحيحة');return;}
      const save=cell.querySelector('[data-v46-cost-save]');if(save){save.disabled=true;save.textContent='جاري الحفظ...';}
      try{
        const {cid,sid}=await scope();
        await K.api('/api/inventory/cost',{method:'PATCH',body:JSON.stringify({clientId:cid,storeId:sid||undefined,productId,variantId:variantId||undefined,cost})});
        catalogPromise=null;K.notify('تم تحديث تكلفة الوحدة');await enhanceInventory(true);
      }catch(error){K.notify(error.message);if(save){save.disabled=false;save.textContent='حفظ';}}
    };
  }
  async function ensureSyncButton(root){
    if(document.getElementById('v46EasyOrdersSync'))return;
    const head=root.querySelector('.page-head .spacer');if(!head)return;
    const button=document.createElement('button');button.id='v46EasyOrdersSync';button.className='btn soft';button.textContent='مزامنة Easy Orders';button.title='راجع التكاليف داخل السيستم ثم اسحب المنتجات والمتغيرات والكميات وسعر البيع من Easy Orders';
    button.onclick=()=>syncEasyOrders(button).catch(error=>K.notify(error.message));head.after(button);
  }
  async function enhanceInventory(force=false){
    if(typeof view!=='undefined'&&view!=='inventory')return;
    const root=document.getElementById('root');if(!root)return;
    document.getElementById('pcVariantInventory')?.remove();
    await ensureSyncButton(root);
    const split=root.querySelector('.grid.split');if(!split)return;
    if(force||!split.dataset.v46Loading){split.dataset.v46Loading='1';split.innerHTML='<div class="card empty">جارٍ تحميل مخزون المتغيرات...</div>';}
    try{
      const products=await catalog(force),rows=inventoryRows(products);
      if(typeof view!=='undefined'&&view!=='inventory')return;
      updateKpis(root,rows);split.innerHTML=renderTable(rows);split.dataset.v46Ready='1';
      split.querySelectorAll('[data-v46-adjust]').forEach(button=>button.onclick=()=>K.openStockAdjust?.({productId:button.dataset.productId,variantId:button.dataset.variantId||null}));
      split.querySelectorAll('[data-v46-price-edit]').forEach(button=>button.onclick=()=>savePrice(button));
      split.querySelectorAll('[data-v46-cost-edit]').forEach(button=>button.onclick=()=>saveCost(button));
      document.getElementById('pcVariantInventory')?.remove();
    }catch(error){split.innerHTML=`<div class="card empty"><b>تعذر تحميل مخزون المتغيرات</b><div class="sub">${esc(error.message)}</div></div>`;}
  }

  if(typeof inventory==='function'){
    const baseInventory=inventory;
    inventory=function(){const html=baseInventory();queueMicrotask(()=>enhanceInventory(false));return html;};
  }
  document.addEventListener('click',event=>{
    const button=event.target.closest?.('#v46EasyOrdersSync');if(!button)return;event.preventDefault();event.stopImmediatePropagation();syncEasyOrders(button).catch(error=>K.notify(error.message));
  },true);
  window.KunVariantInventoryV46={refresh:()=>enhanceInventory(true),syncEasyOrders:()=>syncEasyOrders(document.getElementById('v46EasyOrdersSync')),version:'46.3'};
  document.documentElement.dataset.variantInventoryV46='ready';
})();