/* Kun Online v126.4 — one consolidated performance section without duplicate dashboard blocks */
(()=>{
  if(window.KunDashboardFinanceTopV126)return;
  const VERSION='126.4';
  const nativeFetch=window.fetch.bind(window);
  const state={dashboard:null,scopedDashboard:null,collected:null,timer:0,collecting:false,collectedRequest:0,lastPendingKey:'',lastCollectedKey:'',scopeEpoch:0};
  const dashboard=()=>state.scopedDashboard||state.dashboard;
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

      /* Single, durable performance summary replaces four overlapping surfaces. */
      .v33-dashboard [data-dash-executive="122"],
      .v33-dashboard #cp47Section,
      .v33-dashboard [data-dash-section="overview"],
      .v33-dashboard .dash-x-nav [data-dx-jump="overview"]{display:none!important}
      .v33-dashboard .dash-f126{display:block!important;padding:20px!important;border:1px solid var(--line,#e2e8f0)!important;border-radius:20px!important;background:var(--card,#fff)!important;box-shadow:0 10px 30px rgba(15,23,42,.05)!important;overflow:visible!important}
      .dash-f126 .dash-f126-headline{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;margin-bottom:16px}
      .dash-f126 .dash-f126-headline h2{font-size:19px;color:var(--ink,#0f172a);font-weight:900;line-height:1.4;margin:2px 0 3px}
      .dash-f126 .dash-f126-headline p{margin:0;color:var(--muted,#64748b);font-size:11px;line-height:1.65}
      .dash-f126 .dash-f126-eyebrow{font-size:10px;font-weight:850;color:#2563eb}
      .dash-f126 .dash-f126-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      .dash-f126 .dash-f126-period{border:1px solid var(--line,#e2e8f0);border-radius:10px;padding:8px 10px;color:var(--muted,#64748b);font-size:10px}
      .dash-f126 .dash-f126-refresh{border:1px solid var(--line,#e2e8f0);border-radius:10px;padding:8px 12px;background:var(--card,#fff);color:var(--ink,#0f172a);font:inherit;font-size:11px;font-weight:800;cursor:pointer}
      .dash-f126 .dash-f126-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
      .dash-f126 .dash-f126-card{appearance:none;text-align:right;font:inherit;cursor:pointer;min-width:0;min-height:135px;padding:14px;border-radius:14px;box-shadow:none;transition:border-color .15s,transform .15s,box-shadow .15s}
      .dash-f126 .dash-f126-card:hover,.dash-f126 .dash-f126-card:focus-visible{border-color:#93c5fd;box-shadow:0 7px 18px rgba(15,23,42,.08);transform:translateY(-1px)}
      .dash-f126 .dash-f126-card:focus-visible{outline:2px solid #2563eb;outline-offset:2px}
      .dash-f126 .dash-f126-value{font-size:24px;margin:13px 0 10px;overflow-wrap:anywhere}
      .dash-f126 .dash-f126-foot{border-top:0;padding-top:0}
      .dash-f126 .dash-f126-detail-cue{color:var(--f126-accent,#2563eb);font-size:10px;font-weight:800;white-space:nowrap;margin-inline-start:auto}
      .dash-f126 .dash-f126-card.orders{--f126-accent:#2563eb}
      .dash-f126 .dash-f126-card.revenue{--f126-accent:#0891b2}
      .dash-f126 .dash-f126-card.confirmation{--f126-accent:#7c3aed}
      .dash-f126 .dash-f126-card.delivery{--f126-accent:#16a34a}
      .dash-f126 .dash-f126-extras{margin-top:13px;border-top:1px solid var(--line,#e2e8f0);padding-top:10px}
      .dash-f126 .dash-f126-extras summary{cursor:pointer;color:var(--ink,#0f172a);font-size:11px;font-weight:850;list-style:none;padding:8px 0}
      .dash-f126 .dash-f126-extras summary::-webkit-details-marker{display:none}
      .dash-f126 .dash-f126-breakdowns{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;padding:10px 0 4px}
      .dash-f126 .dash-f126-breakdowns h3{margin:0 0 7px;font-size:11px}
      .dash-f126 .dash-f126-chips{display:flex;flex-wrap:wrap;gap:7px}
      .dash-f126 .dash-f126-chip{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line,#e2e8f0);border-radius:9px;background:var(--card,#fff);padding:7px 9px;font-size:10px}
      .dash-f126 .dash-f126-chip b{font-weight:900;color:var(--ink,#0f172a)}
      body[data-theme="dark"] .v33-dashboard .dash-f126{background:var(--card,#172033)!important}
      body[data-theme="dark"] .dash-f126 .dash-f126-refresh,body[data-theme="dark"] .dash-f126 .dash-f126-chip{background:var(--card,#172033)}
      @media(max-width:1040px){.dash-f126 .dash-f126-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
      @media(max-width:590px){.v33-dashboard .dash-f126{padding:13px!important}.dash-f126 .dash-f126-grid,.dash-f126 .dash-f126-breakdowns{grid-template-columns:1fr}.dash-f126 .dash-f126-card{min-height:112px}.dash-f126 .dash-f126-value{font-size:23px}}
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
    const d=dashboard();if(!d)return null;
    const ctx=await context(),u=new URL('/api/accounting/collected-profit',location.origin);
    if(ctx.clientId)u.searchParams.set('clientId',ctx.clientId);
    if(ctx.storeId)u.searchParams.set('storeId',ctx.storeId);
    if(d.from)u.searchParams.set('from',d.from);
    if(d.to)u.searchParams.set('to',d.to);
    if(details)u.searchParams.set('details','1');
    return getJson(u.pathname+u.search);
  }
  async function refreshCollected(force=false){
    const d=dashboard(),epoch=state.scopeEpoch;
    if(!d)return;
    const ctx=await context(),key=[ctx.clientId,ctx.storeId,d.from,d.to].join('|');
    if(epoch!==state.scopeEpoch||d!==dashboard())return;
    if(!force&&key===state.lastCollectedKey&&state.collected)return;
    if(!force&&state.collecting&&key===state.lastPendingKey)return;
    const request=++state.collectedRequest;
    state.lastPendingKey=key;
    state.collecting=true;render();
    try{
      // Snapshot the range and tenant before the asynchronous request, not after it.
      const u=new URL('/api/accounting/collected-profit',location.origin);
      if(ctx.clientId)u.searchParams.set('clientId',ctx.clientId);
      if(ctx.storeId)u.searchParams.set('storeId',ctx.storeId);
      if(d.from)u.searchParams.set('from',d.from);
      if(d.to)u.searchParams.set('to',d.to);
      const result=await getJson(u.pathname+u.search);
      if(request!==state.collectedRequest||epoch!==state.scopeEpoch||d!==dashboard())return;
      if(result.from!==d.from||result.to!==d.to)throw new Error('فترة بيانات التحصيل لا تطابق الفترة المختارة');
      state.collected=result;state.lastCollectedKey=key;
    }catch(error){
      if(request!==state.collectedRequest||epoch!==state.scopeEpoch||d!==dashboard())return;
      state.collected={error:error.message,from:d.from,to:d.to};state.lastCollectedKey=key;
    }finally{
      if(request===state.collectedRequest){state.collecting=false;state.lastPendingKey='';render();}
      if(request===state.collectedRequest&&(epoch!==state.scopeEpoch||d!==dashboard()))
        setTimeout(()=>refreshCollected(false),30);
    }
  }

  function card(type,title,value,sub,foot,negative=false){
    return `<button type="button" class="dash-f126-card ${type}${negative?' negative':''}" data-f126-detail="${esc(type)}" aria-label="عرض تفاصيل ${esc(title)}"><span class="dash-f126-head"><span class="dash-f126-icon" aria-hidden="true">${type==='collected'?'✓':type==='pending'?'◷':type==='cpp'?'◎':type==='orders'?'▦':type==='revenue'?'↗':type==='confirmation'?'☑':type==='delivery'?'⇄':'↕'}</span><span class="dash-f126-copy"><span>${esc(title)}</span><small>${esc(sub)}</small></span></span><strong class="dash-f126-value">${value}</strong><span class="dash-f126-foot"><span>${esc(foot)}</span><span class="dash-f126-detail-cue" aria-hidden="true">التفاصيل ←</span></span></button>`;
  }
  function selectedRates(d){
    const rates=d.rates?.selected;
    return rates&&rates.from===d.from&&rates.to===d.to?rates:null;
  }
  function entries(d,label){
    return d.overview?.details?.orders?.find(row=>row.label===label)?.items||[];
  }
  function chips(rows){
    if(!rows.length)return '<span class="dash-f126-chip">لا توجد بيانات لهذه الفترة</span>';
    return rows.map(row=>`<span class="dash-f126-chip">${esc(row.label)} <b>${num(row.value)}</b></span>`).join('');
  }
  function html(){
    const d=dashboard()||{},c=d.currency||'EGP',f=d.finance||{},o=d.overview||{};
    // A change of dashboard period must not show yesterday's collected profit.
    const cp=state.collected?.from===d.from&&state.collected?.to===d.to?state.collected:null;
    const collectedValue=state.collecting&&!cp?'جارٍ الحساب…':cp?.error?'غير متاح':cp?money(cp.collectedProfit||0,cp.currency||c):'جارٍ الحساب…';
    const collectedFoot=cp?.error?'تعذر قراءة بيانات التحصيل':cp?`${num(cp.collectedOrders)} أوردر محصل${cp.missingCollectionAmountOrders?` · ${num(cp.missingCollectionAmountOrders)} أوردر بمبلغ غير موثق`:''}`:'يتم التحقق من المحصل في نفس الفترة';
    const pending=n(o.expectedProfit),net=n(f.netProfit),orders=n(o.totalOrders),adSpend=n(o.adSpend),rt=selectedRates(d);
    const actualCpp=orders?money(adSpend/orders,c):'—';
    const cppFoot=orders?`${num(orders)} أوردر · صرف إعلانات ${money(adSpend,c)}`:'لا توجد أوردرات خلال الفترة';
    const confirmed=rt?.total?num(rt.confirmationRate)+'%':'—';
    const delivered=rt&&(n(rt.delivered)+n(rt.returned))?num(rt.deliveryRate)+'%':'—';
    const sources=entries(d,'مصادر الطلبات'),statuses=entries(d,'حالات الطلبات');
    return `<section class="dash-section dash-f126" data-dashboard-finance-top="126" dir="rtl">
      <div class="dash-f126-headline"><div><span class="dash-f126-eyebrow">نظرة موحدة على المتجر</span><h2>ملخص الأداء</h2><p>كل الأرقام الأساسية في مكان واحد، بدون تكرار. اضغط على أي مؤشر لمعرفة تفاصيل حسابه.</p></div>
      <div class="dash-f126-actions"><span class="dash-f126-period">${esc(d.from||'')} — ${esc(d.to||'')}</span><button type="button" class="dash-f126-refresh" data-f126-refresh="1">↻ تحديث الملخص</button></div></div>
      <div class="dash-f126-grid">
      ${card('orders','عدد الأوردرات',num(orders),'من جميع المصادر والأعضاء','كل الحالات · بدون تكرار')}
      ${card('revenue','الإيرادات المتوقعة',money(o.expectedRevenue,c),'بعد استبعاد الملغي والمرتجع','مبيعات الفترة قبل التحصيل')}
      ${card('pnl','صافي الربح التشغيلي',money(net,c),'صافي الفترة بعد كل المصروفات','النتيجة التشغيلية',net<0)}
      ${card('cpp','سعر الطلب الفعلي',actualCpp,'صرف الإعلانات ÷ كل الأوردرات',cppFoot)}
      ${card('collected','صافي التحصيل التقديري',collectedValue,'بعد تكلفة البضاعة المسجلة ومصاريف التحصيل',collectedFoot)}
      ${card('pending','هامش الطلبات النشطة',money(pending,c),'بعد تكلفة البضاعة ورسوم الطلب','قبل الإعلانات والمصاريف العامة')}
      ${card('confirmation','نسبة التأكيد',confirmed,'الأوردرات المؤكدة من الوارد','خلال الفترة المختارة')}
      ${card('delivery','نسبة التسليم',delivered,'من الطلبات التي اكتملت نتيجتها',rt?`مرتجع: ${num(rt.returnRate)}%`:'بيانات الفترة قيد التحميل')}
      </div>
      <details class="dash-f126-extras"><summary>▾ تفاصيل سريعة: مصادر الأوردرات وحالاتها</summary>
        <div class="dash-f126-breakdowns"><div><h3>مصادر الأوردرات</h3><div class="dash-f126-chips">${chips(sources)}</div></div>
        <div><h3>حالات الأوردرات</h3><div class="dash-f126-chips">${chips(statuses)}</div></div></div>
      </details>
    </section>`;
  }
  function render(){
    if(!active()||!dashboard())return;
    style();const dash=$('.v33-dashboard');if(!dash)return;
    const old=$('[data-dashboard-finance-top="126"]',dash);
    const nav=$('.dash-x-nav',dash),toolbar=$('.dash-period-toolbar',dash),legacy=$('.dash-range',dash),hero=$('.dash-hero',dash);
    const anchor=nav||toolbar||legacy||hero;if(!anchor)return;
    const d=dashboard(),signature=JSON.stringify([d.from,d.to,d.overview,d.finance?.netProfit,d.rates?.selected,state.collected,state.collecting]);
    if(old?.__kunSummarySig===signature)return;
    const extrasOpen=old?.querySelector('.dash-f126-extras')?.open||false;
    if(old)old.outerHTML=html();else anchor.insertAdjacentHTML('afterend',html());
    const current=$('[data-dashboard-finance-top="126"]',dash);
    if(current){
      current.__kunSummarySig=signature;
      if(extrasOpen){const details=$('.dash-f126-extras',current);if(details)details.open=true;}
    }
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
    const d=dashboard()||{},o=d.overview||{},orders=n(o.totalOrders),spend=n(o.adSpend),currency=d.currency||'EGP';
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
  function ordersDetails(){
    const d=dashboard()||{};
    modal('تفاصيل عدد الأوردرات',`<div class="kun85-scope-note">${esc(d.from||'')} — ${esc(d.to||'')} · الإجمالي <b>${num(d.overview?.totalOrders)}</b></div><div class="dash-f126-formula">يشمل كل الأوردرات المسجلة خلال الفترة، من إيزي أوردر أو الإضافة اليدوية بواسطة أي عضو في الفريق أو أي تكامل آخر، بجميع حالاتها. الأوردر الواحد يُحسب مرة واحدة.</div>${detailRows(d.overview?.details?.orders||[],d.currency)}`);
  }
  function revenueDetails(){
    const d=dashboard()||{};
    modal('تفاصيل الإيرادات المتوقعة',`<div class="kun85-scope-note">${esc(d.from||'')} — ${esc(d.to||'')} · الإيرادات المتوقعة <b>${money(d.overview?.expectedRevenue,d.currency)}</b></div><div class="dash-f126-formula">الإيرادات المتوقعة بعد استبعاد الملغي والمرتجع؛ وهي تختلف عن المبالغ المحصلة بالفعل.</div>${detailRows(d.overview?.details?.expectedRevenue||[],d.currency)}`);
  }
  function ratesDetails(type){
    const d=dashboard()||{},r=selectedRates(d),isConfirmation=type==='confirmation';
    const title=isConfirmation?'تفاصيل نسبة التأكيد':'تفاصيل نسبة التسليم والمرتجعات';
    if(!r){modal(title,'<div class="dash-empty">معدلات هذه الفترة غير متاحة حاليًا؛ يُرجى تحديث البيانات.</div>');return;}
    const numerator=isConfirmation?n(r.confirmed):n(r.delivered);
    const denominator=isConfirmation?n(r.total):n(r.delivered)+n(r.returned);
    const percentage=denominator?num(isConfirmation?r.confirmationRate:r.deliveryRate)+'%':'—';
    const formula=isConfirmation?'الأوردرات المؤكدة ÷ جميع الأوردرات المسجلة خلال الفترة × 100':'الأوردرات التي تم تسليمها ÷ (تم التسليم + المرتجعات التي انتهى شحنها) × 100';
    const detailItems=isConfirmation?
      [{label:'كل الأوردرات الداخلة',value:r.total},{label:'الأوردرات المؤكدة',value:r.confirmed}]:
      [{label:'تم التسليم',value:r.delivered},{label:'مرتجعات',value:r.returned},{label:'نسبة المرتجعات من نتائج الشحن',value:r.returnRate,percent:true}];
    modal(title,`<div class="kun85-scope-note">الفترة: ${esc(d.from||'')} — ${esc(d.to||'')} · النتيجة <b>${esc(percentage)}</b></div><div class="dash-f126-formula">${esc(formula)}. العدد المحتسب: ${num(numerator)} من ${num(denominator)}.</div>${detailRows(detailItems,d.currency)}`);
  }
  async function pendingDetails(){
    const d=dashboard()||{},items=d.overview?.details?.expectedProfit||[];
    modal('مفردات هامش الطلبات النشطة',`<div class="kun85-scope-note">${esc(d.from||'')} — ${esc(d.to||'')} · الإجمالي <b>${money(d.overview?.expectedProfit,d.currency)}</b></div><div class="dash-f126-formula">يشمل الطلبات المؤكدة وقيد التجهيز والجاري شحنها، بعد تكلفة البضاعة ورسوم الطلب المباشرة، وقبل الإعلانات والمصاريف العامة. ليس صافي ربح المتجر.</div>${detailRows(items,d.currency)}`);
  }
  async function pnlDetails(){
    const d=dashboard()||{},ctx=await context(),u=new URL('/api/system/dashboard/input-details',location.origin);
    u.searchParams.set('kind','netProfit');if(ctx.clientId)u.searchParams.set('clientId',ctx.clientId);if(ctx.storeId)u.searchParams.set('storeId',ctx.storeId);if(d.from)u.searchParams.set('from',d.from);if(d.to)u.searchParams.set('to',d.to);
    const holder=modal('مفردات صافي الربح التشغيلي','<div class="cs-loading">جارٍ تحميل تفاصيل الحساب…</div>');
    try{const x=await getJson(u.pathname+u.search),summary=x.summary||[];$('.dash-f126-modal',holder).innerHTML=`<h2>مفردات صافي الربح التشغيلي</h2><div class="kun85-scope-note">${esc(x.from||d.from||'')} — ${esc(x.to||d.to||'')} · الناتج <b>${money(x.total,d.currency)}</b></div><div class="dash-f126-summary">${summary.map(row=>`<div><span>${esc(row.label)}</span><b>${row.percent?`${num(row.value)}%`:row.money?money(row.value,d.currency):num(row.value)}</b></div>`).join('')}</div><div class="dash-f126-formula">المعادلة: ${esc(x.formula||'إيراد المنتجات − تكلفة المنتج − المصروفات التشغيلية')}</div><div class="cs-modal-actions"><button class="btn soft" data-f126-close>قفل</button></div>`; $('[data-f126-close]',holder).onclick=closeModal;}
    catch(error){$('.dash-f126-modal',holder).innerHTML=`<h2>تعذر تحميل التفاصيل</h2><p>${esc(error.message)}</p><div class="cs-modal-actions"><button class="btn soft" data-f126-close>قفل</button></div>`; $('[data-f126-close]',holder).onclick=closeModal;}
  }
  function collectedRows(x){
    const rows=x.orders||[];if(!rows.length)return '<div class="dash-empty">لا توجد أوردرات محصلة في الفترة.</div>';
    return `<div class="dash-f126-table"><table><thead><tr><th>الأوردر</th><th>العميل</th><th>تاريخ الأوردر</th><th>تاريخ التحصيل</th><th>المحصل</th><th>الإدارة</th><th>بعد الإدارة</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.ref||r.id)}</td><td>${esc(r.customerName||'—')}</td><td>${esc(r.orderDate||'—')}</td><td>${esc(r.collectedAt||'—')}</td><td>${money(r.collectedAmount,x.currency)}${r.collectionAmountEstimated?' <small>(قيمة الأوردر تقديرية)</small>':''}</td><td>${money(r.managementFee,x.currency)}</td><td><b>${money(r.afterManagement,x.currency)}</b></td></tr>`).join('')}</tbody></table></div>`;
  }
  async function collectedDetails(){
    const holder=modal('مفردات صافي التحصيل التقديري','<div class="cs-loading">جارٍ تحميل كل الحسابات…</div>');
    try{const x=await collected(true),period=x.orderPeriodFrom?`${x.orderPeriodFrom} — ${x.orderPeriodTo}`:'—';$('.dash-f126-modal',holder).innerHTML=`<h2>مفردات صافي التحصيل التقديري</h2><div class="kun85-scope-note">فترة التحصيل: ${esc(x.from)} — ${esc(x.to)} · ${esc(x.storeName||'كل المتاجر')}</div><div class="dash-f126-summary"><div><span>${x.missingCollectionAmountOrders?'مسجل + قيم طلبات مقدرة':'تحصيل مسجل من الشحن'}</span><b>${money(x.collectedGross,x.currency)}</b></div><div><span>تكلفة البضاعة المسجلة</span><b>${money(x.productCost,x.currency)}</b></div><div><span>مصاريف الإدارة</span><b>${money(x.managementFees,x.currency)}</b></div><div><span>مصاريف فترة التحصيل</span><b>${money(x.periodExpenses,x.currency)}</b></div><div><span>صافي المحصل</span><b>${money(x.collectedProfit,x.currency)}</b></div></div><div class="dash-f126-formula">${esc(x.formula)} · تاريخ إنشاء الأوردرات المحصلة: ${esc(period)} ${x.missingProductCostOrders?` · تنبيه: ${num(x.missingProductCostOrders)} أوردر بلا تكلفة بضاعة موجبة مسجلة، فالربح تقديري`:''}${x.missingCollectionAmountOrders?` · تحذير: ${num(x.missingCollectionAmountOrders)} أوردر بلا مبلغ تحصيل مثبت، إجمالي القيم البديلة ${money(x.unverifiedCollectionFallbackGross,x.currency)}، والتحصيل بأرقام مسجلة ${money(x.verifiedCollectedGross,x.currency)}. لا تعتبر الإجمالي وصولًا نقديًا للبنك.`:''}</div>${collectedRows(x)}<div class="dash-f126-list"><div class="dash-f126-row"><span>مصاريف عامة بفترة التحصيل</span><b>${money(x.expenses?.general,x.currency)}</b></div><div class="dash-f126-row"><span>صرف الإعلانات المحتسب</span><b>${money(x.expenses?.adSpend,x.currency)}</b></div><div class="dash-f126-row"><span>مصدر صرف الإعلانات</span><b>${x.expenses?.adSpendSource==='integrations'?'تكاملات الإعلانات':'تسجيل يدوي'}</b></div></div><div class="cs-modal-actions"><button class="btn soft" data-f126-close>قفل</button></div>`; $('[data-f126-close]',holder).onclick=closeModal;}
    catch(error){$('.dash-f126-modal',holder).innerHTML=`<h2>تعذر تحميل التفاصيل</h2><p>${esc(error.message)}</p><div class="cs-modal-actions"><button class="btn soft" data-f126-close>قفل</button></div>`; $('[data-f126-close]',holder).onclick=closeModal;}
  }
  function open(type){
    if(type==='orders')return ordersDetails();
    if(type==='revenue')return revenueDetails();
    if(type==='confirmation'||type==='delivery')return ratesDetails(type);
    if(type==='collected')return collectedDetails();
    if(type==='pending')return pendingDetails();
    if(type==='cpp')return cppDetails();
    return pnlDetails();
  }
  function schedule(delay=40){clearTimeout(state.timer);state.timer=setTimeout(render,delay);}
  function capture(path,data){
    if(path==='/api/dashboard'&&data?.ok){state.dashboard=data;if(!state.scopedDashboard){state.scopeEpoch++;state.collected=null;state.lastCollectedKey='';}schedule(20);if(!state.scopedDashboard)setTimeout(()=>refreshCollected(false),40);}
    // Only guarded refreshCollected may install a collected-profit response.
  }
  window.fetch=async function(...args){
    const response=await nativeFetch(...args);try{const input=args[0],url=typeof input==='string'?input:input?.url||'',path=new URL(url,location.origin).pathname;if(path==='/api/dashboard'||path==='/api/accounting/collected-profit')response.clone().json().then(data=>capture(path,data)).catch(()=>{});}catch{}return response;
  };
  function hook(){
    style();const root=$('#root');if(root)new MutationObserver(()=>{if(active())schedule(55);}).observe(root,{childList:true,subtree:true});
    document.addEventListener('click',event=>{
      const detail=event.target.closest?.('[data-f126-detail]');if(detail){event.preventDefault();open(detail.dataset.f126Detail);return;}
      if(event.target.closest?.('[data-f126-refresh]')){event.preventDefault();window.KunDashboardSectionPeriodsV125?.reloadSection?.('summary');return;}
      if(event.target.closest?.('.nav button[data-view="dashboard"],[data-dash-preset],#dashApplyRange'))
        setTimeout(()=>{schedule(120);refreshCollected(true);},700);
    },true);
    document.addEventListener('change',event=>{if(event.target.closest?.('#storeBtn')){state.scopeEpoch++;state.dashboard=null;state.scopedDashboard=null;state.collected=null;state.lastCollectedKey='';$('[data-dashboard-finance-top="126"]')?.remove();}},true);
    setTimeout(()=>{render();if(active()&&state.dashboard)refreshCollected(false);},900);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',hook,{once:true});else hook();
  window.KunDashboardFinanceTopV126={version:VERSION,refresh:()=>{render();return refreshCollected(true);},setScopedDashboard:d=>{if(!d?.ok)return;state.scopeEpoch++;state.scopedDashboard=d;state.collected=null;state.lastCollectedKey='';render();refreshCollected(true);},clearScopedDashboard:()=>{state.scopeEpoch++;state.scopedDashboard=null;state.collected=null;state.lastCollectedKey='';render();refreshCollected(true);},open};
})();
