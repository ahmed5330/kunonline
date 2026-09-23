/* Kun Online v96.0 — E-commerce Profitability & Growth Calculator. */
(function(){
  'use strict';
  if(window.KunEcommerceCalculatorV94)return;

  const VIEW='ecommerce-calculator';
  const STORAGE='kun:ecommerce-calculator:v96';
  const LEGACY=['kun:ecommerce-calculator:v94','kun:ecommerce-calculator:v93'];
  const root=()=>document.getElementById('root');
  const active=()=>document.querySelector('.nav button.active[data-view]')?.dataset.view===VIEW;
  const n=v=>Number.isFinite(Number(v))?Math.max(0,Number(v)):0;
  const signed=v=>Number.isFinite(Number(v))?Number(v):0;
  const pct=v=>Math.min(100,Math.max(0,n(v)));
  const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
  const safeDiv=(a,b)=>b>0?a/b:0;
  const fmt=(v,d=1)=>new Intl.NumberFormat('ar-EG',{maximumFractionDigits:d}).format(Number(v)||0);
  const money=v=>`${fmt(v,0)} ج.م`;
  const percent=v=>`${fmt(v,1)}%`;
  const multiple=v=>`${fmt(v,2)}x`;
  const escapeHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  const GROUPS={
    orders:[
      ['totalOrders','Total Orders — إجمالي الطلبات','طلب','كل الطلبات التي تم إنشاؤها'],
      ['cancelledOrders','Cancelled Orders — الملغاة','طلب','قبل الشحن'],
      ['shippedOrders','Shipped Orders — المشحونة','طلب','خرجت فعليًا للشحن'],
      ['rtoOrders','RTO Orders — مرتجع قبل التسليم','طلب','Return To Origin'],
      ['deliveredOrders','Delivered Orders — المسلّمة','طلب','وصلت للعميل'],
      ['returnedOrders','Returns After Delivery — مرتجع بعد التسليم','طلب','استلام ثم إرجاع / استرداد']
    ],
    revenue:[
      ['grossAov','Gross AOV — متوسط قيمة الطلب قبل الخصم','ج.م','متوسط قيمة الطلب الأصلية'],
      ['discountPercent','Average Discounts — متوسط الخصم','%','خصم فعلي من قيمة الطلب'],
      ['customerShippingRevenue','شحن محصل من العميل لكل Order محتفظ به','ج.م','إن وجد؛ لا تضع تكلفة شركة الشحن هنا'],
      ['otherRevenue','إيرادات أخرى محققة','ج.م','إيراد فعلي إضافي لنفس الفترة'],
      ['platformReportedRevenue','Platform Reported Revenue','ج.م','Revenue الظاهر في المنصة/Ads Manager']
    ],
    variable:[
      ['cogsPerKept','COGS لكل Order محتفظ به','ج.م','تكلفة المنتج الفعلية'],
      ['returnedCogsLossPercent','خسارة COGS في المرتجع بعد التسليم','%','الجزء غير القابل للاسترداد من تكلفة المنتج'],
      ['packagingPerShipped','Packaging لكل شحنة','ج.م','كرتونة / تغليف / مطبوعات'],
      ['forwardShippingPerShipped','Forward Shipping لكل شحنة','ج.م','تكلفة الذهاب لشركة الشحن'],
      ['rtoCostPerOrder','RTO Cost لكل مرتجع RTO','ج.م','الرجوع / المحاولة / المعالجة'],
      ['returnCostPerOrder','Return Cost بعد التسليم','ج.م','تكلفة الرجوع والمعالجة'],
      ['paymentFeePercent','Payment / COD Fees','%','نسبة من الإيراد المحقق'],
      ['paymentFeeFixed','رسوم دفع ثابتة لكل Order محتفظ به','ج.م','إن وجدت'],
      ['fulfillmentPerShipped','Fulfillment / Handling لكل شحنة','ج.م','تجهيز / Pick & Pack'],
      ['otherVariablePerShipped','تكلفة متغيرة أخرى لكل شحنة','ج.م','هدايا / عمولات / اتصالات']
    ],
    marketing:[
      ['adSpend','Ad Spend — الإنفاق الإعلاني','ج.م','إجمالي الإنفاق لنفس الفترة']
    ],
    fixed:[
      ['salaries','الرواتب','ج.م','لنفس الفترة'],
      ['rent','الإيجار','ج.م','مكتب / مخزن'],
      ['software','Software & Subscriptions','ج.م','منصات وأدوات'],
      ['warehouseUtilities','مخزن / مرافق / كهرباء','ج.م','تكاليف تشغيل ثابتة'],
      ['agencyFees','Agency / Freelancers','ج.م','أتعاب ثابتة'],
      ['otherFixed','Fixed Costs أخرى','ج.م','محاسبة / إدارة / مصروفات ثابتة']
    ],
    targets:[
      ['targetProfit','Target Net Profit','ج.م','الربح المستهدف لنفس الفترة'],
      ['targetMargin','Target Net Margin','%','هامش صافي الربح المستهدف'],
      ['targetRtoRate','Target RTO Rate','%','مثال: 10%'],
      ['targetAovLift','Target AOV Change','%','مثال: 10% زيادة'],
      ['targetCpaChange','Target CPA Change','%','اكتب -20 لتقليل CPA 20%'],
      ['targetCogsChange','Target COGS Change','%','اكتب -5 لتقليل COGS 5%'],
      ['targetReturnChange','Target Returns Change','%','اكتب -20 لتقليل المرتجعات 20%']
    ],
    stress:[
      ['stressRtoRate','Stress RTO Rate','%','مثال: 25%'],
      ['stressAovChange','Stress AOV Change','%','مثال: -10%'],
      ['stressCpaChange','Stress CPA Change','%','مثال: 20%'],
      ['stressCogsChange','Stress COGS Change','%','مثال: 10%'],
      ['stressReturnChange','Stress Returns Change','%','مثال: 25%']
    ]
  };

  const DEFAULTS={
    totalOrders:0,cancelledOrders:0,shippedOrders:0,rtoOrders:0,deliveredOrders:0,returnedOrders:0,
    grossAov:0,discountPercent:0,customerShippingRevenue:0,otherRevenue:0,platformReportedRevenue:0,
    cogsPerKept:0,returnedCogsLossPercent:0,packagingPerShipped:0,forwardShippingPerShipped:0,
    rtoCostPerOrder:0,returnCostPerOrder:0,paymentFeePercent:0,paymentFeeFixed:0,
    fulfillmentPerShipped:0,otherVariablePerShipped:0,adSpend:0,
    salaries:0,rent:0,software:0,warehouseUtilities:0,agencyFees:0,otherFixed:0,
    targetProfit:100000,targetMargin:15,targetRtoRate:10,targetAovLift:10,targetCpaChange:-20,
    targetCogsChange:-5,targetReturnChange:-20,stressRtoRate:25,stressAovChange:-10,
    stressCpaChange:20,stressCogsChange:10,stressReturnChange:25
  };
  let model={...DEFAULTS};

  function migrateLegacy(data){
    if(!data||typeof data!=='object')return null;
    const next={...DEFAULTS};
    for(const key of Object.keys(DEFAULTS))if(data[key]!==undefined)next[key]=data[key];
    if(data.sellingPrice!==undefined&&next.grossAov===0)next.grossAov=n(data.sellingPrice);
    if(data.productCost!==undefined&&next.cogsPerKept===0)next.cogsPerKept=n(data.productCost);
    if(data.packagingCost!==undefined&&next.packagingPerShipped===0)next.packagingPerShipped=n(data.packagingCost);
    if(data.forwardShipping!==undefined&&next.forwardShippingPerShipped===0)next.forwardShippingPerShipped=n(data.forwardShipping);
    if(data.returnShipping!==undefined&&next.rtoCostPerOrder===0)next.rtoCostPerOrder=n(data.returnShipping);
    if(data.codPercent!==undefined&&next.paymentFeePercent===0)next.paymentFeePercent=n(data.codPercent);
    if(data.codFixed!==undefined&&next.paymentFeeFixed===0)next.paymentFeeFixed=n(data.codFixed);
    if(data.otherVariable!==undefined&&next.otherVariablePerShipped===0)next.otherVariablePerShipped=n(data.otherVariable);
    if(data.salaries!==undefined)next.salaries=n(data.salaries);
    if(data.rent!==undefined)next.rent=n(data.rent);
    if(data.software!==undefined)next.software=n(data.software);
    if(data.otherFixed!==undefined)next.otherFixed=n(data.otherFixed);
    return next;
  }

  function load(){
    try{
      const current=JSON.parse(localStorage.getItem(STORAGE)||'null');
      if(current){model={...DEFAULTS,...current};return;}
      for(const key of LEGACY){
        const old=JSON.parse(localStorage.getItem(key)||'null');
        const migrated=migrateLegacy(old);
        if(migrated){model=migrated;save();return;}
      }
    }catch{}
    model={...DEFAULTS};
  }
  function save(){try{localStorage.setItem(STORAGE,JSON.stringify(model));}catch{}}

  function sanitize(input){
    const d={};
    for(const key of Object.keys(DEFAULTS))d[key]=key.includes('Change')||key==='targetAovLift'?signed(input[key]):n(input[key]);
    d.discountPercent=pct(input.discountPercent);
    d.returnedCogsLossPercent=pct(input.returnedCogsLossPercent);
    d.paymentFeePercent=pct(input.paymentFeePercent);
    d.targetMargin=pct(input.targetMargin);
    d.targetRtoRate=pct(input.targetRtoRate);
    d.stressRtoRate=pct(input.stressRtoRate);
    return d;
  }

  function calculate(input){
    const d=sanitize(input);
    const total=d.totalOrders,cancelled=d.cancelledOrders,shipped=d.shippedOrders,rto=d.rtoOrders,delivered=d.deliveredOrders,returned=d.returnedOrders;
    const kept=Math.max(0,delivered-returned);
    const inTransit=Math.max(0,shipped-rto-delivered);
    const netAov=d.grossAov*(1-d.discountPercent/100);
    const realizedRevenue=kept*(netAov+d.customerShippingRevenue)+d.otherRevenue;
    const platformRevenue=d.platformReportedRevenue>0?d.platformReportedRevenue:total*d.grossAov;

    const cogs=kept*d.cogsPerKept+returned*d.cogsPerKept*(d.returnedCogsLossPercent/100);
    const packaging=shipped*d.packagingPerShipped;
    const forwardShipping=shipped*d.forwardShippingPerShipped;
    const rtoCost=rto*d.rtoCostPerOrder;
    const returnCost=returned*d.returnCostPerOrder;
    const paymentFees=realizedRevenue*(d.paymentFeePercent/100)+kept*d.paymentFeeFixed;
    const fulfillment=shipped*d.fulfillmentPerShipped;
    const otherVariable=shipped*d.otherVariablePerShipped;
    const variableCosts=cogs+packaging+forwardShipping+rtoCost+returnCost+paymentFees+fulfillment+otherVariable;
    const contributionBeforeAds=realizedRevenue-variableCosts;
    const contributionProfit=contributionBeforeAds-d.adSpend;
    const fixedCosts=d.salaries+d.rent+d.software+d.warehouseUtilities+d.agencyFees+d.otherFixed;
    const netProfit=contributionProfit-fixedCosts;

    const currentCPA=safeDiv(d.adSpend,total);
    const shippedCPA=safeDiv(d.adSpend,shipped);
    const deliveredCPA=safeDiv(d.adSpend,delivered);
    const keptCPA=safeDiv(d.adSpend,kept);
    const platformROAS=safeDiv(platformRevenue,d.adSpend);
    const realizedROAS=safeDiv(realizedRevenue,d.adSpend);
    const netBreakEvenAdSpend=Math.max(0,contributionBeforeAds-fixedCosts);
    const netBreakEvenCPA=safeDiv(netBreakEvenAdSpend,total);
    const contributionBreakEvenCPA=safeDiv(Math.max(0,contributionBeforeAds),total);
    const realizedBreakEvenROAS=safeDiv(realizedRevenue,netBreakEvenAdSpend);
    const platformBreakEvenROAS=safeDiv(platformRevenue,netBreakEvenAdSpend);
    const cpaHeadroom=netBreakEvenCPA-currentCPA;
    const cpaHeadroomPercent=currentCPA>0?cpaHeadroom/currentCPA*100:0;

    const cancellationRate=safeDiv(cancelled,total)*100;
    const shippingRate=safeDiv(shipped,total)*100;
    const rtoRate=safeDiv(rto,shipped)*100;
    const deliveryRate=safeDiv(delivered,shipped)*100;
    const returnRate=safeDiv(returned,delivered)*100;
    const keptRate=safeDiv(kept,total)*100;
    const netMargin=safeDiv(netProfit,realizedRevenue)*100;
    const contributionMargin=safeDiv(contributionProfit,realizedRevenue)*100;
    const variableCostRate=safeDiv(variableCosts,realizedRevenue)*100;

    const discountLeakage=kept*d.grossAov*(d.discountPercent/100);
    const cancellationValue=cancelled*netAov;
    const rtoValue=rto*netAov;
    const returnsValue=returned*netAov;
    const revenueGap=Math.max(0,platformRevenue-realizedRevenue);

    const profitPerPlaced=safeDiv(netProfit,total);
    const profitPerShipped=safeDiv(netProfit,shipped);
    const profitPerDelivered=safeDiv(netProfit,delivered);
    const profitPerKept=safeDiv(netProfit,kept);
    const realizedRevenuePerPlaced=safeDiv(realizedRevenue,total);
    const nonAdCostPerPlaced=safeDiv(variableCosts+fixedCosts,total);
    const targetProfitGap=d.targetProfit-netProfit;
    const targetMarginGap=d.targetMargin-netMargin;

    const warnings=[];
    if(total>0&&cancelled>total)warnings.push('Cancelled Orders أكبر من Total Orders.');
    if(total>0&&shipped>total)warnings.push('Shipped Orders أكبر من Total Orders.');
    if(rto>shipped)warnings.push('RTO Orders أكبر من Shipped Orders.');
    if(delivered>shipped)warnings.push('Delivered Orders أكبر من Shipped Orders.');
    if(returned>delivered)warnings.push('Returns After Delivery أكبر من Delivered Orders.');
    if(shipped>0&&rto+delivered>shipped)warnings.push('RTO + Delivered أكبر من Shipped؛ راجع تصنيف الحالات.');
    if(total>0&&cancelled+shipped>total)warnings.push('Cancelled + Shipped أكبر من Total Orders؛ قد يكون هناك تداخل في الحالات.');
    if(platformRevenue>0&&realizedRevenue>platformRevenue*1.05)warnings.push('Realized Revenue أعلى من Platform Revenue بأكثر من 5%؛ راجع Other Revenue وشحن العميل.');
    if(inTransit>0)warnings.push(`${fmt(inTransit,0)} Order مشحون لم يُصنّف بعد كـ Delivered أو RTO (In Transit / Pending).`);

    return {...d,keptOrders:kept,inTransitOrders:inTransit,netAov,realizedRevenue,platformRevenue,cogs,packaging,forwardShipping,rtoCost,returnCost,paymentFees,fulfillment,otherVariable,variableCosts,contributionBeforeAds,contributionProfit,fixedCosts,netProfit,currentCPA,shippedCPA,deliveredCPA,keptCPA,platformROAS,realizedROAS,netBreakEvenAdSpend,netBreakEvenCPA,contributionBreakEvenCPA,realizedBreakEvenROAS,platformBreakEvenROAS,cpaHeadroom,cpaHeadroomPercent,cancellationRate,shippingRate,rtoRate,deliveryRate,returnRate,keptRate,netMargin,contributionMargin,variableCostRate,discountLeakage,cancellationValue,rtoValue,returnsValue,revenueGap,profitPerPlaced,profitPerShipped,profitPerDelivered,profitPerKept,realizedRevenuePerPlaced,nonAdCostPerPlaced,targetProfitGap,targetMarginGap,warnings};
  }

  function scenario(baseCalc,opts){
    const d={...model};
    const shipped=Math.max(0,n(d.shippedOrders));
    const baseInTransit=baseCalc.inTransitOrders;
    if(opts.rtoRate!==undefined){
      d.rtoOrders=shipped*clamp(opts.rtoRate,0,100)/100;
      d.deliveredOrders=Math.max(0,shipped-d.rtoOrders-baseInTransit);
      const originalReturnRate=baseCalc.returnRate/100;
      d.returnedOrders=d.deliveredOrders*originalReturnRate;
    }
    if(opts.returnFactor!==undefined)d.returnedOrders=Math.min(n(d.deliveredOrders),n(d.returnedOrders)*Math.max(0,opts.returnFactor));
    if(opts.aovFactor!==undefined)d.grossAov=n(d.grossAov)*Math.max(0,opts.aovFactor);
    if(opts.cogsFactor!==undefined)d.cogsPerKept=n(d.cogsPerKept)*Math.max(0,opts.cogsFactor);
    if(opts.cpaFactor!==undefined){
      const baseCPA=baseCalc.currentCPA;
      d.adSpend=baseCPA*Math.max(0,opts.cpaFactor)*n(d.totalOrders);
    }
    return calculate(d);
  }

  function impactAnalysis(c){
    const targetRto=scenario(c,{rtoRate:model.targetRtoRate});
    const lowRto=scenario(c,{rtoRate:Math.max(0,c.rtoRate-5)});
    const aovUp=scenario(c,{aovFactor:1.10});
    const aovDown=scenario(c,{aovFactor:.90});
    const cpaDown=scenario(c,{cpaFactor:.80});
    const cpaUp=scenario(c,{cpaFactor:1.20});
    const cogsDown=scenario(c,{cogsFactor:.90});
    const cogsUp=scenario(c,{cogsFactor:1.10});
    const returnsDown=scenario(c,{returnFactor:.80});
    const returnsUp=scenario(c,{returnFactor:1.20});
    const rows=[
      ['RTO للهدف',`${percent(c.rtoRate)} → ${percent(model.targetRtoRate)}`,targetRto],
      ['RTO أقل 5 نقاط',`${percent(c.rtoRate)} → ${percent(Math.max(0,c.rtoRate-5))}`,lowRto],
      ['AOV +10%','رفع متوسط الطلب 10%',aovUp],
      ['AOV -10%','خفض متوسط الطلب 10%',aovDown],
      ['CPA -20%','خفض تكلفة الطلب 20%',cpaDown],
      ['CPA +20%','زيادة تكلفة الطلب 20%',cpaUp],
      ['COGS -10%','خفض تكلفة المنتج 10%',cogsDown],
      ['COGS +10%','زيادة تكلفة المنتج 10%',cogsUp],
      ['Returns -20%','خفض مرتجع ما بعد التسليم 20%',returnsDown],
      ['Returns +20%','زيادة مرتجع ما بعد التسليم 20%',returnsUp]
    ].map(([name,change,result])=>({name,change,result,delta:result.netProfit-c.netProfit}));
    const best=[...rows].filter(x=>x.delta>0).sort((a,b)=>b.delta-a.delta)[0]||null;
    return {rows,best};
  }

  function scenarios(c){
    const target=scenario(c,{
      rtoRate:model.targetRtoRate,
      aovFactor:1+signed(model.targetAovLift)/100,
      cpaFactor:1+signed(model.targetCpaChange)/100,
      cogsFactor:1+signed(model.targetCogsChange)/100,
      returnFactor:1+signed(model.targetReturnChange)/100
    });
    const stress=scenario(c,{
      rtoRate:model.stressRtoRate,
      aovFactor:1+signed(model.stressAovChange)/100,
      cpaFactor:1+signed(model.stressCpaChange)/100,
      cogsFactor:1+signed(model.stressCogsChange)/100,
      returnFactor:1+signed(model.stressReturnChange)/100
    });
    return {current:c,target,stress};
  }

  function field([key,label,unit,placeholder]){
    const value=model[key]??'';
    const allowNegative=key.includes('Change')||key==='targetAovLift';
    return `<label class="kun96-field"><span>${escapeHtml(label)}</span><div class="kun96-input-wrap"><input type="number" step="any" ${allowNegative?'':'min="0"'} data-kun96-field="${escapeHtml(key)}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}"><em>${escapeHtml(unit)}</em></div></label>`;
  }
  function fields(group){return `<div class="kun96-fields">${GROUPS[group].map(field).join('')}</div>`;}
  function block(title,sub,content,open=true){return `<details class="kun96-block" ${open?'open':''}><summary><div><b>${title}</b><small>${sub}</small></div><span>⌄</span></summary><div class="kun96-block-body">${content}</div></details>`;}
  function kpi(label,value,cls='',hint=''){return `<div class="kun96-kpi ${cls}"><span>${label}</span><strong>${value}</strong>${hint?`<small>${hint}</small>`:''}</div>`;}
  function row(label,value,cls=''){return `<div class="kun96-row ${cls}"><span>${label}</span><b>${value}</b></div>`;}

  function style(){
    if(document.getElementById('kunEcomCalc96Style'))return;
    const s=document.createElement('style');s.id='kunEcomCalc96Style';s.textContent=`
      .kun94-subnav{font-size:12px!important;padding-inline-start:24px!important;opacity:.9}.kun94-subnav::before{content:'↳';margin-inline-end:7px;opacity:.55}
      .kun96-page{direction:rtl;display:grid;gap:16px}.kun96-head{display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap}.kun96-head h2{margin:0 0 4px;font-size:22px}.kun96-head p{margin:0;color:#64748b;font-size:12px;line-height:1.7}.kun96-head .spacer{flex:1}.kun96-actions{display:flex;gap:8px;flex-wrap:wrap}
      .kun96-actions button{border:1px solid #dbe3ea;background:#fff;border-radius:11px;padding:9px 12px;font:inherit;font-weight:800;cursor:pointer}.kun96-actions button.primary{background:#0f172a;color:#fff;border-color:#0f172a}
      .kun96-process{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:7px}.kun96-process div{background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:9px;text-align:center;font-size:10px;font-weight:850}.kun96-layout{display:grid;grid-template-columns:minmax(0,1.08fr) minmax(400px,.92fr);gap:14px;align-items:start}.kun96-inputs,.kun96-results{display:grid;gap:11px}.kun96-results{position:sticky;top:70px}
      .kun96-block{border:1px solid var(--line,#e2e8f0);border-radius:16px;background:var(--card,#fff);overflow:hidden}.kun96-block summary{list-style:none;cursor:pointer;padding:14px 16px;display:flex;justify-content:space-between;align-items:center;gap:10px}.kun96-block summary::-webkit-details-marker{display:none}.kun96-block summary b{display:block;font-size:14px}.kun96-block summary small{display:block;color:#64748b;font-size:10px;margin-top:3px}.kun96-block-body{padding:0 16px 16px}
      .kun96-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.kun96-field{display:grid;gap:5px}.kun96-field>span{font-size:10.5px;color:#475569;font-weight:800}.kun96-input-wrap{display:grid;grid-template-columns:minmax(0,1fr) auto;border:1px solid #dbe3ea;border-radius:10px;overflow:hidden;background:#fff}.kun96-input-wrap input{border:0!important;border-radius:0!important;min-width:0;padding:10px!important}.kun96-input-wrap em{font-style:normal;display:flex;align-items:center;padding:0 9px;background:#f8fafc;border-inline-start:1px solid #e2e8f0;font-size:9.5px;font-weight:800;color:#64748b;white-space:nowrap}
      .kun96-kpis{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.kun96-kpi{border:1px solid #e2e8f0;border-radius:13px;padding:12px;background:#fff;display:grid;gap:4px}.kun96-kpi span{font-size:10px;color:#64748b;font-weight:800}.kun96-kpi strong{font-size:18px}.kun96-kpi small{font-size:9px;color:#64748b;line-height:1.5}.kun96-kpi.good strong{color:#15803d}.kun96-kpi.bad strong{color:#b91c1c}.kun96-kpi.focus{background:#eff6ff;border-color:#bfdbfe}.kun96-kpi.focus strong{color:#1d4ed8}
      .kun96-row{display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px dashed #e2e8f0;font-size:10.5px}.kun96-row:last-child{border-bottom:0}.kun96-row b{font-size:11.5px}.kun96-row.good b{color:#15803d}.kun96-row.bad b{color:#b91c1c}.kun96-waterfall{display:grid;gap:6px}.kun96-bar{display:grid;grid-template-columns:135px 1fr 90px;gap:8px;align-items:center;font-size:9.5px}.kun96-track{height:10px;border-radius:999px;background:#f1f5f9;overflow:hidden}.kun96-fill{height:100%;background:#64748b;border-radius:999px}.kun96-fill.positive{background:#16a34a}.kun96-fill.negative{background:#dc2626}.kun96-bar b{text-align:left}
      .kun96-impact{overflow:auto}.kun96-impact table{width:100%;border-collapse:collapse;font-size:9.5px;min-width:550px}.kun96-impact th,.kun96-impact td{padding:8px;border-bottom:1px solid #e2e8f0;text-align:right}.kun96-impact th{color:#64748b;background:#f8fafc}.kun96-impact .up{color:#15803d;font-weight:850}.kun96-impact .down{color:#b91c1c;font-weight:850}.kun96-scenarios{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.kun96-scenario{border:1px solid #e2e8f0;border-radius:13px;padding:11px;background:#fff}.kun96-scenario.target{background:#f0fdf4;border-color:#bbf7d0}.kun96-scenario.stress{background:#fff7ed;border-color:#fed7aa}.kun96-scenario h4{margin:0 0 8px;font-size:12px}.kun96-scenario strong{display:block;font-size:16px;margin-bottom:5px}.kun96-scenario small{display:block;font-size:9px;color:#64748b;line-height:1.65}
      .kun96-alert{padding:10px 12px;border-radius:11px;font-size:10.5px;line-height:1.7;margin-bottom:8px}.kun96-alert.warn{background:#fff7ed;border:1px solid #fed7aa;color:#9a3412}.kun96-alert.ok{background:#f0fdf4;border:1px solid #bbf7d0;color:#166534}.kun96-alert.info{background:#eff6ff;border:1px solid #bfdbfe;color:#1e40af}.kun96-decision{display:grid;gap:8px}.kun96-formula{font-size:9.5px;color:#475569;line-height:1.75;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:10px}
      @media(max-width:1080px){.kun96-layout{grid-template-columns:1fr}.kun96-results{position:static}.kun96-process{grid-template-columns:repeat(3,1fr)}}@media(max-width:640px){.kun96-fields,.kun96-kpis{grid-template-columns:1fr}.kun96-scenarios{grid-template-columns:1fr}.kun96-process{grid-template-columns:repeat(2,1fr)}.kun96-bar{grid-template-columns:105px 1fr 72px}.kun96-head h2{font-size:18px}}@media print{.nav,.topbar,.kun96-actions{display:none!important}.kun96-layout{grid-template-columns:1fr}.kun96-results{position:static}.kun96-block{break-inside:avoid}}
    `;document.head.appendChild(s);
  }

  function costWaterfall(c){
    const items=[['Realized Revenue',c.realizedRevenue,'positive'],['COGS',-c.cogs,'negative'],['Shipping',-c.forwardShipping,'negative'],['Packaging',-c.packaging,'negative'],['RTO',-c.rtoCost,'negative'],['Returns',-c.returnCost,'negative'],['Payment Fees',-c.paymentFees,'negative'],['Fulfillment + Other',-(c.fulfillment+c.otherVariable),'negative'],['Advertising',-c.adSpend,'negative'],['Fixed Costs',-c.fixedCosts,'negative'],['Net Profit',c.netProfit,c.netProfit>=0?'positive':'negative']];
    const max=Math.max(1,...items.map(x=>Math.abs(x[1])));
    return `<div class="kun96-waterfall">${items.map(([label,value,cls])=>`<div class="kun96-bar"><span>${label}</span><div class="kun96-track"><div class="kun96-fill ${cls}" style="width:${clamp(Math.abs(value)/max*100,1,100)}%"></div></div><b>${money(value)}</b></div>`).join('')}</div>`;
  }

  function resultHtml(c){
    const impact=impactAnalysis(c),plan=scenarios(c);
    const status=c.netProfit>=0?'good':'bad';
    const breakEvenStatus=c.currentCPA<=c.netBreakEvenCPA&&c.netBreakEvenCPA>0?'good':'bad';
    const best=impact.best;
    const impactRows=impact.rows.map(x=>`<tr><td>${escapeHtml(x.name)}</td><td>${escapeHtml(x.change)}</td><td>${money(x.result.netProfit)}</td><td class="${x.delta>=0?'up':'down'}">${x.delta>=0?'+':''}${money(x.delta)}</td></tr>`).join('');
    const alerts=c.warnings.length?c.warnings.map(x=>`<div class="kun96-alert warn">${escapeHtml(x)}</div>`).join(''):`<div class="kun96-alert ok">تسلسل الـOrders متسق حسابيًا حسب البيانات المدخلة.</div>`;
    const leakageTotal=c.discountLeakage+c.cancellationValue+c.rtoValue+c.returnsValue;
    const scenarioCard=(name,x,cls)=>`<div class="kun96-scenario ${cls}"><h4>${name}</h4><strong>${money(x.netProfit)}</strong><small>Net Margin: ${percent(x.netMargin)}</small><small>Realized Revenue: ${money(x.realizedRevenue)}</small><small>CPA: ${money(x.currentCPA)}</small><small>BE CPA: ${money(x.netBreakEvenCPA)}</small><small>Realized ROAS: ${multiple(x.realizedROAS)}</small></div>`;
    return `
      <section class="kun96-block"><div class="kun96-block-body" style="padding-top:16px"><div class="kun96-kpis">
        ${kpi('Realized Revenue — الإيراد المحقق',money(c.realizedRevenue),'focus',`من ${fmt(c.keptOrders,0)} Order محتفظ به`)}
        ${kpi('Net Profit — صافي الربح',money(c.netProfit),status,`Net Margin ${percent(c.netMargin)}`)}
        ${kpi('Contribution Profit',money(c.contributionProfit),c.contributionProfit>=0?'good':'bad','بعد المتغيرات والإعلانات وقبل Fixed Costs')}
        ${kpi('Realized ROAS',multiple(c.realizedROAS),c.realizedROAS>=c.realizedBreakEvenROAS?'good':'bad',`Platform ROAS ${multiple(c.platformROAS)}`)}
      </div></div></section>

      ${block('Order Funnel — رحلة الـOrder','من Order Created إلى Order محتفظ به فعليًا',`
        ${row('Total Orders',fmt(c.totalOrders,0))}${row(`Cancelled (${percent(c.cancellationRate)})`,fmt(c.cancelledOrders,0),'bad')}${row(`Shipped (${percent(c.shippingRate)} من Total)`,fmt(c.shippedOrders,0))}${row(`RTO (${percent(c.rtoRate)} من Shipped)`,fmt(c.rtoOrders,0),'bad')}${row(`Delivered (${percent(c.deliveryRate)} من Shipped)`,fmt(c.deliveredOrders,0),'good')}${row(`Returns After Delivery (${percent(c.returnRate)})`,fmt(c.returnedOrders,0),'bad')}${row(`Kept / Realized Orders (${percent(c.keptRate)} من Total)`,fmt(c.keptOrders,0),'good')}${row('In Transit / Unclassified',fmt(c.inTransitOrders,0))}<div style="margin-top:10px">${alerts}</div>
      `)}

      ${block('Revenue Quality — جودة الإيراد','الفرق بين Revenue الظاهر وRevenue الذي بقي فعليًا',`
        ${row('Gross AOV',money(c.grossAov))}${row('Net AOV بعد الخصم',money(c.netAov))}${row('Platform Reported Revenue',money(c.platformRevenue))}${row('Realized Revenue',money(c.realizedRevenue),'good')}${row('Platform → Realized Gap',money(c.revenueGap),c.revenueGap>0?'bad':'')}${row('Discount Leakage',money(c.discountLeakage))}${row('Cancelled Potential Value',money(c.cancellationValue))}${row('RTO Potential Value',money(c.rtoValue))}${row('Post-delivery Return Value',money(c.returnsValue))}${row('Total visible leakage signals',money(leakageTotal),'bad')}
      `)}

      ${block('Profit Waterfall — من Revenue إلى Net Profit','كل طبقة تكلفة وتأثيرها على الربح',costWaterfall(c))}

      ${block('Marketing Economics & Break Even','مش بس Customer بكام؛ أقدر أدفع كام قبل ما أخسر',`
        <div class="kun96-kpis">${kpi('Current CPA / Placed Order',money(c.currentCPA),'',`Shipped CPA ${money(c.shippedCPA)}`)}${kpi('Net Break Even CPA',money(c.netBreakEvenCPA),breakEvenStatus,`Headroom ${money(c.cpaHeadroom)} (${percent(c.cpaHeadroomPercent)})`)}${kpi('Delivered CPA',money(c.deliveredCPA),'',`Kept CPA ${money(c.keptCPA)}`)}${kpi('Contribution BE CPA',money(c.contributionBreakEvenCPA),'','قبل Fixed Costs')}${kpi('Realized Break Even ROAS',multiple(c.realizedBreakEvenROAS),'','مبني على Realized Revenue')}${kpi('Platform Break Even ROAS',multiple(c.platformBreakEvenROAS),'','للمقارنة فقط مع Platform Revenue')}</div>
        <div class="kun96-formula" style="margin-top:10px">Net Break Even Ad Spend = Contribution Before Ads − Fixed Costs. ثم Net Break Even CPA = Net Break Even Ad Spend ÷ Total Orders. لذلك الـCPA المقبول يتغير تلقائيًا مع AOV وRTO وReturns وCOGS وباقي التكاليف.</div>
      `)}

      ${block('Unit Economics — اقتصاديات الوحدة','الربحية الحقيقية لكل مرحلة من مراحل الـOrder',`${row('Realized Revenue / Placed Order',money(c.realizedRevenuePerPlaced))}${row('Net Profit / Placed Order',money(c.profitPerPlaced),c.profitPerPlaced>=0?'good':'bad')}${row('Net Profit / Shipped Order',money(c.profitPerShipped),c.profitPerShipped>=0?'good':'bad')}${row('Net Profit / Delivered Order',money(c.profitPerDelivered),c.profitPerDelivered>=0?'good':'bad')}${row('Net Profit / Kept Order',money(c.profitPerKept),c.profitPerKept>=0?'good':'bad')}${row('Variable Cost Rate',percent(c.variableCostRate))}${row('Contribution Margin',percent(c.contributionMargin))}${row('Non-ad Variable + Fixed / Placed Order',money(c.nonAdCostPerPlaced))}`)}

      ${block('Impact Analysis — حساسية الربح','أثر كل Lever على Net Profit مع تثبيت باقي الافتراضات',`${best?`<div class="kun96-alert info"><b>أقوى Lever في الاختبارات الحالية:</b> ${escapeHtml(best.name)} — تأثير تقديري ${best.delta>=0?'+':''}${money(best.delta)} على Net Profit.</div>`:''}<div class="kun96-impact"><table><thead><tr><th>Lever</th><th>التغيير</th><th>Net Profit الجديد</th><th>Δ Profit</th></tr></thead><tbody>${impactRows}</tbody></table></div>`)}

      ${block('Scenario Planner — Current / Target / Stress Test','اختبار البيزنس عند تحسن أو تدهور عدة متغيرات معًا',`<div class="kun96-scenarios">${scenarioCard('Current',plan.current,'')}${scenarioCard('Target',plan.target,'target')}${scenarioCard('Stress Test',plan.stress,'stress')}</div><div class="kun96-formula" style="margin-top:10px">Target وStress Test يستخدمان افتراضاتك الموجودة في قسم السيناريوهات: RTO + AOV + CPA + COGS + Returns معًا. غيّر أي نسبة وسترى الأثر فورًا.</div>`)}

      ${block('Growth Decision — تشخيص القرار','من Ads Manager إلى قرار نمو وربحية',`<div class="kun96-decision">${c.netProfit>=0?`<div class="kun96-alert ok">البيزنس يحقق Net Profit ${money(c.netProfit)} بهامش ${percent(c.netMargin)} حسب البيانات المدخلة.</div>`:`<div class="kun96-alert warn">البيزنس يخسر ${money(Math.abs(c.netProfit))} حسب البيانات المدخلة. راجع أعلى Cost Leak والـRTO/Returns والـCPA.</div>`}${c.currentCPA<=c.netBreakEvenCPA&&c.netBreakEvenCPA>0?`<div class="kun96-alert ok">الـCurrent CPA أقل من Net Break Even CPA بمساحة ${money(c.cpaHeadroom)} لكل Order.</div>`:`<div class="kun96-alert warn">الـCurrent CPA عند/فوق Net Break Even CPA؛ Scale الإعلانات بدون تحسين الـUnit Economics قد يضغط الربحية.</div>`}${best?`<div class="kun96-alert info">أولوية الاختبار الحالية حسابيًا: <b>${escapeHtml(best.name)}</b> قبل الحكم على الأداء من ROAS وحده.</div>`:''}${c.targetProfitGap>0?`<div class="kun96-alert info">للوصول إلى Target Net Profit ما زال هناك Gap قدره ${money(c.targetProfitGap)}.</div>`:`<div class="kun96-alert ok">Target Net Profit متحقق بفائض ${money(Math.abs(c.targetProfitGap))}.</div>`}${c.targetMarginGap>0?`<div class="kun96-alert info">Target Margin أعلى من الهامش الحالي بـ ${percent(c.targetMarginGap)} نقطة مئوية.</div>`:`<div class="kun96-alert ok">Target Margin متحقق أو متجاوز.</div>`}</div>`)}
    `;
  }

  function render(){
    if(!active())return;
    const host=root();if(!host)return;
    style();
    const c=calculate(model);
    host.innerHTML=`<div class="kun96-page"><header class="kun96-head"><div><h2>Ecommerce Profitability Calculator</h2><p>من الـOrder للـRealized Revenue للـContribution لحد الـNet Profit — القرار على الـBusiness كله، مش على ROAS لوحده.</p></div><div class="spacer"></div><div class="kun96-actions"><button data-kun96-action="example">تحميل مثال 1000 Order</button><button data-kun96-action="save" class="primary">حفظ البيانات</button><button data-kun96-action="print">طباعة</button><button data-kun96-action="reset">مسح</button></div></header><div class="kun96-process"><div>Orders</div><div>Shipped</div><div>RTO / Returns</div><div>Realized Revenue</div><div>Contribution</div><div>Net Profit</div></div><div class="kun96-layout"><div class="kun96-inputs">${block('1) Actual Business Data — دورة الـOrders','أدخل أعداد الحالات الفعلية لنفس الفترة؛ النسب تُحسب تلقائيًا.',fields('orders'))}${block('2) Revenue & AOV','Gross AOV → Discounts → Net AOV → Realized Revenue.',fields('revenue'))}${block('3) Variable Cost Stack','كل تكلفة تحصل بسبب الـOrder أو الشحنة.',fields('variable'))}${block('4) Marketing Spend','CPA وROAS سيتم حسابهما من Ad Spend والنتائج الفعلية.',fields('marketing'))}${block('5) Fixed Costs / Overhead','رواتب، إيجار، Software وباقي المصروفات الثابتة.',fields('fixed'))}${block('6) Targets & Growth Assumptions','افتراضات Target Scenario والهدف الربحي.',fields('targets'),false)}${block('7) Stress Test Assumptions','ماذا يحدث لو ساءت المؤشرات؟',fields('stress'),false)}</div><aside class="kun96-results" data-kun96-results>${resultHtml(c)}</aside></div></div>`;
    bind();
  }

  function updateResults(){const out=document.querySelector('[data-kun96-results]');if(out)out.innerHTML=resultHtml(calculate(model));}
  function bind(){
    const host=root();if(!host)return;
    host.querySelectorAll('[data-kun96-field]').forEach(input=>input.addEventListener('input',()=>{const key=input.dataset.kun96Field;model[key]=signed(input.value);save();updateResults();}));
    host.querySelectorAll('[data-kun96-action]').forEach(button=>button.addEventListener('click',()=>{
      const action=button.dataset.kun96Action;
      if(action==='save'){save();window.showToast?.('تم حفظ بيانات حاسبة الربحية');return;}
      if(action==='print'){window.print();return;}
      if(action==='reset'){model={...DEFAULTS};save();render();window.showToast?.('تم مسح بيانات الحاسبة');return;}
      if(action==='example'){
        model={...DEFAULTS,totalOrders:1000,cancelledOrders:50,shippedOrders:950,rtoOrders:150,deliveredOrders:800,returnedOrders:16,grossAov:800,discountPercent:3,customerShippingRevenue:0,otherRevenue:0,platformReportedRevenue:800000,cogsPerKept:350,returnedCogsLossPercent:0,packagingPerShipped:10,forwardShippingPerShipped:55,rtoCostPerOrder:35,returnCostPerOrder:40,paymentFeePercent:2,paymentFeeFixed:0,fulfillmentPerShipped:0,otherVariablePerShipped:0,adSpend:120000,salaries:25000,rent:10000,software:5000,warehouseUtilities:3000,agencyFees:0,otherFixed:2000,targetProfit:130000,targetMargin:20,targetRtoRate:10,targetAovLift:10,targetCpaChange:-20,targetCogsChange:-5,targetReturnChange:-20,stressRtoRate:25,stressAovChange:-10,stressCpaChange:20,stressCogsChange:10,stressReturnChange:25};
        save();render();window.showToast?.('تم تحميل مثال الربحية 1000 Order');
      }
    }));
  }

  load();
  const previousSetView=typeof window.setView==='function'?window.setView:null;
  if(previousSetView)window.setView=function(view){const result=previousSetView.apply(this,arguments);if(String(view)===VIEW)setTimeout(render,0);return result;};
  document.addEventListener('click',event=>{const target=event.target.closest?.(`[data-view="${VIEW}"],[data-go="${VIEW}"]`);if(target)setTimeout(render,0);},false);
  if(active())setTimeout(render,0);

  window.KunEcommerceCalculatorV94={version:'96.0',render,calculate:()=>calculate(model),scenario:(opts)=>scenario(calculate(model),opts||{}),impact:()=>impactAnalysis(calculate(model)),get data(){return {...model};},set data(value){model={...DEFAULTS,...(value||{})};save();render();}};
})();
