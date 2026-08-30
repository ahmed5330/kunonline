/* Kun Online v46 — variant-first inventory + Easy Orders product/variant stock sync. */
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
        for(const variant of variants)rows.push({product,variant,stock:Math.max(0,num(variant.stock)),cost:num(variant.cost??product.cost),sku:variant.sku||product.sku||'',label:optionText(variant),low:threshold(variant,product)});
      }else{
        rows.push({product,variant:null,stock:Math.max(0,num(product.stock)),cost:num(product.cost),sku:product.sku||'',label:'بدون متغيرات',low:Math.max(0,num(product.lowStockThreshold??5))});
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
  function renderTable(rows){
    if(!rows.length)return '<div class="card empty">لا توجد منتجات أو متغيرات في المخزون حتى الآن.</div>';
    return `<div class="card table-wrap"><div class="page-head"><div><h3 style="margin:0">المخزون حسب المتغير</h3><div class="sub">كل لون / مقاس / اختيار يظهر بكمية مستقلة. إجمالي المنتج لا يُستخدم بدل كمية المتغير.</div></div></div><table class="table compact"><thead><tr><th>المنتج</th><th>المتغير</th><th>SKU</th><th>المتاح</th><th>حد التنبيه</th><th>تكلفة الوحدة</th><th>قيمة المخزون</th><th>الحالة</th><th></th></tr></thead><tbody>${rows.map(row=>{const [cls,label]=stockState(row);return `<tr><td><b>${esc(row.product.name)}</b></td><td>${row.variant?`<b>${esc(row.label)}</b>`:'<span class="meta">بدون متغيرات</span>'}</td><td>${esc(row.sku||'—')}</td><td><b>${money(row.stock)}</b></td><td>${money(row.low)}</td><td>${money(row.cost)} EGP</td><td>${money(row.stock*row.cost)} EGP</td><td><span class="stock ${cls}">${label}</span></td><td><button class="btn soft" data-v46-adjust="1" data-product-id="${esc(row.product.id)}" ${row.variant?`data-variant-id="${esc(row.variant.id)}"`:''}>تسوية</button></td></tr>`;}).join('')}</tbody></table></div><div class="card"><h3>تنبيهات المتغيرات</h3>${rows.filter(row=>row.stock<=row.low).slice(0,8).map(row=>`<div class="insight ${row.stock<=0?'danger':'warn'}"><b>${esc(row.product.name)} — ${esc(row.label)}</b><div class="meta">المتاح ${money(row.stock)} — حد التنبيه ${money(row.low)}</div></div>`).join('')||'<div class="insight ok">لا توجد متغيرات منخفضة حاليًا.</div>'}</div>`;
  }
  async function easyOrdersProvider(){
    const {cid,sid}=await scope(),q=`clientId=${encodeURIComponent(cid)}${sid?`&storeId=${encodeURIComponent(sid)}`:''}`;
    const providers=await K.api(`/api/commerce/product-import/providers?${q}`).catch(()=>[]);
    return (providers||[]).find(item=>item.provider==='easyorders')||null;
  }
  async function syncEasyOrders(button){
    const provider=await easyOrdersProvider();
    if(!provider)throw new Error('ربط Easy Orders غير موجود أو لا يملك صلاحية قراءة المنتجات');
    const {cid,sid}=await scope();
    const old=button?.textContent;if(button){button.disabled=true;button.textContent='جاري مزامنة Easy Orders...';}
    try{
      const result=await K.api('/api/commerce/product-import',{method:'POST',body:JSON.stringify({clientId:cid,storeId:sid||undefined,provider:'easyorders',selectionMode:'all'})});
      catalogPromise=null;
      K.notify(`تمت مزامنة Easy Orders: ${num(result.created)} جديد، ${num(result.updated)} تحديث`);
      await enhanceInventory(true);
    }finally{if(button?.isConnected){button.disabled=false;button.textContent=old||'مزامنة Easy Orders';}}
  }
  async function ensureSyncButton(root){
    if(document.getElementById('v46EasyOrdersSync'))return;
    const head=root.querySelector('.page-head .spacer');if(!head)return;
    const button=document.createElement('button');button.id='v46EasyOrdersSync';button.className='btn soft';button.textContent='مزامنة Easy Orders';button.title='سحب المنتجات والمتغيرات وكميات كل متغير من Easy Orders';
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
  window.KunVariantInventoryV46={refresh:()=>enhanceInventory(true),syncEasyOrders:()=>syncEasyOrders(document.getElementById('v46EasyOrdersSync')),version:'46.0'};
  document.documentElement.dataset.variantInventoryV46='ready';
})();
