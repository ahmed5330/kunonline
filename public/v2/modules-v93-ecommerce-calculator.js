/* Kun Online v93 — e-commerce profitability calculator under Finance. */
(function(){
  'use strict';
  if(window.KunEcommerceCalculatorV93)return;

  const VIEW='ecommerce-calculator', STORAGE='kun:ecommerce-calculator:v93';
  const root=()=>document.getElementById('root');
  const active=()=>document.querySelector('.nav button.active[data-view]')?.dataset.view===VIEW;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const n=v=>Number.isFinite(Number(v))?Number(v):0;
  const pct=v=>Math.min(100,Math.max(0,n(v)));
  const fmt=(v,d=2)=>new Intl.NumberFormat('ar-EG',{maximumFractionDigits:d}).format(Number(v)||0);
  const money=v=>`${fmt(v)} ج.م`;

  const FIELDS=[
    ['sellingPrice','سعر بيع المنتج','ج.م','مثال: 599','product'],
    ['productCost','تكلفة المنتج','ج.م','تكلفة الوحدة','product'],
    ['packagingCost','التغليف لكل أوردر مؤكد','ج.م','كرتونة / تغليف','product'],
    ['forwardShipping','تكلفة الشحن للطلب المؤكد','ج.م','تكلفة الشحنة الخارجة','product'],
    ['returnShipping','تكلفة شحن المرتجع','ج.م','ما تتحمله عند رجوع الشحنة','product'],
    ['otherVariable','تكلفة متغيرة إضافية','ج.م','عمولة / هدية / تجهيز','product'],
    ['codPercent','عمولة التحصيل COD','%','نسبة من قيمة الأوردر المستلم','product'],
    ['codFixed','رسوم تحصيل ثابتة','ج.م','رسوم ثابتة لكل طلب مستلم','product'],

    ['confirmationRate','نسبة التأكيد','%','من الطلبات الجديدة','funnel'],
    ['deliveryRate','نسبة الاستلام','%','من الطلبات المؤكدة','funnel'],
    ['returnRate','نسبة المرتجع','%','من الطلبات المؤكدة','funnel'],
    ['dailyOrders','الطلبات اليومية المتوقعة','طلب','قبل التأكيد','funnel'],
    ['workingDays','أيام التشغيل بالشهر','يوم','عادة 30','funnel'],

    ['cpm','CPM','ج.م','تكلفة 1000 ظهور','ads'],
    ['ctr','CTR','%','نسبة النقر','ads'],
    ['clickToOrder','Conversion Rate من النقر إلى الطلب','%','Click → Order','ads'],
    ['cpp','CPP / Cost per Purchase الفعلي','ج.م','اتركه 0 لاستخدام CPP المحسوب','ads'],

    ['salaries','رواتب شهرية','ج.م','إجمالي الرواتب','fixed'],
    ['rent','إيجار / مخزن شهري','ج.م','إيجار ومرافق','fixed'],
    ['software','برامج واشتراكات شهرية','ج.م','منصات وأدوات','fixed'],
    ['otherFixed','مصاريف ثابتة أخرى','ج.م','أي مصاريف شهرية ثابتة','fixed']
  ];

  const DEFAULTS={sellingPrice:0,productCost:0,packagingCost:0,forwardShipping:0,returnShipping:0,otherVariable:0,codPercent:0,codFixed:0,confirmationRate:80,deliveryRate:70,returnRate:20,dailyOrders:20,workingDays:30,cpm:0,ctr:0,clickToOrder:0,cpp:0,salaries:0,rent:0,software:0,otherFixed:0};
  let model={...DEFAULTS};

  function load(){try{model={...DEFAULTS,...JSON.parse(localStorage.getItem(STORAGE)||'{}')};}catch{model={...DEFAULTS};}}
  function save(){try{localStorage.setItem(STORAGE,JSON.stringify(model));}catch{}}

  function style(){if(document.getElementById('kunEcomCalc93Style'))return;const s=document.createElement('style');s.id='kunEcomCalc93Style';s.textContent=`
    .kun93-subnav{font-size:12px!important;padding-inline-start:24px!important;opacity:.9}.kun93-subnav::before{content:'↳';margin-inline-end:7px;opacity:.55}
    .kun93-page{display:grid;gap:16px;direction:rtl}.kun93-head{display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap}.kun93-head .spacer{flex:1}.kun93-actions{display:flex;gap:8px;flex-wrap:wrap}
    .kun93-layout{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(360px,.85fr);gap:15px;align-items:start}.kun93-inputs{display:grid;gap:14px}.kun93-block{border:1px solid var(--line,#e2e8f0);border-radius:16px;background:var(--card,#fff);padding:16px}.kun93-block-title{font-size:15px;font-weight:850;margin-bottom:3px}.kun93-block-sub{font-size:11px;color:var(--muted,#64748b);margin-bottom:12px}.kun93-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.kun93-field{display:grid;gap:5px}.kun93-field span{font-size:11px;font-weight:800;color:var(--muted,#64748b)}.kun93-input-wrap{display:grid;grid-template-columns:minmax(0,1fr) auto;border:1px solid var(--line,#dbe3ea);border-radius:11px;overflow:hidden;background:#fff}.kun93-input-wrap input{border:0!important;border-radius:0!important;min-width:0}.kun93-unit{display:flex;align-items:center;padding:0 10px;background:#f8fafc;border-inline-start:1px solid var(--line,#e2e8f0);font-size:10px;font-weight:800;color:#64748b;white-space:nowrap}
    .kun93-results{display:grid;gap:12px;position:sticky;top:72px}.kun93-kpis{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.kun93-kpi{border:1px solid var(--line,#e2e8f0);border-radius:14px;background:#fff;padding:13px;display:grid;gap:5px}.kun93-kpi span{font-size:10.5px;color:#64748b;font-weight:750}.kun93-kpi strong{font-size:18px;line-height:1.25}.kun93-kpi.good strong{color:#15803d}.kun93-kpi.bad strong{color:#b91c1c}.kun93-kpi.focus{background:#eff6ff;border-color:#dbeafe}.kun93-kpi.focus strong{color:#1d4ed8}.kun93-summary{display:grid;gap:8px}.kun93-row{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px dashed #e2e8f0;font-size:11px}.kun93-row:last-child{border-bottom:0}.kun93-row b{font-size:12px}.kun93-warning{padding:10px 12px;border-radius:11px;background:#fff7ed;color:#9a3412;border:1px solid #fed7aa;font-size:11px;line-height:1.7}.kun93-ok{padding:10px 12px;border-radius:11px;background:#f0fdf4;color:#166534;border:1px solid #bbf7d0;font-size:11px;line-height:1.7}
    .kun93-chart-card{padding:15px}.kun93-chart-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:10px}.kun93-chart-title{font-size:14px;font-weight:850}.kun93-chart-sub{font-size:10px;color:#64748b;margin-top:3px}.kun93-chart{width:100%;height:auto;display:block}.kun93-chart text{font-family:inherit;font-size:9px;fill:#64748b}.kun93-chart .axis{stroke:#cbd5e1;stroke-width:1}.kun93-chart .zero{stroke:#94a3b8;stroke-width:1;stroke-dasharray:4 4}.kun93-chart .curve{stroke:#2563eb;stroke-width:3;fill:none}.kun93-chart .break{stroke:#16a34a;stroke-width:1.5;stroke-dasharray:5 4}.kun93-chart .dot{fill:#16a34a}.kun93-chart .loss{fill:#fff1f2}.kun93-chart .profit{fill:#f0fdf4}
    .kun93-note{font-size:10.5px;color:#64748b;line-height:1.7}.kun93-formula{font-size:10px;color:#475569;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:9px;line-height:1.7}
    @media(max-width:1050px){.kun93-layout{grid-template-columns:1fr}.kun93-results{position:static}.kun93-kpis{grid-template-columns:repeat(4,minmax(0,1fr))}}
    @media(max-width:760px){.kun93-fields{grid-template-columns:1fr}.kun93-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.kun93-head{align-items:stretch}.kun93-actions{width:100%}.kun93-actions .btn{flex:1}}
  `;document.head.appendChild(s);}

  function ensureNav(){
    const nav=document.querySelector('.nav'),finance=nav?.querySelector('[data-view="finance"]');if(!nav||!finance)return;
    let b=nav.querySelector(`[data-view="${VIEW}"]`);if(!b){b=document.createElement('button');b.dataset.view=VIEW;b.className='kun93-subnav';b.textContent='حاسبة التجارة الإلكترونية';finance.insertAdjacentElement('afterend',b);}else b.classList.add('kun93-subnav');
    if(b.dataset.kun93Bound==='1')return;b.dataset.kun93Bound='1';
    b.addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation();document.querySelectorAll('.nav button').forEach(x=>x.classList.toggle('active',x===b));document.querySelector('.side')?.classList.remove('mobile-open');document.body.classList.remove('kun-mobile-nav-open');render();},{capture:true});
  }

  function inputHtml(key,label,unit,placeholder){const value=n(model[key]);return `<label class="kun93-field"><span>${esc(label)}</span><div class="kun93-input-wrap"><input class="input" type="number" step="0.01" min="0" data-kun93-input="${esc(key)}" value="${esc(value)}" placeholder="${esc(placeholder)}"><em class="kun93-unit">${esc(unit)}</em></div></label>`;}
  function section(group,title,sub){return `<section class="kun93-block"><div class="kun93-block-title">${title}</div><div class="kun93-block-sub">${sub}</div><div class="kun93-fields">${FIELDS.filter(x=>x[4]===group).map(x=>inputHtml(x[0],x[1],x[2],x[3])).join('')}</div></section>`;}

  function calc(){
    const price=n(model.sellingPrice),cost=n(model.productCost),pack=n(model.packagingCost),ship=n(model.forwardShipping),retShip=n(model.returnShipping),other=n(model.otherVariable),codPct=pct(model.codPercent)/100,codFixed=n(model.codFixed);
    const confirm=pct(model.confirmationRate)/100,delivery=pct(model.deliveryRate)/100,ret=pct(model.returnRate)/100,days=Math.max(1,n(model.workingDays)||30),daily=Math.max(0,n(model.dailyOrders));
    const cpm=n(model.cpm),ctr=pct(model.ctr)/100,cvr=pct(model.clickToOrder)/100,manualCpp=n(model.cpp);
    const derivedCpc=ctr>0?cpm/(1000*ctr):0,derivedCpp=ctr>0&&cvr>0?derivedCpc/cvr:0,usedCpp=manualCpp>0?manualCpp:derivedCpp;
    const deliveredPerOrder=confirm*delivery,returnedPerOrder=confirm*ret;
    const revenuePerOrder=price*deliveredPerOrder;
    const productCostPerOrder=cost*deliveredPerOrder;
    const packagingPerOrder=pack*confirm;
    const shippingPerOrder=ship*confirm;
    const returnCostPerOrder=retShip*returnedPerOrder;
    const otherPerOrder=other*confirm;
    const codPerOrder=deliveredPerOrder*(codFixed+price*codPct);
    const nonAdVariable=productCostPerOrder+packagingPerOrder+shippingPerOrder+returnCostPerOrder+otherPerOrder+codPerOrder;
    const preAdContribution=revenuePerOrder-nonAdVariable;
    const contribution=preAdContribution-usedCpp;
    const fixed=n(model.salaries)+n(model.rent)+n(model.software)+n(model.otherFixed);
    const monthlyOrders=daily*days,monthlyRevenue=revenuePerOrder*monthlyOrders,monthlyProfit=contribution*monthlyOrders-fixed;
    const breakEvenMonthly=contribution>0?fixed/contribution:Infinity,breakEvenDaily=Number.isFinite(breakEvenMonthly)?breakEvenMonthly/days:Infinity;
    const expectedConfirmedDaily=daily*confirm,expectedDeliveredDaily=daily*deliveredPerOrder,expectedReturnsDaily=daily*returnedPerOrder;
    const roas=usedCpp>0?revenuePerOrder/usedCpp:0;
    const maxCppVariable=Math.max(0,preAdContribution);
    const fixedAllocation=monthlyOrders>0?fixed/monthlyOrders:0,maxCppAtPlan=Math.max(0,preAdContribution-fixedAllocation);
    const profitPerDelivered=deliveredPerOrder>0?contribution/deliveredPerOrder:0;
    const margin=monthlyRevenue>0?monthlyProfit/monthlyRevenue*100:0;
    return {price,cost,pack,ship,retShip,other,codPct,codFixed,confirm,delivery,ret,days,daily,cpm,ctr,cvr,manualCpp,derivedCpc,derivedCpp,usedCpp,deliveredPerOrder,returnedPerOrder,revenuePerOrder,nonAdVariable,preAdContribution,contribution,fixed,monthlyOrders,monthlyRevenue,monthlyProfit,breakEvenMonthly,breakEvenDaily,expectedConfirmedDaily,expectedDeliveredDaily,expectedReturnsDaily,roas,maxCppVariable,maxCppAtPlan,profitPerDelivered,margin};
  }

  function chart(c){
    const W=640,H=260,pad={l:58,r:18,t:22,b:42};
    let maxX=Math.max(10,c.daily*1.5,Number.isFinite(c.breakEvenDaily)?c.breakEvenDaily*1.8:0);maxX=Math.ceil(maxX/5)*5;
    const profitAt=x=>c.contribution*x*c.days-c.fixed;
    let minY=Math.min(-c.fixed,profitAt(0),profitAt(maxX),0),maxY=Math.max(profitAt(maxX),0);
    if(Math.abs(maxY-minY)<1){maxY=1;minY=-1;}const range=maxY-minY;
    const X=x=>pad.l+(x/maxX)*(W-pad.l-pad.r),Y=y=>pad.t+((maxY-y)/range)*(H-pad.t-pad.b),zeroY=Y(0);
    const ticks=4,labels=[];for(let i=0;i<=ticks;i++){const x=maxX*i/ticks;labels.push(`<line class="axis" x1="${X(x)}" y1="${H-pad.b}" x2="${X(x)}" y2="${H-pad.b+4}"/><text x="${X(x)}" y="${H-pad.b+18}" text-anchor="middle">${fmt(x,0)}</text>`);}for(let i=0;i<=ticks;i++){const y=minY+range*i/ticks;labels.push(`<line class="axis" x1="${pad.l-4}" y1="${Y(y)}" x2="${pad.l}" y2="${Y(y)}"/><text x="${pad.l-8}" y="${Y(y)+3}" text-anchor="end">${fmt(y,0)}</text>`);}
    const breakLine=Number.isFinite(c.breakEvenDaily)&&c.breakEvenDaily<=maxX?`<line class="break" x1="${X(c.breakEvenDaily)}" y1="${pad.t}" x2="${X(c.breakEvenDaily)}" y2="${H-pad.b}"/><circle class="dot" cx="${X(c.breakEvenDaily)}" cy="${zeroY}" r="4"/><text x="${X(c.breakEvenDaily)}" y="${pad.t+10}" text-anchor="middle">تعادل ${fmt(c.breakEvenDaily,1)} طلب/يوم</text>`:'';
    return `<svg class="kun93-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="منحنى الربح والخسارة حسب عدد الطلبات اليومية"><rect class="loss" x="${pad.l}" y="${zeroY}" width="${W-pad.l-pad.r}" height="${Math.max(0,H-pad.b-zeroY)}"/><rect class="profit" x="${pad.l}" y="${pad.t}" width="${W-pad.l-pad.r}" height="${Math.max(0,zeroY-pad.t)}"/><line class="axis" x1="${pad.l}" y1="${pad.t}" x2="${pad.l}" y2="${H-pad.b}"/><line class="axis" x1="${pad.l}" y1="${H-pad.b}" x2="${W-pad.r}" y2="${H-pad.b}"/><line class="zero" x1="${pad.l}" y1="${zeroY}" x2="${W-pad.r}" y2="${zeroY}"/><path class="curve" d="M ${X(0)} ${Y(profitAt(0))} L ${X(maxX)} ${Y(profitAt(maxX))}"/>${breakLine}${labels.join('')}<text x="${W/2}" y="${H-7}" text-anchor="middle">عدد الطلبات الجديدة يوميًا</text><text x="14" y="${H/2}" text-anchor="middle" transform="rotate(-90 14 ${H/2})">صافي الربح الشهري</text></svg>`;
  }

  function resultsHtml(c){
    const loss=c.monthlyProfit<0, invalidFlow=(c.delivery+c.ret)>1.00001;
    const cppLabel=c.manualCpp>0?'CPP الفعلي المستخدم':'CPP المحسوب من CPM + CTR + CVR';
    const be=Number.isFinite(c.breakEvenDaily)?`${fmt(c.breakEvenDaily,1)} طلب/يوم`:'لا توجد نقطة تعادل';
    return `<div class="kun93-results"><section class="kun93-block"><div class="kun93-block-title">النتيجة الفورية</div><div class="kun93-block-sub">الحساب يتحدث تلقائيًا مع كل رقم تغيّره.</div>${invalidFlow?'<div class="kun93-warning">تنبيه: نسبة الاستلام + المرتجع أكبر من 100% من الطلبات المؤكدة. راجع النسب قبل الاعتماد على النتيجة.</div>':''}<div class="kun93-kpis" style="margin-top:10px"><div class="kun93-kpi ${loss?'bad':'good'}"><span>صافي الربح / الخسارة شهريًا</span><strong>${money(c.monthlyProfit)}</strong></div><div class="kun93-kpi focus"><span>طلبات يومية لتغطية المصاريف</span><strong>${be}</strong></div><div class="kun93-kpi"><span>ربح متوقع لكل طلب جديد</span><strong>${money(c.contribution)}</strong></div><div class="kun93-kpi"><span>ROAS متوقع</span><strong>${c.roas?`${fmt(c.roas,2)}x`:'—'}</strong></div><div class="kun93-kpi"><span>هامش صافي الربح</span><strong>${fmt(c.margin,1)}%</strong></div><div class="kun93-kpi"><span>${cppLabel}</span><strong>${c.usedCpp?money(c.usedCpp):'—'}</strong></div></div></section>
    <section class="kun93-block kun93-summary"><div class="kun93-block-title">تفاصيل اليوم والشهر</div><div class="kun93-row"><span>طلبات مؤكدة متوقعة يوميًا</span><b>${fmt(c.expectedConfirmedDaily,1)}</b></div><div class="kun93-row"><span>طلبات مستلمة متوقعة يوميًا</span><b>${fmt(c.expectedDeliveredDaily,1)}</b></div><div class="kun93-row"><span>مرتجعات متوقعة يوميًا</span><b>${fmt(c.expectedReturnsDaily,1)}</b></div><div class="kun93-row"><span>إيراد شهري متوقع</span><b>${money(c.monthlyRevenue)}</b></div><div class="kun93-row"><span>المصاريف الثابتة الشهرية</span><b>${money(c.fixed)}</b></div><div class="kun93-row"><span>الربح قبل الإعلان لكل طلب جديد</span><b>${money(c.preAdContribution)}</b></div><div class="kun93-row"><span>أقصى CPP قبل خسارة المتغيرات</span><b>${money(c.maxCppVariable)}</b></div><div class="kun93-row"><span>أقصى CPP عند حجم الطلبات الحالي لتغطية كل المصاريف</span><b>${money(c.maxCppAtPlan)}</b></div><div class="kun93-row"><span>CPC المحسوب</span><b>${c.derivedCpc?money(c.derivedCpc):'—'}</b></div><div class="kun93-row"><span>CPP المحسوب</span><b>${c.derivedCpp?money(c.derivedCpp):'—'}</b></div></section>
    <section class="kun93-block kun93-chart-card"><div class="kun93-chart-head"><div><div class="kun93-chart-title">نقطة التعادل والربحية</div><div class="kun93-chart-sub">المنحنى يوضح صافي الربح الشهري مقابل عدد الطلبات الجديدة يوميًا.</div></div><b>${be}</b></div>${chart(c)}${c.contribution<=0?'<div class="kun93-warning">كل طلب جديد حاليًا يحقق مساهمة سالبة أو صفرية، لذلك زيادة عدد الطلبات وحدها لن تصل لنقطة التعادل. تحتاج رفع الهامش أو تحسين التأكيد/الاستلام أو خفض CPP والتكاليف المتغيرة.</div>':'<div class="kun93-ok">المنطقة الحمراء = خسارة، والخضراء = ربح. نقطة تقاطع الخط مع الصفر هي حجم الطلبات المطلوب لتغطية المصاريف.</div>'}</section></div>`;
  }

  function render(){
    style();ensureNav();const el=root();if(!el)return;load();
    el.innerHTML=`<section class="kun93-page"><div class="page-head kun93-head"><div><div class="title">حاسبة التجارة الإلكترونية</div><div class="sub">احسب ربحية المنتج ونقطة التعادل والطلبات اليومية المطلوبة قبل ضخ الميزانية.</div></div><div class="spacer"></div><div class="kun93-actions"><button class="btn soft" data-kun93-reset>إعادة ضبط</button><button class="btn primary" data-kun93-recalc>إعادة الحساب</button></div></div><div class="kun93-layout"><div class="kun93-inputs">${section('product','1) اقتصاديات المنتج والطلب','سعر البيع، التكلفة، الشحن، المرتجع والتحصيل.')}${section('funnel','2) التأكيد والاستلام والمرتجعات','النسب التشغيلية التي تحدد كام طلب يتحول لتحصيل فعلي.')}${section('ads','3) أرقام الإعلانات','أدخل CPP الفعلي، أو اتركه صفر ليتم حسابه من CPM وCTR وConversion Rate.')}${section('fixed','4) المصاريف الثابتة الشهرية','المصاريف التي لازم الأرباح تغطيها كل شهر.')}<div class="kun93-formula"><b>طريقة الحساب:</b> الإيراد المتوقع لكل طلب جديد = سعر البيع × نسبة التأكيد × نسبة الاستلام. ثم تخصم تكلفة المنتج والتغليف والشحن والمرتجع والتحصيل والإعلان. نقطة التعادل = المصاريف الثابتة ÷ هامش المساهمة لكل طلب جديد.</div></div><div id="kun93Results"></div></div></section>`;
    bind();refresh();
  }

  function refresh(){if(!active())return;const c=calc(),host=document.getElementById('kun93Results');if(host)host.innerHTML=resultsHtml(c);}
  function bind(){
    document.querySelectorAll('[data-kun93-input]').forEach(input=>input.addEventListener('input',()=>{const key=input.dataset.kun93Input;let value=n(input.value);if(['confirmationRate','deliveryRate','returnRate','codPercent','ctr','clickToOrder'].includes(key))value=pct(value);model[key]=value;save();refresh();}));
    document.querySelector('[data-kun93-recalc]')?.addEventListener('click',refresh);
    document.querySelector('[data-kun93-reset]')?.addEventListener('click',()=>{if(!confirm('إعادة كل أرقام الحاسبة للقيم الافتراضية؟'))return;model={...DEFAULTS};save();render();});
  }

  function boot(){style();ensureNav();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
  window.KunEcommerceCalculatorV93={version:'93.0',render,calc,refresh,defaults:DEFAULTS};
})();
