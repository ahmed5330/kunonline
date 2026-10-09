/* Kun Online v134 — optional bundle component picker in Easy Orders product import. */
(function(){
  'use strict';
  const K=window.KunActionsV23;if(!K)return;
  let catalog=[],mappings={},drafts=Object.create(null),dirty=false,ready=false,items=[];
  const el=id=>document.getElementById(id),esc=v=>K.esc(v);
  const notify=x=>K.notify(x);
  const renderButton=(id)=>{
    const btn=[...document.querySelectorAll('.commerceBundleEdit')].find(b=>b.dataset.bundleId===id);
    if(!btn)return;
    const list=Object.prototype.hasOwnProperty.call(drafts,id)?drafts[id]:mappings[id]?.components;
    btn.textContent=Object.prototype.hasOwnProperty.call(drafts,id)?list.length?'باندل مُعدّل ('+list.length+')':'منتج عادي — فك الربط':list?.length?'مربوط ('+list.length+' مكونات)':'ربط مكونات';
  };
  const updateSync=()=>{if(dirty){const b=el('syncCommerceProducts');if(b)b.disabled=true;}};
  const componentLine=(allowed,part={})=>'<div class="bun134-line" style="display:grid;grid-template-columns:minmax(150px,1fr) 80px auto;gap:6px;align-items:center;margin:6px 0">'+
    '<select class="input bun134-product" aria-label="المكون من المخزون">'+
    '<option value="">اختر المكون</option>'+allowed.map(p=>'<option value="'+esc(p.id)+'"'+(part.productId===p.id?' selected':'')+'>'+esc(p.name+' ('+(p.sku||p.id)+')')+'</option>').join('')+'</select>'+
    '<input type="number" min="1" max="1000" step="1" class="input bun134-qty" aria-label="الكمية لكل باندل" value="'+(Number(part.quantity)||1)+'">'+
    '<button type="button" class="btn soft bun134-remove" aria-label="حذف مكون">×</button></div>';
  function open(id){
    if(!ready){notify('حدد متجرًا صحيحًا ليتم تحميل قطع المخزون أولًا.');return;}
    const parent=items.find(x=>String(x.externalId)===id),host=el('commerceBundleEditor');
    if(!parent||!host)return;
    const allowed=catalog.filter(p=>p.id!==(parent.existingId||parent.id)&&p.id!==parent.id);
    if(!allowed.length){notify('لا توجد قطع مناسبة داخل مخزون المتجر بعد.');return;}
    const components=Object.prototype.hasOwnProperty.call(drafts,id)?drafts[id]:mappings[id]?.components||[];
    host.dataset.externalId=id;
    host.innerHTML='<div class="card" style="border:2px solid var(--line,#d9e2ed);padding:15px">'+
      '<h3 style="margin:0">مكونات '+esc(parent.name)+'</h3>'+
      '<p class="sub">الربط داخلي في كن أونلاين. لن يتغير المنتج على Easy Orders. كل مكون لازم يكون موجودًا في مخزون نفس المتجر.</p>'+
      '<div id="bun134Lines">'+(components.length?components.map(x=>componentLine(allowed,x)).join(''):componentLine(allowed))+'</div>'+
      '<div class="toolbar mt"><button type="button" class="btn soft" id="bun134Add">+ مكون</button>'+
      '<button type="button" class="btn primary" id="bun134Stage">اعتماد المكونات للاستيراد</button>'+
      '<button type="button" class="btn soft" id="bun134Unlink">إرجاع لمنتج عادي</button>'+
      '<button type="button" class="btn soft" id="bun134Close">إغلاق</button></div>'+
      '<div class="sub" id="bun134Notice">المكونات لا تُحفظ إلا بعد بدء الاستيراد.</div></div>';
    dirty=false;
    const lines=el('bun134Lines');
    const markDirty=()=>{dirty=true;el('bun134Notice').textContent='فيه تغييرات غير معتمدة. اعتمد المكونات أولًا.';updateSync();};
    lines.addEventListener('input',markDirty);lines.addEventListener('change',markDirty);
    lines.addEventListener('click',e=>{if(e.target.closest('.bun134-remove')){e.target.closest('.bun134-line').remove();markDirty();}});
    el('bun134Add').onclick=()=>{lines.insertAdjacentHTML('beforeend',componentLine(allowed));markDirty();};
    el('bun134Stage').onclick=()=>{
      const rows=[...lines.querySelectorAll('.bun134-line')],seen=new Set(),parts=[];
      if(!rows.length)return notify('أضف مكونًا أو اختر «إرجاع لمنتج عادي».');
      for(const row of rows){
        const productId=row.querySelector('.bun134-product').value,quantity=Number(row.querySelector('.bun134-qty').value);
        if(!productId||!Number.isSafeInteger(quantity)||quantity<1||quantity>1000)return notify('اختار المنتج واكتب كمية صحيحة (1 إلى 1000).');
        if(seen.has(productId))return notify('نفس المكون مكرر. استخدم سطرًا واحدًا بكمية أكبر.');
        seen.add(productId);parts.push({productId,quantity});
      }
      drafts[id]=parts;dirty=false;renderButton(id);
      host.innerHTML='<div class="insight good">تم اعتماد اختيار المكونات لهذه المزامنة. اضغط بدء المزامنة لحفظ الربط.</div>';
      window.KunBundleImportV134.refresh?.();
    };
    el('bun134Unlink').onclick=()=>{
      if(!confirm('هل تريد إزالة الربط عند تنفيذ المزامنة؟ المنتج نفسه مش هيتحذف.'))return;
      drafts[id]=[];dirty=false;renderButton(id);
      host.innerHTML='<div class="insight warn">هيتم إلغاء الربط مع مكونات المخزون عند المزامنة، والمنتج يظل موجودًا.</div>';
      window.KunBundleImportV134.refresh?.();
    };
    el('bun134Close').onclick=()=>{host.innerHTML='';dirty=false;window.KunBundleImportV134.refresh?.();};
    host.scrollIntoView({behavior:'smooth',block:'nearest'});
  }
  async function mount({provider,cid,sid,importedItems}){
    catalog=[];mappings={};drafts=Object.create(null);dirty=false;ready=false;items=importedItems;
    const help=el('commerceBundleHelp');
    if(provider!=='easyorders'){if(help)help.textContent='الربط الاختياري متاح لاستيراد Easy Orders فقط.';return;}
    if(!sid){if(help)help.textContent='اختار المتجر أولًا علشان يظهر مخزونه.';return;}
    try{
      const q=new URLSearchParams({clientId:cid,storeId:sid,provider:'easyorders'});
      const data=await K.api('/api/commerce/product-import/bundle-options?'+q);
      catalog=data.products||[];mappings=data.mappings||{};ready=true;
      if(help)help.textContent='اختياري: المنتج من Easy Orders يظل عاديًا ما لم تربط مكوناته. الربط السابق لا يُمس إلا لو عدّلته صراحة. قائمة المكونات تعرض حتى 250 منتجًا من المخزون.';
      for(const btn of document.querySelectorAll('.commerceBundleEdit')){
        renderButton(btn.dataset.bundleId);btn.onclick=()=>open(btn.dataset.bundleId);
      }
    }catch(e){if(help)help.textContent='تعذر تحميل مخزون الباندلز: '+(e.message||'خطأ اتصال')+' — الاستيراد العادي ما زال متاحًا ولن يغيّر أي روابط سابقة.';}
  }
  function changes(targetIds){
    const selected=new Set((targetIds||[]).map(String)),result={};
    for(const [id,parts] of Object.entries(drafts))if(selected.has(id))result[id]=parts;
    return result;
  }
  window.KunBundleImportV134={version:'134.0',mount,changes,isDirty:()=>dirty,refresh:()=>{}};
})();
