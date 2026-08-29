/* Kun Online v31 — multi-store Customer Service workspace */
(function(){
  const ALLOWED=new Set(['admin','client','ops','support']);
  const STAGES=['pending','confirmed','preparing','shipped'];
  const LABELS={pending:'في انتظار التأكيد',confirmed:'تم التأكيد',preparing:'التجهيز والتغليف',shipped:'جاري الشحن',signed:'تحصيل منتظر',collected:'تم التحصيل',returned:'مرتجع',cancelled:'تم إلغاء الطلب',deferred:'مؤجل'};
  const STATUS_ORDER=['pending','confirmed','preparing','shipped','signed','collected','returned','cancelled','deferred'];
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=v=>new Intl.NumberFormat('ar-EG',{maximumFractionDigits:2}).format(Number(v)||0);
  const notify=msg=>typeof window.showToast==='function'?window.showToast(msg):console.log(msg);
  let me=null,clientId='',selectedStore='',data=null,loading=false;

  async function api(path,options={}){
    const r=await fetch(path,{credentials:'include',...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})}});
    const d=await r.json().catch(()=>({}));
    if(!r.ok)throw Object.assign(new Error(d.error||`HTTP ${r.status}`),{status:r.status,code:d.code,data:d});
    return d;
  }
  const root=()=>document.getElementById('root');
  const urlFor=(path,storeId=selectedStore)=>`${path}${path.includes('?')?'&':'?'}clientId=${encodeURIComponent(clientId)}${storeId?`&storeId=${encodeURIComponent(storeId)}`:''}`;
  const bodyFor=(extra={},storeId=selectedStore)=>JSON.stringify({clientId,...(storeId?{storeId}:{}),...extra});
  function cairoToday(){
    const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()),g=t=>p.find(x=>x.type===t)?.value||'';
    return `${g('year')}-${g('month')}-${g('day')}`;
  }
  function formatWhen(v){if(!v)return '—';const d=new Date(v);if(Number.isNaN(d.getTime()))return esc(v);return new Intl.DateTimeFormat('ar-EG',{dateStyle:'medium',timeStyle:'short',timeZone:'Africa/Cairo'}).format(d);}
  function phoneIntl(raw){let d=String(raw||'').replace(/\D/g,'');if(d.startsWith('00'))d=d.slice(2);if(/^01\d{9}$/.test(d))return '20'+d.slice(1);if(/^05\d{8}$/.test(d))return '966'+d.slice(1);return d;}
  function statusOptions(current){return STATUS_ORDER.map(s=>`<option value="${s}" ${s===current?'selected':''}>${esc(LABELS[s]||s)}</option>`).join('');}

  function storeTabs(){
    const tabs=[{id:'',name:'كل المتاجر'},...(data?.stores||[])];
    return `<div class="cs-store-tabs" role="tablist" aria-label="المتاجر المسموحة">${tabs.map(s=>`<button class="cs-store-tab ${String(selectedStore)===String(s.id||'')?'active':''}" data-cs-store="${esc(s.id||'')}">${esc(s.name||s.id)}</button>`).join('')}</div>`;
  }
  function orderCard(o,{deferred=false}={}){
    return `<article class="cs-order ${o.returnedFromDeferredToday?'cs-returned-today':''}" data-cs-order="${esc(o.id)}">
      ${o.returnedFromDeferredToday?'<div class="cs-return-banner">⏰ رجع من التأجيل اليوم — يحتاج متابعة</div>':''}
      <div class="cs-order-head"><div><div class="cs-customer">${esc(o.name||'بدون اسم')}</div><div class="cs-phone">${esc(o.phone||'بدون رقم')}</div></div><span class="cs-store" title="${esc(o.storeName||'')}">${esc(o.storeName||'بدون متجر')}</span></div>
      <div class="cs-address">📍 ${esc([o.gov,o.address].filter(Boolean).join(' — ')||'لا يوجد عنوان')}</div>
      <div class="cs-product">${esc(o.product||'بدون منتج')}</div>
      ${o.productNote?`<div class="cs-product-note">${esc(o.productNote)}</div>`:''}
      <div class="cs-order-meta">${money(o.total)} جنيه · الكمية ${money(o.qty||1)} · ${esc(String(o.date||'').slice(0,10)||'بدون تاريخ')}</div>
      ${o.customerNote?`<div class="cs-customer-note"><strong>ملاحظة العميل عند الطلب:</strong> ${esc(o.customerNote)}</div>`:''}
      ${o.latestInternalNote?`<div class="cs-internal-latest"><b>آخر ملاحظة داخلية:</b> ${esc(o.latestInternalNote)}</div>`:''}
      ${deferred&&o.deferUntil?`<div class="cs-defer-chip">⏰ مؤجل حتى ${esc(o.deferUntil)}</div>`:''}
      <div class="cs-field"><input class="input" data-cs-note placeholder="ملاحظة داخلية لخدمة العملاء"></div>
      <div class="cs-field"><select class="select" data-cs-state data-current="${esc(o.state)}">${statusOptions(o.state)}</select></div>
      <div class="cs-field"><div style="display:grid;grid-template-columns:1fr auto;gap:6px"><input class="input" data-cs-awb value="${esc(o.awb||'')}" placeholder="رقم البوليصة"><button class="btn soft" data-cs-action="awb">حفظ</button></div></div>
      <div class="cs-actions">
        <button class="btn soft" data-cs-action="history">سجل الأوردر</button>
        <button class="btn soft" data-cs-action="contact">تواصل (${Number(o.contactCount)||0})</button>
        <a class="btn soft" href="tel:${esc(o.phone||'')}" data-cs-action="call">مكالمة</a>
        <button class="btn soft" data-cs-action="whatsapp">واتساب</button>
        <button class="btn soft" data-cs-action="note">حفظ الملاحظة</button>
      </div>
    </article>`;
  }
  function column(stage){const arr=(data?.orders||[]).filter(o=>o.state===stage);return `<section class="cs-column" data-state="${stage}"><div class="cs-column-head"><span>${esc(LABELS[stage])}</span><span class="cs-count">${arr.length}</span></div><div class="cs-list">${arr.length?arr.map(o=>orderCard(o)).join(''):'<div class="cs-empty">مفيش أوردرات هنا دلوقتي</div>'}</div></section>`;}
  function workspace(){
    const deferred=(data?.orders||[]).filter(o=>o.state==='deferred').sort((a,b)=>String(a.deferUntil||'').localeCompare(String(b.deferUntil||'')));
    return `<div class="cs-page"><div class="page-head"><div><div class="title">خدمة العملاء</div><div class="sub">إدارة التأكيد والتجهيز والشحن لكل المتاجر المعيّنة لك، مع تسجيل كل إجراء باسم عضو الفريق.</div></div><div class="spacer"></div><button class="btn soft" id="csReload">تحديث</button></div>
      ${storeTabs()}
      <div class="cs-board">${STAGES.map(column).join('')}</div>
      <section class="cs-deferred"><div class="cs-deferred-head"><div class="title">الطلبات المؤجلة</div><span class="cs-count">${deferred.length}</span></div><div class="cs-deferred-grid">${deferred.length?deferred.map(o=>orderCard(o,{deferred:true})).join(''):'<div class="cs-empty">لا توجد طلبات مؤجلة حاليًا</div>'}</div></section>
    </div>`;
  }
  async function renderWorkspace(){
    if(loading)return;loading=true;const r=root();if(!r){loading=false;return;}r.innerHTML='<div class="cs-loading">جارٍ تحميل أوردرات خدمة العملاء...</div>';
    try{
      if(!clientId)clientId=await (window.kunClientId?.()||Promise.resolve(me?.clientId||''));
      if(!clientId)throw new Error('تعذر تحديد حساب المتجر');
      data=await api(urlFor('/api/customer-service'));
      r.innerHTML=workspace();bindWorkspace();
    }catch(e){r.innerHTML=`<div class="card empty"><h3>تعذر فتح خدمة العملاء</h3><p>${esc(e.message)}</p></div>`;}finally{loading=false;}
  }
  function bindWorkspace(){
    document.getElementById('csReload')?.addEventListener('click',renderWorkspace);
    root()?.querySelectorAll('[data-cs-store]').forEach(b=>b.onclick=()=>{selectedStore=b.dataset.csStore||'';renderWorkspace();});
    root()?.querySelectorAll('[data-cs-order]').forEach(card=>bindCard(card));
  }
  function orderByCard(card){return (data?.orders||[]).find(o=>String(o.id)===String(card.dataset.csOrder));}
  function bindCard(card){
    const select=card.querySelector('[data-cs-state]');
    select.onchange=async()=>{const o=orderByCard(card),next=select.value;if(!o)return;if(next==='deferred'){select.value=select.dataset.current||o.state;openDefer(o);return;}try{await changeState(o,next);select.dataset.current=next;}catch(e){notify(e.message);select.value=select.dataset.current||o.state;}};
    card.querySelectorAll('[data-cs-action]').forEach(btn=>{const a=btn.dataset.csAction;if(a==='call')return;btn.onclick=async()=>{const o=orderByCard(card);if(!o)return;if(a==='history')return openHistory(o);if(a==='contact')return registerContact(o);if(a==='whatsapp')return openWhatsApp(o);if(a==='note')return saveNote(o,card);if(a==='awb')return saveAwb(o,card);};});
  }
  async function changeState(o,state,deferUntil){
    await api(urlFor(`/api/customer-service/orders/${encodeURIComponent(o.id)}/state`,o.storeId),{method:'PATCH',body:bodyFor({state,...(deferUntil?{deferUntil}: {})},o.storeId)});
    notify(state==='deferred'?`تم تأجيل الأوردر حتى ${deferUntil}`:`تم نقل الأوردر إلى ${LABELS[state]||state}`);await renderWorkspace();
  }
  function modal(html){closeModal();const back=document.createElement('div');back.className='cs-modal-back';back.id='csModalBack';back.innerHTML=`<div class="cs-modal" role="dialog" aria-modal="true">${html}</div>`;document.body.appendChild(back);back.addEventListener('click',e=>{if(e.target===back)closeModal();});back.querySelectorAll('[data-cs-close]').forEach(b=>b.onclick=closeModal);return back;}
  function closeModal(){document.getElementById('csModalBack')?.remove();}
  function openDefer(o){
    const m=modal(`<h2>تأجيل الأوردر — ${esc(o.name)}</h2><div class="sub">حدد اليوم اللي يرجع فيه الأوردر تلقائيًا إلى «في انتظار التأكيد».</div><label class="cs-field" style="display:block;margin-top:15px">تاريخ الرجوع<input class="input" id="csDeferDate" type="date" min="${cairoToday()}" value="${esc(o.deferUntil||cairoToday())}"></label><div class="cs-modal-actions"><button class="btn primary" id="csConfirmDefer">تأجيل</button><button class="btn soft" data-cs-close>إلغاء</button></div>`);
    m.querySelector('#csConfirmDefer').onclick=async e=>{const date=m.querySelector('#csDeferDate').value;if(!date){notify('حدد تاريخ الرجوع');return;}e.currentTarget.disabled=true;try{await changeState(o,'deferred',date);closeModal();}catch(err){notify(err.message);e.currentTarget.disabled=false;}};
  }
  function eventText(h){
    if(h.type==='contact')return 'محاولة تواصل مع العميل';
    if(h.type==='whatsapp'){const x={confirm:'إرسال رسالة تأكيد الطلب',shipped:'إرسال رسالة الشحن',review:'إرسال رسالة طلب تقييم',other:'إرسال رسالة واتساب'};return x[h.template]||'إرسال رسالة واتساب';}
    if(h.type==='internal_note')return `ملاحظة داخلية: ${h.note||''}`;
    if(h.type==='awb')return `تحديث رقم البوليصة${h.awb?`: ${h.awb}`:''}`;
    if(h.type==='defer_return'||h.note==='رجع تلقائي من التأجيل')return 'رجع تلقائيًا من التأجيل إلى انتظار التأكيد';
    if(h.state)return `${LABELS[h.state]||h.state}${h.note?` — ${h.note}`:''}`;
    if(h.note)return h.note;
    return h.action||h.type||'تحديث على الأوردر';
  }
  async function openHistory(o){
    try{
      const d=await api(urlFor(`/api/customer-service/orders/${encodeURIComponent(o.id)}/history`,o.storeId)),order=d.order||o,history=[...(order.history||[])].reverse();
      modal(`<h2>سجل الأوردر — ${esc(order.name)}</h2><div class="sub">كل تغيير أو تواصل أو ملاحظة مسجل باسم من نفذه ووقته.</div><div class="cs-history">${history.length?history.map(h=>`<div class="cs-history-row"><div><div class="cs-history-event">${esc(eventText(h))}</div><div class="cs-history-who">بواسطة: ${esc(h.byName||h.by||(h.system?'النظام':'غير مسجل'))}</div></div><div class="cs-history-time">${esc(formatWhen(h.at))}</div></div>`).join(''):'<div class="cs-empty">لا يوجد سجل بعد</div>'}</div><div class="cs-modal-actions"><button class="btn soft" data-cs-close>قفل</button></div>`);
    }catch(e){notify(e.message);}
  }
  async function registerContact(o){
    try{
      const d=await api(urlFor(`/api/customer-service/orders/${encodeURIComponent(o.id)}/contact`,o.storeId),{method:'POST',body:bodyFor({},o.storeId)}),count=(d.log||[]).length;
      notify('تم تسجيل محاولة التواصل');
      modal(`<h2>محاولات التواصل — ${esc(o.name)}</h2><div class="cs-contact-summary">إجمالي المحاولات المسجلة: <b>${count}</b>${d.todayCount!==undefined?` · اليوم: <b>${Number(d.todayCount)||0}</b>`:''}</div><div class="sub">المحاولة اتسجلت باسم المستخدم الحالي ووقتها داخل سجل الأوردر.</div><div class="cs-modal-actions"><button class="btn soft" data-cs-close>قفل</button></div>`);
      await refreshDataSilently();
    }catch(e){notify(e.message);}
  }
  function templatesFor(o){
    const name=o.name||'حضرتك',product=o.product||'طلبك',total=money(o.total),base={};
    base.confirm={label:'رسالة تأكيد الطلب',log:'confirm',text:`مرحبًا ${name}، بنأكد طلبك ${product} بإجمالي ${total} جنيه. هل نأكد الطلب ونبدأ التجهيز؟`};
    base.preparing={label:'رسالة التجهيز والتغليف',log:'other',text:`مرحبًا ${name}، طلبك ${product} تم تأكيده ودخل مرحلة التجهيز والتغليف. هنبلغك فور خروجه للشحن.`};
    base.shipped={label:'رسالة جاري الشحن',log:'shipped',text:`مرحبًا ${name}، طلبك ${product} خرج للشحن وهو في الطريق ليك.${o.awb?` رقم البوليصة: ${o.awb}.`:''}`};
    base.review={label:'رسالة طلب تقييم',log:'review',text:`مرحبًا ${name}، نتمنى تكون تجربتك مع الطلب كانت كويسة. يسعدنا نعرف تقييمك وملاحظاتك.`};
    base.deferred={label:'متابعة الطلب المؤجل',log:'other',text:`مرحبًا ${name}، بنتابع مع حضرتك بخصوص طلبك ${product} اللي اتفقنا نرجع نتواصل عليه${o.deferUntil?` بتاريخ ${o.deferUntil}`:''}. هل مناسب نأكد الطلب دلوقتي؟`};
    if(o.state==='pending')return [base.confirm,base.preparing];
    if(o.state==='confirmed')return [base.preparing,base.shipped];
    if(o.state==='preparing')return [base.preparing,base.shipped];
    if(o.state==='shipped')return [base.shipped,base.review];
    if(o.state==='deferred')return [base.deferred,base.confirm];
    return [base.confirm,base.shipped,base.review];
  }
  function openWhatsApp(o){
    const list=templatesFor(o),m=modal(`<h2>ابعث واتساب — ${esc(o.name)}</h2><div class="sub">اختار قالب مناسب لحالة الأوردر الحالية. الإرسال بيتسجل في سجل الأوردر باسمك.</div><div class="cs-wa-list">${list.map((t,i)=>`<button class="cs-wa-template ${i?'secondary':''}" data-cs-wa="${i}">${esc(t.label)}</button>`).join('')}</div><div class="cs-modal-actions"><button class="btn soft" data-cs-close>إلغاء</button></div>`);
    m.querySelectorAll('[data-cs-wa]').forEach(b=>b.onclick=()=>sendWhatsApp(o,list[Number(b.dataset.csWa)]));
  }
  async function sendWhatsApp(o,t){
    const p=phoneIntl(o.phone);if(!p){notify('رقم العميل غير صالح لواتساب');return;}
    const win=window.open(`https://wa.me/${encodeURIComponent(p)}?text=${encodeURIComponent(t.text)}`,'_blank','noopener,noreferrer');
    if(!win)notify('المتصفح منع فتح واتساب — اسمح بالنوافذ المنبثقة وحاول تاني');
    closeModal();
    try{await api(urlFor(`/api/customer-service/orders/${encodeURIComponent(o.id)}/whatsapp-log`,o.storeId),{method:'POST',body:bodyFor({template:t.log},o.storeId)});notify('تم تسجيل فتح رسالة واتساب في سجل الأوردر');await refreshDataSilently();}catch(e){notify(`واتساب اتفتح، لكن تعذر تسجيل الحدث: ${e.message}`);}
  }
  async function saveNote(o,card){
    const input=card.querySelector('[data-cs-note]'),note=input?.value.trim();if(!note){notify('اكتب الملاحظة الأول');return;}
    try{await api(urlFor(`/api/customer-service/orders/${encodeURIComponent(o.id)}/notes`,o.storeId),{method:'POST',body:bodyFor({note},o.storeId)});input.value='';notify('تم حفظ الملاحظة الداخلية');await renderWorkspace();}catch(e){notify(e.message);}
  }
  async function saveAwb(o,card){
    const awb=card.querySelector('[data-cs-awb]')?.value.trim()||'';
    try{await api(urlFor(`/api/customer-service/orders/${encodeURIComponent(o.id)}/awb`,o.storeId),{method:'PATCH',body:bodyFor({awb},o.storeId)});notify('تم حفظ رقم البوليصة');await refreshDataSilently();}catch(e){notify(e.message);}
  }
  async function refreshDataSilently(){
    try{data=await api(urlFor('/api/customer-service'));const current=root();if(current?.querySelector('.cs-page')){current.innerHTML=workspace();bindWorkspace();}}catch{}
  }
  async function boot(){
    const nav=document.querySelector('.nav button[data-view="customer-service"]');if(!nav)return;
    try{me=await api('/api/me');if(!ALLOWED.has(me.role)){nav.remove();return;}nav.classList.add('is-visible');nav.onclick=()=>{document.querySelectorAll('.nav button').forEach(b=>b.classList.toggle('active',b===nav));renderWorkspace();};}catch{nav.remove();}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
  window.KunCustomerServiceV31={render:renderWorkspace};
})();
