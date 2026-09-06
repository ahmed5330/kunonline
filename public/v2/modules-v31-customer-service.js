/* Kun Online v31.2 — multi-store Customer Service workspace — persistent notes, no-answer follow-up and in-place updates */
(function(){
  const ALLOWED=new Set(['admin','client','ops','support']);
  const STAGES=['pending','no_answer','confirmed','preparing','shipped'];
  const LABELS={pending:'في انتظار التأكيد',no_answer:'العميل لا يرد',confirmed:'تم التأكيد',preparing:'التجهيز والتغليف',shipped:'جاري الشحن',signed:'تحصيل منتظر',collected:'تم التحصيل',returned:'مرتجع',cancelled:'تم إلغاء الطلب',deferred:'مؤجل'};
  const STATUS_ORDER=['pending','no_answer','confirmed','preparing','shipped','signed','collected','returned','cancelled','deferred'];
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
  function statusOptions(current,contactCount=0){
    const noAnswerAllowed=['pending','no_answer','deferred'].includes(current);
    return STATUS_ORDER.filter(s=>s!=='no_answer'||noAnswerAllowed).map(s=>{const label=s==='no_answer'?`${LABELS[s]} — ${Number(contactCount)||0} محاولة تواصل`:(LABELS[s]||s);return `<option value="${s}" ${s===current?'selected':''}>${esc(label)}</option>`;}).join('');
  }

  function storeTabs(){
    const tabs=[{id:'',name:'كل المتاجر'},...(data?.stores||[])];
    return `<div class="cs-store-tabs" role="tablist" aria-label="المتاجر المسموحة">${tabs.map(s=>`<button class="cs-store-tab ${String(selectedStore)===String(s.id||'')?'active':''}" data-cs-store="${esc(s.id||'')}">${esc(s.name||s.id)}</button>`).join('')}</div>`;
  }
  function orderCard(o,{deferred=false}={}){
    const attempts=Number(o.contactCount)||0;
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
      <div class="cs-contact-attempts" data-cs-contact-attempts><span>محاولات التواصل (مكالمة + تواصل)</span><b data-cs-contact-count>${attempts}</b></div>
      <div class="cs-field cs-note-field"><input class="input" data-cs-note placeholder="ملاحظة داخلية لخدمة العملاء"><button type="button" class="btn primary cs-note-add" data-cs-action="note">إضافة</button></div>
      <div class="cs-field"><select class="select" data-cs-state data-current="${esc(o.state)}">${statusOptions(o.state,attempts)}</select></div>
      <div class="cs-field"><div style="display:grid;grid-template-columns:1fr auto;gap:6px"><input class="input" data-cs-awb value="${esc(o.awb||'')}" placeholder="رقم البوليصة"><button class="btn soft" data-cs-action="awb">حفظ</button></div></div>
      <div class="cs-actions">
        <button class="btn soft" data-cs-action="history">سجل الأوردر</button>
        <button class="btn soft" data-cs-action="contact">تواصل (${attempts})</button>
        <a class="btn soft" href="tel:${esc(o.phone||'')}" data-cs-action="call">مكالمة</a>
        <button class="btn soft" data-cs-action="whatsapp">واتساب</button>
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
  }

  const pendingActions=new Set();
  document.addEventListener('click',event=>{
    const button=event.target.closest?.('[data-cs-action]'),card=button?.closest?.('#root [data-cs-order]');
    if(!card)return;
    const action=button.dataset.csAction,o=orderByCard(card);
    if(!['history','contact','call','whatsapp','note','awb'].includes(action))return;
    if(action!=='call')event.preventDefault();
    if(!o){notify('تعذر تحديد الأوردر، حدّث القسم وحاول مرة أخرى');return;}
    const key=`${o.id}:${action}`;if(pendingActions.has(key))return;
    if(action==='history'){openHistory(o);return;}
    if(action==='whatsapp'){openWhatsApp(o);return;}
    pendingActions.add(key);button.setAttribute('aria-busy','true');if(action!=='call')button.disabled=true;
    const work=action==='note'?saveNote(o,card):action==='awb'?saveAwb(o,card):registerContact(o,action==='call');
    Promise.resolve(work).finally(()=>{pendingActions.delete(key);button.removeAttribute('aria-busy');if(action!=='call')button.disabled=false;});
  });

  function cardsForOrder(orderId){return [...(root()?.querySelectorAll('[data-cs-order]')||[])].filter(card=>String(card.dataset.csOrder)===String(orderId));}
  function updateContactUi(card,count){
    const n=Number(count)||0,contact=card.querySelector('[data-cs-action="contact"]'),counter=card.querySelector('[data-cs-contact-count]'),select=card.querySelector('[data-cs-state]');
    if(contact)contact.textContent=`تواصل (${n})`;if(counter)counter.textContent=String(n);
    const option=select?.querySelector('option[value="no_answer"]');if(option)option.textContent=`${LABELS.no_answer} — ${n} محاولة تواصل`;
  }
  function applyInteraction(o,d){
    if(Array.isArray(d.history)){o.history=d.history;o.internalNotes=d.history.filter(h=>h.type==='internal_note');o.latestInternalNote=o.internalNotes.at(-1)?.note||'';}
    if(Array.isArray(d.log)){o.contactLog=d.log;o.contactCount=d.contactCount??d.log.length;}
    cardsForOrder(o.id).forEach(card=>{
      updateContactUi(card,o.contactCount);
      if(o.latestInternalNote){
        let latest=card.querySelector('.cs-internal-latest');
        if(!latest){latest=document.createElement('div');latest.className='cs-internal-latest';const field=card.querySelector('.cs-note-field');if(field)field.before(latest);else card.appendChild(latest);}
        latest.innerHTML=`<b>آخر ملاحظة داخلية:</b> ${esc(o.latestInternalNote)}`;
      }
    });
  }
  function ensureCustomerNote(card,note){
    let box=card.querySelector('.cs-customer-note');
    if(note){if(!box){box=document.createElement('div');box.className='cs-customer-note';const anchor=card.querySelector('.cs-contact-attempts,.cs-note-field');anchor?.before(box);}if(box)box.innerHTML=`<strong>ملاحظة العميل عند الطلب:</strong> ${esc(note)}`;}
    else box?.remove();
  }
  function patchCardBasics(card,o){
    const name=card.querySelector('.cs-customer'),phone=card.querySelector('.cs-phone'),address=card.querySelector('.cs-address'),product=card.querySelector('.cs-product'),productNote=card.querySelector('.cs-product-note'),meta=card.querySelector('.cs-order-meta'),awb=card.querySelector('[data-cs-awb]'),call=card.querySelector('[data-cs-action="call"]'),select=card.querySelector('[data-cs-state]');
    if(name)name.textContent=o.name||'بدون اسم';if(phone)phone.textContent=o.phone||'بدون رقم';if(address)address.textContent=`📍 ${[o.gov,o.address].filter(Boolean).join(' — ')||'لا يوجد عنوان'}`;if(product)product.textContent=o.product||'بدون منتج';if(productNote)productNote.textContent=o.productNote||'';if(meta)meta.textContent=`${money(o.total)} جنيه · الكمية ${money(o.qty||1)} · ${String(o.date||'').slice(0,10)||'بدون تاريخ'}`;if(awb&&document.activeElement!==awb)awb.value=o.awb||'';if(call)call.href=`tel:${o.phone||''}`;if(select){select.innerHTML=statusOptions(o.state,o.contactCount);select.value=o.state;select.dataset.current=o.state;}ensureCustomerNote(card,o.customerNote||'');updateContactUi(card,o.contactCount);
  }
  function patchOrder(orderId,patch={}){
    const o=(data?.orders||[]).find(item=>String(item.id)===String(orderId));if(!o)return false;Object.assign(o,patch);cardsForOrder(orderId).forEach(card=>patchCardBasics(card,o));return true;
  }
  function listForState(state){
    if(state==='deferred')return root()?.querySelector('.cs-deferred-grid')||null;
    if(STAGES.includes(state))return root()?.querySelector(`.cs-column[data-state="${state}"] .cs-list`)||null;
    return null;
  }
  function refreshContainerSummaries(){
    root()?.querySelectorAll('.cs-column[data-state]').forEach(column=>{const list=column.querySelector('.cs-list'),count=list?.querySelectorAll(':scope > .cs-order').length||0,countEl=column.querySelector('.cs-count');if(countEl)countEl.textContent=String(count);if(list){list.querySelector('.cs-empty')?.remove();if(!count)list.innerHTML='<div class="cs-empty">مفيش أوردرات هنا دلوقتي</div>';}});
    const deferred=root()?.querySelector('.cs-deferred'),list=deferred?.querySelector('.cs-deferred-grid'),count=list?.querySelectorAll(':scope > .cs-order').length||0,countEl=deferred?.querySelector('.cs-deferred-head .cs-count');if(countEl)countEl.textContent=String(count);if(list){list.querySelector('.cs-empty')?.remove();if(!count)list.innerHTML='<div class="cs-empty">لا توجد طلبات مؤجلة حاليًا</div>';}
  }
  function moveOrderState(o,state,deferUntil){
    o.state=state;if(state==='deferred')o.deferUntil=deferUntil||o.deferUntil||cairoToday();else if(state!=='deferred')o.deferUntil=null;
    const target=listForState(state),cards=cardsForOrder(o.id);
    cards.forEach(card=>{
      const select=card.querySelector('[data-cs-state]');if(select){select.innerHTML=statusOptions(state,o.contactCount);select.value=state;select.dataset.current=state;}
      let chip=card.querySelector('.cs-defer-chip');if(state==='deferred'){if(!chip){chip=document.createElement('div');chip.className='cs-defer-chip';const attempts=card.querySelector('.cs-contact-attempts');attempts?.before(chip);}if(chip)chip.textContent=`⏰ مؤجل حتى ${o.deferUntil}`;}else chip?.remove();
      if(target){target.querySelector('.cs-empty')?.remove();target.prepend(card);}else card.remove();
    });
    refreshContainerSummaries();window.KunCustomerServiceOrderEdit?.scan?.();window.KunConfirmInventoryV58?.scan?.();window.KunCustomerServiceRichCards?.scan?.();
    return true;
  }
  async function changeState(o,state,deferUntil){
    await api(urlFor(`/api/customer-service/orders/${encodeURIComponent(o.id)}/state`,o.storeId),{method:'PATCH',body:bodyFor({state,...(deferUntil?{deferUntil}: {})},o.storeId)});
    moveOrderState(o,state,deferUntil);notify(state==='deferred'?`تم تأجيل الأوردر حتى ${deferUntil}`:`تم نقل الأوردر إلى ${LABELS[state]||state}`);
  }
  function modal(html){closeModal();const back=document.createElement('div');back.className='cs-modal-back';back.id='csModalBack';back.innerHTML=`<div class="cs-modal" role="dialog" aria-modal="true">${html}</div>`;document.body.appendChild(back);back.addEventListener('click',e=>{if(e.target===back)closeModal();});back.querySelectorAll('[data-cs-close]').forEach(b=>b.onclick=closeModal);return back;}
  function closeModal(){document.getElementById('csModalBack')?.remove();}
  function openDefer(o){
    const m=modal(`<h2>تأجيل الأوردر — ${esc(o.name)}</h2><div class="sub">حدد اليوم اللي يرجع فيه الأوردر تلقائيًا إلى «في انتظار التأكيد».</div><label class="cs-field" style="display:block;margin-top:15px">تاريخ الرجوع<input class="input" id="csDeferDate" type="date" min="${cairoToday()}" value="${esc(o.deferUntil||cairoToday())}"></label><div class="cs-modal-actions"><button class="btn primary" id="csConfirmDefer">تأجيل</button><button class="btn soft" data-cs-close>إلغاء</button></div>`);
    m.querySelector('#csConfirmDefer').onclick=async e=>{const date=m.querySelector('#csDeferDate').value;if(!date){notify('حدد تاريخ الرجوع');return;}e.currentTarget.disabled=true;try{await changeState(o,'deferred',date);closeModal();}catch(err){notify(err.message);e.currentTarget.disabled=false;}};
  }
  function eventText(h){
    if(h.type==='contact')return h.intent==='call'?'إجراء مكالمة — تم الضغط على زر الاتصال':'محاولة تواصل مع العميل';
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
  async function registerContact(o,isCall=false){
    try{
      const d=await api(urlFor(`/api/customer-service/orders/${encodeURIComponent(o.id)}/contact`,o.storeId),{method:'POST',keepalive:isCall,body:bodyFor({channel:'phone',intent:isCall?'call':'contact'},o.storeId)}),count=d.contactCount??(d.log||[]).length;
      applyInteraction(o,d);
      if(isCall){notify('تم تسجيل إجراء المكالمة في سجل الأوردر');return;}
      notify('تم تسجيل محاولة التواصل');
      modal(`<h2>محاولات التواصل — ${esc(o.name)}</h2><div class="cs-contact-summary">إجمالي المحاولات المسجلة: <b>${count}</b>${d.todayCount!==undefined?` · اليوم: <b>${Number(d.todayCount)||0}</b>`:''}</div><div class="sub">العدد يجمع زر «مكالمة» وزر «تواصل»، وكل محاولة مسجلة باسم المستخدم الحالي ووقتها داخل سجل الأوردر.</div><div class="cs-modal-actions"><button class="btn soft" data-cs-close>قفل</button></div>`);
    }catch(e){notify(isCall?`تم فتح الاتصال، لكن تعذر تسجيل المكالمة: ${e.message}`:e.message);}
  }
  function templatesFor(o){
    const name=o.name||'حضرتك',product=o.product||'طلبك',total=money(o.total),base={};
    base.confirm={label:'رسالة تأكيد الطلب',log:'confirm',text:`مرحبًا ${name}، بنأكد طلبك ${product} بإجمالي ${total} جنيه. هل نأكد الطلب ونبدأ التجهيز؟`};
    base.preparing={label:'رسالة التجهيز والتغليف',log:'other',text:`مرحبًا ${name}، طلبك ${product} تم تأكيده ودخل مرحلة التجهيز والتغليف. هنبلغك فور خروجه للشحن.`};
    base.shipped={label:'رسالة جاري الشحن',log:'shipped',text:`مرحبًا ${name}، طلبك ${product} خرج للشحن وهو في الطريق ليك.${o.awb?` رقم البوليصة: ${o.awb}.`:''}`};
    base.review={label:'رسالة طلب تقييم',log:'review',text:`مرحبًا ${name}، نتمنى تكون تجربتك مع الطلب كانت كويسة. يسعدنا نعرف تقييمك وملاحظاتك.`};
    base.deferred={label:'متابعة الطلب المؤجل',log:'other',text:`مرحبًا ${name}، بنتابع مع حضرتك بخصوص طلبك ${product} اللي اتفقنا نرجع نتواصل عليه${o.deferUntil?` بتاريخ ${o.deferUntil}`:''}. هل مناسب نأكد الطلب دلوقتي؟`};
    base.noAnswer={label:'متابعة عميل لا يرد',log:'other',text:`مرحبًا ${name}، حاولنا نتواصل مع حضرتك بخصوص طلبك ${product}. لو مناسب، ابعتلنا رد علشان نأكد الطلب ونبدأ التجهيز.`};
    if(o.state==='pending')return [base.confirm,base.preparing];
    if(o.state==='no_answer')return [base.noAnswer,base.confirm];
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
    try{await api(urlFor(`/api/customer-service/orders/${encodeURIComponent(o.id)}/whatsapp-log`,o.storeId),{method:'POST',body:bodyFor({template:t.log},o.storeId)});notify('تم تسجيل فتح رسالة واتساب في سجل الأوردر');}catch(e){notify(`واتساب اتفتح، لكن تعذر تسجيل الحدث: ${e.message}`);}
  }
  async function saveNote(o,card){
    const input=card.querySelector('[data-cs-note]'),note=input?.value.trim();if(!note){notify('اكتب الملاحظة الأول');return;}
    try{const saved=await api(urlFor(`/api/customer-service/orders/${encodeURIComponent(o.id)}/notes`,o.storeId),{method:'POST',body:bodyFor({note},o.storeId)});applyInteraction(o,saved);if(input.value.trim()===note)input.value='';notify('تم حفظ الملاحظة الداخلية');}catch(e){notify(e.message);}
  }
  async function saveAwb(o,card){
    const awb=card.querySelector('[data-cs-awb]')?.value.trim()||'';
    try{const saved=await api(urlFor(`/api/customer-service/orders/${encodeURIComponent(o.id)}/awb`,o.storeId),{method:'PATCH',body:bodyFor({awb},o.storeId)});o.awb=saved.awb??awb;if(Array.isArray(saved.history))o.history=saved.history;cardsForOrder(o.id).forEach(c=>{const input=c.querySelector('[data-cs-awb]');if(input&&document.activeElement!==input)input.value=o.awb||'';});notify('تم حفظ رقم البوليصة');}catch(e){notify(e.message);}
  }
  async function boot(){
    const nav=document.querySelector('.nav button[data-view="customer-service"]');if(!nav)return;
    try{me=await api('/api/me');if(!ALLOWED.has(me.role)){nav.remove();return;}nav.classList.add('is-visible');nav.onclick=()=>{document.querySelectorAll('.nav button').forEach(b=>b.classList.toggle('active',b===nav));renderWorkspace();};}catch{nav.remove();}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
  window.KunCustomerServiceV31={render:renderWorkspace,patchOrder,moveState:(orderId,state,deferUntil)=>{const o=(data?.orders||[]).find(item=>String(item.id)===String(orderId));return o?moveOrderState(o,state,deferUntil):false;},updateContactCount:(orderId,count)=>{const o=(data?.orders||[]).find(item=>String(item.id)===String(orderId));if(o)o.contactCount=Number(count)||0;cardsForOrder(orderId).forEach(card=>updateContactUi(card,count));},version:'31.2'};
})();
