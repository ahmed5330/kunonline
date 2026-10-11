/* Kun Online v126.1 — financial cards + system-wide actual cost per incoming order */
(()=>{
  if(window.KunDashboardFinanceTopV126)return;
  const VERSION='126.1';
  const nativeFetch=window.fetch.bind(window);
  const state={dashboard:null,collected:null,timer:0,collecting:false,lastCollectedKey:''};
  const $=(s,r=document)=>r?.querySelector?.(s)||null;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const n=v=>Number(v)||0;
  const num=v=>new Intl.NumberFormat('ar-EG',{maximumFractionDigits:2}).format(n(v));
  const money=(v,c='EGP')=>`${num(v)} ${String(c||'EGP').toUpperCase()==='EGP'?'ج.م':esc(c)}`;
  const active=()=>$('.nav button.active')?.dataset.view==='dashboard'&&$('.v33-dashboard');

  function style(){
    if($('#kunDashboardFinanceTop126Style'))return;
    const el=document.createElement('style');el.id='kunDashboardFinanceTop126Style';el.textContent=`
      .dash-f126{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;padding:0!important;border:0!important;background:transparent!important;box-shadow:none!important;overflow:visible!important}
      .dash-f126:before{display:none!important}
      .dash-f126-card{position:relative;overflow:hidden;display:flex;flex-direction:column;min-height:154px;padding:17px;border:1px solid var(--line,#e2e8f0);border-radius:18px;background:linear-gradient(160deg,#fff 0%,#fbfdff 100%);box-shadow:0 10px 28px rgba(15,23,42,.055)}
      .dash-f126-card:before{content:'';position:absolute;inset:0 0 auto;height:3px;background:var(--f126-accent,#2563eb)}
      .dash-f126-card.collected{--f126-accent:#16a34a}.dash-f126-card.pending{--f126-accent:#d97706}.dash-f126-card.pnl{--f126-accent:#2563eb}.dash-f126-card.cpp{--f126-accent:#0e7490}.dash-f126-card.pnl.negative{--f126-accent:#dc2626}
      .dash-f126-head{display:flex;align-items:flex-start;gap:8px}.dash-f126-icon{display:grid;place-items:center;width:31px;height:31px;border-radius:10px;background:color-mix(in srgb,var(--f126-accent) 11%,transparent);color:var(--f126-accent);font-weight:950;font-size:15px}
      .dash-f126-copy{min-width:0}.dash-f126-copy span{display:block;color:var(--muted,#64748b);font-size:9px;font-weight:900}.dash-f126-copy small{display:block;margin-top:3px;color:var(--muted,#64748b);font-size:8.2px;line-height:1.45}
      .dash-f126-value{display:block;margin:14px 0 12px;font-size:27px;line-height:1.15;color:var(--ink,#0f172a);letter-spacing:-.5px} .dash-f126-card.collected .dash-f126-value{color:#15803d}.dash-f126-card.pending .dash-f126-value{color:#b45309}.dash-f126-card.pnl.negative .dash-f126-value{color:#b91c1c}
      .dash-f126-foot{display:flex;align-items:center;gap:8px;margin-top:auto;padding-top:11px;border-top:1px solid var(--line,#e2e8f0)}.dash-f126-foot span{color:var(--muted,#64748b);font-size:8.5px;line-height:1.45}.dash-f126-detail{margin-inline-start:auto;flex:0 0 auto;border:1px solid var(--line,#dbe3ec);border-radius:9px;background:var(--card,#fff);color:#0d47a1;padding:7px 9px;font:inherit;font-size:8.5px;font-weight:900;cursor:pointer}.dash-f126-detail:hover{border-color:#93add0;background:#f8fbff}
      .dash-f126-loading{opacity:.58}.dash-f126-modal{max-width:980px!important;width:min(980px,94vw)!important}.dash-f126-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:12px 0}.dash-f126-summary>div{padding:11px;border:1px solid var(--line,#e2e8f0);border-radius:11px}.dash-f126-summary span{display:block;color:var(--muted,#64748b);font-size:9px}.dash-f126-summary b{display:block;margin-top:5px;font-size:14px}.dash-f126-formula{padding:11px 12px;border:1px dashed var(--line,#cbd5e1);border-radius:11px;background:#f8fafc;font-size:10px;font-weight:800;line-height:1.65}.dash-f126-list{display:grid;gap:7px;margin-top:12px}.dash-f126-row{display:flex;justify-content:space-between;gap:12px;padding:10px 11px;border:1px solid var(--line,#e2e8f0);border-radius:10px}.dash-f126-row span{font-size:9.5px;color:var(--muted,#64748b)}.dash-f126-row b{font-size:10px}.dash-f126-table{overflow:auto;max-height:390px;margin-top:12px}.dash-f126-table table{width:100%;border-collapse:collapse;min-width:760px}.dash-f126-table th,.dash-f126-table td{padding:9px;border-bottom:1px solid var(--line,#e2e8f0);text-align:right;font-size:9px;white-space:nowrap}
      body[data-theme="dark"] .dash-f126-card{background:linear-gradient(160deg,#172033,var(--card));border-color:var(--line)}body[data-theme="dark"] .dash-f126-formula{background:#172033}
      @media(max-width:980px){.dash-f126{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:600px){.dash-f126{grid-template-columns:1fr}.dash-f126-summary{grid-template-columns:1fr 1fr}.dash-f126-value{font-size:25px}}@media(max-width:390px){.dash-f126-summary{grid-template-columns:1fr}}
    `;document.head.appendChild(el);
  }

  async function context(){
    const clientId=await (window.kunClientId?.()||Promise.resolve(''));
    const storeId=await (window.kunStoreId?.()||Promise.resolve(''));
    return {clientId,storeId};
  }
  async function getJson(path){
    const response=await nativeFetch(path,{credentials:'include',headers:{Accept:'application/json'}}),data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||`HTTP ${response.status}`);
    return data;
  }
  async function collected(details=false){
    const d=state.dashboard;if(!d)return null;
    const ctx=await context(),u=new URL('/api/accounting/collected-profit',location.origin);
    if(ctx.clientId)u.searchParams.set('clientId',ctx.clientId);
    if(ctx.storeId)u.searchParams.set('storeId',ctx.storeId);
    if(d.from)u.searchParams.set('from',d.from);
    if(d.to)u.searchParams.set('to',d.to);
    if(details)u.searchParams.set('details','1');
    return getJson(u.pathname+u.search);
  }
  async function refreshCollected(force=false){
    const d=state.dashboard;if(!d||state.collecting)return;
    const ctx=await context(),key=[ctx.clientId,ctx.storeId,d.from,d.to].join('|');
    if(!force&&key===state.lastCollectedKey&&state.collected)return;
    state.collecting=true;render();
    try{state.collected=await collected(false);state.lastCollectedKey=key;}
    catch(error){state.collected={error:error.message};}
    finally{state.collecting=false;render();}
  }

  function card(type,title,value,sub,foot,negative=false){
    return `<article class="dash-f126-card ${type}${negative?' negative':''}"><div class="dash-f126-head"><div class="dash-f126-icon">${type==='collected'?'✓':type==='pending'?'◷':type==='cpp'?'◎':'↕'}</div><div class="dash-f126-copy"><span>${esc(title)}</span><small>${esc(sub)}</small></div></div><strong class="dash-f126-value">${value}</strong><div class="dash-f126-foot"><span>${esc(foot)}</span><button type="button" class="dash-f126-detail" data-f126-detail="${type}">عرض المفردات ←</button></div></article>`;
  }
  function html(){
    const d=state.dashboard||{},c=d.currency||'EGP',f=d.finance||{},o=d.overview||{},cp=state.collected;
    const collectedValue=state.collecting&&!cp?'جارٍ الحساب…':cp?.error?'غير متاح':money(cp?.collectedProfit||0,cp?.currency||c);
    const collectedFoot=cp?.error?'تعذر تحميل مفردات التحصيل':cp?`${num(cp.collectedOrders)} أوردر محصل · صافي بعد الإدارة والمصاريف`:'يتم تحميل بيانات التحصيل';
    const pending=n(o.expectedProfit),net=n(f.netProfit),orders=n(o.totalOrders),adSpend=n(o.adSpend);
    const actualCpp=orders?money(adSpend/orders,c):'—';
    const cppFoot=orders?`${num(orders)} أوردر من كل المصادر · إعلانات ${money(adSpend,c)}`:'لا توجد أوردرات خلال الفترة المحددة';
    return `<section class="dash-section dash-f126" data-dashboard-finance-top="126">${card('collected','أرباح تم التحصيل',collectedValue,'ما تم تحصيله فعليًا وصافي نتيجته',collectedFoot)}${card('pending','أرباح منتظرة',money(pending,c),'الأرباح المتوقع دخولها من الطلبات النشطة','المؤكد + التجهيز + الجاري شحنه')}${card('pnl','الربح / الخسارة',money(net,c),'صافي نتيجة الفترة بعد التكلفة والمصروفات','إيراد المنتجات − تكلفة المنتج − المصروفات',net<0)}${card('cpp','سعر الطلب الفعلي',actualCpp,'إجمالي صرف الإعلانات ÷ جميع الأوردرات',cppFoot)}</section>`;
  }
  function render(){
    if(!active()||!state.dashboard)return;
    style();const dash=$('.v33-dashboard');if(!dash)return;
    const old=$('[data-dashboard-finance-top="126"]',dash);
    const nav=$('.dash-x-nav',dash),toolbar=$('.dash-period-toolbar',dash),legacy=$('.dash-range',dash),hero=$('.dash-hero',dash);
    const anchor=nav||toolbar||legacy||hero;if(!anchor)return;
    if(old)old.outerHTML=html();else anchor.insertAdjacentHTML('afterend',html());
  }

  function closeModal(){$('#dashF126ModalBack')?.remove();}
  function modal(title,body){
    closeModal();const back=document.createElement('div');back.id='dashF126ModalBack';back.className='cs-modal-back';back.innerHTML=`<div class="cs-modal dash-f126-modal" role="dialog" aria-modal="true"><h2>${esc(title)}</h2>${body}<div class="cs-modal-actions"><button class="btn soft" data-f126-close>قفل</button></div></div>`;document.body.appendChild(back);back.onclick=e=>{if(e.target===back)closeModal();};$('[data-f126-close]',back).onclick=closeModal;return back;
  }
  function detailRows(items=[],currency='EGP'){
    if(!items.length)return '<div class="dash-empty">لا توجد مفردات لهذه الفترة.</div>';
    return `<div class="dash-f126-list">${items.map(item=>{
      if(Array.isArray(item.items))return `<div class="dash-f126-row"><span>${esc(item.label)}</span><b>${item.items.map(x=>`${esc(x.label)}: ${item.money?money(x.value,currency):num(x.value)}`).join(' · ')||'—'}</b></div>`;
      const value=item.text?esc(item.text):item.percent?`${num(item.value)}%`:item.money?money(item.value,currency):num(item.value);
      return `<div class="dash-f126-row"><span>${esc(item.label)}</span><b>${value}</b></div>`;
    }).join('')}</div>`;
  }
  function cppDetails(){
    const d=state.dashboard||{},o=d.overview||{},orders=n(o.totalOrders),spend=n(o.adSpend),currency=d.currency||'EGP';
    const cost=orders?money(spend/orders,currency):'غير متاح (لا توجد طلبات)';
    const source=d.ads?.spendSource||'';
    const sourceLabel=source==='integrations'?'تكاملات منصات الإعلانات':source==='manual'?'المصاريف الإعلانية المسجلة يدويًا':'لا يوجد صرف إعلاني مسجل';
    const sourceRows=d.overview?.details?.orders?.find(x=>x.label==='مصادر الطلبات')?.items||[];
    const sourceBreakdown=sourceRows.map(x=>({label:x.label,value:x.value}));
    const content=`<div class="kun85-scope-note">الفترة: ${esc(d.from||'')} — ${esc(d.to||'')} · <b>${esc(cost)}</b></div>
      <div class="dash-f126-summary"><div><span>إجمالي مصروفات الإعلانات</span><b>${money(spend,currency)}</b></div><div><span>كل الأوردرات الداخلة</span><b>${num(orders)}</b></div><div><span>سعر الأوردر الفعلي</span><b>${esc(cost)}</b></div><div><span>مصدر مصروف الإعلانات</span><b>${esc(sourceLabel)}</b></div></div>
      <div class="dash-f126-formula">سعر الأوردر الفعلي = إجمالي مصروفات الإعلانات خلال الفترة ÷ جميع الأوردرات المسجلة خلال نفس الفترة. يشمل طلبات إيزي أوردر والطلبات التي أضافها أي عضو من فريق المتجر، وجميع الحالات بما فيها الملغية والمرتجعة. كل أوردر يُحسب مرة واحدة فقط. لا نعتمد على عدد Purchases الذي تعرضه منصة الإعلان.</div>
      <h3 style="font-size:13px;margin:16px 0 8px">تفصيل عدد الأوردرات حسب مصدرها</h3>
      ${sourceBreakdown.length?detailRows(sourceBreakdown,currency):'<div class="dash-empty">لا توجد طلبات في هذه الفترة.</div>'}`;
    modal('مفردات سعر الطلب الفعلي',content);
  }
  async function pendingDetails(){
    const d=state.dashboard||{},items=d.overview?.details?.expectedProfit||[];
    modal('مفردات الأرباح المنتظرة',`<div class="kun85-scope-note">${esc(d.from||'')} — ${esc(d.to||'')} · الإجمالي <b>${money(d.overview?.expectedProfit,d.currency)}</b></div><div class="dash-f126-formula">الأرباح المنتظرة تشمل الطلبات المؤكدة + قيد التجهيز + الجاري شحنها بعد مصاريف الطلب التشغيلية.</div>${detailRows(items,d.currency)}`);
  }
  async function pnlDetails(){
    const d=state.dashboard||{},ctx=await context(),u=new URL('/api/system/dashboard/input-details',location.origin);
    u.searchParams.set('kind','netProfit');if(ctx.clientId)u.searchParams.set('clientId',ctx.clientId);if(ctx.storeId)u.searchParams.set('storeId',ctx.storeId);if(d.from)u.searchParams.set('from',d.from);if(d.to)u.searchParams.set('to',d.to);
    const holder=modal('مفردات الربح / الخسارة','<div class="cs-loading">جارٍ تحميل تفاصيل الحساب…</div>');
    try{const x=await getJson(u.pathname+u.search),summary=x.summary||[];$('.dash-f126-modal',holder).innerHTML=`<h2>مفردات الربح / الخسارة</h2><div class="kun85-scope-note">${esc(x.from||d.from||'')} — ${esc(x.to||d.to||'')} · الناتج <b>${money(x.total,d.currency)}</b></div><div class="dash-f126-summary">${summary.map(row=>`<div><span>${esc(row.label)}</span><b>${row.percent?`${num(row.value)}%`:row.money?money(row.value,d.currency):num(row.value)}</b></div>`).join('')}</div><div class="dash-f126-formula">المعادلة: ${esc(x.formula||'إيراد المنتجات − تكلفة المنتج − المصروفات التشغيلية')}</div><div class="cs-modal-actions"><button class="btn soft" data-f126-close>قفل</button></div>`; $('[data-f126-close]',holder).onclick=closeModal;}
    catch(error){$('.dash-f126-modal',holder).innerHTML=`<h2>تعذر تحميل التفاصيل</h2><p>${esc(error.message)}</p><div class="cs-modal-actions"><button class="btn soft" data-f126-close>قفل</button></div>`; $('[data-f126-close]',holder).onclick=closeModal;}
  }
  function collectedRows(x){
    const rows=x.orders||[];if(!rows.length)return '<div class="dash-empty">لا توجد أوردرات محصلة في الفترة.</div>';
    return `<div class="dash-f126-table"><table><thead><tr><th>الأوردر</th><th>العميل</th><th>تاريخ الأوردر</th><th>تاريخ التحصيل</th><th>المحصل</th><th>الإدارة</th><th>بعد الإدارة</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.ref||r.id)}</td><td>${esc(r.customerName||'—')}</td><td>${esc(r.orderDate||'—')}</td><td>${esc(r.collectedAt||'—')}</td><td>${money(r.collectedAmount,x.currency)}</td><td>${money(r.managementFee,x.currency)}</td><td><b>${money(r.afterManagement,x.currency)}</b></td></tr>`).join('')}</tbody></table></div>`;
  }
  async function collectedDetails(){
    const holder=modal('مفردات الأرباح المحصلة','<div class="cs-loading">جارٍ تحميل كل الحسابات…</div>');
    try{const x=await collected(true),period=x.orderPeriodFrom?`${x.orderPeriodFrom} — ${x.orderPeriodTo}`:'—';$('.dash-f126-modal',holder).innerHTML=`<h2>مفردات الأرباح المحصلة</h2><div class="kun85-scope-note">فترة التحصيل: ${esc(x.from)} — ${esc(x.to)} · ${esc(x.storeName||'كل المتاجر')}</div><div class="dash-f126-summary"><div><span>المحصل من الشحن</span><b>${money(x.collectedGross,x.currency)}</b></div><div><span>مصاريف الإدارة</span><b>${money(x.managementFees,x.currency)}</b></div><div><span>مصاريف مدة الأوردرات</span><b>${money(x.periodExpenses,x.currency)}</b></div><div><span>صافي المحصل</span><b>${money(x.collectedProfit,x.currency)}</b></div></div><div class="dash-f126-formula">${esc(x.formula)} · مدة الأوردرات: ${esc(period)}</div>${collectedRows(x)}<div class="dash-f126-list"><div class="dash-f126-row"><span>مصاريف عامة</span><b>${money(x.expenses?.general,x.currency)}</b></div><div class="dash-f126-row"><span>صرف الإعلانات المحتسب</span><b>${money(x.expenses?.adSpend,x.currency)}</b></div><div class="dash-f126-row"><span>مصدر صرف الإعلانات</span><b>${x.expenses?.adSpendSource==='integrations'?'تكاملات الإعلانات':'تسجيل يدوي'}</b></div></div><div class="cs-modal-actions"><button class="btn soft" data-f126-close>قفل</button></div>`; $('[data-f126-close]',holder).onclick=closeModal;}
    catch(error){$('.dash-f126-modal',holder).innerHTML=`<h2>تعذر تحميل التفاصيل</h2><p>${esc(error.message)}</p><div class="cs-modal-actions"><button class="btn soft" data-f126-close>قفل</button></div>`; $('[data-f126-close]',holder).onclick=closeModal;}
  }
  function open(type){if(type==='collected')return collectedDetails();if(type==='pending')return pendingDetails();if(type==='cpp')return cppDetails();return pnlDetails();}
  function schedule(delay=40){clearTimeout(state.timer);state.timer=setTimeout(render,delay);}
  function capture(path,data){
    if(path==='/api/dashboard'&&data?.ok){state.dashboard=data;schedule(20);setTimeout(()=>refreshCollected(false),40);}
    if(path==='/api/accounting/collected-profit'&&data?.ok&&!data.orders){state.collected=data;schedule(20);}
  }
  window.fetch=async function(...args){
    const response=await nativeFetch(...args);try{const input=args[0],url=typeof input==='string'?input:input?.url||'',path=new URL(url,location.origin).pathname;if(path==='/api/dashboard'||path==='/api/accounting/collected-profit')response.clone().json().then(data=>capture(path,data)).catch(()=>{});}catch{}return response;
  };
  function hook(){
    style();const root=$('#root');if(root)new MutationObserver(()=>{if(active())schedule(55);}).observe(root,{childList:true,subtree:true});
    document.addEventListener('click',event=>{const detail=event.target.closest?.('[data-f126-detail]');if(detail){event.preventDefault();open(detail.dataset.f126Detail);return;}if(event.target.closest?.('.nav button[data-view="dashboard"],[data-dash-preset],#dashApplyRange,[data-v125-period]'))setTimeout(()=>{schedule(120);refreshCollected(true);},700);},true);
    setTimeout(()=>{render();if(active()&&state.dashboard)refreshCollected(false);},900);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',hook,{once:true});else hook();
  window.KunDashboardFinanceTopV126={version:VERSION,refresh:()=>{render();return refreshCollected(true);},open};
})();
