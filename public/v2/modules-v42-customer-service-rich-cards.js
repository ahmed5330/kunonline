/* Kun Online v42.3 — rich Customer Service cards matching order details with in-place refresh */
(function(){
  const cache=new Map();
  const pending=new Map();
  let observer=null,scanQueued=false;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const val=v=>String(v??'').trim();
  const money=v=>new Intl.NumberFormat('ar-EG',{maximumFractionDigits:2}).format(Number(v)||0);
  const present=v=>val(v)!=='';

  function iconCopy(){
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  }
  function copyBtn(value,label='نسخ'){
    if(!present(value))return '';
    return `<button type="button" class="cs-copy-btn" data-cs-copy-value="${esc(value)}" title="${esc(label)}" aria-label="${esc(label)}">${iconCopy()}</button>`;
  }
  function ensureStyle(){
    if(document.getElementById('kunCsRichCardStyle'))return;
    const style=document.createElement('style');style.id='kunCsRichCardStyle';style.textContent=`
      .cs-order.cs-rich-loaded>.cs-order-head,.cs-order.cs-rich-loaded>.cs-address,.cs-order.cs-rich-loaded>.cs-product,.cs-order.cs-rich-loaded>.cs-product-note,.cs-order.cs-rich-loaded>.cs-order-meta{display:none!important}
      body[data-theme="dark"]{--cs-order-frame:#475569}.cs-order{border:2px solid var(--cs-order-frame,#cbd5e1);box-shadow:0 5px 16px rgba(15,23,42,.08);transition:border-color .18s ease,box-shadow .18s ease}.cs-order:hover{border-color:#94a3b8;box-shadow:0 8px 22px rgba(15,23,42,.12)}.cs-note-field{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px;align-items:stretch}.cs-note-field .cs-note-add{min-width:64px;padding-inline:14px;font-weight:800}
      .cs-rich-card{display:grid;gap:12px;margin-bottom:12px}.cs-rich-top{display:grid;gap:8px}.cs-rich-row{min-height:28px}.cs-rich-row.has-copy{display:grid;grid-template-columns:minmax(0,1fr) 26px;gap:8px;align-items:center}.cs-rich-value{font-size:12px;line-height:1.55;overflow-wrap:anywhere}.cs-rich-name{font-size:14px;font-weight:800}.cs-copy-btn{width:26px;height:26px;padding:4px;border:0;border-radius:7px;background:transparent;color:inherit;display:grid;place-items:center;cursor:pointer;opacity:.72}.cs-copy-btn:hover{background:rgba(127,127,127,.12);opacity:1}.cs-copy-btn svg{width:16px;height:16px}
      .cs-rich-store{display:inline-flex;width:max-content;max-width:100%;padding:4px 8px;border-radius:999px;background:rgba(127,127,127,.09);font-size:10px;opacity:.8}.cs-rich-divider{height:1px;background:var(--line,#e5e7eb);opacity:.8}.cs-rich-products{display:grid;gap:0}.cs-rich-product{display:grid;grid-template-columns:52px minmax(0,1fr);gap:10px;padding:11px 0;align-items:start}.cs-rich-product+.cs-rich-product{border-top:1px solid var(--line,#e5e7eb)}.cs-rich-thumb{width:50px;height:50px;border-radius:9px;object-fit:cover;background:rgba(127,127,127,.08)}.cs-rich-thumb-fallback{display:grid;place-items:center;font-size:19px}.cs-rich-product-main{min-width:0;display:grid;gap:5px}.cs-rich-product-line{display:block}.cs-rich-product-name{font-size:13px;font-weight:800;line-height:1.55;overflow-wrap:anywhere}.cs-rich-option{font-size:11px;line-height:1.5;opacity:.82;overflow-wrap:anywhere}.cs-rich-product-price{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:3px}.cs-rich-qty,.cs-rich-line-total{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:800}.cs-rich-price-copy{display:inline-flex;align-items:center;gap:2px}
      .cs-rich-delivery{padding-top:4px}.cs-rich-delivery-head{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:800}.cs-rich-delivery-head .cs-copy-btn{margin-inline-start:auto}.cs-rich-bars{direction:ltr;display:grid;grid-template-columns:repeat(5,1fr);gap:5px;margin-top:7px}.cs-rich-bar{height:5px;border-radius:99px;background:rgba(127,127,127,.18)}.cs-rich-delivery.high .cs-rich-bar.on{background:#22c55e}.cs-rich-delivery.medium .cs-rich-bar.on{background:#f59e0b}.cs-rich-delivery.low .cs-rich-bar.on{background:#ef4444}.cs-rich-delivery.high .cs-rich-level{color:#22c55e}.cs-rich-delivery.medium .cs-rich-level{color:#f59e0b}.cs-rich-delivery.low .cs-rich-level{color:#ef4444}.cs-rich-meta{display:flex;flex-wrap:wrap;align-items:center;gap:7px 12px}.cs-rich-meta-item{display:inline-flex;align-items:center;gap:2px;font-size:10.5px;opacity:.8}.cs-rich-order-total{font-size:18px;font-weight:900;line-height:1.3;color:var(--ink);opacity:1}.cs-rich-loading{padding:8px 0;font-size:11px;opacity:.62}.cs-rich-error-copy{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px}
      @media(max-width:520px){.cs-rich-order-total{font-size:17px}.cs-note-field{grid-template-columns:minmax(0,1fr) auto}.cs-rich-product{grid-template-columns:46px minmax(0,1fr)}.cs-rich-thumb{width:44px;height:44px}.cs-rich-product-price{align-items:flex-start;flex-direction:column;gap:4px}}
    `;document.head.appendChild(style);
  }
  async function copyValue(value){
    try{await navigator.clipboard.writeText(String(value??''));window.showToast?.('تم النسخ');}
    catch{window.showToast?.('تعذر النسخ');}
  }
  function delivery(c={}){
    const delivered=Number(c.deliveredOrders)||0,returned=Number(c.returnedOrders)||0,cancelled=Number(c.cancelledOrders)||0,finished=delivered+returned+cancelled;
    if(!finished)return `<div class="cs-rich-delivery"><div class="cs-rich-delivery-head"><span>نسبة التسليم للعميل</span><span class="cs-rich-level">لا توجد بيانات كافية</span></div><div class="cs-rich-bars">${'<span class="cs-rich-bar"></span>'.repeat(5)}</div></div>`;
    const rate=Math.round(delivered/finished*100),bars=Math.max(1,Math.min(5,Math.ceil(rate/20))),cls=rate>=80?'high':rate>=50?'medium':'low',level=rate>=80?'مرتفعة':rate>=50?'متوسطة':'منخفضة';
    return `<div class="cs-rich-delivery ${cls}"><div class="cs-rich-delivery-head"><span>نسبة التسليم للعميل</span><span class="cs-rich-level">${level} · ${rate}%</span></div><div class="cs-rich-bars">${Array.from({length:5},(_,i)=>`<span class="cs-rich-bar ${i<bars?'on':''}"></span>`).join('')}</div></div>`;
  }
  function row(value,{name=false,copy=false,label='نسخ'}={}){
    if(!present(value))return '';
    const button=copy?copyBtn(value,label):'';
    return `<div class="cs-rich-row ${button?'has-copy':''}"><div class="cs-rich-value ${name?'cs-rich-name':''}">${esc(value)}</div>${button}</div>`;
  }
  function optionText(item){
    const out=[];
    if(present(item.variantName))out.push(val(item.variantName));
    for(const o of item.options||[])if(present(o?.name)&&present(o?.value))out.push(`${val(o.name)}: ${val(o.value)}`);
    if(present(item.note))out.push(val(item.note));
    return [...new Set(out)].join(' - ');
  }
  function product(item={}){
    const qty=Math.max(1,Number(item.quantity)||1),price=Number(item.price)||0,total=Number(item.lineTotal)||price*qty,choice=optionText(item);
    const image=present(item.image)?`<img class="cs-rich-thumb" src="${esc(item.image)}" alt="${esc(item.name||'المنتج')}" loading="lazy">`:'<div class="cs-rich-thumb cs-rich-thumb-fallback">📦</div>';
    return `<div class="cs-rich-product">${image}<div class="cs-rich-product-main"><div class="cs-rich-product-line"><div class="cs-rich-product-name">${esc(item.name||'منتج')}</div></div>${choice?`<div class="cs-rich-product-line"><div class="cs-rich-option">${esc(choice)}</div></div>`:''}<div class="cs-rich-product-price"><span class="cs-rich-qty">${qty}x ${money(price)} </span><span class="cs-rich-line-total">${money(total)} </span></div></div></div>`;
  }
  function renderDetails(d={}){
    const c=d.customer||{},a=d.address||{},o=d.order||{},s=d.summary||{},items=Array.isArray(d.items)?d.items:[];
    const address=[a.government,a.city,a.area,a.street,a.address].map(val).filter(Boolean).filter((x,i,arr)=>arr.indexOf(x)===i).join(' — ');
    const date=val(o.date).slice(0,10),total=`${money(s.total)} جنيه`,qty=`الكمية ${Number(s.quantity)||items.reduce((x,it)=>x+(Number(it.quantity)||1),0)||1}`;
    return `<div class="cs-rich-card"><div class="cs-rich-top">${o.storeName?`<span class="cs-rich-store">${esc(o.storeName)}</span>`:''}${row(c.name,{name:true})}${row(c.phone,{copy:true,label:'نسخ رقم الهاتف'})}${row(c.email,{copy:true,label:'نسخ البريد الإلكتروني'})}${row(address,{copy:true,label:'نسخ العنوان بالكامل'})}${delivery(c)}</div><div class="cs-rich-divider"></div><div class="cs-rich-products">${items.length?items.map(product).join(''):'<div class="cs-rich-loading">لا توجد تفاصيل منتجات إضافية.</div>'}</div><div class="cs-rich-meta"><span class="cs-rich-meta-item cs-rich-order-total">${total}</span><span class="cs-rich-meta-item">${qty}</span>${date?`<span class="cs-rich-meta-item">${esc(date)}</span>`:''}</div></div>`;
  }
  function basicFallback(card){
    if(card.dataset.csRichFallback==='1')return;card.dataset.csRichFallback='1';
    const targets=['.cs-customer','.cs-phone','.cs-address','.cs-product','.cs-product-note','.cs-order-meta'];
    for(const selector of targets){const el=card.querySelector(selector);if(!el||!present(el.textContent)||el.querySelector('.cs-copy-btn'))continue;const b=document.createElement('button');b.type='button';b.className='cs-copy-btn';b.dataset.csCopyValue=el.textContent.trim();b.title='نسخ';b.setAttribute('aria-label','نسخ');b.innerHTML=iconCopy();el.style.display='flex';el.style.alignItems='center';el.style.gap='5px';el.appendChild(b);}
  }
  async function clientId(){return window.kunClientId?await window.kunClientId():'';}
  async function fetchDetails(orderId,{force=false}={}){
    if(force){cache.delete(orderId);pending.delete(orderId);}
    if(cache.has(orderId))return cache.get(orderId);if(pending.has(orderId))return pending.get(orderId);
    const work=(async()=>{const cid=await clientId();if(!cid)throw new Error('تعذر تحديد الحساب');const r=await fetch(`/api/orders/${encodeURIComponent(orderId)}/details?clientId=${encodeURIComponent(cid)}`,{credentials:'include'}),d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||`HTTP ${r.status}`);cache.set(orderId,d);return d;})().finally(()=>pending.delete(orderId));pending.set(orderId,work);return work;
  }
  function placeDetails(card,details){
    const existing=card.querySelector('.cs-rich-card');if(existing){existing.outerHTML=renderDetails(details);card.classList.add('cs-rich-loaded');return;}
    card.querySelector('.cs-rich-loading')?.remove();const anchor=card.querySelector('.cs-customer-note,.cs-internal-latest,.cs-defer-chip,.cs-contact-attempts,.cs-field,.cs-actions'),box=document.createElement('div');box.innerHTML=renderDetails(details);const node=box.firstElementChild;if(anchor)card.insertBefore(node,anchor);else card.prepend(node);card.classList.add('cs-rich-loaded');card.dataset.csRichRequested='1';
  }
  async function refresh(orderId){
    const id=String(orderId||'').trim();if(!id)return null;const details=await fetchDetails(id,{force:true});document.querySelectorAll('#root .cs-order[data-cs-order]').forEach(card=>{if(String(card.dataset.csOrder)===id)placeDetails(card,details);});return details;
  }
  async function enrich(card){
    if(!card||card.dataset.csRichRequested==='1')return;card.dataset.csRichRequested='1';
    const orderId=card.dataset.csOrder;if(!orderId)return;
    const anchor=card.querySelector('.cs-customer-note,.cs-internal-latest,.cs-defer-chip,.cs-contact-attempts,.cs-field,.cs-actions');
    const box=document.createElement('div');box.className='cs-rich-loading';box.textContent='جارٍ تحميل بيانات العميل والمنتجات...';if(anchor)card.insertBefore(box,anchor);else card.appendChild(box);
    try{const details=await fetchDetails(orderId);box.outerHTML=renderDetails(details);card.classList.add('cs-rich-loaded');}
    catch{box.remove();basicFallback(card);}
  }
  function watchCard(card){
    if(!observer){observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){observer.unobserve(entry.target);enrich(entry.target);}}, {rootMargin:'80px 0px'});}
    observer.observe(card);
  }
  function active(){return document.querySelector('.nav button.active[data-view]')?.dataset.view==='customer-service';}
  function scan(){if(!active())return;document.querySelectorAll('#root .cs-order[data-cs-order]').forEach(card=>{if(card.dataset.csRichWatched==='1')return;card.dataset.csRichWatched='1';watchCard(card);});}
  function scheduleScan(){if(!active()||scanQueued)return;scanQueued=true;queueMicrotask(()=>{scanQueued=false;scan();});}
  function boot(){ensureStyle();document.addEventListener('click',e=>{const b=e.target.closest?.('[data-cs-copy-value]');if(b){e.preventDefault();e.stopImmediatePropagation();copyValue(b.dataset.csCopyValue||'');return;}if(e.target.closest?.('.nav button[data-view="customer-service"]'))setTimeout(scheduleScan,0);},true);const root=document.getElementById('root')||document.body;new MutationObserver(scheduleScan).observe(root,{childList:true,subtree:true});scheduleScan();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
  window.KunCustomerServiceRichCards={scan:scheduleScan,refresh,cache,version:'42.3'};
})();