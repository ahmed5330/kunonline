/* Kun Online v94 — e-commerce unit economics, funnel and break-even calculator. */
(function(){
  'use strict';
  if(window.KunEcommerceCalculatorV94)return;

  const VIEW='ecommerce-calculator';
  const STORAGE='kun:ecommerce-calculator:v94';
  const LEGACY_STORAGE='kun:ecommerce-calculator:v93';
  const root=()=>document.getElementById('root');
  const active=()=>document.querySelector('.nav button.active[data-view]')?.dataset.view===VIEW;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const n=v=>Number.isFinite(Number(v))?Number(v):0;
  const pct=v=>Math.min(100,Math.max(0,n(v)));
  const fmt=(v,d=2)=>new Intl.NumberFormat('ar-EG',{maximumFractionDigits:d}).format(Number(v)||0);
  const money=v=>`${fmt(v)} ج.م`;
  const finite=v=>Number.isFinite(v);

  const FIELDS=[
    ['sellingPrice','سعر بيع المنتج','ج.م','مثال: 599','product'],
    ['productCost','تكلفة المنتج','ج.م','تكلفة الوحدة','product'],
    ['packagingCost','التغليف لكل طلب مؤكد','ج.م','كرتونة / تغليف','product'],
    ['forwardShipping','الشحن للطلب المؤكد','ج.م','تكلفة الشحنة الخارجة','product'],
    ['returnShipping','تكلفة المرتجع','ج.م','شحن رجوع / معالجة المرتجع','product'],
    ['otherVariable','تكلفة متغيرة إضافية','ج.م','عمولة / تجهيز / هدية','product'],
    ['codPercent','عمولة التحصيل COD','%','نسبة من قيمة البيع النهائي','product'],
    ['codFixed','رسوم تحصيل ثابتة','ج.م','لكل طلب نهائي مستلم','product'],

    ['confirmationRate','نسبة التأكيد','%','من الطلبات الجديدة','funnel'],
    ['deliveryRate','نسبة الاستلام','%','من الطلبات المؤكدة','funnel'],
    ['returnRate','نسبة المرتجع بعد الاستلام','%','من الطلبات المستلمة','funnel'],
    ['dailyOrders','الطلبات الجديدة يوميًا','طلب','قبل التأكيد','funnel'],
    ['workingDays','أيام التشغيل بالشهر','يوم','عادة 30','funnel'],

    ['cpm','CPM','ج.م','تكلفة 1000 ظهور','ads'],
    ['ctr','CTR','%','نسبة النقر','ads'],
    ['clickToOrder','Conversion Rate من النقر للطلب','%','Click → Order','ads'],
    ['cpp','CPP الفعلي','ج.م','يستخدم فقط في الوضع اليدوي','ads'],

    ['salaries','رواتب شهرية','ج.م','إجمالي الرواتب','fixed'],
    ['rent','إيجار / مخزن شهري','ج.م','إيجار ومرافق','fixed'],
    ['software','برامج واشتراكات شهرية','ج.م','منصات وأدوات','fixed'],
    ['otherFixed','مصاريف ثابتة أخرى','ج.م','أي مصاريف شهرية ثابتة','fixed'],

    ['targetProfit','الربح الشهري المستهدف','ج.م','مثال: 30000','goals'],
    ['targetMargin','هامش صافي الربح المستهدف','%','مثال: 15','goals']
  ];

  const DEFAULTS={
    sellingPrice:0,productCost:0,packagingCost:0,forwardShipping:0,returnShipping:0,otherVariable:0,codPercent:0,codFixed:0,
    confirmationRate:80,deliveryRate:70,returnRate:10,dailyOrders:20,workingDays:30,
    cpm:0,ctr:0,clickToOrder:0,cpp:0,adCostMode:'auto',
    salaries:0,rent:0,software:0,otherFixed:0,targetProfit:10000,targetMargin:15
  };
  let model={...DEFAULTS};

  function load(){
    try{
      const current=JSON.parse(localStorage.getItem(STORAGE)||'null');
      if(current){model={...DEFAULTS,...current};return;}
      const legacy=JSON.parse(localStorage.getItem(LEGACY_STORAGE)||'null');
      if(legacy){model={...DEFAULTS,...legacy,adCostMode:n(legacy.cpp)>0?'manual':'auto'};save();return;}
    }catch{}
    model={...DEFAULTS};
  }
  function save(){try{localStorage.setItem(STORAGE,JSON.stringify(model));}catch{}}

  function calculate(input){
    const price=n(input.sellingPrice),cost=n(input.productCost),pack=n(input.packagingCost),ship=n(input.forwardShipping),retShip=n(input.returnShipping),other=n(input.otherVariable),codPct=pct(input.codPercent)/100,codFixed=n(input.codFixed);
    const confirm=pct(input.confirmationRate)/100,delivery=pct(input.deliveryRate)/100,ret=pct(input.returnRate)/100,days=Math.max(1,n(input.workingDays)||30),daily=Math.max(0,n(input.dailyOrders));
    const cpm=n(input.cpm),ctr=pct(input.ctr)/100,cvr=pct(input.clickToOrder)/100,manualCpp=n(input.cpp),adCostMode=input.adCostMode==='manual'?'manual':'auto';
    const targetProfit=Math.max(0,n(input.targetProfit)),targetMargin=pct(input.targetMargin)/100;

    const derivedCpc=ctr>0?cpm/(1000*ctr):0;
    const derivedCpp=ctr>0&&cvr>0?derivedCpc/cvr:0;
    const usedCpp=adCostMode==='manual'?manualCpp:derivedCpp;

    // Funnel is deliberately cascading so every rate has a direct economic effect:
    // new order -> confirmed -> delivered -> retained after returns.
    const confirmedPerOrder=confirm;
    const grossDeliveredPerOrder=confirm*delivery;
    const returnedPerOrder=grossDeliveredPerOrder*ret;
    const keptPerOrder=grossDeliveredPerOrder*(1-ret);

    const revenuePerOrder=price*keptPerOrder;
    const productCostPerOrder=cost*keptPerOrder;
    const packagingPerOrder=pack*confirmedPerOrder;
    const shippingPerOrder=ship*confirmedPerOrder;
    const returnCostPerOrder=retShip*returnedPerOrder;
    const otherPerOrder=other*confirmedPerOrder;
    const codPerOrder=keptPerOrder*(codFixed+price*codPct);
    const nonAdVariable=productCostPerOrder+packagingPerOrder+shippingPerOrder+returnCostPerOrder+otherPerOrder+codPerOrder;
    const preAdContribution=revenuePerOrder-nonAdVariable;
    const contribution=preAdContribution-usedCpp;

    const fixed=n(input.salaries)+n(input.rent)+n(input.software)+n(input.otherFixed);
    const monthlyOrders=daily*days;
    const monthlyRevenue=revenuePerOrder*monthlyOrders;
    const monthlyAdSpend=usedCpp*monthlyOrders;
    const monthlyProfit=contribution*monthlyOrders-fixed;
    const margin=monthlyRevenue>0?monthlyProfit/monthlyRevenue*100:0;
    const roas=monthlyAdSpend>0?monthlyRevenue/monthlyAdSpend:0;

    const breakEvenDaily=contribution>0?fixed/(contribution*days):Infinity;
    const targetProfitDaily=contribution>0?(fixed+targetProfit)/(contribution*days):Infinity;
    const marginDenominator=contribution-targetMargin*revenuePerOrder;
    let targetMarginDaily=Infinity;
    if(targetMargin===0)targetMarginDaily=breakEvenDaily;
    else if(marginDenominator>0)targetMarginDaily=fixed/(marginDenominator*days);
    else if(fixed===0&&monthlyRevenue>=0&&revenuePerOrder>0&&(contribution/revenuePerOrder)>=targetMargin)targetMarginDaily=0;

    const expectedConfirmedDaily=daily*confirmedPerOrder;
    const expectedGrossDeliveredDaily=daily*grossDeliveredPerOrder;
    const expectedReturnsDaily=daily*returnedPerOrder;
    const expectedNetDeliveredDaily=daily*keptPerOrder;
    const maxCppVariable=Math.max(0,preAdContribution);
    const fixedAllocation=monthlyOrders>0?fixed/monthlyOrders:0;
    const maxCppAtPlan=Math.max(0,preAdContribution-fixedAllocation);

    const priceCoefficient=keptPerOrder*(1-codPct);
    const nonPriceUnitCost=productCostPerOrder+packagingPerOrder+shippingPerOrder+returnCostPerOrder+otherPerOrder+keptPerOrder*codFixed+usedCpp;
    const minimumPriceForPositiveContribution=priceCoefficient>0?nonPriceUnitCost/priceCoefficient:Infinity;

    const trafficPlan=ordersDaily=>{
      const q=Math.max(0,n(ordersDaily));
      const clicks=cvr>0?q/cvr:Infinity;
      const impressions=ctr>0&&finite(clicks)?clicks/ctr:Infinity;
      const mediaBudget=finite(impressions)?impressions/1000*cpm:Infinity;
      return {orders:q,confirmed:q*confirmedPerOrder,grossDelivered:q*grossDeliveredPerOrder,returns:q*returnedPerOrder,netDelivered:q*keptPerOrder,clicks,impressions,mediaBudget,adBudget:q*usedCpp};
    };

    return {price,cost,pack,ship,retShip,other,codPct,codFixed,confirm,delivery,ret,days,daily,cpm,ctr,cvr,manualCpp,adCostMode,targetProfit,targetMargin,derivedCpc,derivedCpp,usedCpp,confirmedPerOrder,grossDeliveredPerOrder,returnedPerOrder,keptPerOrder,revenuePerOrder,nonAdVariable,preAdContribution,contribution,fixed,monthlyOrders,monthlyRevenue,monthlyAdSpend,monthlyProfit,margin,roas,breakEvenDaily,targetProfitDaily,targetMarginDaily,expectedConfirmedDaily,expectedGrossDeliveredDaily,expectedReturnsDaily,expectedNetDeliveredDaily,maxCppVariable,maxCppAtPlan,minimumPriceForPositiveContribution,trafficPlan};
  }

  function style(){
    if(document.getElementById('kunEcomCalc94Style'))return;
    const s=document.createElement('style');s.id='kunEcomCalc94Style';s.textContent=`
      .kun94-subnav{font-size:12px!important;padding-inline-start:24px!important;opacity:.9}.kun94-subnav::before{content:'↳';margin-inline-end:7px;opacity:.55}
      .kun94-page{display:grid;gap:16px;direction:rtl}.kun94-head{display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap}.kun94-head .spacer{flex:1}.kun94-actions{display:flex;gap:8px;flex-wrap:wrap}
      .kun94-layout{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(380px,.9fr);gap:15px;align-items:start}.kun94-inputs,.kun94-results{display:grid;gap:12px}.kun94-results{position:sticky;top:72px}.kun94-block{border:1px solid var(--line,#e2e8f0);border-radius:16px;background:var(--card,#fff);padding:16px}.kun94-block-title{font-size:15px;font-weight:850}.kun94-block-sub{font-size:11px;color:var(--muted,#64748b);margin:3px 0 12px}.kun94-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.kun94-field{display:grid;gap:5px}.kun94-field>span{font-size:11px;font-weight:800;color:#64748b}.kun94-input-wrap{display:grid;grid-template-columns:minmax(0,1fr) auto;border:1px solid #dbe3ea;border-radius:11px;overflow:hidden;background:#fff}.kun94-input-wrap input{border:0!important;border-radius:0!important;min-width:0}.kun94-unit{display:flex;align-items:center;padding:0 10px;background:#f8fafc;border-inline-start:1px solid #e2e8f0;font-size:10px;font-weight:800;color:#64748b;white-space:nowrap}
      .kun94-mode{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px}.kun94-mode button{border:1px solid #dbe3ea;background:#fff;border-radius:11px;padding:10px;font:inherit;font-weight:800;cursor:pointer}.kun94-mode button.active{background:#eff6ff;border-color:#93c5fd;color:#1d4ed8}.kun94-mode-note{font-size:10.5px;line-height:1.7;color:#475569;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:9px;margin-bottom:10px}
      .kun94-kpis{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.kun94-kpi{border:1px solid #e2e8f0;border-radius:14px;background:#fff;padding:13px;display:grid;gap:5px}.kun94-kpi span{font-size:10.5px;color:#64748b;font-weight:750}.kun94-kpi strong{font-size:18px;line-height:1.25}.kun94-kpi.good strong{color:#15803d}.kun94-kpi.bad strong{color:#b91c1c}.kun94-kpi.focus{background:#eff6ff;border-color:#dbeafe}.kun94-kpi.focus strong{color:#1d4ed8}
      .kun94-scenarios{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.kun94-scenario{border:1px solid #e2e8f0;border-radius:13px;padding:12px;background:#fff;display:grid;gap:5px}.kun94-scenario .name{font-size:10.5px;color:#64748b;font-weight:800}.kun94-scenario strong{font-size:16px}.kun94-scenario small{font-size:9.5px;color:#64748b;line-height:1.6}.kun94-scenario.impossible{background:#fff7ed;border-color:#fed7aa}.kun94-scenario.impossible strong{color:#b45309}
      .kun94-summary{display:grid;gap:0}.kun94-row{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px dashed #e2e8f0;font-size:11px}.kun94-row:last-child{border-bottom:0}.kun94-row b{font-size:12px}.kun94-warning,.kun94-ok{padding:10px 12px;border-radius:11px;font-size:11px;line-height:1.7}.kun94-warning{background:#fff7ed;color:#9a3412;border:1px solid #fed7aa}.kun94-ok{background:#f0fdf4;color:#166534;border:1px solid #bbf7d0}
      .kun94-chart{width:100%;height:auto;display:block}.kun94-chart text{font-family:inherit;font-size:9px;fill:#64748b}.kun94-chart .axis{stroke:#cbd5e1;stroke-width:1}.kun94-chart .zero{stroke:#94a3b8;stroke-width:1;stroke-dasharray:4 4}.kun94-chart .curve{stroke:#2563eb;stroke-width:3;fill:none}.kun94-chart .break{stroke:#16a34a;stroke-width:1.5;stroke-dasharray:5 4}.kun94-chart .dot{fill:#16a34a}.kun94-chart .loss{fill:#fff1f2}.kun94-chart .profit{fill:#f0fdf4}.kun94-formula{font-size:10px;color:#475569;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:10px;line-height:1.7}
      @media(max-width:1050px){.kun94-layout{grid-template-columns:1fr}.kun94-results{position:static}.kun94-kpis{grid-template-columns:repeat(4,minmax(0,1fr))}}
      @media(max-width:760px){.kun94-fields,.kun94-scenarios{grid-template-columns:1fr}.kun94-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.kun94-head{align-items:stretch}.kun94-actions{width:100%}.kun94-actions .btn{flex:1}}
    `;document.head.appendChild(s);
  }

  function ensureNav(){
    const nav=document.querySelector('.nav'),finance=nav?.querySelector('[data-view="finance"]');if(!nav||!finance)return;
    const old=nav.querySelector('[data-view="ecommerce-calculator"]');
    let b=old;if(!b){b=document.createElement('button');b.dataset.view=VIEW;finance.insertAdjacentElement('afterend',b);}b.classList.add('kun94-subnav');b.textContent='حاسبة التجارة الإلكترونية';
    if(b.dataset.kun94Bound==='1')return;b.dataset.kun94Bound='1';
    b.addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation();document.querySelectorAll('.nav button').forEach(x=>x.classList.toggle('active',x===b));document.querySelector('.side')?.classList.remove('mobile-open');document.body.classList.remove('kun-mobile-nav-open');render();},{capture:true});
  }

  function inputHtml(key,label,unit,placeholder){return `<label class="kun94-field"><span>${esc(label)}</span><div class="kun94-input-wrap"><input class="input" type="number" step="0.01" min="0" data-kun94-input="${esc(key)}" value="${esc(n(model[key]))}" placeholder="${esc(placeholder)}"><em class="kun94-unit">${esc(unit)}</em></div></label>`;}
  function section(group,title,sub,extra=''){return `<section class="kun94-block"><div class="kun94-block-title">${title}</div><div class="kun94-block-sub">${sub}</div>${extra}<div class="kun94-fields">${FIELDS.filter(x=>x[4]===group).map(x=>inputHtml(x[0],x[1],x[2],x[3])).join('')}</div></section>`;}
  function adControls(){const auto=model.adCostMode!=='manual';return `<div class="kun94-mode"><button type="button" data-kun94-admode="auto" class="${auto?'active':''}">حساب CPP تلقائي</button><button type="button" data-kun94-admode="manual" class="${!auto?'active':''}">استخدام CPP فعلي</button></div><div class="kun94-mode-note">${auto?'الوضع التلقائي: CPM + CTR + Conversion Rate يحسبوا CPC وCPP، والـCPP الناتج يدخل مباشرة في الربح والخسارة.':'الوضع اليدوي: CPP الفعلي هو تكلفة الإعلان المستخدمة في الربحية. CPM وCTR وConversion Rate يظلوا مستخدمين في حساب الترافيك والظهور المطلوب للمقارنة، لكن لا يغيّروا تكلفة الطلب اليدوية.'}</div>`;}

  function practicalTarget(value){return finite(value)?Math.max(0,Math.ceil(value)):(Infinity);}
  function planLine(c,daily){
    if(!finite(daily))return '';
    const p=c.trafficPlan(practicalTarget(daily)),bits=[`صافي مبيعات: ${fmt(p.netDelivered,1)}/يوم`,`إعلان: ${money(p.adBudget)}/يوم`];
    if(finite(p.clicks))bits.push(`نقرات: ${fmt(p.clicks,0)}`);
    if(finite(p.impressions))bits.push(`ظهور: ${fmt(p.impressions,0)}`);
    if(c.adCostMode==='manual'&&finite(p.mediaBudget))bits.push(`تكلفة ميديا محسوبة: ${money(p.mediaBudget)}`);
    return bits.join(' • ');
  }
  function scenario(label,value,c,note=''){
    if(!finite(value))return `<div class="kun94-scenario impossible"><span class="name">${esc(label)}</span><strong>غير ممكن بأي عدد طلبات</strong><small>${esc(note||'هامش المساهمة لكل طلب غير كافٍ. عدّل السعر أو التكاليف أو الإعلان أو نسب التحويل أولًا.')}</small></div>`;
    const q=practicalTarget(value);return `<div class="kun94-scenario"><span class="name">${esc(label)}</span><strong>${fmt(q,0)} طلب/يوم</strong><small>القيمة الحسابية ≈ ${fmt(value,2)} • ${esc(planLine(c,value))}</small></div>`;
  }

  function chart(c){
    const W=640,H=250,pad={l:58,r:18,t:22,b:42};
    let maxX=Math.max(10,c.daily*1.5,finite(c.breakEvenDaily)?c.breakEvenDaily*1.8:0,finite(c.targetProfitDaily)?c.targetProfitDaily*1.2:0);maxX=Math.ceil(maxX/5)*5;
    const profitAt=x=>c.contribution*x*c.days-c.fixed;
    let minY=Math.min(-c.fixed,profitAt(0),profitAt(maxX),0),maxY=Math.max(profitAt(maxX),0);if(Math.abs(maxY-minY)<1){maxY=1;minY=-1;}const range=maxY-minY;
    const X=x=>pad.l+(x/maxX)*(W-pad.l-pad.r),Y=y=>pad.t+((maxY-y)/range)*(H-pad.t-pad.b),zeroY=Y(0),labels=[];
    for(let i=0;i<=4;i++){const x=maxX*i/4;labels.push(`<line class="axis" x1="${X(x)}" y1="${H-pad.b}" x2="${X(x)}" y2="${H-pad.b+4}"/><text x="${X(x)}" y="${H-pad.b+18}" text-anchor="middle">${fmt(x,0)}</text>`);}for(let i=0;i<=4;i++){const y=minY+range*i/4;labels.push(`<line class="axis" x1="${pad.l-4}" y1="${Y(y)}" x2="${pad.l}" y2="${Y(y)}"/><text x="${pad.l-8}" y="${Y(y)+3}" text-anchor="end">${fmt(y,0)}</text>`);}
    const be=finite(c.breakEvenDaily)&&c.breakEvenDaily<=maxX?`<line class="break" x1="${X(c.breakEvenDaily)}" y1="${pad.t}" x2="${X(c.breakEvenDaily)}" y2="${H-pad.b}"/><circle class="dot" cx="${X(c.breakEvenDaily)}" cy="${zeroY}" r="4"/><text x="${X(c.breakEvenDaily)}" y="${pad.t+10}" text-anchor="middle">تعادل ${fmt(c.breakEvenDaily,1)}</text>`:'';
    return `<svg class="kun94-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="منحنى الربح والخسارة"><rect class="loss" x="${pad.l}" y="${zeroY}" width="${W-pad.l-pad.r}" height="${Math.max(0,H-pad.b-zeroY)}"/><rect class="profit" x="${pad.l}" y="${pad.t}" width="${W-pad.l-pad.r}" height="${Math.max(0,zeroY-pad.t)}"/><line class="axis" x1="${pad.l}" y1="${pad.t}" x2="${pad.l}" y2="${H-pad.b}"/><line class="axis" x1="${pad.l}" y1="${H-pad.b}" x2="${W-pad.r}" y2="${H-pad.b}"/><line class="zero" x1="${pad.l}" y1="${zeroY}" x2="${W-pad.r}" y2="${zeroY}"/><path class="curve" d="M ${X(0)} ${Y(profitAt(0))} L ${X(maxX)} ${Y(profitAt(maxX))}"/>${be}${labels.join('')}<text x="${W/2}" y="${H-7}" text-anchor="middle">الطلبات الجديدة يوميًا</text><text x="14" y="${H/2}" text-anchor="middle" transform="rotate(-90 14 ${H/2})">صافي الربح الشهري</text></svg>`;
  }

  function resultsHtml(c){
    const be=finite(c.breakEvenDaily)?practicalTarget(c.breakEvenDaily):Infinity;
    const delta=finite(c.breakEvenDaily)?c.daily-c.breakEvenDaily:null;
    const status=!finite(c.breakEvenDaily)?`هامش المساهمة الحالي ${money(c.contribution)} لكل طلب جديد؛ زيادة الطلبات لن تعالج الخسارة قبل تحسين اقتصاديات الطلب.`:delta>=0?`الخطة الحالية أعلى من نقطة التعادل بحوالي ${fmt(delta,1)} طلب يوميًا.`:`تحتاج تقريبًا ${fmt(Math.ceil(Math.abs(delta)),0)} طلب إضافي يوميًا للوصول للتعادل.`;
    const impossibleHint=`أقصى CPP يسمح بمساهمة موجبة حاليًا ≈ ${money(c.maxCppVariable)}، والحد الأدنى التقريبي لسعر البيع لمساهمة موجبة ≈ ${finite(c.minimumPriceForPositiveContribution)?money(c.minimumPriceForPositiveContribution):'غير متاح'}.`;
    return `<div class="kun94-results">
      <section class="kun94-block"><div class="kun94-block-title">النتيجة الفورية</div><div class="kun94-block-sub">كل مدخل مرتبط بالحساب أو بالتخطيط بشكل واضح.</div><div class="kun94-kpis"><div class="kun94-kpi ${c.monthlyProfit<0?'bad':'good'}"><span>صافي الربح / الخسارة شهريًا</span><strong>${money(c.monthlyProfit)}</strong></div><div class="kun94-kpi focus"><span>الطلبات اليومية للتعادل</span><strong>${finite(be)?`${fmt(be,0)} طلب`:'غير ممكن'}</strong></div><div class="kun94-kpi"><span>هامش المساهمة لكل طلب جديد</span><strong>${money(c.contribution)}</strong></div><div class="kun94-kpi"><span>صافي مبيعات لكل 100 طلب جديد</span><strong>${fmt(c.keptPerOrder*100,1)}</strong></div><div class="kun94-kpi"><span>ROAS متوقع</span><strong>${c.roas?`${fmt(c.roas,2)}x`:'—'}</strong></div><div class="kun94-kpi"><span>هامش صافي الربح</span><strong>${fmt(c.margin,1)}%</strong></div></div><div class="${finite(c.breakEvenDaily)?'kun94-ok':'kun94-warning'}" style="margin-top:10px">${status}${!finite(c.breakEvenDaily)?` ${impossibleHint}`:''}</div></section>
      <section class="kun94-block"><div class="kun94-block-title">كام طلب يومي مطلوب في كل حالة؟</div><div class="kun94-block-sub">الأرقام هنا هي طلبات جديدة قبل التأكيد، وليست الطلبات المستلمة فقط.</div><div class="kun94-scenarios"><div class="kun94-scenario"><span class="name">الخطة الحالية</span><strong>${fmt(c.daily,0)} طلب/يوم</strong><small>ربح شهري متوقع: ${money(c.monthlyProfit)} • صافي مبيعات: ${fmt(c.expectedNetDeliveredDaily,1)}/يوم</small></div>${scenario('نقطة التعادل',c.breakEvenDaily,c,impossibleHint)}${scenario(`تحقيق ربح ${money(c.targetProfit)} شهريًا`,c.targetProfitDaily,c,impossibleHint)}${scenario(`تحقيق هامش ${fmt(c.targetMargin*100,1)}%`,c.targetMarginDaily,c,'الهامش المستهدف أعلى من الهامش الممكن للوحدة الحالية. حسّن سعر البيع أو CPP أو التكاليف أو نسب التحويل.')}</div></section>
      <section class="kun94-block kun94-summary"><div class="kun94-block-title">تفاصيل الفانل والاقتصاديات</div><div class="kun94-row"><span>طلبات مؤكدة متوقعة يوميًا</span><b>${fmt(c.expectedConfirmedDaily,1)}</b></div><div class="kun94-row"><span>طلبات مستلمة قبل المرتجع يوميًا</span><b>${fmt(c.expectedGrossDeliveredDaily,1)}</b></div><div class="kun94-row"><span>مرتجعات متوقعة يوميًا</span><b>${fmt(c.expectedReturnsDaily,1)}</b></div><div class="kun94-row"><span>صافي طلبات نهائية يوميًا</span><b>${fmt(c.expectedNetDeliveredDaily,1)}</b></div><div class="kun94-row"><span>الإيراد الشهري المتوقع</span><b>${money(c.monthlyRevenue)}</b></div><div class="kun94-row"><span>تكلفة الإعلان الشهرية</span><b>${money(c.monthlyAdSpend)}</b></div><div class="kun94-row"><span>المصاريف الثابتة الشهرية</span><b>${money(c.fixed)}</b></div><div class="kun94-row"><span>CPP المستخدم في الربحية</span><b>${c.usedCpp?money(c.usedCpp):'—'}</b></div><div class="kun94-row"><span>CPP المحسوب من CPM/CTR/CVR</span><b>${c.derivedCpp?money(c.derivedCpp):'—'}</b></div><div class="kun94-row"><span>CPC المحسوب</span><b>${c.derivedCpc?money(c.derivedCpc):'—'}</b></div><div class="kun94-row"><span>أقصى CPP قبل خسارة الوحدة</span><b>${money(c.maxCppVariable)}</b></div><div class="kun94-row"><span>أقصى CPP عند حجم الطلبات الحالي لتغطية كل المصاريف</span><b>${money(c.maxCppAtPlan)}</b></div></section>
      <section class="kun94-block"><div class="kun94-block-title">نقطة التعادل والربحية</div><div class="kun94-block-sub">الخط يتحرك مع كل تكلفة ونسبة وإعلان، وليس مع عدد الطلبات فقط.</div>${chart(c)}</section>
    </div>`;
  }

  function render(){
    style();ensureNav();const el=root();if(!el)return;load();
    el.innerHTML=`<section class="kun94-page"><div class="page-head kun94-head"><div><div class="title">حاسبة التجارة الإلكترونية</div><div class="sub">فانل كامل: طلب → تأكيد → استلام → مرتجع → صافي بيع، ثم الربح ونقطة التعادل.</div></div><div class="spacer"></div><div class="kun94-actions"><button class="btn soft" data-kun94-reset>إعادة ضبط</button><button class="btn primary" data-kun94-recalc>إعادة الحساب</button></div></div><div class="kun94-layout"><div class="kun94-inputs">${section('product','1) اقتصاديات المنتج والطلب','كل تكلفة هنا تدخل مباشرة في هامش المساهمة.')}${section('funnel','2) التأكيد والاستلام والمرتجع','النسب تعمل بالتتابع: التأكيد ثم الاستلام ثم خصم المرتجعات؛ لذلك كل نسبة تغيّر صافي المبيعات والربح.')}${section('ads','3) الإعلانات','اختر بوضوح هل تكلفة الطلب تُحسب من CPM/CTR/Conversion أم تستخدم CPP فعليًا.',adControls())}${section('fixed','4) المصاريف الثابتة الشهرية','تحدد عدد الطلبات المطلوب للوصول إلى نقطة التعادل.')}${section('goals','5) أهداف الربحية','حدد هدفك، والحاسبة تعطيك عدد الطلبات اليومية المطلوب لتحقيقه.')}<div class="kun94-formula"><b>المعادلة الأساسية:</b> صافي البيع = الطلبات الجديدة × التأكيد × الاستلام × (1 − المرتجع). الربح الشهري = (هامش المساهمة لكل طلب جديد × الطلبات اليومية × أيام التشغيل) − المصاريف الثابتة. في الوضع التلقائي يدخل CPM وCTR وConversion Rate إلى الربحية عبر CPP المحسوب؛ وفي الوضع اليدوي يدخل CPP الفعلي بينما تُستخدم مؤشرات الترافيك لتقدير الزيارات والظهور والميزانية النظرية.</div></div><div id="kun94Results"></div></div></section>`;
    bind();refresh();
  }

  function refresh(){if(!active())return;const c=calculate(model),host=document.getElementById('kun94Results');if(host)host.innerHTML=resultsHtml(c);}
  function bind(){
    document.querySelectorAll('[data-kun94-input]').forEach(input=>input.addEventListener('input',()=>{const key=input.dataset.kun94Input;let value=n(input.value);if(['confirmationRate','deliveryRate','returnRate','codPercent','ctr','clickToOrder','targetMargin'].includes(key))value=pct(value);model[key]=value;save();refresh();}));
    document.querySelectorAll('[data-kun94-admode]').forEach(button=>button.addEventListener('click',()=>{model.adCostMode=button.dataset.kun94Admode==='manual'?'manual':'auto';save();render();}));
    document.querySelector('[data-kun94-recalc]')?.addEventListener('click',refresh);
    document.querySelector('[data-kun94-reset]')?.addEventListener('click',()=>{if(!confirm('إعادة كل أرقام الحاسبة للقيم الافتراضية؟'))return;model={...DEFAULTS};save();render();});
  }

  function boot(){style();ensureNav();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
  window.KunEcommerceCalculatorV94={version:'94.0',render,refresh,calculate,defaults:DEFAULTS,get model(){return {...model};}};
})();
