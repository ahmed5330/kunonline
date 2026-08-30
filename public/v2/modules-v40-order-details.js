/* Kun Online v40.1 — reference-matched order product + customer details */
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
      .drawer.kun-order-details-open{width:min(1120px,98vw);max-width:98vw;overflow:auto}
      .kod-page{padding-bottom:28px}.kod-head{display:flex;gap:12px;align-items:flex-start;position:sticky;top:0;z-index:4;background:var(--bg,#fff);padding:4px 0 14px}
      .kod-head-main{min-width:0}.kod-order-id{font-size:23px;font-weight:800;overflow-wrap:anywhere}.kod-sub{font-size:12px;opacity:.7;margin-top:4px}.kod-spacer{flex:1}
      .kod-grid{display:grid;grid-template-columns:minmax(0,2fr) minmax(285px,.9fr);gap:16px;margin-top:12px;align-items:start}.kod-card{border:1px solid var(--line,#e5e7eb);border-radius:16px;padding:18px;background:var(--card,#fff)}
      .kod-card h3{margin:0 0 18px;font-size:17px}.kod-field-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 14px}.kod-field{min-width:0}.kod-label{font-size:11px;opacity:.62;margin-bottom:4px}.kod-value{font-weight:700;overflow-wrap:anywhere;white-space:pre-wrap}.kod-muted{opacity:.68;font-size:12px}
      .kod-products-card{grid-column:1}.kod-customer-card{grid-column:2}.kod-products{display:block}.kod-item{display:grid;grid-template-columns:68px minmax(0,1fr) 84px 72px;gap:16px;align-items:center;padding:16px 0}.kod-item+.kod-item{border-top:1px solid var(--line,#e5e7eb)}
      .kod-thumb{width:64px;height:64px;border-radius:9px;object-fit:cover;background:rgba(127,127,127,.08)}.kod-thumb-fallback{display:grid;place-items:center;font-size:22px}
      .kod-item-info{min-width:0}.kod-item-name{font-weight:800;line-height:1.65;overflow-wrap:anywhere}.kod-item-choice{font-size:12px;line-height:1.6;margin-top:2px;opacity:.88;overflow-wrap:anywhere}.kod-item-qty{display:inline-flex;align-items:center;justify-content:center;justify-self:center;border:1px solid var(--line,#e5e7eb);border-radius:8px;min-height:32px;padding:5px 10px;white-space:nowrap;font-weight:800;font-size:12px}.kod-price{text-align:left;white-space:nowrap;font-weight:800;font-size:13px}
      .kod-customer-list{display:grid;gap:2px}.kod-customer-row{display:grid;grid-template-columns:18px minmax(0,1fr) 26px;gap:10px;align-items:center;min-height:38px}.kod-customer-icon,.kod-copy-icon{width:17px;height:17px;opacity:.78}.kod-customer-value{font-size:13px;font-weight:700;overflow-wrap:anywhere}.kod-customer-value a{color:inherit;text-decoration:none}.kod-icon-button{display:grid;place-items:center;width:26px;height:26px;padding:0;border:0;background:transparent;color:inherit;cursor:pointer;border-radius:6px}.kod-icon-button:hover{background:rgba(127,127,127,.1)}
      .kod-delivery-score{margin-top:12px;padding-top:12px;border-top:1px solid var(--line,#e5e7eb)}.kod-delivery-head{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:12px;font-weight:800}.kod-delivery-level{font-size:11px}.kod-delivery-bars{direction:ltr;display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin-top:11px}.kod-delivery-bar{height:6px;border-radius:999px;background:rgba(127,127,127,.18)}.kod-delivery-score.high .kod-delivery-level{color:#22c55e}.kod-delivery-score.high .kod-delivery-bar.on{background:#22c55e}.kod-delivery-score.medium .kod-delivery-level{color:#f59e0b}.kod-delivery-score.medium .kod-delivery-bar.on{background:#f59e0b}.kod-delivery-score.low .kod-delivery-level{color:#ef4444}.kod-delivery-score.low .kod-delivery-bar.on{background:#ef4444}
      .kod-address,.kod-summary{grid-column:1/-1}.kod-note{margin-top:10px;padding:10px 12px;border-radius:10px;background:rgba(127,127,127,.08);white-space:pre-wrap}.kod-warning{grid-column:1/-1;border:1px solid #f0b429;background:rgba(240,180,41,.1);border-radius:12px;padding:10px 12px;font-size:12px}.kod-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.kod-copy{cursor:pointer}.kod-empty{opacity:.6}.kod-loading{padding:35px;text-align:center}
      @media(max-width:820px){.drawer.kun-order-details-open{width:100vw;max-width:100vw}.kod-grid{grid-template-columns:1fr}.kod-products-card,.kod-customer-card,.kod-address,.kod-summary{grid-column:1}.kod-item{grid-template-columns:54px minmax(0,1fr) 74px}.kod-thumb{width:52px;height:52px}.kod-price{grid-column:3;grid-row:1;text-align:left}.kod-item-qty{grid-column:3;grid-row:2}.kod-item-info{grid-row:1/3}.kod-field-grid{grid-template-columns:1fr}}
    `;document.head.appendChild(s);
  }
  function show(html){
    ensureStyle();const d=drawer(),b=back();if(!d||!b)return;d.classList.add('kun-order-details-open','open');b.classList.add('show');d.innerHTML=html;
    d.querySelectorAll('[data-kod-close]').forEach(x=>x.onclick=close);
    d.querySelectorAll('[data-kod-copy]').forEach(x=>x.onclick=async()=>{const t=x.dataset.kodCopy||'';try{await navigator.clipboard.writeText(t);window.showToast?.('تم النسخ');}catch{}});
  }
  function close(){const d=drawer(),b=back();if(!d||!b)return;d.classList.remove('kun-order-details-open','open');b.classList.remove('show');}
  function field(label,val,{copy=false,html=false}={}){if(!present(val)&&!html)return '';const display=html?val:esc(val);return `<div class="kod-field"><div class="kod-label">${esc(label)}</div><div class="kod-value">${display}${copy&&present(val)?` <button class="link kod-copy" type="button" data-kod-copy="${esc(val)}" title="نسخ">نسخ</button>`:''}</div></div>`;}
  function icon(type){
    const paths={user:'<path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="7" r="4"/>',mail:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',phone:'<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.69 2.8a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.28-1.28a2 2 0 0 1 2.11-.45c.9.33 1.84.56 2.8.69A2 2 0 0 1 22 16.92z"/>',copy:'<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'};
    return `<svg class="${type==='copy'?'kod-copy-icon':'kod-customer-icon'}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[type]||paths.user}</svg>`;
  }
  function itemChoice(item){
    const parts=[];
    if(item.variantName)parts.push(value(item.variantName));
    for(const o of item.options||[])if(present(o?.name)&&present(o?.value))parts.push(`${value(o.name)}: ${value(o.value)}`);
    if(item.note)parts.push(value(item.note));
    return [...new Set(parts.filter(Boolean))].join(' - ');
  }
  function itemHtml(item){
    const image=item.image?`<img class="kod-thumb" src="${esc(item.image)}" alt="${esc(item.name||'المنتج')}" loading="lazy">`:'<div class="kod-thumb kod-thumb-fallback">📦</div>';
    const choice=itemChoice(item),qty=Math.max(1,Number(item.quantity)||1),price=Number(item.price)||0;
    return `<div class="kod-item">${image}<div class="kod-item-info"><div class="kod-item-name">${esc(item.name||'منتج')}</div>${choice?`<div class="kod-item-choice">${esc(choice)}</div>`:''}</div><div class="kod-item-qty">${qty}x ${money(price)}</div><div class="kod-price">${money(price)}</div></div>`;
  }
  function customerRow(type,val,{link=false}={}){
    if(!present(val))return '';
    const raw=value(val),shown=link?`<a href="tel:${esc(raw)}">${esc(raw)}</a>`:esc(raw);
    return `<div class="kod-customer-row">${icon(type)}<div class="kod-customer-value">${shown}</div><button type="button" class="kod-icon-button" data-kod-copy="${esc(raw)}" title="نسخ" aria-label="نسخ">${icon('copy')}</button></div>`;
  }
  function deliveryScore(c={}){
    const delivered=Number(c.deliveredOrders)||0,returned=Number(c.returnedOrders)||0,cancelled=Number(c.cancelledOrders)||0,finished=delivered+returned+cancelled;
    if(!finished)return `<div class="kod-delivery-score"><div class="kod-delivery-head"><span>نسبة التسليم للعميل</span><span class="kod-delivery-level kod-muted">لا توجد بيانات كافية</span></div><div class="kod-delivery-bars">${'<span class="kod-delivery-bar"></span>'.repeat(5)}</div></div>`;
    const rate=Math.round(delivered/finished*100),bars=Math.max(1,Math.min(5,Math.ceil(rate/20))),level=rate>=80?'مرتفعة':rate>=50?'متوسطة':'منخفضة',cls=rate>=80?'high':rate>=50?'medium':'low';
    return `<div class="kod-delivery-score ${cls}"><div class="kod-delivery-head"><span>نسبة التسليم للعميل</span><span class="kod-delivery-level">${level}</span></div><div class="kod-delivery-bars">${Array.from({length:5},(_,i)=>`<span class="kod-delivery-bar ${i<bars?'on':''}"></span>`).join('')}</div></div>`;
  }
  function customerHtml(c={}){
    const rows=[customerRow('user',c.name),customerRow('mail',c.email),customerRow('phone',c.phone,{link:true}),customerRow('phone',c.alternatePhone,{link:true})].join('');
    return `<div class="kod-customer-list">${rows||'<div class="kod-empty">لا توجد بيانات عميل مسجلة.</div>'}</div>${deliveryScore(c)}`;
  }
  function addressHtml(a={}){
    const parts=[field('المحافظة',a.government),field('المدينة',a.city),field('المنطقة / الحي',a.area),field('الشارع',a.street),field('رقم المبنى',a.building),field('الدور',a.floor),field('الشقة',a.apartment),field('علامة مميزة',a.landmark),field('الرقم البريدي',a.postalCode),field('العنوان بالتفصيل',a.address,{copy:true})].join('');
    return parts||'<div class="kod-empty">لا توجد تفاصيل عنوان إضافية مسجلة.</div>';
  }
  function render(data){
    const o=data.order||{},s=data.summary||{},items=data.items||[],customer=data.customer||{},a=data.address||{};
    const payment=PAYMENT[value(s.paymentMethod).toLowerCase()]||s.paymentMethod||'غير مسجل';
    return `<div class="kod-page"><div class="kod-head"><div class="kod-head-main"><div class="kod-order-id">الطلب ${esc(o.id||'')}</div><div class="kod-sub">${esc(o.storeName||'')} ${o.source?`· ${esc(o.source)}`:''} · ${fmtDate(o.date)}</div></div><div class="kod-spacer"></div><button type="button" class="btn soft" data-kod-close>إغلاق</button></div>
      <div class="kod-grid">
        ${data.provider?.warning?`<div class="kod-warning">تفاصيل Kun متاحة، لكن ${esc(data.provider.warning)}</div>`:''}
        <section class="kod-card kod-products-card"><h3>عناصر السلة</h3><div class="kod-products">${items.length?items.map(itemHtml).join(''):'<div class="kod-empty">لا توجد عناصر منتج مسجلة.</div>'}</div></section>
        <section class="kod-card kod-customer-card"><h3>بيانات العميل</h3>${customerHtml(customer)}</section>
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
  document.documentElement.dataset.orderDetailsUi='v40.1-ready';
})();
