/* Kun Online v79.9 — safe shipping reset and billing-aware print flow. */
(function(){
  const clean=v=>String(v??'').trim(),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),notify=m=>window.showToast?.(m)||console.log(m);
  let cid='',orders=[],tab='waiting',sending=new Set(),selectedStore='',pageIndex=0;const PAGE_SIZE=100;
  async function clientId(){return clean(await(window.kunClientId?.()||Promise.resolve('')));}
  async function api(path,options={}){const r=await fetch(path,{credentials:'include',...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})}}),d=await r.json().catch(()=>({}));if(!r.ok){const e=new Error(d.error||`HTTP ${r.status}`);e.code=d.code;e.data=d;throw e;}return d;}
  function history(order){return Array.isArray(order?.history)?order.history:[];}
  function isPrinted(order){return Boolean(order?.printed||history(order).some(e=>e?.type==='jt_label_printed'&&e?.official!==false));}
  function isQueued(order){return Boolean(order?.queuedForPrint||history(order).some(e=>e?.type==='jt_print_queued'));}
  function style(){if(document.getElementById('print79Style'))return;const s=document.createElement('style');s.id='print79Style';s.textContent=`.print79-page{display:grid;gap:16px}.print79-head{display:flex;align-items:flex-end;gap:10px;flex-wrap:wrap}.print79-head h2{margin:0;font-size:22px}.print79-head p{margin:4px 0 0;color:var(--muted,#64748b);font-size:12px}.print79-head .spacer{flex:1}.print79-tabs{display:flex;gap:6px;background:var(--surface-2,#f5f8f7);border:1px solid var(--line,#d3deda);padding:4px;border-radius:12px;width:max-content;max-width:100%}.print79-tabs button{padding:8px 14px;border-radius:9px;font-weight:800}.print79-tabs button.active{background:var(--surface,#fff);box-shadow:0 1px 3px rgba(18,33,43,.12)}.print79-flow{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px}.print79-flow div{padding:9px;border-radius:10px;border:1px solid var(--line,#e2e8f0);background:var(--surface,#fff);font-size:10px;font-weight:850;text-align:center}.print79-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(310px,1fr));gap:14px}.print79-card{border:1px solid var(--line,#d3deda);border-radius:15px;padding:14px;background:var(--surface,#fff);display:grid;gap:10px}.print79-card.printed{border-color:#bbf7d0}.print79-title{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}.print79-title-main{display:grid;gap:4px}.print79-badge{font-size:10px;font-weight:900;padding:5px 9px;border-radius:999px;white-space:nowrap}.print79-badge.ready{background:#dbeafe;color:#1d4ed8}.print79-badge.queued{background:#fef3c7;color:#92400e}.print79-badge.printed{background:#dcfce7;color:#166534}.print79-address{font-size:12px;line-height:1.75;color:var(--ink-2,#3d5563)}.print79-meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.print79-meta div{padding:8px;border-radius:9px;background:rgba(148,163,184,.1)}.print79-meta small{display:block;color:var(--muted,#64748b);font-size:9px;font-weight:800}.print79-meta b{display:block;margin-top:2px;font-size:11px;overflow-wrap:anywhere}.print79-note{padding:9px 10px;border-radius:9px;background:#f8fafc;border:1px solid #e2e8f0;font-size:10.5px;line-height:1.7}.print79-actions{display:flex;gap:7px;flex-wrap:wrap}.print79-actions .btn{width:auto}.print79-send{background:#0f766e!important;border-color:#0f766e!important;color:#fff!important}.print79-error{color:#b91c1c;font-size:10px;font-weight:800}@media(max-width:640px){.print79-grid,.print79-meta,.print79-flow{grid-template-columns:1fr}.print79-actions .btn{flex:1;min-width:140px}.print79-tabs{width:100%}.print79-tabs button{flex:1}}`;document.head.appendChild(s);}
  function card(o){const printed=isPrinted(o),queued=isQueued(o),badge=printed?['printed','✓ تم الإرسال والطباعة']:queued?['queued','جاهز للإرسال']:['ready','تم التأكيد'];const address=[o.province||o.gov,o.city,o.area,o.street||o.address].filter(Boolean).join(' — ');return `<article class="print79-card ${printed?'printed':''}" data-print79-order="${esc(o.id)}"><div class="print79-title"><div class="print79-title-main"><b>${esc(o.name||'بدون اسم')}</b><span class="sub">#${esc(o.ref||o.id)} • ${esc(o.product||'بدون منتج')} × ${Number(o.qty)||1}</span></div><span class="print79-badge ${badge[0]}">${badge[1]}</span></div><div class="print79-address">${o.storeName?`المتجر: ${esc(o.storeName)} · `:''}${esc(address||'العنوان غير مكتمل')}</div><div class="print79-meta"><div><small>COD</small><b>${new Intl.NumberFormat('ar-EG').format(Number(o.total)||0)} ج.م</b></div><div><small>AWB</small><b dir="ltr">${esc(o.awb||'يُنشأ عند الإرسال')}</b></div><div><small>Sorting Code</small><b dir="ltr">${esc(o.sortingCode||'—')}</b></div><div><small>الحالة</small><b>${printed?'جاري الشحن':queued?'بيانات J&T جاهزة':'وصل من خدمة العملاء'}</b></div></div><div class="print79-note">${printed?'تم إرسال الأوردر إلى J&T بنجاح، إنشاء AWB، وتجهيز البوليصة الرسمية.':queued?'بيانات J&T محفوظة. الإرسال الحقيقي للشركة لم يحدث بعد؛ اضغط الزر أدناه.':'الأوردر اتأكد ووصل قسم الطباعة تلقائيًا. راجع بيانات J&T أو أرسله مباشرة إذا كانت البيانات مكتملة.'}</div><div class="print79-error" data-print79-error></div><div class="print79-actions">${printed?`<button class="btn soft" data-print79-edit>بيانات J&T</button>`:`<button class="btn soft" data-print79-edit>مراجعة بيانات J&T</button><button class="btn primary print79-send" data-print79-send ${sending.has(String(o.id))?'disabled':''}>${sending.has(String(o.id))?'جارٍ الإرسال...':'إرسال إلى J&T وطباعة البوليصة'}</button>`}${(printed||queued||o.awb)?'<button class="btn soft print79-void" type="button" data-print79-void>حذف البوليصة</button>':''}</div></article>`;}
  async function render(){
    const root=document.getElementById('root');if(!root)return;
    if(window.KunSubscriptionsV127?.access?.locked){document.querySelector('.nav button[data-view="dashboard"]')?.click();return;}
    root.innerHTML='<div class="card empty">جارٍ تحميل قسم الطباعة...</div>';
    try{
      cid=await clientId();if(!cid)throw new Error('تعذر تحديد الحساب');
      const url=`/api/printing?clientId=${encodeURIComponent(cid)}&tab=${encodeURIComponent(tab)}&limit=${PAGE_SIZE}&offset=${pageIndex*PAGE_SIZE}${selectedStore?`&storeId=${encodeURIComponent(selectedStore)}`:''}`;
      const data=await api(url);
      orders=data.orders||[];
      const visible=orders.filter(o=>tab==='printed'?isPrinted(o):!isPrinted(o));
      const waitingCount=Number(data.counts?.waiting??(tab==='waiting'?visible.length:0));
      const printedCount=Number(data.counts?.printed??(tab==='printed'?visible.length:0));
      const stores=[{id:'',name:'كل المتاجر'},...(data.stores||[])];
      const storeTabs=`<div class="print79-tabs" role="tablist" aria-label="متاجر الطباعة" style="width:100%;flex-wrap:wrap">${stores.map(store=>`<button type="button" data-print79-store="${esc(store.id||'')}" class="${selectedStore===String(store.id||'')?'active':''}">${esc(store.name||store.id)}</button>`).join('')}</div>`;
      const total=Number(data.total??visible.length);
      const pages=total>PAGE_SIZE?`<div class="print79-tabs" style="margin:0 auto"><button type="button" data-print79-page="prev" ${pageIndex===0?'disabled':''}>السابق</button><span style="padding:8px 12px">صفحة ${pageIndex+1} من ${Math.ceil(total/PAGE_SIZE)}</span><button type="button" data-print79-page="next" ${!data.hasMore?'disabled':''}>التالي</button></div>`:'';
      root.innerHTML=`<section class="print79-page"><header class="print79-head"><div><h2>الطباعة والشحن</h2><p>الطلبات المؤكدة تظل ظاهرة في خدمة العملاء وفي الطباعة حتى إرسالها بنجاح إلى J&amp;T.</p></div><div class="spacer"></div><button class="btn soft" data-print79-reload>تحديث</button></header><div class="print79-flow"><div>1. تأكيد الأوردر</div><div>2. يظهر في خدمة العملاء والطباعة</div><div>3. إرسال إلى J&amp;T + AWB</div><div>4. جاري الشحن في جميع الأقسام</div></div>${storeTabs}<div class="print79-tabs"><button data-print79-tab="waiting" class="${tab==='waiting'?'active':''}">في انتظار الإرسال (${waitingCount})</button><button data-print79-tab="printed" class="${tab==='printed'?'active':''}">تم الإرسال والطباعة (${printedCount})</button></div><div class="print79-grid">${visible.length?visible.map(card).join(''):`<div class="card empty">${tab==='printed'?'لا توجد أوردرات تم إرسالها وطباعتها بعد.':'لا توجد أوردرات مؤكدة في انتظار الطباعة.'}</div>`}</div>${pages}</section>`;
      bind();
    }catch(e){
      if(['SUBSCRIPTION_BALANCE_REQUIRED','SUBSCRIPTION_ACCESS_PAUSED'].includes(e.code)){notify(e.message);window.KunSubscriptionsV127?.refreshAccess?.(true);document.querySelector('.nav button[data-view="dashboard"]')?.click();return;}
      root.innerHTML=`<div class="card empty"><b>تعذر فتح قسم الطباعة</b><p>${esc(e.message)}</p><button class="btn soft" data-print79-reload>إعادة المحاولة</button></div>`;root.querySelector('[data-print79-reload]')?.addEventListener('click',render);
    }
  }
  function bind(){document.querySelector('[data-print79-reload]')?.addEventListener('click',render);document.querySelectorAll('[data-print79-tab]').forEach(b=>b.onclick=()=>{tab=b.dataset.print79Tab;pageIndex=0;render();});document.querySelectorAll('[data-print79-store]').forEach(b=>b.onclick=()=>{selectedStore=b.dataset.print79Store||'';pageIndex=0;render();});document.querySelectorAll('[data-print79-page]').forEach(b=>b.onclick=()=>{pageIndex=Math.max(0,pageIndex+(b.dataset.print79Page==='next'?1:-1));render();});document.querySelectorAll('[data-print79-edit]').forEach(b=>b.onclick=()=>editOrder(b.closest('[data-print79-order]')?.dataset.print79Order));document.querySelectorAll('[data-print79-send]').forEach(b=>b.onclick=()=>sendOrder(b.closest('[data-print79-order]')?.dataset.print79Order));document.querySelectorAll('[data-print79-void]').forEach(b=>b.onclick=()=>voidWaybill(b.closest('[data-print79-order]')?.dataset.print79Order));}
  function orderById(id){return orders.find(x=>String(x.id)===String(id));}
  function editOrder(id,onQueued){const o=orderById(id);if(!o)return;const editor=window.KunJtShippingOrderV78;if(!editor?.openOrder){notify('محرر بيانات J&T لم يكتمل تحميله بعد. حاول مرة أخرى.');return;}editor.openOrder(o,{onQueued:async result=>{await render();if(typeof onQueued==='function')await onQueued(result);}});}
  function needsEditor(error){return ['JT_SHIPMENT_FIELDS_MISSING','JT_PRINT_QUEUE_DATA_MISSING'].includes(error?.code)||/أكمل|بيانات الشحنة|العنوان/i.test(error?.message||'');}
  async function ensureQueued(o){if(isQueued(o))return;try{await api(`/api/jt/shipments/${encodeURIComponent(o.id)}?clientId=${encodeURIComponent(cid)}${o.storeId?`&storeId=${encodeURIComponent(o.storeId)}`:''}`,{method:'POST',body:JSON.stringify({clientId:cid,...(o.storeId?{storeId:o.storeId}:{})})});}catch(error){if(needsEditor(error)){editOrder(o.id,()=>sendOrder(o.id,true));const wrapped=new Error('راجع بيانات J&T ثم سيتم استكمال الإرسال من نفس قسم الطباعة.');wrapped.code='EDITOR_OPENED';throw wrapped;}throw error;}}
  async function sendOrder(id,skipConfirm=false){const o=orderById(id);if(!o||sending.has(String(id)))return;if(!skipConfirm&&!window.confirm('سيتم الآن إرسال الأوردر فعليًا إلى J&T، إنشاء AWB، ثم طلب البوليصة الرسمية. بعد النجاح سينتقل الأوردر إلى جاري الشحن. هل تريد المتابعة؟'))return;sending.add(String(id));let popup=null;try{await render();if(window.KunSubscriptionsV127?.access?.locked)throw Object.assign(new Error('رصيد الاشتراك انتهى. اشحن الرصيد أولًا.'),{code:'SUBSCRIPTION_BALANCE_REQUIRED'});await ensureQueued(o);popup=window.open('about:blank','jtOfficialLabel');if(popup){popup.document.title='جارٍ تجهيز بوليصة J&T...';popup.document.body.innerHTML='<p style="font-family:Arial;padding:24px">جارٍ إرسال الأوردر إلى J&amp;T وتجهيز البوليصة الرسمية...</p>';}const result=await api(`/api/jt/shipments/${encodeURIComponent(id)}/print?clientId=${encodeURIComponent(cid)}${o.storeId?`&storeId=${encodeURIComponent(o.storeId)}`:''}`,{method:'POST',body:JSON.stringify({clientId:cid,...(o.storeId?{storeId:o.storeId}:{})})});if(result.url){if(popup){popup.opener=null;popup.location.replace(result.url);}else window.open(result.url,'_blank','noopener');}else try{popup?.close();}catch{}notify(`تم إرسال الأوردر إلى J&T بنجاح — AWB: ${result.awb||'تم الإنشاء'}`);if(result.state==='shipped')window.dispatchEvent(new CustomEvent('kun:order-workflow-updated',{detail:{orderId:id,state:'shipped',storeId:o.storeId||null,source:'printing'}}));tab='printed';pageIndex=0;}catch(error){try{popup?.close();}catch{}if(error.code!=='EDITOR_OPENED')notify(`لم يكتمل الإرسال إلى J&T — ${error.message}`);}finally{sending.delete(String(id));await render();}}

  // Shared, user-confirmed carrier handoff from Customer Service, order details,
  // and Printing. Do not fake a shipped status with a generic state PATCH.
  const handoffTasks=new Map();
  function shipById(id,storeId=''){
    if(!id)return Promise.reject(new Error('حدد الأوردر أولًا'));
    // One confirmed J&T handoff per order in this browser context.
    // Server-side cross-device idempotency remains independently required.
    const key=String(id);
    if(handoffTasks.has(key))return handoffTasks.get(key);
    if(!window.confirm('سيتم إرسال الأوردر فعليًا إلى J&T وإصدار البوليصة الرسمية. بعد نجاح العملية فقط سينتقل إلى جاري الشحن. هل تريد المتابعة؟'))return Promise.resolve({cancelled:true});
    const popup=window.open('about:blank','jtOfficialLabel');
    if(popup){popup.document.title='جارٍ إصدار بوليصة الشحن';popup.document.body.textContent='جارٍ تجهيز بوليصة J&T الرسمية...';}
    const task=(async()=>{
      const client=await clientId();
      if(!client)throw new Error('تعذر تحديد حساب المتجر');
      const details=await api(`/api/orders/${encodeURIComponent(id)}/details?clientId=${encodeURIComponent(client)}${storeId?`&storeId=${encodeURIComponent(storeId)}`:''}`);
      const order=details.order||{};
      if(!['confirmed','preparing'].includes(order.state))throw new Error('لا يمكن إرسال الطلب قبل التأكيد أو بعد شحنه بالفعل');
      const sid=clean(order.storeId||storeId);
      const query=`?clientId=${encodeURIComponent(client)}${sid?`&storeId=${encodeURIComponent(sid)}`:''}`;
      const body=JSON.stringify({clientId:client,...(sid?{storeId:sid}:{})});
      await api(`/api/jt/shipments/${encodeURIComponent(id)}${query}`,{method:'POST',body});
      const result=await api(`/api/jt/shipments/${encodeURIComponent(id)}/print${query}`,{method:'POST',body});
      if(result.state!=='shipped'||!result.awb||!result.url)throw new Error('الشركة لم تؤكد إصدار بوليصة رسمية؛ لم يتم تغيير حالة الأوردر');
      if(popup){popup.opener=null;popup.location.replace(result.url);}
      else window.open(result.url,'_blank','noopener');
      notify(`تم إرسال الأوردر إلى J&T ونقله إلى جاري الشحن — AWB: ${result.awb}`);
      window.dispatchEvent(new CustomEvent('kun:order-workflow-updated',{detail:{orderId:id,state:'shipped',storeId:sid||null,source:'confirmed-handoff'}}));
      if(document.querySelector('.nav button.active[data-view="customer-service"]'))await window.KunCustomerServiceV31?.render?.();
      if(document.querySelector('.nav button.active[data-view="printing"]'))await render();
      return result;
    })().catch(error=>{
      try{popup?.close();}catch{}
      notify(`تعذر إرسال الأوردر إلى J&T: ${error.message}`);
      throw error;
    }).finally(()=>handoffTasks.delete(key));
    handoffTasks.set(key,task);
    return task;
  }
  function askVoidReason(o){
    return new Promise(resolve=>{
      const cover=document.createElement('div');cover.className='print79-void-back';cover.setAttribute('role','presentation');
      cover.innerHTML=`<section class="print79-void-dialog" role="dialog" aria-modal="true" aria-labelledby="print79VoidTitle" dir="rtl">
        <h3 id="print79VoidTitle">حذف بوليصة الشحن</h3>
        <p><b>${esc(o.name||'العميل')}</b> — ${esc(o.awb||'تجهيز بوليصة لم تُرسل')}</p>
        <p class="print79-void-warning">${o.awb?'سيتم أولًا طلب إلغاء الشحنة من J&T. لو رفضت الشركة الإلغاء، لن تُحذف البوليصة من النظام.':'سيتم حذف تجهيز الشحنة المحلي فقط دون إرسال أي إلغاء إلى J&T.'} الأوردر نفسه وسجله لن يُحذفا.</p>
        <label>سبب الحذف (إجباري)<textarea data-void-reason minlength="8" maxlength="500" rows="3" placeholder="مثال: تعديل العنوان وإعادة إصدار بوليصة جديدة" required></textarea></label>
        <div class="print79-void-actions"><button type="button" class="btn soft" data-void-cancel>رجوع</button><button type="button" class="btn primary" data-void-confirm>تأكيد حذف البوليصة</button></div>
        <p data-void-error class="print79-error" aria-live="polite"></p>
      </section>`;
      const finish=value=>{cover.remove();document.removeEventListener('keydown',escapeKey);resolve(value);};
      const escapeKey=e=>{if(e.key==='Escape')finish(null);};
      cover.addEventListener('click',e=>{if(e.target===cover||e.target.closest('[data-void-cancel]'))finish(null);});
      cover.querySelector('[data-void-confirm]').onclick=()=>{
        const reason=cover.querySelector('[data-void-reason]')?.value?.trim()||'';
        if(reason.length<8){cover.querySelector('[data-void-error]').textContent='اكتب سبب الحذف (٨ حروف على الأقل)';return;}
        finish(reason);
      };
      document.body.appendChild(cover);document.addEventListener('keydown',escapeKey);cover.querySelector('[data-void-reason]')?.focus();
    });
  }
  async function voidWaybill(id){
    const o=orderById(id);if(!o||sending.has(String(id)))return;
    const reason=await askVoidReason(o);if(!reason)return;
    sending.add(String(id));
    const card=document.querySelector(`[data-print79-order="${CSS.escape(String(id))}"]`);
    const button=card?.querySelector('[data-print79-void]');if(button){button.disabled=true;button.textContent='جارٍ إلغاء البوليصة...';}
    try{
      const result=await api(`/api/jt/shipments/${encodeURIComponent(id)}/void?clientId=${encodeURIComponent(cid)}${o.storeId?`&storeId=${encodeURIComponent(o.storeId)}`:''}`,{method:'POST',body:JSON.stringify({clientId:cid,...(o.storeId?{storeId:o.storeId}:{}),reason})});
      notify(result.message||'تم حذف البوليصة مع الاحتفاظ بسجلها');
      window.dispatchEvent(new CustomEvent('kun:order-workflow-updated',{detail:{orderId:id,state:result.state,storeId:o.storeId||null,source:'printing-waybill-void'}}));
      tab='waiting';pageIndex=0;await render();
    }catch(error){const err=card?.querySelector('[data-print79-error]');if(err)err.textContent=error.message;notify(`تعذر حذف البوليصة: ${error.message}`);}
    finally{sending.delete(String(id));if(button?.isConnected){button.disabled=false;button.textContent='حذف البوليصة';}}
  }
  function boot(){style();const button=document.querySelector('.nav [data-view="printing"]');if(button)button.addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation();document.querySelectorAll('.nav button').forEach(b=>b.classList.toggle('active',b===button));tab='waiting';pageIndex=0;render();},true);window.addEventListener('kun:jt-print-queued',()=>{if(document.querySelector('.nav button.active[data-view="printing"]'))render();});window.addEventListener('kun:printing-ready',()=>{if(document.querySelector('.nav button.active[data-view="printing"]'))render();});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
  window.KunPrintingV79={render,isPrinted,isQueued,sendOrder,shipById,version:'79.11'};
})();
