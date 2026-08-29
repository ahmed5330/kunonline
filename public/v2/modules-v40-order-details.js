/* Kun Online v40 — unified rich order details for Orders + Customer Service */
(function(){
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=v=>new Intl.NumberFormat('ar-EG',{maximumFractionDigits:2}).format(Number(v)||0);
  const fmtDate=v=>{if(!v)return '—';const d=new Date(v);if(Number.isNaN(d.getTime()))return esc(v);return new Intl.DateTimeFormat('ar-EG',{dateStyle:'medium',timeStyle:String(v).includes('T')?'short':undefined,timeZone:'Africa/Cairo'}).format(d);};
  const STATE={pending:'في انتظار التأكيد',confirmed:'تم التأكيد',preparing:'التجهيز والتغليف',shipped:'جاري الشحن',signed:'تم التسليم',collected:'تم التحصيل',returned:'مرتجع',cancelled:'ملغي',deferred:'مؤجل'};
  const PAYMENT={cod:'الدفع عند الاستلام',cash_on_delivery:'الدفع عند الاستلام',cash:'نقدي',card:'بطاقة',online:'دفع إلكتروني'};
  const drawer=()=>document.getElementById('drawer'),back=()=>document.getElementById('drawerBack');
  const value=v=>String(v??'').trim();
  const present=v=>value(v)!=='';

  function ensureStyle(){
    if(document.getElementById('kunOrderDetailsStyle'))return;
    const s=document.createElement('style');s.id='kunOrderDetailsStyle';s.textContent=`
      .drawer.kun-order-details-open{width:min(940px,96vw);max-width:96vw;overflow:auto}
      .kod-page{padding-bottom:28px}.kod-head{display:flex;gap:12px;align-items:flex-start;position:sticky;top:0;z-index:4;background:var(--bg,#fff);padding:4px 0 14px}
      .kod-head-main{min-width:0}.kod-order-id{font-size:23px;font-weight:800;overflow-wrap:anywhere}.kod-sub{font-size:12px;opacity:.7;margin-top:4px}.kod-spacer{flex:1}
      .kod-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}.kod-card{border:1px solid var(--line,#e5e7eb);border-radius:16px;padding:16px;background:var(--card,#fff)}
      .kod-card h3{margin:0 0 14px;font-size:17px}.kod-field-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 14px}.kod-field{min-width:0}.kod-label{font-size:11px;opacity:.62;margin-bottom:4px}.kod-value{font-weight:700;overflow-wrap:anywhere;white-space:pre-wrap}.kod-muted{opacity:.68;font-size:12px}
      .kod-products{display:grid;gap:10px}.kod-item{display:grid;grid-template-columns:68px minmax(0,1fr) auto;gap:12px;align-items:start;border:1px solid var(--line,#e5e7eb);border-radius:14px;padding:12px}.kod-thumb{width:68px;height:68px;border-radius:12px;object-fit:cover;background:rgba(127,127,127,.08)}
      .kod-thumb-fallback{display:grid;place-items:center;font-size:24px}.kod-item-name{font-weight:800;line-height:1.5}.kod-item-meta{font-size:12px;opacity:.7;margin-top:3px}.kod-options{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.kod-option{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--line,#e5e7eb);border-radius:999px;padding:4px 8px;font-size:12px}.kod-swatch{width:14px;height:14px;border-radius:50%;border:1px solid rgba(127,127,127,.4)}.kod-price{text-align:left;white-space:nowrap;font-weight:800}
      .kod-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:12px}.kod-kpi{border:1px solid var(--line,#e5e7eb);border-radius:12px;padding:10px}.kod-kpi b{display:block;font-size:17px;margin-top:3px}.kod-address{grid-column:1/-1}.kod-products-card{grid-column:1/-1}.kod-summary{grid-column:1/-1}.kod-note{margin-top:10px;padding:10px 12px;border-radius:10px;background:rgba(127,127,127,.08);white-space:pre-wrap}.kod-warning{grid-column:1/-1;border:1px solid #f0b429;background:rgba(240,180,41,.1);border-radius:12px;padding:10px 12px;font-size:12px}.kod-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.kod-copy{cursor:pointer}.kod-empty{opacity:.6}.kod-loading{padding:35px;text-align:center}
      @media(max-width:720px){.drawer.kun-order-details-open{width:100vw;max-width:100vw}.kod-grid{grid-template-columns:1fr}.kod-address,.kod-products-card,.kod-summary{grid-column:auto}.kod-field-grid{grid-template-columns:1fr}.kod-kpis{grid-template-columns:1fr 1fr}.kod-item{grid-template-columns:52px minmax(0,1fr)}.kod-thumb{width:52px;height:52px}.kod-price{grid-column:2;text-align:right}}
    `;document.head.appendChild(s);
  }
  function show(html){
    ensureStyle();const d=drawer(),b=back();if(!d||!b)return;d.classList.add('kun-order-details-open','open');b.classList.add('show');d.innerHTML=html;
    d.querySelectorAll('[data-kod-close]').forEach(x=>x.onclick=close);
    d.querySelectorAll('[data-kod-copy]').forEach(x=>x.onclick=async()=>{const t=x.dataset.kodCopy||'';try{await navigator.clipboard.writeText(t);window.showToast?.('تم النسخ');}catch{}});
  }
  function close(){const d=drawer(),b=back();if(!d||!b)return;d.classList.remove('kun-order-details-open','open');b.classList.remove('show');}
  function field(label,val,{copy=false,html=false}={}){if(!present(val)&&!html)return '';const display=html?val:esc(val);return `<div class="kod-field"><div class="kod-label">${esc(label)}</div><div class="kod-value">${display}${copy&&present(val)?` <button class="link kod-copy" type="button" data-kod-copy="${esc(val)}" title="نسخ">نسخ</button>`:''}</div></div>`;}
  function colorSwatch(v){const c=value(v);return /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(c)?`<span class="kod-swatch" style="background:${esc(c)}"></span>`:'';}
  function itemHtml(item){
    const options=(item.options||[]).map(o=>`<span class="kod-option">${colorSwatch(o.value)}<b>${esc(o.name)}:</b> ${esc(o.value)}</span>`).join('');
    const image=item.image?`<img class="kod-thumb" src="${esc(item.image)}" alt="${esc(item.name||'المنتج')}" loading="lazy">`:'<div class="kod-thumb kod-thumb-fallback">📦</div>';
    const skus=[item.sku?`SKU: ${esc(item.sku)}`:'',item.variantSku?`Variant SKU: ${esc(item.variantSku)}`:''].filter(Boolean).join(' · ');
    return `<div class="kod-item">${image}<div><div class="kod-item-name">${esc(item.name||'منتج')}</div>${skus?`<div class="kod-item-meta">${skus}</div>`:''}${item.variantName?`<div class="kod-item-meta">${esc(item.variantName)}</div>`:''}${options?`<div class="kod-options">${options}</div>`:''}${item.note?`<div class="kod-note">${esc(item.note)}</div>`:''}</div><div class="kod-price"><div>${money(item.price)} EGP × ${Number(item.quantity)||1}</div><div class="kod-muted">${money(item.lineTotal)} EGP</div></div></div>`;
  }
  function addressHtml(a={}){
    const parts=[field('المحافظة',a.government),field('المدينة',a.city),field('المنطقة / الحي',a.area),field('الشارع',a.street),field('رقم المبنى',a.building),field('الدور',a.floor),field('الشقة',a.apartment),field('علامة مميزة',a.landmark),field('الرقم البريدي',a.postalCode),field('العنوان بالتفصيل',a.address,{copy:true})].join('');
    return parts||'<div class="kod-empty">لا توجد تفاصيل عنوان إضافية مسجلة.</div>';
  }
  function customerHtml(c={}){
    const phone=c.phone?`<a href="tel:${esc(c.phone)}">${esc(c.phone)}</a>`:'—',alt=c.alternatePhone?`<a href="tel:${esc(c.alternatePhone)}">${esc(c.alternatePhone)}</a>`:'';
    return `<div class="kod-field-grid">${field('الاسم',c.name)}${field('رقم الهاتف',phone,{html:true})}${field('رقم بديل',alt,{html:true})}${field('البريد الإلكتروني',c.email)}${field('المحافظة',c.government)}${field('تاريخ أول تعامل',fmtDate(c.createdAt))}</div>
      <div class="kod-kpis"><div class="kod-kpi"><span class="kod-muted">إجمالي الطلبات</span><b>${Number(c.totalOrders)||0}</b></div><div class="kod-kpi"><span class="kod-muted">تم التسليم</span><b>${Number(c.deliveredOrders)||0}</b></div><div class="kod-kpi"><span class="kod-muted">مرتجع</span><b>${Number(c.returnedOrders)||0}</b></div><div class="kod-kpi"><span class="kod-muted">إجمالي التعامل</span><b>${money(c.totalSpent)} EGP</b></div></div>
      ${Array.isArray(c.tags)&&c.tags.length?`<div class="kod-options">${c.tags.map(t=>`<span class="kod-option">${esc(t)}</span>`).join('')}</div>`:''}${c.note?`<div class="kod-note"><b>ملاحظة العميل:</b> ${esc(c.note)}</div>`:''}
      ${c.phone?`<div class="kod-actions"><a class="btn soft" href="tel:${esc(c.phone)}">اتصال</a><a class="btn soft" target="_blank" rel="noopener" href="https://wa.me/${esc(String(c.phone).replace(/\D/g,''))}">واتساب</a><button type="button" class="btn soft" data-kod-copy="${esc(c.phone)}">نسخ الرقم</button></div>`:''}`;
  }
  function render(data){
    const o=data.order||{},s=data.summary||{},items=data.items||[],customer=data.customer||{},a=data.address||{};
    const payment=PAYMENT[value(s.paymentMethod).toLowerCase()]||s.paymentMethod||'غير مسجل';
    return `<div class="kod-page"><div class="kod-head"><div class="kod-head-main"><div class="kod-order-id">الطلب ${esc(o.id||'')}</div><div class="kod-sub">${esc(o.storeName||'')} ${o.source?`· ${esc(o.source)}`:''} · ${fmtDate(o.date)}</div></div><div class="kod-spacer"></div><button type="button" class="btn soft" data-kod-close>إغلاق</button></div>
      <div class="kod-grid">
        ${data.provider?.warning?`<div class="kod-warning">تفاصيل Kun متاحة، لكن ${esc(data.provider.warning)}</div>`:''}
        <section class="kod-card kod-products-card"><h3>تفاصيل المنتجات</h3><div class="kod-products">${items.length?items.map(itemHtml).join(''):'<div class="kod-empty">لا توجد عناصر منتج مسجلة.</div>'}</div></section>
        <section class="kod-card"><h3>بيانات العميل</h3>${customerHtml(customer)}</section>
        <section class="kod-card kod-address"><h3>بيانات وعنوان الشحن</h3><div class="kod-field-grid">${addressHtml(a)}</div></section>
        <section class="kod-card kod-summary"><h3>ملخص الطلب</h3><div class="kod-field-grid">${field('الحالة',STATE[o.state]||o.state||'—')}${field('وسيلة الدفع',payment)}${field('إجمالي الكمية',s.quantity)}${field('مجموع المنتجات',`${money(s.subtotal)} EGP`)}${field('رسوم التوصيل',`${money(s.shippingCost)} EGP`)}${Number(s.discountAmount)>0?field('الخصم',`${money(s.discountAmount)} EGP`):''}${field('الإجمالي المطلوب',`${money(s.total)} EGP`)}${field('كود الكوبون',o.couponCode)}${field('رقم البوليصة',o.awb,{copy:true})}${field('مصدر الطلب',o.source)}${field('رقم الطلب الأصلي',o.ref,{copy:true})}</div>${o.customerNote?`<div class="kod-note"><b>ملاحظة على الطلب:</b> ${esc(o.customerNote)}</div>`:''}</section>
      </div></div>`;
  }
  async function open(orderId){
    if(!orderId)return;show('<div class="kod-loading">جارٍ تحميل كل تفاصيل الطلب...</div>');
    try{
      const clientId=await (window.kunClientId?.()||Promise.resolve(''));if(!clientId)throw new Error('تعذر تحديد المتجر');
      const r=await fetch(`/api/orders/${encodeURIComponent(orderId)}/details?clientId=${encodeURIComponent(clientId)}`,{credentials:'include'}),d=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(d.error||'تعذر تحميل تفاصيل الطلب');show(render(d));
    }catch(error){show(`<div class="kod-page"><div class="kod-head"><div class="kod-order-id">تعذر فتح تفاصيل الطلب</div><div class="kod-spacer"></div><button class="btn soft" data-kod-close>إغلاق</button></div><div class="kod-card">${esc(error?.message||String(error))}</div></div>`);}
  }
  function injectCustomerServiceButtons(){
    document.querySelectorAll('#root .cs-order[data-cs-order]').forEach(card=>{
      const actions=card.querySelector('.cs-actions');if(!actions||actions.querySelector('[data-kod-cs-details]'))return;
      const button=document.createElement('button');button.type='button';button.className='btn soft';button.dataset.kodCsDetails=card.dataset.csOrder||'';button.textContent='تفاصيل الطلب';actions.prepend(button);
    });
  }
  document.addEventListener('click',event=>{
    const cs=event.target.closest?.('[data-kod-cs-details]');if(cs){event.preventDefault();event.stopImmediatePropagation();open(cs.dataset.kodCsDetails);return;}
    const order=event.target.closest?.('#root button[data-order]');if(order){event.preventDefault();event.stopImmediatePropagation();open(order.dataset.order);}
  },true);
  const root=document.getElementById('root')||document.body,observer=new MutationObserver(injectCustomerServiceButtons);observer.observe(root,{subtree:true,childList:true});
  setTimeout(injectCustomerServiceButtons,0);
  window.KunOrderDetails={open,close};
  try{window.openOrder=open;}catch{}
  document.documentElement.dataset.orderDetailsUi='v40-ready';
})();
