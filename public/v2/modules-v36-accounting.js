/* Kun Online v100 — unified monthly accounting workspace. */
(function(){
  'use strict';
  if(window.KunAccountingV100)return;

  const VIEW='accounting';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const n=v=>Number(v)||0;
  const fmt=(v,d=2)=>new Intl.NumberFormat('ar-EG',{maximumFractionDigits:d}).format(n(v));
  const money=(v,c='EGP')=>`${fmt(v)} ${c==='EGP'?'ج.م':esc(c||'EGP')}`;
  const methodLabels={cash:'كاش',bank:'تحويل بنكي',card:'بطاقة',wallet:'محفظة',instapay:'InstaPay',vodafone_cash:'Vodafone Cash',other:'أخرى'};
  const stateLabels={shipped:'تم الشحن',signed:'تم التسليم',collected:'تم التحصيل',returned:'مرتجع',cancelled:'ملغي'};
  const root=()=>document.getElementById('root');
  const active=()=>document.querySelector('.nav button.active[data-view]')?.dataset.view===VIEW;
  const notify=message=>window.showToast?window.showToast(message):(typeof toast==='function'?toast(message):console.info(message));
  let rendering=0;

  function today(){const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()),g=t=>p.find(x=>x.type===t)?.value||'';return `${g('year')}-${g('month')}-${g('day')}`;}
  function currentMonth(){return today().slice(0,7);}
  function monthRange(month){const m=/^\d{4}-\d{2}$/.test(month)?month:currentMonth(),[y,mo]=m.split('-').map(Number),last=new Date(Date.UTC(y,mo,0)).toISOString().slice(0,10);return {from:`${m}-01`,to:m===currentMonth()?today():last};}
  async function context(){return {clientId:window.kunClientId?await window.kunClientId():'',storeId:window.kunStoreId?await window.kunStoreId():''};}
  async function api(path,options={}){
    const ctx=await context(),u=new URL(path,location.origin),method=String(options.method||'GET').toUpperCase();
    if(ctx.clientId&&!u.searchParams.has('clientId'))u.searchParams.set('clientId',ctx.clientId);
    if(ctx.storeId&&!u.searchParams.has('storeId')&&method==='GET')u.searchParams.set('storeId',ctx.storeId);
    const init={credentials:'include',headers:{'Content-Type':'application/json',...(options.headers||{})},...options};
    if(method!=='GET'&&method!=='HEAD'){
      let body={};try{body=options.body?JSON.parse(options.body):{}}catch{}
      if(ctx.clientId&&!body.clientId)body.clientId=ctx.clientId;
      if(ctx.storeId&&!body.storeId)body.storeId=ctx.storeId;
      init.body=JSON.stringify(body);
    }
    const r=await fetch(u.pathname+u.search,init),d=await r.json().catch(()=>({}));
    if(!r.ok){const e=new Error(d.error||`HTTP ${r.status}`);e.code=d.code;throw e;}return d;
  }
  function invalidateFinance(){
    for(const key of ['/api/dashboard','/api/accounting/overview','/api/accounting/entries','/api/accounting/monthly','/api/accounting/management-fees'])window.KunPerformanceCore?.invalidate?.(key);
    document.dispatchEvent(new CustomEvent('kun:accounting-changed',{detail:{at:Date.now()}}));
  }
  function canWrite(me){return me?.role==='client'||me?.role==='admin'||me?.role==='accountant'||(me?.permissions||[]).some?.(x=>x==='finance.*'||x==='finance.write'||x==='*');}

  function ensureStyles(){if(document.getElementById('kunAccountingV100Styles'))return;const s=document.createElement('style');s.id='kunAccountingV100Styles';s.textContent=`
    .acc100{display:grid;gap:15px;direction:rtl}.acc100-head{display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap}.acc100-head .spacer{flex:1}.acc100-actions{display:flex;gap:8px;align-items:end;flex-wrap:wrap}.acc100-actions label{display:grid;gap:5px;font-size:10.5px;color:#64748b;font-weight:800}.acc100-actions input{min-width:155px}.acc100-scope{display:inline-flex;padding:5px 9px;border-radius:999px;background:#eff6ff;color:#1d4ed8;border:1px solid #dbeafe;font-size:10px;font-weight:850}
    .acc100-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.acc100-kpi{padding:14px;border:1px solid var(--line,#e2e8f0);border-radius:15px;background:#fff;display:grid;gap:5px}.acc100-kpi span{font-size:10.5px;color:#64748b;font-weight:800}.acc100-kpi strong{font-size:19px}.acc100-kpi small{font-size:9.5px;color:#94a3b8;line-height:1.55}.acc100-kpi.good strong{color:#15803d}.acc100-kpi.bad strong{color:#b91c1c}.acc100-kpi.cash{background:#f0fdf4;border-color:#bbf7d0}.acc100-kpi.focus{background:#eff6ff;border-color:#bfdbfe}
    .acc100-grid{display:grid;grid-template-columns:minmax(360px,.85fr) minmax(0,1.15fr);gap:13px;align-items:start}.acc100-card{border:1px solid var(--line,#e2e8f0);border-radius:16px;background:#fff;padding:16px}.acc100-title-row{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;margin-bottom:11px}.acc100-title{font-size:16px;font-weight:850}.acc100-sub{font-size:10.5px;color:#64748b;line-height:1.7;margin-top:3px}.acc100-chip{font-size:9.5px;font-weight:850;padding:4px 8px;border:1px solid #e2e8f0;background:#f8fafc;color:#64748b;border-radius:999px;white-space:nowrap}
    .acc100-pnl{display:grid}.acc100-row{display:grid;grid-template-columns:minmax(150px,1fr) auto;gap:14px;align-items:center;padding:8px 0;border-bottom:1px dashed #e2e8f0}.acc100-row:last-child{border-bottom:0}.acc100-row span{font-size:11px;color:#475569}.acc100-row b{font-size:12px}.acc100-row.major span,.acc100-row.major b{font-weight:900;color:#0f172a}.acc100-row.total{margin-top:6px;padding:11px 10px;border:0;border-radius:11px;background:#f8fafc}.acc100-row.total.good{background:#f0fdf4}.acc100-row.total.bad{background:#fff1f2}.acc100-row.total.good b{color:#15803d}.acc100-row.total.bad b{color:#b91c1c}.acc100-indent{padding-right:12px!important}.acc100-note{padding:10px 12px;border-radius:11px;background:#eff6ff;border:1px solid #dbeafe;color:#1e40af;font-size:10.5px;line-height:1.75}.acc100-warn{background:#fff7ed;border-color:#fed7aa;color:#9a3412}
    .acc100-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.acc100-form label{display:grid;gap:5px;font-size:10.5px;color:#64748b;font-weight:800}.acc100-form .wide{grid-column:1/-1}.acc100-store-select{background:#fffbea!important;border-color:#fde68a!important}.acc100-table{overflow:auto;max-height:520px}.acc100-table table{width:100%;border-collapse:collapse;min-width:960px}.acc100-table th,.acc100-table td{padding:9px 8px;border-bottom:1px solid #eef2f7;text-align:right;font-size:10.5px;white-space:nowrap}.acc100-table th{color:#64748b;font-size:9.5px}.acc100-pos{color:#15803d;font-weight:900}.acc100-neg{color:#b91c1c;font-weight:900}.acc100-cat-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.acc100-cat{display:flex;justify-content:space-between;gap:8px;padding:9px 10px;border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc;font-size:10px}.acc100-cat b{font-size:10.5px}.acc100-empty{text-align:center;padding:22px;color:#94a3b8;font-size:11px}.acc100-status{display:inline-flex;padding:3px 8px;border-radius:999px;font-size:10px;font-weight:850}.acc100-status.active{background:#dcfce7;color:#166534}.acc100-status.reversed{background:#fee2e2;color:#991b1b}.acc100-store-settings{margin-top:16px}.acc100-store-row{display:grid;grid-template-columns:minmax(180px,1fr) minmax(150px,220px) auto;gap:10px;align-items:end;padding:12px 0;border-bottom:1px solid #e2e8f0}
    @media(max-width:1100px){.acc100-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.acc100-grid{grid-template-columns:1fr}}@media(max-width:650px){.acc100-kpis,.acc100-form,.acc100-cat-grid{grid-template-columns:1fr}.acc100-form .wide{grid-column:auto}.acc100-head{align-items:stretch}.acc100-actions{width:100%}.acc100-actions label{flex:1}.acc100-actions input{width:100%;min-width:0}.acc100-actions .btn{flex:1}.acc100-store-row{grid-template-columns:1fr}}
  `;document.head.appendChild(s);}

  function ensureNav(){
    const nav=document.querySelector('.nav');if(!nav||nav.querySelector(`[data-view="${VIEW}"]`))return;
    const b=document.createElement('button');b.dataset.view=VIEW;b.textContent='الحسابات والحركات';
    const finance=nav.querySelector('[data-view="finance"]');if(finance)finance.insertAdjacentElement('afterend',b);else nav.appendChild(b);
    window.KunSidebarGroupsV90?.sync?.();
  }
  function storesOptions(stores,selected=''){return `<option value="">اختر المتجر / الفرع</option>${(stores||[]).map(s=>`<option value="${esc(s.id)}" ${String(s.id)===String(selected)?'selected':''}>${esc(s.name||s.code||s.id)}</option>`).join('')}`;}
  function form(catalog,currency,write,stores,fixedStore){
    const cats=(catalog.categories||[]).map(x=>`<option>${esc(x)}</option>`).join(''),methods=(catalog.methods||[]).map(x=>`<option value="${esc(x)}">${esc(methodLabels[x]||x)}</option>`).join('');
    return `<section class="acc100-card"><div class="acc100-title-row"><div><div class="acc100-title">تسجيل حركة</div><div class="acc100-sub">الحركة تُسجّل على شهرها وتدخل تلقائيًا في الحساب الشهري والمالية.</div></div><span class="acc100-chip">${write?'كتابة مفعلة':'قراءة فقط'}</span></div>${!fixedStore?'<div class="acc100-note acc100-warn" style="margin-bottom:10px">أنت تعرض كل المتاجر. اختَر المتجر داخل الحركة بدل ما تضطر تغيّر فلتر النظام.</div>':''}<div class="acc100-form">
      ${!fixedStore?`<label class="wide">المتجر / الفرع<select class="select acc100-store-select" id="acc100Store">${storesOptions(stores)}</select></label>`:''}
      <label>نوع الحركة<select class="select" id="acc100Type"><option value="expense">مصروف</option><option value="income">إيراد آخر</option></select></label>
      <label>البند<select class="select" id="acc100Category">${cats}</select></label>
      <label>المبلغ<input class="input" id="acc100Amount" type="number" min="0" step="0.01" value="0"></label>
      <label>طريقة الدفع<select class="select" id="acc100Method">${methods}</select></label>
      <label>التاريخ<input class="input" id="acc100Date" type="date" value="${today()}"></label>
      <label>الجهة / الطرف المقابل<input class="input" id="acc100Counterparty" placeholder="مورد، موظف، شركة..."></label>
      <label>رقم المستند<input class="input" id="acc100Document" placeholder="اختياري"></label>
      <label>الضريبة<input class="input" id="acc100Tax" type="number" min="0" step="0.01" value="0"></label>
      <label>تاريخ الاستحقاق<input class="input" id="acc100Due" type="date"></label>
      <label>نوع المرجع<input class="input" id="acc100RefType" placeholder="order / invoice / supplier"></label>
      <label>رقم المرجع<input class="input" id="acc100RefId" placeholder="رقم الطلب أو الفاتورة"></label>
      <label class="wide">رابط مرفق<input class="input" id="acc100Attachment" type="url" placeholder="https://..."></label>
      <label class="wide">البيان<textarea class="input" id="acc100Note" rows="3" placeholder="تفاصيل الحركة"></textarea></label>
      <div class="wide"><button class="btn primary" id="acc100Save" ${write?'':'disabled'}>تسجيل الحركة</button></div>
    </div></section>`;
  }
  function pnl(m){const c=m.currency||'EGP',p=m.profit||{},cost=m.costs||{},sales=m.sales||{},net=n(p.accountingNetProfit);return `<section class="acc100-card"><div class="acc100-title-row"><div><div class="acc100-title">الحساب الشهري P&amp;L</div><div class="acc100-sub">مجمّع من الطلبات والتكاليف والإعلانات والشحن والحركات اليدوية، بدون تكرار.</div></div><span class="acc100-chip">${esc(m.period?.month||'')}</span></div><div class="acc100-pnl">
    <div class="acc100-row major"><span>إيراد المبيعات</span><b>${money(sales.revenue,c)}</b></div>
    <div class="acc100-row"><span>− تكلفة المنتجات COGS</span><b>− ${money(cost.productCost,c)}</b></div>
    <div class="acc100-row major"><span>= مجمل الربح</span><b>${money(p.grossProfit,c)}</b></div>
    <div class="acc100-row acc100-indent"><span>إعلانات</span><b>− ${money(cost.ads,c)}</b></div>
    <div class="acc100-row acc100-indent"><span>شحن يتحمله البيزنس</span><b>− ${money(cost.shipping,c)}</b></div>
    <div class="acc100-row acc100-indent"><span>تغليف / مصاريف أوردر</span><b>− ${money(cost.orderOther,c)}</b></div>
    <div class="acc100-row acc100-indent"><span>مصاريف عامة وحركات يدوية</span><b>− ${money(cost.general,c)}</b></div>
    <div class="acc100-row acc100-indent"><span>إدارة ورسوم تشغيل</span><b>− ${money(cost.admin,c)}</b></div>
    <div class="acc100-row"><span>= صافي الربح التشغيلي</span><b>${money(p.operatingNetProfit,c)}</b></div>
    <div class="acc100-row"><span>+ إيرادات أخرى مسجلة يدويًا</span><b>+ ${money(p.otherIncome,c)}</b></div>
    <div class="acc100-row total ${net>=0?'good':'bad'}"><span>= صافي الربح المحاسبي للشهر</span><b>${money(net,c)}</b></div>
    </div><div class="acc100-note" style="margin-top:11px">التحصيل الفعلي (${money(sales.collectedRevenue,c)}) منفصل عن إيراد المبيعات حتى لا تُحسب نفس الفلوس مرتين. المصروف اليدوي يدخل أصلًا ضمن مصروفات التشغيل، لذلك لا يتم خصمه مرة ثانية.</div></section>`;}
  function kpis(m){const c=m.currency||'EGP',sales=m.sales||{},cost=m.costs||{},p=m.profit||{},cash=m.cash||{},net=n(p.accountingNetProfit);return `<div class="acc100-kpis"><div class="acc100-kpi focus"><span>إيراد المبيعات</span><strong>${money(sales.revenue,c)}</strong><small>قيمة المبيعات الداخلة في حساب الشهر.</small></div><div class="acc100-kpi cash"><span>المحصل فعليًا</span><strong>${money(sales.collectedRevenue,c)}</strong><small>سيولة محصلة وليست إيرادًا إضافيًا.</small></div><div class="acc100-kpi"><span>تكلفة المنتج</span><strong>${money(cost.productCost,c)}</strong><small>COGS للفترة.</small></div><div class="acc100-kpi"><span>المصروفات التشغيلية</span><strong>${money(cost.operatingExpenses,c)}</strong><small>تشمل المصروفات اليدوية مرة واحدة.</small></div><div class="acc100-kpi ${net>=0?'good':'bad'}"><span>صافي الربح المحاسبي</span><strong>${money(net,c)}</strong><small>التشغيلي + الإيرادات الأخرى.</small></div><div class="acc100-kpi"><span>هامش الربح</span><strong>${fmt(p.marginPct,1)}%</strong><small>صافي الربح المحاسبي ÷ المبيعات.</small></div><div class="acc100-kpi"><span>إيرادات أخرى</span><strong>${money(p.otherIncome,c)}</strong><small>حركات دخل يدوية، لا تُضاف للمبيعات.</small></div><div class="acc100-kpi"><span>صافي التدفق المسجل</span><strong>${money(cash.registeredNetCash,c)}</strong><small>مؤشر تحصيل/حركات مسجلة وليس رصيد بنك.</small></div></div>`;}
  function categories(m){const c=m.currency||'EGP',rows=m.manual?.categories||[];if(!rows.length)return '<div class="acc100-empty">لا توجد حركات يدوية في الشهر.</div>';return `<div class="acc100-cat-grid">${rows.map(x=>`<div class="acc100-cat"><span>${x.type==='income'?'إيراد':'مصروف'} · ${esc(x.category)}</span><b class="${x.type==='income'?'acc100-pos':'acc100-neg'}">${money(x.amount,c)}</b></div>`).join('')}</div>`;}
  function entriesTable(rows,currency,write,storeMap){if(!rows.length)return '<div class="acc100-empty">لا توجد حركات مسجلة في الشهر.</div>';return `<div class="acc100-table"><table><thead><tr><th>التاريخ</th><th>المتجر</th><th>النوع</th><th>البند</th><th>الجهة</th><th>المبلغ</th><th>الدفع</th><th>المستند</th><th>البيان</th><th></th></tr></thead><tbody>${rows.map(x=>`<tr><td>${esc(x.date||'—')}</td><td>${esc(storeMap.get(String(x.storeId))||x.storeId||'—')}</td><td>${x.type==='income'?'<span class="acc100-pos">إيراد</span>':'<span class="acc100-neg">مصروف</span>'}</td><td>${esc(x.category||'—')}</td><td>${esc(x.counterparty||'—')}</td><td>${money(x.amount,x.currency||currency)}</td><td>${esc(methodLabels[x.method]||x.method||'—')}</td><td>${esc(x.documentNo||'—')}</td><td>${esc(x.note||'—')}</td><td>${write?`<button class="btn soft acc100Delete" data-id="${esc(x.id)}" data-store="${esc(x.storeId||'')}">حذف</button>`:'—'}</td></tr>`).join('')}</tbody></table></div>`;}
  function feesTable(rows,currency){if(!rows.length)return '<div class="acc100-empty">لا توجد رسوم إدارة في الشهر.</div>';return `<div class="acc100-table"><table style="min-width:760px"><thead><tr><th>الأوردر</th><th>التاريخ</th><th>العميل</th><th>الحالة</th><th>النسبة</th><th>المبلغ</th><th>القيد</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${esc(x.ref||x.orderId)}</td><td>${esc(x.date||'—')}</td><td>${esc(x.customerName||'—')}</td><td>${esc(stateLabels[x.state]||x.state||'—')}</td><td>${fmt(x.ratePct)}%</td><td>${money(x.amount,currency)}</td><td><span class="acc100-status ${esc(x.status)}">${x.status==='active'?'محتسب':'معكوس'}</span></td></tr>`).join('')}</tbody></table></div>`;}

  async function renderAccounting(){
    ensureStyles();ensureNav();const el=root();if(!el)return;const token=++rendering;el.innerHTML='<div class="card">جارٍ تحميل الحسابات الشهرية...</div>';
    try{
      const [{clientId,storeId},me,catalog]=await Promise.all([context(),fetch('/api/me',{credentials:'include'}).then(r=>r.json()),api('/api/accounting/catalog')]);
      if(token!==rendering||!active())return;
      let storeContext={stores:[]};if(clientId){try{const r=await fetch(`/api/my-store-context?clientId=${encodeURIComponent(clientId)}`,{credentials:'include'}),d=await r.json();if(r.ok)storeContext=d;}catch{}}
      const stores=storeContext.stores||[],storeMap=new Map(stores.map(s=>[String(s.id),s.name||s.code||s.id])),write=canWrite(me);
      el.innerHTML=`<div class="acc100"><div class="page-head acc100-head"><div><div class="title">الحسابات والحركات</div><div class="sub">كل حركة تسمع في شهرها على الحسابات والمالية للسيستم، مع فصل المبيعات عن التحصيل النقدي.</div><div style="margin-top:7px"><span class="acc100-scope">${storeId?esc(storeMap.get(String(storeId))||'المتجر الحالي'):'كل المتاجر'}</span></div></div><div class="spacer"></div><div class="acc100-actions"><label>الشهر<input class="input" type="month" id="acc100Month" value="${currentMonth()}"></label><button class="btn soft" id="acc100Reload">تحديث</button></div></div><div id="acc100Body"></div></div>`;
      const load=async()=>{
        const body=document.getElementById('acc100Body'),month=document.getElementById('acc100Month')?.value||currentMonth();if(!body||!active())return;const localToken=++rendering;body.innerHTML='<div class="card">جارٍ تجميع حساب الشهر من كل مصادر السيستم...</div>';
        try{
          const r=monthRange(month),q=`from=${encodeURIComponent(r.from)}&to=${encodeURIComponent(r.to)}`;
          const [monthly,entries,fees]=await Promise.all([api(`/api/accounting/monthly?month=${encodeURIComponent(month)}`),api(`/api/accounting/entries?${q}`),api(`/api/accounting/management-fees?${q}`)]);
          if(localToken!==rendering||!active()||document.getElementById('acc100Body')!==body)return;
          const c=monthly.currency||'EGP';body.innerHTML=`${kpis(monthly)}<div class="acc100-grid">${pnl(monthly)}${form(catalog,c,write,stores,storeId)}</div><div class="acc100-grid"><section class="acc100-card"><div class="acc100-title-row"><div><div class="acc100-title">توزيع الحركات اليدوية</div><div class="acc100-sub">للمراجعة فقط؛ المصروفات مدخلة بالفعل في P&amp;L ولا تُخصم مرة ثانية.</div></div></div>${categories(monthly)}</section><section class="acc100-card"><div class="acc100-title-row"><div><div class="acc100-title">سلامة الربط الشهري</div><div class="acc100-sub">مصادر الحساب المستخدم حاليًا.</div></div></div><div class="acc100-pnl"><div class="acc100-row"><span>مصدر تكلفة المنتج</span><b>${esc(monthly.quality?.productCostSource||'غير محدد')}</b></div><div class="acc100-row"><span>مصدر صرف الإعلانات</span><b>${esc(monthly.quality?.adSpendSource||'غير محدد')}</b></div><div class="acc100-row"><span>حركات يدوية في الشهر</span><b>${fmt(monthly.manual?.entries,0)}</b></div><div class="acc100-row"><span>أوردرات عليها رسوم إدارة</span><b>${fmt(monthly.quality?.managementFeeOrders,0)}</b></div></div></section></div><section class="acc100-card"><div class="acc100-title-row"><div><div class="acc100-title">القيود والحركات</div><div class="acc100-sub">${esc(monthly.storeName||'كل المتاجر')} · ${esc(r.from)} إلى ${esc(r.to)}</div></div></div>${entriesTable(entries.entries||[],c,write,storeMap)}</section><section class="acc100-card"><div class="acc100-title-row"><div><div class="acc100-title">رسوم الإدارة الآلية</div><div class="acc100-sub">تدخل ضمن مصروفات الإدارة مرة واحدة، وتُعكس عند المرتجع أو الإلغاء.</div></div></div>${feesTable(fees.entries||[],c)}</section>`;
          bindBody(load,storeId,write);
        }catch(error){if(localToken!==rendering||!active())return;body.innerHTML=`<div class="card"><strong>تعذر تحميل الحساب الشهري</strong><div class="sub mt">${esc(error.message)}</div></div>`;}
      };
      document.getElementById('acc100Reload')?.addEventListener('click',load);document.getElementById('acc100Month')?.addEventListener('change',load);await load();
    }catch(error){if(active())el.innerHTML=`<div class="card"><strong>تعذر فتح الحسابات</strong><div class="sub mt">${esc(error.message)}</div></div>`;}
  }

  function bindBody(reload,fixedStore,write){
    const save=document.getElementById('acc100Save');if(save&&write)save.onclick=async()=>{
      const selectedStore=fixedStore||document.getElementById('acc100Store')?.value||'';if(!selectedStore){notify('اختار المتجر أو الفرع للحركة');document.getElementById('acc100Store')?.focus();return;}
      const amount=n(document.getElementById('acc100Amount')?.value);if(amount<=0){notify('اكتب مبلغ أكبر من صفر');return;}
      try{save.disabled=true;await api('/api/accounting/entries',{method:'POST',body:JSON.stringify({storeId:selectedStore,type:document.getElementById('acc100Type').value,category:document.getElementById('acc100Category').value,amount,method:document.getElementById('acc100Method').value,date:document.getElementById('acc100Date').value,counterparty:document.getElementById('acc100Counterparty').value,documentNo:document.getElementById('acc100Document').value,taxAmount:n(document.getElementById('acc100Tax').value),dueDate:document.getElementById('acc100Due').value,referenceType:document.getElementById('acc100RefType').value,referenceId:document.getElementById('acc100RefId').value,attachmentUrl:document.getElementById('acc100Attachment').value,note:document.getElementById('acc100Note').value})});invalidateFinance();notify('تم تسجيل الحركة ودخلت في حسابات الشهر');await reload();}catch(e){notify(e.message)}finally{if(save?.isConnected)save.disabled=false;}
    };
    document.querySelectorAll('.acc100Delete').forEach(b=>b.onclick=async()=>{if(!confirm('حذف الحركة المحاسبية؟ سيتم تحديث حساب الشهر بعدها.'))return;try{b.disabled=true;await api(`/api/accounting/entries/${encodeURIComponent(b.dataset.id)}`,{method:'DELETE',body:JSON.stringify({storeId:b.dataset.store||fixedStore||''})});invalidateFinance();notify('تم حذف الحركة وتحديث الحساب الشهري');await reload();}catch(e){notify(e.message)}finally{if(b?.isConnected)b.disabled=false;}});
  }

  async function injectAdminStoreSettings(){
    ensureStyles();const el=root();if(!el||document.getElementById('acc100StoreSettings'))return;
    try{const me=await fetch('/api/me',{credentials:'include'}).then(r=>r.json());if(me?.role!=='admin')return;const {clientId}=await context();if(!clientId)return;const ctx=await fetch(`/api/my-store-context?clientId=${encodeURIComponent(clientId)}`,{credentials:'include'}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error||'تعذر تحميل المتاجر');return d}),stores=ctx.stores||[];if(!stores.length)return;const settings=await Promise.all(stores.map(async s=>{try{const r=await fetch(`/api/admin/stores/${encodeURIComponent(s.id)}/management-fee?clientId=${encodeURIComponent(clientId)}`,{credentials:'include'}),d=await r.json();return {...s,managementFeePct:n(d.managementFeePct),error:r.ok?'':d.error};}catch(e){return {...s,managementFeePct:0,error:e.message}}}));if(el!==root()||!el.isConnected||document.querySelector('.nav button.active[data-view]')?.dataset.view!=='stores')return;const card=document.createElement('section');card.id='acc100StoreSettings';card.className='card acc100-store-settings';card.innerHTML=`<div class="title" style="font-size:18px">إعدادات رسوم الإدارة</div><div class="sub">النسبة تثبت على الأوردر وقت الشحن وتظهر ضمن الحسابات الشهرية ومصروفات الإدارة.</div><div class="mt">${settings.map(s=>`<div class="acc100-store-row"><div><strong>${esc(s.name||s.code||s.id)}</strong><div class="meta">${esc(s.code||s.id)}</div></div><label>نسبة الإدارة %<input class="input acc100Rate" data-store="${esc(s.id)}" type="number" min="0" max="100" step="0.01" value="${esc(s.managementFeePct)}"></label><button class="btn primary acc100SaveRate" data-store="${esc(s.id)}">حفظ</button></div>`).join('')}</div>`;el.appendChild(card);card.querySelectorAll('.acc100SaveRate').forEach(b=>b.onclick=async()=>{const input=card.querySelector(`.acc100Rate[data-store="${CSS.escape(b.dataset.store)}"]`);try{b.disabled=true;const r=await fetch(`/api/admin/stores/${encodeURIComponent(b.dataset.store)}/management-fee`,{method:'PATCH',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({clientId,managementFeePct:n(input?.value)})}),d=await r.json();if(!r.ok)throw new Error(d.error||'تعذر الحفظ');input.value=d.managementFeePct;invalidateFinance();notify(`تم حفظ رسوم الإدارة ${fmt(d.managementFeePct)}%`);}catch(e){notify(e.message)}finally{b.disabled=false;}});}catch(e){console.warn('management fee settings',e);}
  }

  function hook(){ensureStyles();ensureNav();document.addEventListener('click',e=>{const b=e.target.closest('.nav button');if(!b)return;if(b.dataset.view===VIEW)setTimeout(renderAccounting,25);if(b.dataset.view==='stores')[120,500,950].forEach(ms=>setTimeout(injectAdminStoreSettings,ms));},true);document.addEventListener('kun:accounting-changed',()=>{if(active())setTimeout(renderAccounting,0);});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',hook,{once:true});else hook();
  window.KunAccountingV100={version:'100.0',render:renderAccounting,invalidate:invalidateFinance};
})();
