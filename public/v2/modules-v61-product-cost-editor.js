/* Kun Online v61.0 — visible product/variant cost editing from Products workspace. */
(function(){
  const K=window.KunActionsV23;if(!K)return;
  const esc=value=>K.esc?K.esc(value):String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const num=value=>Number.isFinite(Number(value))?Number(value):0;
  const money=value=>new Intl.NumberFormat('ar-EG',{maximumFractionDigits:2}).format(num(value));
  const optionText=variant=>Object.entries(variant?.optionValues||{}).map(([name,value])=>`${name}: ${value}`).join(' — ')||variant?.name||'المتغير';
  async function scope(){return K.scope();}
  async function loadCatalog(){const {cid,sid}=await scope(),query=`clientId=${encodeURIComponent(cid)}${sid?`&storeId=${encodeURIComponent(sid)}`:''}`,data=await K.api(`/api/catalog/products?${query}`);return {cid,sid,products:data.products||[]};}
  function entries(products){const out=[];for(const product of products){out.push({productId:product.id,variantId:null,name:product.name,label:'التكلفة الأساسية للمنتج',sku:product.sku||'',cost:num(product.cost)});for(const variant of (product.variants||[]).filter(item=>item.active!==false))out.push({productId:product.id,variantId:variant.id,name:product.name,label:optionText(variant),sku:variant.sku||product.sku||'',cost:num(variant.cost??product.cost),inherits:variant.cost===null||variant.cost===undefined});}return out;}
  async function saveRow(button,row,cid,sid){
    const input=row.querySelector('[data-v61-cost-input]'),cost=Number(input?.value);if(!Number.isFinite(cost)||cost<0){K.notify('اكتب تكلفة صحيحة');return;}
    const productId=button.dataset.productId,variantId=button.dataset.variantId||null,old=button.textContent;button.disabled=true;button.textContent='جاري الحفظ...';
    try{await K.api('/api/inventory/cost',{method:'PATCH',body:JSON.stringify({clientId:cid,storeId:sid||undefined,productId,variantId:variantId||undefined,cost})});row.querySelector('[data-v61-current]').textContent=`الحالية: ${money(cost)} EGP`;row.querySelector('[data-v61-inherits]')?.remove();K.notify('تم تحديث تكلفة المنتج');window.KunVariantInventoryV46?.refresh?.();}
    catch(error){K.notify(error.message);}finally{if(button.isConnected){button.disabled=false;button.textContent=old;}}
  }
  async function openCostManager(){
    try{
      const {cid,sid,products}=await loadCatalog(),rows=entries(products);
      K.drawer('تعديل تكاليف المنتجات والمتغيرات',`<div class="card"><div class="page-head"><div><div class="title">تكلفة المنتجات</div><div class="sub">عدّل تكلفة المنتج الأساسية أو تكلفة كل لون/مقاس بشكل مستقل. هذه التكلفة تدخل في قيمة المخزون وحساب الربحية.</div></div></div>${rows.length?`<div class="table-wrap"><table class="table compact"><thead><tr><th>المنتج</th><th>المتغير</th><th>SKU</th><th>التكلفة</th><th></th></tr></thead><tbody>${rows.map(item=>`<tr data-v61-cost-row><td><b>${esc(item.name)}</b></td><td>${esc(item.label)}${item.inherits?'<div class="meta" data-v61-inherits>كانت تستخدم تكلفة المنتج الأساسية</div>':''}</td><td>${esc(item.sku||'—')}</td><td><input class="input" data-v61-cost-input type="number" min="0" step="0.01" value="${esc(item.cost)}" style="min-width:110px"><div class="meta" data-v61-current>الحالية: ${money(item.cost)} EGP</div></td><td><button class="btn primary" data-v61-save data-product-id="${esc(item.productId)}" ${item.variantId?`data-variant-id="${esc(item.variantId)}"`:''}>حفظ التكلفة</button></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">لا توجد منتجات.</div>'}<div class="meta mt">مزامنة Easy Orders لا تستبدل تكلفة المنتج المحلية؛ هي تزامن سعر البيع والكميات فقط.</div></div>`);
      document.querySelectorAll('[data-v61-save]').forEach(button=>button.onclick=()=>saveRow(button,button.closest('[data-v61-cost-row]'),cid,sid));
    }catch(error){K.notify(error.message);}
  }
  function ensureButton(){
    if(typeof view!=='undefined'&&view!=='products')return;const root=document.getElementById('root');if(!root||document.getElementById('v61ProductCosts'))return;
    const anchor=root.querySelector('#newProduct')||root.querySelector('.page-head .spacer');if(!anchor)return;
    const button=document.createElement('button');button.id='v61ProductCosts';button.className='btn soft';button.type='button';button.textContent='تعديل التكاليف';button.title='تعديل تكلفة المنتج أو كل متغير بشكل مستقل';button.onclick=openCostManager;
    if(anchor.id==='newProduct')anchor.insertAdjacentElement('afterend',button);else anchor.after(button);
  }
  const root=document.getElementById('root');if(root)new MutationObserver(()=>queueMicrotask(ensureButton)).observe(root,{childList:true,subtree:false});
  document.addEventListener('click',event=>{if(event.target.closest?.('[data-view="products"]'))setTimeout(ensureButton,0);},true);
  queueMicrotask(ensureButton);
  window.KunProductCostEditorV61={open:openCostManager,refresh:ensureButton,version:'61.0'};
  document.documentElement.dataset.productCostEditorV61='ready';
})();
