/* Kun Online v54 — order-details workflow controls: state routing + full order editing. */
(function(){
  const EDITABLE=new Set(['pending','confirmed','preparing','deferred']);
  const LABELS={pending:'في انتظار التأكيد',confirmed:'تم التأكيد',preparing:'التجهيز والتغليف',shipped:'جاري الشحن',signed:'تم الشحن',collecting:'جاري التحصيل',collected:'تم التحصيل',returned:'مرتجع',cancelled:'ملغي',deferred:'مؤجل'};
  const STATUS_ORDER=['pending','confirmed','preparing','shipped','signed','collecting','collected','returned','cancelled','deferred'];
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const num=value=>Number.isFinite(Number(value))?Number(value):0;
  const notify=message=>window.showToast?.(message)||console.log(message);
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  let activeOrderId='',decorating=false;

  async function clientId(){return window.kunClientId?await window.kunClientId():'';}
  async function api(path,options={}){
    const response=await fetch(path,{credentials:'include',...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})}}),data=await response.json().catch(()=>({}));
    if(!response.ok)throw Object.assign(new Error(data.error||`HTTP ${response.status}`),{status:response.status,code:data.code,data});
    return data;
  }
  const query=(path,cid,storeId='')=>`${path}${path.includes('?')?'&':'?'}clientId=${encodeURIComponent(cid)}${storeId?`&storeId=${encodeURIComponent(storeId)}`:''}`;
  function cairoToday(){const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()),get=t=>p.find(x=>x.type===t)?.value||'';return `${get('year')}-${get('month')}-${get('day')}`;}
  function stageOf(order={}){return order.state==='signed'&&String(order.checkpoint||'').trim()==='جاري التحصيل'?'collecting':order.state||'pending';}
  function locationFor(stage){if(['pending','confirmed','preparing','deferred'].includes(stage))return 'خدمة العملاء';if(['shipped','signed','collecting','collected'].includes(stage))return 'خدمات ما بعد الشحن';return 'الأوردرات';}
  function statusOptions(current){return STATUS_ORDER.map(state=>`<option value="${state}" ${state===current?'selected':''}>${esc(LABELS[state]||state)}</option>`).join('');}
  function currentDrawerOrderId(){
    if(activeOrderId)return activeOrderId;
    const title=document.querySelector('#drawer .kod-order-id')?.textContent||'';
    return title.replace(/^\s*الطلب\s+/,'').trim();
  }
  function ensureStyle(){
    if(document.getElementById('kunOrderWorkflowV54Style'))return;
    const style=document.createElement('style');style.id='kunOrderWorkflowV54Style';style.textContent=`
      .kow-controls{grid-column:1/-1;display:grid;gap:12px;border-color:rgba(13,71,161,.22)!important;background:linear-gradient(180deg,rgba(13,71,161,.035),transparent)}
      .kow-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.kow-head strong{font-size:16px}.kow-location{font-size:11px;font-weight:900;padding:5px 9px;border-radius:999px;background:rgba(13,71,161,.08);color:#0d47a1}.kow-help{font-size:11px;opacity:.72;line-height:1.7}
      .kow-row{display:grid;grid-template-columns:minmax(220px,1fr) auto auto;gap:9px;align-items:end}.kow-field{display:grid;gap:5px;font-size:11px;font-weight:800}.kow-edit-btn{white-space:nowrap}.kow-edit-btn:disabled{opacity:.45;cursor:not-allowed}
      .kow-modal-back{position:fixed;inset:0;z-index:10050;background:rgba(15,23,42,.48);display:grid;place-items:center;padding:18px}.kow-modal{width:min(900px,96vw);max-height:92vh;overflow:auto;background:var(--card,#fff);color:var(--text,#0f172a);border:1px solid var(--line,#e5e7eb);border-radius:16px;padding:18px;box-shadow:0 24px 80px rgba(15,23,42,.28)}
      .kow-modal h2{margin:0 0 5px}.kow-modal-actions{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:16px}.kow-form{display:grid;gap:14px;margin-top:14px}.kow-section{padding:13px;border:1px solid var(--line,#e5e7eb);border-radius:12px}.kow-section-title{font-size:14px;font-weight:900;margin-bottom:10px}.kow-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.kow-grid .wide{grid-column:1/-1}.kow-grid label,.kow-item label{display:grid;gap:5px;font-size:11px;font-weight:800}.kow-items{display:grid;gap:10px}.kow-item{display:grid;grid-template-columns:minmax(150px,1.4fr) minmax(130px,1fr) minmax(80px,.5fr) minmax(100px,.7fr) auto;gap:8px;align-items:end;padding:10px;border:1px solid var(--line,#e5e7eb);border-radius:10px}.kow-total{font-size:20px!important;font-weight:900!important}.kow-provider-note{padding:8px 10px;border-radius:8px;background:rgba(245,158,11,.1);font-size:11px}.kow-loading{padding:30px;text-align:center}.kow-error{padding:9px 11px;border-radius:9px;background:rgba(239,68,68,.08);color:#b91c1c;font-size:12px;font-weight:800;display:none}
      @media(max-width:760px){.kow-row{grid-template-columns:1fr}.kow-row .btn{width:100%}.kow-grid{grid-template-columns:1fr}.kow-grid .wide{grid-column:auto}.kow-item{grid-template-columns:1fr 1fr}.kow-item label:first-child,.kow-item .kow-remove{grid-column:1/-1}.kow-remove{width:100%}}
    `;document.head.appendChild(style);
  }
  function closeModal(){document.getElementById('kowModalBack')?.remove();}
  function modal(html){closeModal();const back=document.createElement('div');back.id='kowModalBack';back.className='kow-modal-back';back.innerHTML=`<div class="kow-modal" role="dialog" aria-modal="true">${html}</div>`;document.body.appendChild(back);back.onclick=event=>{if(event.target===back)closeModal();};back.querySelectorAll('[data-kow-close]').forEach(button=>button.onclick=closeModal);return back;}
  async function refreshVisibleWorkspace(){
    const view=document.querySelector('.nav button.active[data-view]')?.dataset.view||'';
    if(view==='customer-service')await window.KunCustomerServiceV31?.render?.();
    else if(view==='post-shipping')await window.KunPostShippingV47?.render?.();
  }
  async function refreshDetails(orderId){
    activeOrderId=orderId;
    await Promise.resolve(window.KunOrderDetails?.open?.(orderId));
    await sleep(0);
    decorateDrawer();
  }
  async function genericState(order,next,cid,deferUntil=''){
    await api(query(`/api/customer-service/orders/${encodeURIComponent(order.id)}/state`,cid,order.storeId||''),{method:'PATCH',body:JSON.stringify({clientId:cid,...(order.storeId?{storeId:order.storeId}:{}),state:next,...(deferUntil?{deferUntil}: {})})});
  }
  async function changeState(details,next){
    const order=details.order||{},cid=await clientId();if(!cid)throw new Error('تعذر تحديد حساب المتجر');const current=stageOf(order);if(next===current)return;
    if(next==='deferred'){return openDeferredModal(details);}
    if(next==='collecting'){
      if(current!=='signed')throw new Error('انقل الطلب إلى «تم الشحن» أولًا قبل بدء التحصيل');
      await api(query(`/api/post-shipping/orders/${encodeURIComponent(order.id)}/collecting`,cid,order.storeId||''),{method:'PATCH',body:JSON.stringify({clientId:cid})});
    }else if(next==='collected'){
      if(current!=='collecting')throw new Error('انقل الطلب إلى «جاري التحصيل» أولًا قبل تسجيل التحصيل');
      return openCollectionModal(details);
    }else if(next==='signed'&&current==='shipped'){
      await api(query(`/api/post-shipping/orders/${encodeURIComponent(order.id)}/delivered`,cid,order.storeId||''),{method:'PATCH',body:JSON.stringify({clientId:cid})});
    }else{
      await genericState(order,next,cid);
    }
    notify(`تم نقل الأوردر إلى ${LABELS[next]||next}`);window.dispatchEvent(new CustomEvent('kun:order-workflow-updated',{detail:{orderId:order.id,state:next}}));await refreshVisibleWorkspace();await refreshDetails(order.id);
  }
  function openDeferredModal(details){
    const order=details.order||{},back=modal(`<h2>تأجيل الطلب</h2><div class="kow-help">حدد اليوم الذي يرجع فيه الطلب تلقائيًا إلى «في انتظار التأكيد».</div><label class="kow-field" style="margin-top:14px">تاريخ الرجوع<input class="input" id="kowDeferDate" type="date" min="${cairoToday()}" value="${esc(order.deferUntil||cairoToday())}"></label><div class="kow-error" id="kowDeferError"></div><div class="kow-modal-actions"><button class="btn primary" id="kowConfirmDefer">تأجيل</button><button class="btn soft" data-kow-close>إلغاء</button></div>`);
    back.querySelector('#kowConfirmDefer').onclick=async event=>{const button=event.currentTarget,date=back.querySelector('#kowDeferDate').value,error=back.querySelector('#kowDeferError');if(!date){error.textContent='حدد تاريخ الرجوع';error.style.display='block';return;}try{button.disabled=true;const cid=await clientId();await genericState(order,'deferred',cid,date);closeModal();notify(`تم تأجيل الأوردر حتى ${date}`);window.dispatchEvent(new CustomEvent('kun:order-workflow-updated',{detail:{orderId:order.id,state:'deferred'}}));await refreshVisibleWorkspace();await refreshDetails(order.id);}catch(e){error.textContent=e.message;error.style.display='block';button.disabled=false;}};
  }
  function openCollectionModal(details){
    const order=details.order||{},back=modal(`<h2>تسجيل التحصيل</h2><div class="kow-help">اكتب المبلغ المستلم فعليًا من شركة الشحن. بعد الحفظ ينتقل الطلب إلى «تم التحصيل» ويُحدّث حساب الأرباح.</div><label class="kow-field" style="margin-top:14px">المبلغ المستلم<input class="input kow-total" id="kowCollectedAmount" type="number" min="0" step="0.01" value="${Math.max(0,num(details.summary?.total||order.total))}"></label><div class="kow-error" id="kowCollectError"></div><div class="kow-modal-actions"><button class="btn primary" id="kowConfirmCollect">تسجيل التحصيل</button><button class="btn soft" data-kow-close>إلغاء</button></div>`);
    back.querySelector('#kowConfirmCollect').onclick=async event=>{const button=event.currentTarget,amount=Number(back.querySelector('#kowCollectedAmount').value),error=back.querySelector('#kowCollectError');if(!Number.isFinite(amount)||amount<0){error.textContent='اكتب المبلغ المستلم بشكل صحيح';error.style.display='block';return;}try{button.disabled=true;const cid=await clientId();const result=await api(query(`/api/post-shipping/orders/${encodeURIComponent(order.id)}/collect`,cid,order.storeId||''),{method:'PATCH',body:JSON.stringify({clientId:cid,amount})});closeModal();notify('تم تسجيل التحصيل ونقل الأوردر إلى «تم التحصيل»');window.dispatchEvent(new CustomEvent('kun:collection-recorded',{detail:{orderId:order.id,amount:result.collectedAmount}}));window.dispatchEvent(new CustomEvent('kun:order-workflow-updated',{detail:{orderId:order.id,state:'collected'}}));await refreshVisibleWorkspace();await refreshDetails(order.id);}catch(e){error.textContent=e.message;error.style.display='block';button.disabled=false;}};
  }
  function productOptions(catalog,selected){return `<option value="">— منتج يدوي —</option>${catalog.map(product=>`<option value="${esc(product.id)}" ${String(product.id)===String(selected||'')?'selected':''}>${esc(product.name)}${product.sku?` — ${esc(product.sku)}`:''}</option>`).join('')}`;}
  function variantOptions(product,selected){return `<option value="">— بدون اختيار —</option>${(product?.variants||[]).filter(item=>item.active!==false).map(variant=>`<option value="${esc(variant.id)}" ${String(variant.id)===String(selected||'')?'selected':''}>${esc(variant.name)}${variant.sku?` — ${esc(variant.sku)}`:''}</option>`).join('')}`;}
  function initialItems(details){return (details.items||[]).map(item=>({productId:item.productId||'',variantId:item.variantId||'',productName:item.name||'',variantLabel:item.variantName||item.note||'',sku:item.variantSku||item.sku||'',qty:Math.max(1,Math.floor(num(item.quantity)||1)),unitPrice:Math.max(0,num(item.price))}));}
  async function openEditor(orderId){
    const cid=await clientId();if(!cid)throw new Error('تعذر تحديد حساب المتجر');
    modal('<h2>تعديل الطلب</h2><div class="kow-loading">جارٍ تحميل بيانات الطلب والمنتجات...</div><div class="kow-modal-actions"><button class="btn soft" data-kow-close>إلغاء</button></div>');
    const details=await api(query(`/api/orders/${encodeURIComponent(orderId)}/details`,cid)),order=details.order||{};if(!EDITABLE.has(order.state)){closeModal();throw new Error('التعديل متاح قبل خروج الطلب للشحن فقط. يمكنك تغيير الحالة أولًا إذا كان ذلك صحيحًا تشغيليًا.');}
    let catalog=[];try{catalog=(await api(query('/api/catalog/products',cid,order.storeId||''))).products||[];}catch{}
    closeModal();const customer=details.customer||{},address=details.address||{};let items=initialItems(details);if(!items.length)items=[{productId:'',variantId:'',productName:'',variantLabel:'',sku:'',qty:1,unitPrice:0}];
    const back=modal(`<h2>تعديل الطلب — ${esc(customer.name||order.id)}</h2><div class="kow-help">يمكن تعديل بيانات العميل والمنتجات والكمية والسعر. كل تعديل يُسجل في سجل الطلب ويظهر بعلامة «معدّل» في خدمة العملاء.</div>${details.provider?.id?'<div class="kow-provider-note" style="margin-top:10px">بعد الحفظ تصبح النسخة المعدّلة داخل Kun Online هي النسخة التشغيلية المعتمدة للفريق.</div>':''}<div class="kow-error" id="kowEditError" style="margin-top:10px"></div><div class="kow-form">
      <section class="kow-section"><div class="kow-section-title">بيانات العميل والتوصيل</div><div class="kow-grid"><label>اسم العميل<input class="input" id="kowName" value="${esc(customer.name||'')}"></label><label>رقم الهاتف<input class="input" id="kowPhone" type="tel" value="${esc(customer.phone||'')}"></label><label>المحافظة<input class="input" id="kowGov" value="${esc(address.government||customer.government||'')}"></label><label>العنوان<input class="input" id="kowAddress" value="${esc(address.address||customer.address||'')}"></label></div></section>
      <section class="kow-section"><div class="kow-head"><div><div class="kow-section-title">منتجات الطلب</div><div class="kow-help">غيّر المنتج أو اللون/المقاس أو الكمية أو السعر، ويمكن إضافة أكثر من بند.</div></div><div style="margin-inline-start:auto"><button type="button" class="btn soft" id="kowAddItem">+ إضافة منتج</button></div></div><div class="kow-items" id="kowItems"></div></section>
      <section class="kow-section"><div class="kow-grid"><label>كود الخصم<input class="input" id="kowCoupon" value="${esc(order.couponCode||'')}"></label><label>إجمالي الطلب<input class="input kow-total" id="kowTotal" type="number" min="0" step="0.01" value="${Math.max(0,num(details.summary?.total))}"></label><label class="wide">ملاحظة العميل على الطلب<textarea class="input" id="kowCustomerNote" rows="3">${esc(order.customerNote||'')}</textarea></label></div></section>
    </div><div class="kow-modal-actions"><button class="btn primary" id="kowSaveEdit">حفظ التعديلات</button><button class="btn soft" data-kow-close>إلغاء</button></div>`);
    const itemsRoot=back.querySelector('#kowItems'),totalInput=back.querySelector('#kowTotal'),errorBox=back.querySelector('#kowEditError');
    const recalc=()=>{totalInput.value=String(Number(items.reduce((sum,item)=>sum+Math.max(1,num(item.qty))*Math.max(0,num(item.unitPrice)),0).toFixed(2)));};
    function renderItems(){
      itemsRoot.innerHTML=items.map((item,index)=>{const product=catalog.find(entry=>String(entry.id)===String(item.productId));return `<div class="kow-item" data-kow-row="${index}"><label>المنتج<select class="select" data-kow-product>${productOptions(catalog,item.productId)}</select></label><label>اللون / المقاس / الاختيار<select class="select" data-kow-variant ${product?.variants?.length?'':'disabled'}>${variantOptions(product,item.variantId)}</select></label><label>الكمية<input class="input" data-kow-qty type="number" min="1" step="1" value="${Math.max(1,num(item.qty))}"></label><label>سعر الوحدة<input class="input" data-kow-price type="number" min="0" step="0.01" value="${Math.max(0,num(item.unitPrice))}"></label><button type="button" class="btn soft kow-remove" data-kow-remove ${items.length===1?'disabled':''}>حذف البند</button><label style="grid-column:1/-1">اسم المنتج / وصف يدوي<input class="input" data-kow-name value="${esc(item.productName||'')}" placeholder="اسم المنتج"></label></div>`;}).join('');
      itemsRoot.querySelectorAll('[data-kow-row]').forEach(row=>{const index=Number(row.dataset.kowRow),item=items[index];
        row.querySelector('[data-kow-product]').onchange=event=>{const product=catalog.find(entry=>String(entry.id)===event.target.value);item.productId=product?.id||'';item.variantId='';item.productName=product?.name||item.productName;item.variantLabel='';item.sku=product?.sku||'';if(product)item.unitPrice=num(product.price);renderItems();recalc();};
        row.querySelector('[data-kow-variant]').onchange=event=>{const product=catalog.find(entry=>String(entry.id)===String(item.productId)),variant=(product?.variants||[]).find(entry=>String(entry.id)===event.target.value);item.variantId=variant?.id||'';item.variantLabel=variant?.name||'';item.sku=variant?.sku||product?.sku||'';if(variant)item.unitPrice=variant.price===null?num(product.price):num(variant.price);renderItems();recalc();};
        row.querySelector('[data-kow-name]').oninput=event=>{item.productName=event.target.value;};row.querySelector('[data-kow-qty]').oninput=event=>{item.qty=Math.max(1,Math.floor(num(event.target.value)||1));recalc();};row.querySelector('[data-kow-price]').oninput=event=>{item.unitPrice=Math.max(0,num(event.target.value));recalc();};row.querySelector('[data-kow-remove]').onclick=()=>{if(items.length===1)return;items.splice(index,1);renderItems();recalc();};
      });
    }
    renderItems();back.querySelector('#kowAddItem').onclick=()=>{items.push({productId:'',variantId:'',productName:'',variantLabel:'',sku:'',qty:1,unitPrice:0});renderItems();};
    back.querySelector('#kowSaveEdit').onclick=async event=>{const button=event.currentTarget;try{const name=back.querySelector('#kowName').value.trim(),phone=back.querySelector('#kowPhone').value.trim();if(!name)throw new Error('اسم العميل مطلوب');if(!phone)throw new Error('رقم الهاتف مطلوب');if(items.some(item=>!String(item.productName||'').trim()))throw new Error('اكتب اسم كل منتج في الطلب');button.disabled=true;button.textContent='جارٍ حفظ التعديلات...';await api(query(`/api/customer-service/orders/${encodeURIComponent(orderId)}/edit`,cid,order.storeId||''),{method:'PATCH',body:JSON.stringify({clientId:cid,...(order.storeId?{storeId:order.storeId}:{}),name,phone,gov:back.querySelector('#kowGov').value.trim(),address:back.querySelector('#kowAddress').value.trim(),couponCode:back.querySelector('#kowCoupon').value.trim(),customerNote:back.querySelector('#kowCustomerNote').value.trim(),total:Math.max(0,num(totalInput.value)),items})});closeModal();notify('تم تعديل الطلب وتسجيل التغييرات');window.KunCustomerServiceRichCards?.cache?.delete?.(orderId);window.dispatchEvent(new CustomEvent('kun:order-edited',{detail:{orderId}}));await refreshVisibleWorkspace();await refreshDetails(orderId);}catch(error){errorBox.textContent=error.message;errorBox.style.display='block';button.disabled=false;button.textContent='حفظ التعديلات';}};
  }
  async function decorateDrawer(){
    if(decorating)return;const drawer=document.getElementById('drawer'),page=drawer?.querySelector('.kod-page'),grid=page?.querySelector('.kod-grid');if(!grid)return;const orderId=currentDrawerOrderId();if(!orderId)return;if(grid.querySelector(`.kow-controls[data-order-id="${CSS.escape(orderId)}"]`))return;decorating=true;
    try{
      const cid=await clientId();if(!cid)return;const details=await api(query(`/api/orders/${encodeURIComponent(orderId)}/details`,cid)),order=details.order||{},stage=stageOf(order);if(!document.getElementById('drawer')?.querySelector('.kod-page'))return;
      document.getElementById('drawer')?.querySelectorAll('.kow-controls').forEach(node=>node.remove());
      const section=document.createElement('section');section.className='kod-card kow-controls';section.dataset.orderId=orderId;section.innerHTML=`<div class="kow-head"><strong>إدارة الطلب</strong><span class="kow-location">${esc(locationFor(stage))} · ${esc(LABELS[stage]||stage)}</span></div><div class="kow-row"><label class="kow-field">حالة الطلب<select class="select" data-kow-state>${statusOptions(stage)}</select></label><button type="button" class="btn primary" data-kow-apply>تحديث الحالة</button><button type="button" class="btn soft kow-edit-btn" data-kow-edit ${EDITABLE.has(order.state)?'':'disabled'}>تعديل الطلب</button></div><div class="kow-help">أي تغيير للحالة هنا يحدّث نفس الأوردر مباشرة، وينقله تلقائيًا إلى الخانة الصحيحة في خدمة العملاء أو خدمات ما بعد الشحن. ${EDITABLE.has(order.state)?'يمكن تعديل محتوى الطلب الآن.':'تعديل محتوى الطلب متاح قبل خروج الطلب للشحن فقط.'}</div>`;
      grid.prepend(section);const select=section.querySelector('[data-kow-state]'),apply=section.querySelector('[data-kow-apply]'),edit=section.querySelector('[data-kow-edit]');apply.onclick=async()=>{try{apply.disabled=true;apply.textContent='جارٍ التحديث...';await changeState(details,select.value);}catch(error){notify(error.message);select.value=stage;}finally{if(apply.isConnected){apply.disabled=false;apply.textContent='تحديث الحالة';}}};edit.onclick=()=>openEditor(orderId).catch(error=>notify(error.message));
    }catch(error){console.warn('Order workflow controls unavailable',error);}finally{decorating=false;}
  }
  function captureOrder(event){const trigger=event.target.closest?.('[data-kod-cs-details],#root button[data-order]');if(!trigger)return;activeOrderId=trigger.dataset.kodCsDetails||trigger.dataset.order||activeOrderId;}
  ensureStyle();document.addEventListener('click',captureOrder,true);const target=document.getElementById('drawer')||document.body;new MutationObserver(()=>decorateDrawer()).observe(target,{subtree:true,childList:true});setTimeout(decorateDrawer,0);
  window.KunOrderWorkflowV54={decorate:decorateDrawer,edit:openEditor,changeState,stageOf,version:'54.0'};
  document.documentElement.dataset.orderWorkflowControls='v54-ready';
})();
