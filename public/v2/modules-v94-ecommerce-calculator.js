/* Kun Online v96.2 — Arabic E-commerce Profitability Calculator UX refresh. */
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
  const escapeHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]));

  const GROUPS={
    orders:[
      ['totalOrders','إجمالي الطلبات','طلب','كل الطلبات اللي اتعملت في نفس الفترة'],
      ['cancelledOrders','الطلبات الملغاة','طلب','اتلغت قبل الشحن'],
      ['shippedOrders','الطلبات التي تم شحنها','طلب','خرجت فعليًا لشركة الشحن'],
      ['rtoOrders','مرتجعات قبل التسليم (RTO)','طلب','رجعت من شركة الشحن قبل ما العميل يستلم'],
      ['deliveredOrders','الطلبات المسلّمة','طلب','وصلت للعميل فعليًا'],
      ['returnedOrders','مرتجعات بعد التسليم','طلب','العميل استلم وبعدها رجّع الطلب']
    ],
    revenue:[
      ['grossAov','متوسط قيمة الطلب قبل الخصم (AOV)','ج.م','متوسط قيمة الطلب الأصلية قبل الخصومات'],
      ['discountPercent','متوسط نسبة الخصم','%','متوسط الخصم الفعلي على الطلبات'],
      ['customerShippingRevenue','الشحن المحصل من العميل لكل طلب محتفظ به','ج.م','المبلغ اللي العميل بيدفعه كشحن'],
      ['otherRevenue','إيرادات أخرى محققة','ج.م','أي إيراد إضافي حقيقي لنفس الفترة'],
      ['platformReportedRevenue','الإيراد الظاهر في المنصة / Ads Manager','ج.م','الرقم الظاهر في المنصة قبل تصفية الإلغاءات والمرتجعات']
    ],
    variable:[
      ['cogsPerKept','تكلفة المنتج لكل طلب محتفظ به (COGS)','ج.م','تكلفة البضاعة الفعلية للطلب اللي فضل مع العميل'],
      ['returnedCogsLossPercent','نسبة خسارة تكلفة المنتج في مرتجع بعد التسليم','%','الجزء اللي مش هتعرف تسترده من تكلفة المنتج المرتجع'],
      ['packagingPerShipped','تكلفة التغليف لكل شحنة','ج.م','كرتونة وتغليف ومطبوعات'],
      ['forwardShippingPerShipped','تكلفة الشحن ذهاب لكل شحنة','ج.م','تكلفة إرسال الشحنة للعميل'],
      ['rtoCostPerOrder','تكلفة المرتجع قبل التسليم (RTO)','ج.م','تكلفة رجوع الشحنة اللي العميل ما استلمهاش'],
      ['returnCostPerOrder','تكلفة المرتجع بعد التسليم','ج.م','تكلفة رجوع الطلب بعد ما العميل استلمه'],
      ['paymentFeePercent','عمولة الدفع / التحصيل (COD)','%','نسبة شركة الدفع أو التحصيل من الإيراد المحقق'],
      ['paymentFeeFixed','رسوم دفع ثابتة لكل طلب محتفظ به','ج.م','رسوم ثابتة زيادة على النسبة إن وجدت'],
      ['fulfillmentPerShipped','تكلفة التجهيز لكل شحنة','ج.م','تجهيز وPick & Pack ومناولة'],
      ['otherVariablePerShipped','تكلفة متغيرة أخرى لكل شحنة','ج.م','هدايا أو عمولات أو اتصالات مرتبطة بالشحنة']
    ],
    marketing:[
      ['adSpend','الإنفاق الإعلاني','ج.م','إجمالي اللي اتصرف على الإعلانات لنفس الفترة']
    ],
    fixed:[
      ['salaries','الرواتب','ج.م','رواتب نفس الفترة اللي بتحسب عليها'],
      ['rent','الإيجار','ج.م','إيجار المكتب أو المخزن'],
      ['software','البرامج والاشتراكات','ج.م','منصات وأدوات وبرامج مدفوعة'],
      ['warehouseUtilities','المخزن والمرافق','ج.م','كهرباء ومياه وتشغيل ثابت للمخزن'],
      ['agencyFees','أتعاب وكالة / مستقلين','ج.م','أتعاب ثابتة لوكالة أو فريلانسر'],
      ['otherFixed','مصروفات ثابتة أخرى','ج.م','محاسبة وإدارة وأي مصروف ثابت تاني']
    ],
    targets:[
      ['targetProfit','صافي الربح المستهدف','ج.م','الربح اللي عايز توصل له في نفس الفترة'],
      ['targetMargin','هامش صافي الربح المستهدف','%','نسبة صافي الربح اللي عايز تحققها من الإيراد المحقق'],
      ['targetRtoRate','نسبة RTO المستهدفة','%','النسبة اللي عايز توصل لها للمرتجع قبل التسليم'],
      ['targetAovLift','التغيير المستهدف في متوسط الطلب (AOV)','%','مثال: 10 يعني زيادة 10%'],
      ['targetCpaChange','التغيير المستهدف في تكلفة الطلب (CPA)','%','مثال: -20 يعني تقليل CPA بنسبة 20%'],
      ['targetCogsChange','التغيير المستهدف في تكلفة المنتج (COGS)','%','مثال: -5 يعني تقليل تكلفة المنتج 5%'],
      ['targetReturnChange','التغيير المستهدف في مرتجعات ما بعد التسليم','%','مثال: -20 يعني تقليل المرتجعات 20%']
    ],
    stress:[
      ['stressRtoRate','نسبة RTO في السيناريو المتشائم','%','النسبة اللي ممكن توصل لها لو الأداء ساء'],
      ['stressAovChange','تغيير متوسط الطلب في السيناريو المتشائم','%','مثال: -10 يعني AOV أقل 10%'],
      ['stressCpaChange','تغيير CPA في السيناريو المتشائم','%','مثال: 20 يعني CPA أعلى 20%'],
      ['stressCogsChange','تغيير COGS في السيناريو المتشائم','%','مثال: 10 يعني تكلفة المنتج أعلى 10%'],
      ['stressReturnChange','تغيير مرتجعات ما بعد التسليم في السيناريو المتشائم','%','مثال: 25 يعني المرتجعات أعلى 25%']
    ]
  };

  const FIELD_HELP={
    totalOrders:'اكتب إجمالي عدد الطلبات اللي اتعملت في نفس الفترة اللي بتحسب عليها. خلي كل الأرقام في الحاسبة لنفس المدة، زي آخر 30 يوم مثلًا.',
    cancelledOrders:'اكتب الطلبات اللي اتلغت قبل ما تخرج للشحن. ما تحطش هنا الشحنات اللي خرجت ورجعت؛ دي تتحط في RTO.',
    shippedOrders:'اكتب عدد الطلبات اللي خرجت فعليًا لشركة الشحن. الرقم ده يشمل اللي اتسلّم واللي رجع RTO واللي لسه في الطريق.',
    rtoOrders:'اكتب الشحنات اللي خرجت للشحن ورجعت قبل ما العميل يستلم. دي غير المرتجع بعد التسليم.',
    deliveredOrders:'اكتب عدد الشحنات اللي شركة الشحن سجلتها تم التسليم للعميل. قبل خصم المرتجعات اللي حصلت بعد التسليم.',
    returnedOrders:'اكتب الطلبات اللي العميل استلمها فعلًا وبعد كده رجعها أو طلب Refund. ما تدخلش RTO هنا.',
    grossAov:'اكتب متوسط قيمة الطلب قبل الخصم. لو عندك إجمالي قيمة الطلبات قبل الخصومات اقسمها على عدد الطلبات.',
    discountPercent:'اكتب متوسط نسبة الخصم الفعلية على الطلبات. لو مفيش خصومات حط 0.',
    customerShippingRevenue:'اكتب متوسط الشحن اللي بتحصله من العميل للطلب اللي فضل معاه. دي فلوس داخلة، مش تكلفة شركة الشحن.',
    otherRevenue:'أي إيراد فعلي إضافي مرتبط بنفس الفترة ومش داخل في قيمة الطلبات، زي رسوم خدمة أو دخل إضافي واضح. لو مفيش حط 0.',
    platformReportedRevenue:'اكتب الإيراد اللي المنصة أو Ads Manager بيعرضه قبل ما تصفي الإلغاءات وRTO والمرتجعات. الخانة دي للمقارنة بين الإيراد الظاهر والإيراد الحقيقي.',
    cogsPerKept:'اكتب تكلفة البضاعة الفعلية للطلب اللي العميل احتفظ بيه: سعر شراء أو تصنيع المنتج وتكلفته المباشرة. ما تضيفش الإعلان أو الشحن هنا.',
    returnedCogsLossPercent:'لو المنتج المرتجع بعد التسليم ممكن يرجع للمخزون كامل حط 0%. لو جزء من تكلفته بيضيع بسبب تلف أو فتح أو إعادة تجهيز، اكتب النسبة اللي بتخسرها.',
    packagingPerShipped:'اكتب تكلفة الكرتونة والتغليف والاستيكر والمطبوعات لكل شحنة بتخرج، حتى لو الشحنة رجعت.',
    forwardShippingPerShipped:'اكتب تكلفة إرسال الشحنة من عندك للعميل لكل شحنة خرجت. ما تضيفش تكلفة رجوع RTO هنا.',
    rtoCostPerOrder:'اكتب اللي شركة الشحن بتحمله عليك لما الشحنة ترجع قبل التسليم، شامل الرجوع أو المحاولة لو محسوبة عليك.',
    returnCostPerOrder:'اكتب تكلفة رجوع الطلب بعد ما العميل يكون استلمه: شحن رجوع، استلام، فحص أو إعادة تجهيز لو بتتحسب لكل مرتجع.',
    paymentFeePercent:'اكتب نسبة عمولة الدفع الإلكتروني أو تحصيل COD اللي بتتخصم من الإيراد المحقق. مثال 2 يعني 2%.',
    paymentFeeFixed:'لو فيه مبلغ ثابت بيتخصم مع كل طلب متسلم فوق النسبة، اكتبه هنا. لو مفيش حط 0.',
    fulfillmentPerShipped:'اكتب تكلفة تجهيز ومناولة الشحنة الواحدة لو بتدفع Pick & Pack أو Fulfillment لكل شحنة.',
    otherVariablePerShipped:'أي تكلفة بتزيد مع كل شحنة ومش موجودة فوق، زي هدية أو عمولة أو تكلفة اتصال مرتبطة بالطلب.',
    adSpend:'اكتب إجمالي الإنفاق الإعلاني لنفس الفترة بالظبط. الحاسبة هتطلع CPA وROAS تلقائي من الأرقام الفعلية.',
    salaries:'إجمالي الرواتب اللي تخص نفس الفترة. لو بتحسب شهر، حط رواتب الشهر.',
    rent:'إيجار المكتب أو المخزن لنفس الفترة. لو الإيجار سنوي قسمه على المدة اللي بتحسب عليها.',
    software:'اشتراكات البرامج والمنصات والأدوات المدفوعة لنفس الفترة، زي المتجر أو CRM أو أدوات التحليل.',
    warehouseUtilities:'المصاريف الثابتة لتشغيل المخزن أو المكتب زي كهرباء ومياه وإنترنت لو بتعتبرها ضمن التشغيل.',
    agencyFees:'أتعاب ثابتة لوكالة تسويق أو مستقلين خلال نفس الفترة. الإنفاق الإعلاني نفسه يتحط في خانة الإنفاق الإعلاني.',
    otherFixed:'أي مصروف ثابت مش بيتغير مباشرة مع عدد الطلبات ومش موجود فوق، زي المحاسبة أو الإدارة.',
    targetProfit:'اكتب صافي الربح اللي نفسك توصل له في نفس الفترة. الحاسبة هتقارن الهدف بالنتيجة الحالية وتقولك الفجوة.',
    targetMargin:'اكتب هامش صافي الربح المستهدف كنسبة من الإيراد المحقق. مثال 20 يعني عايز 20% صافي ربح.',
    targetRtoRate:'اكتب نسبة RTO اللي عايز توصل لها من الشحنات المشحونة. مثال 10 يعني هدفك RTO = 10%.',
    targetAovLift:'اكتب التغيير اللي مستهدفه في متوسط قيمة الطلب. رقم موجب للزيادة وسالب للنقص، مثال 10 يعني +10%.',
    targetCpaChange:'اكتب التغيير المستهدف في CPA. لو عايز تقلله 20% اكتب -20، ولو متوقع يزيد 10% اكتب 10.',
    targetCogsChange:'اكتب التغيير المستهدف في تكلفة المنتج. -5 يعني قدرت تقلل COGS بنسبة 5%.',
    targetReturnChange:'اكتب التغيير المستهدف في المرتجعات بعد التسليم. -20 يعني تقليلها 20% عن الوضع الحالي.',
    stressRtoRate:'دي نسبة RTO اللي عايز تختبر عليها أسوأ سيناريو منطقي. استخدمها عشان تعرف البيزنس يستحمل لحد فين.',
    stressAovChange:'اكتب قد إيه متوسط الطلب ممكن ينخفض في السيناريو المتشائم. مثال -10 يعني AOV أقل 10%.',
    stressCpaChange:'اكتب قد إيه CPA ممكن يزيد لو الإعلانات ساءت. مثال 20 يعني تكلفة الطلب أعلى 20%.',
    stressCogsChange:'اكتب قد إيه تكلفة المنتج ممكن تزيد في السيناريو المتشائم. مثال 10 يعني COGS أعلى 10%.',
    stressReturnChange:'اكتب قد إيه مرتجعات ما بعد التسليم ممكن تزيد في السيناريو المتشائم. مثال 25 يعني زيادة 25%.'
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
    if(total>0&&cancelled>total)warnings.push('الطلبات الملغاة أكبر من إجمالي الطلبات؛ راجع الأرقام.');
    if(total>0&&shipped>total)warnings.push('الطلبات المشحونة أكبر من إجمالي الطلبات؛ راجع الأرقام.');
    if(rto>shipped)warnings.push('مرتجعات RTO أكبر من الطلبات المشحونة؛ راجع الأرقام.');
    if(delivered>shipped)warnings.push('الطلبات المسلّمة أكبر من الطلبات المشحونة؛ راجع الأرقام.');
    if(returned>delivered)warnings.push('مرتجعات ما بعد التسليم أكبر من الطلبات المسلّمة؛ راجع الأرقام.');
    if(shipped>0&&rto+delivered>shipped)warnings.push('إجمالي RTO + المسلّم أكبر من المشحون؛ راجع تصنيف حالات الشحن.');
    if(total>0&&cancelled+shipped>total)warnings.push('الملغي + المشحون أكبر من إجمالي الطلبات؛ ممكن يكون فيه تداخل في الحالات.');
    if(platformRevenue>0&&realizedRevenue>platformRevenue*1.05)warnings.push('الإيراد المحقق أعلى من الإيراد الظاهر في المنصة بأكثر من 5%؛ راجع الإيرادات الأخرى والشحن المحصل من العميل.');
    if(inTransit>0)warnings.push(`${fmt(inTransit,0)} طلب مشحون لسه ما اتصنّفش كمسلّم أو RTO؛ غالبًا لسه في الطريق أو قيد المتابعة.`);

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
      ['الوصول لنسبة RTO المستهدفة',`${percent(c.rtoRate)} → ${percent(model.targetRtoRate)}`,targetRto],
      ['تقليل RTO خمس نقاط',`${percent(c.rtoRate)} → ${percent(Math.max(0,c.rtoRate-5))}`,lowRto],
      ['رفع متوسط قيمة الطلب 10%','زيادة AOV بنسبة 10%',aovUp],
      ['خفض متوسط قيمة الطلب 10%','تقليل AOV بنسبة 10%',aovDown],
      ['خفض تكلفة الطلب الإعلانية 20%','تقليل CPA بنسبة 20%',cpaDown],
      ['زيادة تكلفة الطلب الإعلانية 20%','زيادة CPA بنسبة 20%',cpaUp],
      ['خفض تكلفة المنتج 10%','تقليل COGS بنسبة 10%',cogsDown],
      ['زيادة تكلفة المنتج 10%','زيادة COGS بنسبة 10%',cogsUp],
      ['خفض مرتجعات ما بعد التسليم 20%','تقليل المرتجعات 20%',returnsDown],
      ['زيادة مرتجعات ما بعد التسليم 20%','زيادة المرتجعات 20%',returnsUp]
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

  const CORE_FIELDS=['totalOrders','shippedOrders','rtoOrders','deliveredOrders','grossAov','cogsPerKept','forwardShippingPerShipped','adSpend'];
  const SECTION_NAV=[
    ['orders','التشغيل','الطلبات وحالاتها'],
    ['revenue','الإيراد','القيمة والخصومات'],
    ['variable','التكاليف','المتغيرة والشحن'],
    ['marketing','الإعلانات','الإنفاق والأداء'],
    ['fixed','الثابتة','المصاريف الشهرية'],
    ['targets','الهدف','سيناريو النمو'],
    ['stress','الضغط','أسوأ سيناريو']
  ];
  function entryProgress(){
    const filled=CORE_FIELDS.filter(key=>Math.abs(signed(model[key]))>0).length;
    return {filled,total:CORE_FIELDS.length,percent:Math.round(filled/CORE_FIELDS.length*100)};
  }
  function quickSummary(c){
    const progress=entryProgress(),hasData=progress.filled>=3;
    const profitable=c.netProfit>=0;
    const cpaOk=c.netBreakEvenCPA>0&&c.currentCPA<=c.netBreakEvenCPA;
    const status=!hasData?'ابدأ بإدخال بياناتك':profitable?'الوضع الحالي مربح':'الوضع الحالي محتاج مراجعة';
    const statusClass=!hasData?'neutral':profitable?'good':'bad';
    return `<section class="kun96-overview" aria-label="ملخص سريع">
      <div class="kun96-overview-top">
        <div>
          <span class="kun96-eyebrow">ملخص سريع</span>
          <div class="kun96-status-row"><span class="kun96-status ${statusClass}"><i></i>${status}</span><span class="kun96-autosave" data-kun96-save-state aria-live="polite">الحفظ تلقائي</span></div>
        </div>
        <div class="kun96-progress-wrap" title="اكتمال أهم البيانات الأساسية">
          <div class="kun96-progress-copy"><b>${progress.filled}/${progress.total}</b><span>بيانات أساسية</span></div>
          <div class="kun96-progress"><span style="width:${progress.percent}%"></span></div>
        </div>
      </div>
      <div class="kun96-overview-grid">
        <div class="kun96-overview-kpi"><span>صافي الربح</span><strong class="${hasData?(profitable?'pos':'neg'):''}">${hasData?money(c.netProfit):'—'}</strong><small>${hasData?`هامش ${percent(c.netMargin)}`:'هيظهر بعد إدخال البيانات'}</small></div>
        <div class="kun96-overview-kpi"><span>CPA الحالي</span><strong>${hasData?money(c.currentCPA):'—'}</strong><small>${hasData&&c.netBreakEvenCPA>0?`التعادل عند ${money(c.netBreakEvenCPA)}`:'تكلفة الطلب الإعلانية'}</small></div>
        <div class="kun96-overview-kpi"><span>ROAS الحقيقي</span><strong>${hasData?multiple(c.realizedROAS):'—'}</strong><small>${hasData&&c.realizedBreakEvenROAS>0?`التعادل ${multiple(c.realizedBreakEvenROAS)}`:'بعد الإلغاءات والمرتجعات'}</small></div>
        <div class="kun96-overview-kpi"><span>مساحة CPA</span><strong class="${hasData?(cpaOk?'pos':'neg'):''}">${hasData&&c.netBreakEvenCPA>0?money(c.cpaHeadroom):'—'}</strong><small>${hasData&&c.netBreakEvenCPA>0?(cpaOk?'لسه فيه مساحة قبل التعادل':'فوق أو عند نقطة التعادل'):'هتظهر بعد اكتمال البيانات'}</small></div>
      </div>
    </section>`;
  }
  function sectionNav(){
    return `<nav class="kun96-stepnav" aria-label="انتقل بين أقسام الحاسبة">${SECTION_NAV.map(([id,label,sub],index)=>`<button type="button" data-kun96-jump="${id}"><span>${index+1}</span><b>${label}</b><small>${sub}</small></button>`).join('')}</nav>`;
  }

  function field([key,label,unit,placeholder]){
    const value=model[key]??'';
    const allowNegative=key.includes('Change')||key==='targetAovLift';
    const help=FIELD_HELP[key]||placeholder||'اكتب القيمة الفعلية لنفس الفترة اللي بتحسب عليها.';
    const helpId=`kun96-help-${key}`;
    return `<div class="kun96-field"><div class="kun96-field-head"><span>${escapeHtml(label)}</span><button type="button" class="kun96-help-btn" data-kun96-help="${escapeHtml(key)}" aria-label="شرح خانة ${escapeHtml(label)}" aria-describedby="${helpId}" aria-expanded="false">!</button><div class="kun96-tooltip" id="${helpId}" role="tooltip">${escapeHtml(help)}</div></div><label class="kun96-input-wrap"><input type="number" step="any" ${allowNegative?'':'min="0"'} data-kun96-field="${escapeHtml(key)}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" aria-label="${escapeHtml(label)}"><em>${escapeHtml(unit)}</em></label></div>`;
  }
  function fields(group){return `<div class="kun96-fields">${GROUPS[group].map(field).join('')}</div>`;}
  function block(title,sub,content,open=true,id=''){return `<details class="kun96-block" ${id?`id="kun96-section-${escapeHtml(id)}"`:''} ${open?'open':''}><summary><div><b>${title}</b><small>${sub}</small></div><span class="kun96-chevron" aria-hidden="true">⌄</span></summary><div class="kun96-block-body">${content}</div></details>`;}
  function kpi(label,value,cls='',hint=''){return `<div class="kun96-kpi ${cls}"><span>${label}</span><strong>${value}</strong>${hint?`<small>${hint}</small>`:''}</div>`;}
  function row(label,value,cls=''){return `<div class="kun96-row ${cls}"><span>${label}</span><b>${value}</b></div>`;}

  function style(){
    if(document.getElementById('kunEcomCalc96Style'))return;
    const s=document.createElement('style');s.id='kunEcomCalc96Style';s.textContent=`
      .kun94-subnav{font-size:12px!important;padding-inline-start:24px!important;opacity:.9}.kun94-subnav::before{content:'↳';margin-inline-end:7px;opacity:.55}
      .kun96-page{direction:rtl;display:grid;gap:16px;color:#0f172a}.kun96-page *{box-sizing:border-box}
      .kun96-head{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:18px;align-items:center;padding:18px 20px;border:1px solid #e2e8f0;border-radius:20px;background:linear-gradient(135deg,#fff 0%,#f8fafc 100%)}
      .kun96-titleline{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.kun96-head h2{margin:0;font-size:24px;letter-spacing:-.25px}.kun96-head p{margin:7px 0 0;color:#64748b;font-size:12.5px;line-height:1.8;max-width:760px}.kun96-version{font-size:9px;font-weight:900;padding:4px 8px;border-radius:999px;background:#eef2ff;color:#3730a3}
      .kun96-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}.kun96-actions button{min-height:40px;border:1px solid #dbe3ea;background:#fff;border-radius:12px;padding:9px 13px;font:inherit;font-size:11px;font-weight:850;cursor:pointer;transition:.18s ease}.kun96-actions button:hover{transform:translateY(-1px);border-color:#94a3b8}.kun96-actions button.primary{background:#0f172a;color:#fff;border-color:#0f172a}.kun96-actions button.danger{color:#b91c1c;background:#fff7f7;border-color:#fecaca}
      .kun96-overview{border:1px solid #dbe3ea;border-radius:20px;background:#fff;padding:16px;display:grid;gap:14px}.kun96-overview-top{display:flex;gap:14px;align-items:center;justify-content:space-between;flex-wrap:wrap}.kun96-eyebrow{display:block;color:#64748b;font-size:9.5px;font-weight:900;margin-bottom:5px}.kun96-status-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.kun96-status{display:inline-flex;align-items:center;gap:7px;padding:6px 10px;border-radius:999px;font-size:11px;font-weight:900}.kun96-status i{width:7px;height:7px;border-radius:50%;background:currentColor}.kun96-status.good{background:#ecfdf3;color:#15803d}.kun96-status.bad{background:#fef2f2;color:#b91c1c}.kun96-status.neutral{background:#f1f5f9;color:#475569}.kun96-autosave{font-size:9.5px;color:#64748b;padding:5px 8px;border:1px solid #e2e8f0;border-radius:999px;background:#fff}
      .kun96-progress-wrap{display:flex;align-items:center;gap:10px;min-width:210px}.kun96-progress-copy{display:grid;line-height:1.2;text-align:left}.kun96-progress-copy b{font-size:12px}.kun96-progress-copy span{font-size:9px;color:#64748b}.kun96-progress{width:118px;height:7px;background:#e2e8f0;border-radius:999px;overflow:hidden}.kun96-progress span{display:block;height:100%;background:#0f172a;border-radius:999px;transition:width .2s ease}
      .kun96-overview-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px}.kun96-overview-kpi{padding:13px 14px;border:1px solid #edf0f3;border-radius:15px;background:#fbfcfd;min-width:0}.kun96-overview-kpi span{display:block;font-size:9.5px;color:#64748b;font-weight:850}.kun96-overview-kpi strong{display:block;font-size:20px;margin:4px 0 2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.kun96-overview-kpi strong.pos{color:#15803d}.kun96-overview-kpi strong.neg{color:#b91c1c}.kun96-overview-kpi small{font-size:8.8px;color:#64748b;line-height:1.5}
      .kun96-stepnav{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:7px;padding:6px;border:1px solid #e2e8f0;border-radius:17px;background:#f8fafc}.kun96-stepnav button{display:grid;grid-template-columns:28px minmax(0,1fr);grid-template-rows:auto auto;column-gap:7px;align-items:center;text-align:right;border:1px solid transparent;border-radius:12px;background:transparent;padding:8px 9px;cursor:pointer;font:inherit;min-width:0}.kun96-stepnav button:hover,.kun96-stepnav button:focus-visible{background:#fff;border-color:#dbe3ea;outline:none}.kun96-stepnav button>span{grid-row:1/3;width:28px;height:28px;border-radius:9px;background:#fff;border:1px solid #e2e8f0;display:grid;place-items:center;font-size:10px;font-weight:900}.kun96-stepnav b{font-size:10.5px;white-space:nowrap}.kun96-stepnav small{font-size:8px;color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .kun96-process{position:relative;display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:0;padding:12px 8px;border:1px solid #e2e8f0;border-radius:17px;background:#fff;overflow:hidden}.kun96-process::before{content:'';position:absolute;right:9%;left:9%;top:27px;height:2px;background:#e2e8f0}.kun96-process div{position:relative;z-index:1;display:grid;justify-items:center;gap:6px;font-size:9.5px;font-weight:850;color:#475569;text-align:center}.kun96-process div::before{content:attr(data-step);width:30px;height:30px;border-radius:50%;display:grid;place-items:center;background:#fff;border:2px solid #cbd5e1;color:#334155;font-size:9px}
      .kun96-layout{display:grid;grid-template-columns:minmax(0,1.12fr) minmax(390px,.88fr);gap:16px;align-items:start}.kun96-inputs,.kun96-results{display:grid;gap:12px}.kun96-results{position:sticky;top:72px;max-height:calc(100vh - 86px);overflow:auto;padding-inline-start:2px;scrollbar-width:thin}
      .kun96-block{scroll-margin-top:82px;border:1px solid #e2e8f0;border-radius:18px;background:#fff;overflow:visible;box-shadow:0 1px 2px rgba(15,23,42,.02)}.kun96-block[open]{border-color:#d5dde6}.kun96-block summary{list-style:none;cursor:pointer;padding:15px 16px;display:flex;justify-content:space-between;align-items:center;gap:10px;user-select:none}.kun96-block summary::-webkit-details-marker{display:none}.kun96-block summary b{display:block;font-size:13.5px}.kun96-block summary small{display:block;color:#64748b;font-size:9.5px;margin-top:4px;line-height:1.5}.kun96-chevron{width:28px;height:28px;border:1px solid #e2e8f0;border-radius:9px;display:grid;place-items:center;color:#64748b;transition:transform .18s ease}.kun96-block[open] .kun96-chevron{transform:rotate(180deg)}.kun96-block-body{padding:2px 16px 17px}
      .kun96-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.kun96-field{display:grid;gap:7px;min-width:0}.kun96-field-head{position:relative;display:flex;align-items:center;gap:6px;min-height:27px}.kun96-field-head>span{font-size:10.5px;color:#334155;font-weight:850;line-height:1.5}.kun96-help-btn{width:25px;height:25px;min-width:25px;border:1px solid #d5dde6;border-radius:999px;background:#f8fafc;color:#475569;font:900 12px/1 inherit;padding:0;display:inline-grid;place-items:center;cursor:help;transition:.16s ease}.kun96-help-btn:hover,.kun96-help-btn:focus-visible,.kun96-field-head[data-open="1"] .kun96-help-btn{background:#0f172a;color:#fff;border-color:#0f172a;outline:none}.kun96-tooltip{display:none;position:absolute;z-index:100;top:calc(100% + 6px);right:0;width:min(330px,calc(100vw - 56px));padding:11px 13px;border-radius:12px;background:#0f172a;color:#fff;font-size:10.5px;font-weight:650;line-height:1.85;box-shadow:0 12px 34px rgba(15,23,42,.22);text-align:right}.kun96-field-head:hover .kun96-tooltip,.kun96-field-head:focus-within .kun96-tooltip,.kun96-field-head[data-open="1"] .kun96-tooltip{display:block}
      .kun96-input-wrap{display:grid;grid-template-columns:minmax(0,1fr) auto;border:1px solid #cfd8e3;border-radius:12px;overflow:hidden;background:#fff;transition:border-color .16s ease,box-shadow .16s ease}.kun96-input-wrap:focus-within{border-color:#64748b;box-shadow:0 0 0 3px rgba(100,116,139,.10)}.kun96-input-wrap input{border:0!important;border-radius:0!important;min-width:0;min-height:45px;padding:11px 12px!important;font-size:14px!important;font-weight:750!important;background:transparent!important;color:#0f172a!important}.kun96-input-wrap input::placeholder{color:#b1bac6;font-weight:500}.kun96-input-wrap em{font-style:normal;display:flex;align-items:center;padding:0 11px;background:#f8fafc;border-inline-start:1px solid #e2e8f0;font-size:9.5px;font-weight:850;color:#64748b;white-space:nowrap}
      .kun96-kpis{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.kun96-kpi{border:1px solid #e2e8f0;border-radius:14px;padding:12px 13px;background:#fff;display:grid;gap:4px;min-width:0}.kun96-kpi span{font-size:9.5px;color:#64748b;font-weight:850}.kun96-kpi strong{font-size:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.kun96-kpi small{font-size:8.8px;color:#64748b;line-height:1.5}.kun96-kpi.good{background:#f8fff9;border-color:#d9f3df}.kun96-kpi.good strong{color:#15803d}.kun96-kpi.bad{background:#fffafa;border-color:#fee2e2}.kun96-kpi.bad strong{color:#b91c1c}.kun96-kpi.focus{background:#f8fafc;border-color:#cbd5e1}.kun96-kpi.focus strong{color:#0f172a}
      .kun96-row{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;padding:9px 0;border-bottom:1px dashed #e2e8f0;font-size:10.5px}.kun96-row:last-child{border-bottom:0}.kun96-row span{color:#475569}.kun96-row b{font-size:11.5px;text-align:left;white-space:nowrap}.kun96-row.good b{color:#15803d}.kun96-row.bad b{color:#b91c1c}
      .kun96-waterfall{display:grid;gap:8px}.kun96-bar{display:grid;grid-template-columns:150px 1fr 92px;gap:9px;align-items:center;font-size:9.5px}.kun96-track{height:9px;border-radius:999px;background:#f1f5f9;overflow:hidden}.kun96-fill{height:100%;background:#64748b;border-radius:999px}.kun96-fill.positive{background:#16a34a}.kun96-fill.negative{background:#dc2626}.kun96-bar b{text-align:left}
      .kun96-impact{overflow:auto;border:1px solid #eef2f7;border-radius:12px}.kun96-impact table{width:100%;border-collapse:collapse;font-size:9.5px;min-width:550px}.kun96-impact th,.kun96-impact td{padding:9px;border-bottom:1px solid #eef2f7;text-align:right}.kun96-impact th{color:#64748b;background:#f8fafc;position:sticky;top:0}.kun96-impact .up{color:#15803d;font-weight:850}.kun96-impact .down{color:#b91c1c;font-weight:850}.kun96-scenarios{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.kun96-scenario{border:1px solid #e2e8f0;border-radius:14px;padding:12px;background:#fff}.kun96-scenario.target{background:#f4fff6;border-color:#d9f3df}.kun96-scenario.stress{background:#fffaf5;border-color:#ffedd5}.kun96-scenario h4{margin:0 0 8px;font-size:11.5px}.kun96-scenario strong{display:block;font-size:16px;margin-bottom:6px}.kun96-scenario small{display:block;font-size:9px;color:#64748b;line-height:1.7}
      .kun96-alert{padding:10px 12px;border-radius:12px;font-size:10.5px;line-height:1.75;margin-bottom:8px}.kun96-alert.warn{background:#fff8f1;border:1px solid #fed7aa;color:#9a3412}.kun96-alert.ok{background:#f3fff5;border:1px solid #bbf7d0;color:#166534}.kun96-alert.info{background:#f6f8ff;border:1px solid #dbe4ff;color:#1e40af}.kun96-decision{display:grid;gap:8px}.kun96-formula{font-size:9.5px;color:#475569;line-height:1.8;background:#f8fafc;border:1px solid #e2e8f0;border-radius:11px;padding:11px}
      @media(max-width:1180px){.kun96-layout{grid-template-columns:1fr}.kun96-results{position:static;max-height:none;overflow:visible}.kun96-overview-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.kun96-stepnav{grid-template-columns:repeat(4,minmax(0,1fr))}}
      @media(max-width:720px){.kun96-page{gap:12px}.kun96-head{grid-template-columns:1fr;padding:15px}.kun96-head h2{font-size:19px}.kun96-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));width:100%}.kun96-actions button{width:100%;min-height:44px}.kun96-actions button.primary{grid-column:1/-1;grid-row:1}.kun96-overview{padding:13px}.kun96-overview-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.kun96-progress-wrap{width:100%;justify-content:space-between}.kun96-progress{flex:1}.kun96-stepnav{display:flex;overflow:auto;scroll-snap-type:x proximity;padding:6px}.kun96-stepnav button{min-width:145px;scroll-snap-align:start}.kun96-process{grid-template-columns:repeat(3,1fr);row-gap:14px}.kun96-process::before{display:none}.kun96-fields,.kun96-kpis{grid-template-columns:1fr}.kun96-scenarios{grid-template-columns:1fr}.kun96-bar{grid-template-columns:112px 1fr 78px}.kun96-tooltip{position:fixed;top:auto;right:18px;left:18px;bottom:18px;width:auto;font-size:11px}.kun96-input-wrap input{min-height:48px;font-size:16px!important}}
      @media(max-width:420px){.kun96-overview-grid{grid-template-columns:1fr}.kun96-actions{grid-template-columns:1fr}.kun96-actions button.primary{grid-column:auto}.kun96-process{grid-template-columns:repeat(2,1fr)}.kun96-head p{font-size:11.5px}}
      @media print{.nav,.topbar,.kun96-actions,.kun96-stepnav{display:none!important}.kun96-head,.kun96-overview{border:0;padding:0}.kun96-layout{grid-template-columns:1fr}.kun96-results{position:static;max-height:none;overflow:visible}.kun96-block{break-inside:avoid}}
    `;document.head.appendChild(s);
  }

  function costWaterfall(c){
      const items=[['الإيراد المحقق',c.realizedRevenue,'positive'],['تكلفة المنتجات (COGS)',-c.cogs,'negative'],['تكلفة الشحن ذهاب',-c.forwardShipping,'negative'],['التغليف',-c.packaging,'negative'],['مرتجعات قبل التسليم (RTO)',-c.rtoCost,'negative'],['مرتجعات بعد التسليم',-c.returnCost,'negative'],['عمولات الدفع والتحصيل',-c.paymentFees,'negative'],['التجهيز + تكاليف متغيرة أخرى',-(c.fulfillment+c.otherVariable),'negative'],['الإعلانات',-c.adSpend,'negative'],['المصروفات الثابتة',-c.fixedCosts,'negative'],['صافي الربح',c.netProfit,c.netProfit>=0?'positive':'negative']];
      const max=Math.max(1,...items.map(x=>Math.abs(x[1])));
      return `<div class="kun96-waterfall">${items.map(([label,value,cls])=>`<div class="kun96-bar"><span>${label}</span><div class="kun96-track"><div class="kun96-fill ${cls}" style="width:${clamp(Math.abs(value)/max*100,1,100)}%"></div></div><b>${money(value)}</b></div>`).join('')}</div>`;
  }

  function resultHtml(c){
      const impact=impactAnalysis(c),plan=scenarios(c);
      const status=c.netProfit>=0?'good':'bad';
      const breakEvenStatus=c.currentCPA<=c.netBreakEvenCPA&&c.netBreakEvenCPA>0?'good':'bad';
      const best=impact.best;
      const impactRows=impact.rows.map(x=>`<tr><td>${escapeHtml(x.name)}</td><td>${escapeHtml(x.change)}</td><td>${money(x.result.netProfit)}</td><td class="${x.delta>=0?'up':'down'}">${x.delta>=0?'+':''}${money(x.delta)}</td></tr>`).join('');
      const alerts=c.warnings.length?c.warnings.map(x=>`<div class="kun96-alert warn">${escapeHtml(x)}</div>`).join(''):`<div class="kun96-alert ok">تسلسل حالات الطلبات متناسق حسابيًا حسب البيانات اللي دخلتها.</div>`;
      const leakageTotal=c.discountLeakage+c.cancellationValue+c.rtoValue+c.returnsValue;
      const scenarioCard=(name,x,cls)=>`<div class="kun96-scenario ${cls}"><h4>${name}</h4><strong>${money(x.netProfit)}</strong><small>هامش صافي الربح: ${percent(x.netMargin)}</small><small>الإيراد المحقق: ${money(x.realizedRevenue)}</small><small>تكلفة الطلب (CPA): ${money(x.currentCPA)}</small><small>CPA عند التعادل: ${money(x.netBreakEvenCPA)}</small><small>العائد الحقيقي على الإعلان (ROAS): ${multiple(x.realizedROAS)}</small></div>`;
      return `
        <section class="kun96-block"><div class="kun96-block-body" style="padding-top:16px"><div class="kun96-kpis">
          ${kpi('الإيراد المحقق فعليًا',money(c.realizedRevenue),'focus',`من ${fmt(c.keptOrders,0)} طلب احتفظ به العميل`)}
          ${kpi('صافي الربح',money(c.netProfit),status,`هامش صافي الربح ${percent(c.netMargin)}`)}
          ${kpi('ربح المساهمة',money(c.contributionProfit),c.contributionProfit>=0?'good':'bad','بعد التكاليف المتغيرة والإعلانات وقبل المصروفات الثابتة')}
          ${kpi('العائد الحقيقي على الإعلان (ROAS)',multiple(c.realizedROAS),c.realizedROAS>=c.realizedBreakEvenROAS?'good':'bad',`ROAS الظاهر في المنصة ${multiple(c.platformROAS)}`)}
        </div></div></section>
  
        ${block('رحلة الطلب من البداية للنهاية','من إنشاء الطلب لحد الطلب اللي اتسلّم وفضل مع العميل',`
          ${row('إجمالي الطلبات',fmt(c.totalOrders,0))}${row(`الملغاة (${percent(c.cancellationRate)})`,fmt(c.cancelledOrders,0),'bad')}${row(`المشحونة (${percent(c.shippingRate)} من الإجمالي)`,fmt(c.shippedOrders,0))}${row(`مرتجع قبل التسليم RTO (${percent(c.rtoRate)} من المشحون)`,fmt(c.rtoOrders,0),'bad')}${row(`تم التسليم (${percent(c.deliveryRate)} من المشحون)`,fmt(c.deliveredOrders,0),'good')}${row(`مرتجع بعد التسليم (${percent(c.returnRate)})`,fmt(c.returnedOrders,0),'bad')}${row(`طلبات محتفظ بها فعليًا (${percent(c.keptRate)} من الإجمالي)`,fmt(c.keptOrders,0),'good')}${row('في الطريق / غير مصنفة بعد',fmt(c.inTransitOrders,0))}<div style="margin-top:10px">${alerts}</div>
        `)}
  
        ${block('جودة الإيراد','الفرق بين الإيراد الظاهر في المنصة والإيراد اللي فضل فعليًا بعد الإلغاءات والمرتجعات',`
          ${row('متوسط قيمة الطلب قبل الخصم (AOV)',money(c.grossAov))}${row('متوسط قيمة الطلب بعد الخصم',money(c.netAov))}${row('الإيراد الظاهر في المنصة',money(c.platformRevenue))}${row('الإيراد المحقق فعليًا',money(c.realizedRevenue),'good')}${row('الفجوة بين الظاهر والمحقق',money(c.revenueGap),c.revenueGap>0?'bad':'')}${row('قيمة الخصومات',money(c.discountLeakage))}${row('قيمة محتملة ضاعت من الإلغاءات',money(c.cancellationValue))}${row('قيمة محتملة ضاعت من RTO',money(c.rtoValue))}${row('قيمة مرتجعات ما بعد التسليم',money(c.returnsValue))}${row('إجمالي إشارات تسريب الإيراد',money(leakageTotal),'bad')}
        `)}
  
        ${block('رحلة الربح من الإيراد لصافي الربح','كل طبقة تكلفة وتأثيرها على النتيجة النهائية',costWaterfall(c))}
  
        ${block('اقتصاديات الإعلانات ونقطة التعادل','مش بس الطلب بيكلفك كام؛ الأهم أقصى تكلفة إعلان تقدر تستحملها قبل الخسارة',`
          <div class="kun96-kpis">${kpi('CPA الحالي لكل طلب وارد',money(c.currentCPA),'',`CPA لكل طلب مشحون ${money(c.shippedCPA)}`)}${kpi('CPA عند نقطة التعادل بعد كل التكاليف',money(c.netBreakEvenCPA),breakEvenStatus,`المساحة المتاحة ${money(c.cpaHeadroom)} (${percent(c.cpaHeadroomPercent)})`)}${kpi('CPA لكل طلب مسلّم',money(c.deliveredCPA),'',`CPA لكل طلب محتفظ به ${money(c.keptCPA)}`)}${kpi('CPA عند تعادل ربح المساهمة',money(c.contributionBreakEvenCPA),'','قبل المصروفات الثابتة')}${kpi('ROAS الحقيقي عند نقطة التعادل',multiple(c.realizedBreakEvenROAS),'','مبني على الإيراد المحقق')}${kpi('ROAS الظاهر عند نقطة التعادل',multiple(c.platformBreakEvenROAS),'','للمقارنة فقط مع إيراد المنصة')}</div>
          <div class="kun96-formula" style="margin-top:10px">الحد الأقصى للإنفاق الإعلاني عند التعادل = هامش المساهمة قبل الإعلانات − المصروفات الثابتة. وبعدها بنقسمه على إجمالي الطلبات علشان نطلع CPA عند التعادل. عشان كده الـCPA المقبول بيتغير مع AOV وRTO والمرتجعات وتكلفة المنتج وباقي التكاليف.</div>
        `)}
  
        ${block('اقتصاديات الطلب الواحد','الربحية الحقيقية لكل مرحلة من مراحل الطلب',`${row('الإيراد المحقق لكل طلب وارد',money(c.realizedRevenuePerPlaced))}${row('صافي الربح لكل طلب وارد',money(c.profitPerPlaced),c.profitPerPlaced>=0?'good':'bad')}${row('صافي الربح لكل طلب مشحون',money(c.profitPerShipped),c.profitPerShipped>=0?'good':'bad')}${row('صافي الربح لكل طلب مسلّم',money(c.profitPerDelivered),c.profitPerDelivered>=0?'good':'bad')}${row('صافي الربح لكل طلب محتفظ به',money(c.profitPerKept),c.profitPerKept>=0?'good':'bad')}${row('نسبة التكاليف المتغيرة',percent(c.variableCostRate))}${row('هامش المساهمة',percent(c.contributionMargin))}${row('تكاليف غير إعلانية + ثابتة لكل طلب وارد',money(c.nonAdCostPerPlaced))}`)}
  
        ${block('تحليل حساسية الربح','بيوضح تأثير تغيير كل عامل على صافي الربح مع تثبيت باقي العوامل',`${best?`<div class="kun96-alert info"><b>أقوى عامل تحسين في الاختبارات الحالية:</b> ${escapeHtml(best.name)} — تأثير تقديري ${best.delta>=0?'+':''}${money(best.delta)} على صافي الربح.</div>`:''}<div class="kun96-impact"><table><thead><tr><th>العامل</th><th>التغيير</th><th>صافي الربح الجديد</th><th>فرق الربح</th></tr></thead><tbody>${impactRows}</tbody></table></div>`)}
  
        ${block('مخطط السيناريوهات: الحالي / المستهدف / المتشائم','اختبر البيزنس لو كذا متغير اتحسن أو ساء في نفس الوقت',`<div class="kun96-scenarios">${scenarioCard('الوضع الحالي',plan.current,'')}${scenarioCard('السيناريو المستهدف',plan.target,'target')}${scenarioCard('السيناريو المتشائم',plan.stress,'stress')}</div><div class="kun96-formula" style="margin-top:10px">السيناريو المستهدف والمتشائم بيستخدموا افتراضاتك في RTO وAOV وCPA وCOGS ومرتجعات ما بعد التسليم مع بعض. غيّر أي نسبة وهتشوف تأثيرها فورًا.</div>`)}
  
        ${block('تشخيص قرار النمو','من أرقام الإعلانات والتشغيل لقرار نمو وربحية واضح',`<div class="kun96-decision">${c.netProfit>=0?`<div class="kun96-alert ok">حسب البيانات المدخلة، البيزنس بيحقق صافي ربح ${money(c.netProfit)} بهامش ${percent(c.netMargin)}.</div>`:`<div class="kun96-alert warn">حسب البيانات المدخلة، البيزنس خسران ${money(Math.abs(c.netProfit))}. راجع أكبر تسريب تكلفة ونسب RTO والمرتجعات وCPA.</div>`}${c.currentCPA<=c.netBreakEvenCPA&&c.netBreakEvenCPA>0?`<div class="kun96-alert ok">CPA الحالي أقل من CPA عند نقطة التعادل بمساحة ${money(c.cpaHeadroom)} لكل طلب وارد.</div>`:`<div class="kun96-alert warn">CPA الحالي عند أو أعلى من نقطة التعادل؛ زيادة ميزانية الإعلانات من غير تحسين اقتصاديات الطلب ممكن تزود الخسارة.</div>`}${best?`<div class="kun96-alert info">أولوية التحسين حسابيًا حاليًا: <b>${escapeHtml(best.name)}</b> قبل ما تحكم على الأداء من ROAS لوحده.</div>`:''}${c.targetProfitGap>0?`<div class="kun96-alert info">لسه ناقص ${money(c.targetProfitGap)} علشان توصل لصافي الربح المستهدف.</div>`:`<div class="kun96-alert ok">هدف صافي الربح متحقق بفائض ${money(Math.abs(c.targetProfitGap))}.</div>`}${c.targetMarginGap>0?`<div class="kun96-alert info">هامش الربح المستهدف أعلى من الهامش الحالي بـ ${percent(c.targetMarginGap)} نقطة مئوية.</div>`:`<div class="kun96-alert ok">هامش الربح المستهدف متحقق أو متجاوز.</div>`}</div>`)}
      `;
  }

  function render(){
    if(!active())return;
    const host=root();if(!host)return;
    style();
    const c=calculate(model);
    host.innerHTML=`<div class="kun96-page">
      <header class="kun96-head">
        <div><div class="kun96-titleline"><h2>حاسبة ربحية التجارة الإلكترونية</h2><span class="kun96-version">نسخة محسّنة</span></div><p>دخل أرقامك الفعلية لنفس الفترة، والحاسبة هتحولها لقرار واضح: أنت مربح ولا لأ، أقصى CPA تستحمله، فين التسريب، وإيه أفضل نقطة تحسنها.</p></div>
        <div class="kun96-actions"><button data-kun96-action="example">تجربة مثال</button><button data-kun96-action="print">طباعة</button><button data-kun96-action="reset" class="danger">مسح البيانات</button><button data-kun96-action="save" class="primary">حفظ الآن</button></div>
      </header>
      ${quickSummary(c)}
      ${sectionNav()}
      <div class="kun96-process" aria-label="رحلة الحساب"><div data-step="1">الطلبات</div><div data-step="2">تم الشحن</div><div data-step="3">المرتجعات</div><div data-step="4">الإيراد المحقق</div><div data-step="5">هامش المساهمة</div><div data-step="6">صافي الربح</div></div>
      <div class="kun96-layout">
        <div class="kun96-inputs">
          ${block('1) بيانات التشغيل الفعلية','ابدأ هنا: الطلبات وحالات الشحن لنفس الفترة.',fields('orders'),true,'orders')}
          ${block('2) الإيرادات ومتوسط قيمة الطلب (AOV)','القيمة قبل وبعد الخصم، والشحن اللي بتحصله من العميل.',fields('revenue'),true,'revenue')}
          ${block('3) التكاليف المتغيرة','المنتج والتغليف والشحن والمرتجعات وكل تكلفة مرتبطة بالطلب.',fields('variable'),true,'variable')}
          ${block('4) الإنفاق الإعلاني','اكتب إجمالي الإنفاق لنفس الفترة، والباقي يتحسب تلقائي.',fields('marketing'),true,'marketing')}
          ${block('5) المصروفات الثابتة','رواتب وإيجار وبرامج وباقي مصاريف الفترة.',fields('fixed'),false,'fixed')}
          ${block('6) الأهداف وافتراضات النمو','حدد الهدف اللي عايز توصله واختبر تأثير التحسين.',fields('targets'),false,'targets')}
          ${block('7) السيناريو المتشائم','اختبر حدود أمان البيزنس لو المؤشرات ساءت.',fields('stress'),false,'stress')}
        </div>
        <aside class="kun96-results" data-kun96-results aria-live="polite">${resultHtml(c)}</aside>
      </div>
    </div>`;
    bind();
  }

  function updateResults(){
    const c=calculate(model),out=document.querySelector('[data-kun96-results]');
    if(out)out.innerHTML=resultHtml(c);
    const overview=document.querySelector('.kun96-overview');
    if(overview){const holder=document.createElement('div');holder.innerHTML=quickSummary(c);overview.replaceWith(holder.firstElementChild);}
  }
  function bind(){
    const host=root();if(!host)return;
    const setSaveState=text=>{const el=host.querySelector('[data-kun96-save-state]');if(el){el.textContent=text;clearTimeout(setSaveState.timer);setSaveState.timer=setTimeout(()=>{if(el.isConnected)el.textContent='الحفظ تلقائي';},1500);}};
    host.querySelectorAll('[data-kun96-field]').forEach(input=>input.addEventListener('input',()=>{
      const key=input.dataset.kun96Field;model[key]=signed(input.value);save();updateResults();setSaveState('تم الحفظ ✓');
    }));
    host.querySelectorAll('[data-kun96-help]').forEach(button=>{
      button.addEventListener('click',event=>{
        event.preventDefault();event.stopPropagation();
        const head=button.closest('.kun96-field-head'),willOpen=head?.dataset.open!=='1';
        host.querySelectorAll('.kun96-field-head[data-open="1"]').forEach(item=>{item.dataset.open='0';item.querySelector('[data-kun96-help]')?.setAttribute('aria-expanded','false');});
        if(head&&willOpen){head.dataset.open='1';button.setAttribute('aria-expanded','true');}
      });
      button.addEventListener('keydown',event=>{if(event.key==='Escape'){const head=button.closest('.kun96-field-head');if(head)head.dataset.open='0';button.setAttribute('aria-expanded','false');button.blur();}});
    });
    host.addEventListener('click',event=>{
      if(!event.target.closest?.('[data-kun96-help],.kun96-tooltip'))host.querySelectorAll('.kun96-field-head[data-open="1"]').forEach(item=>{item.dataset.open='0';item.querySelector('[data-kun96-help]')?.setAttribute('aria-expanded','false');});
    });
    host.querySelectorAll('[data-kun96-jump]').forEach(button=>button.addEventListener('click',()=>{
      const id=button.dataset.kun96Jump,target=host.querySelector(`#kun96-section-${CSS.escape(id)}`);
      if(!target)return;target.open=true;target.scrollIntoView({behavior:'smooth',block:'start'});
      setTimeout(()=>target.querySelector('input')?.focus({preventScroll:true}),260);
    }));
    host.querySelectorAll('[data-kun96-action]').forEach(button=>button.addEventListener('click',()=>{
      const action=button.dataset.kun96Action;
      if(action==='save'){save();setSaveState('تم الحفظ ✓');window.showToast?.('تم حفظ بيانات الحاسبة');return;}
      if(action==='print'){window.print();return;}
      if(action==='reset'){
        const hasData=Object.keys(DEFAULTS).some(key=>Math.abs(signed(model[key]))>0&&signed(model[key])!==signed(DEFAULTS[key]));
        if(hasData&&!window.confirm('متأكد إنك عايز تمسح بيانات الحاسبة؟ مش هتقدر ترجعها بعد المسح.'))return;
        model={...DEFAULTS};save();render();window.showToast?.('تم مسح بيانات الحاسبة');return;
      }
      if(action==='example'){
        const hasData=CORE_FIELDS.some(key=>Math.abs(signed(model[key]))>0);
        if(hasData&&!window.confirm('تحميل المثال هيستبدل الأرقام الحالية في الحاسبة. تكمل؟'))return;
        model={...DEFAULTS,totalOrders:1000,cancelledOrders:50,shippedOrders:950,rtoOrders:150,deliveredOrders:800,returnedOrders:16,grossAov:800,discountPercent:3,customerShippingRevenue:0,otherRevenue:0,platformReportedRevenue:800000,cogsPerKept:350,returnedCogsLossPercent:0,packagingPerShipped:10,forwardShippingPerShipped:55,rtoCostPerOrder:35,returnCostPerOrder:40,paymentFeePercent:2,paymentFeeFixed:0,fulfillmentPerShipped:0,otherVariablePerShipped:0,adSpend:120000,salaries:25000,rent:10000,software:5000,warehouseUtilities:3000,agencyFees:0,otherFixed:2000,targetProfit:130000,targetMargin:20,targetRtoRate:10,targetAovLift:10,targetCpaChange:-20,targetCogsChange:-5,targetReturnChange:-20,stressRtoRate:25,stressAovChange:-10,stressCpaChange:20,stressCogsChange:10,stressReturnChange:25};
        save();render();window.showToast?.('تم تحميل مثال ربحية لـ 1000 طلب');
      }
    }));
  }

  load();
  const previousSetView=typeof window.setView==='function'?window.setView:null;
  if(previousSetView)window.setView=function(view){const result=previousSetView.apply(this,arguments);if(String(view)===VIEW)setTimeout(render,0);return result;};
  document.addEventListener('click',event=>{const target=event.target.closest?.(`[data-view="${VIEW}"],[data-go="${VIEW}"]`);if(target)setTimeout(render,0);},false);
  if(active())setTimeout(render,0);

  window.KunEcommerceCalculatorV94={version:'96.2',render,calculate:()=>calculate(model),scenario:(opts)=>scenario(calculate(model),opts||{}),impact:()=>impactAnalysis(calculate(model)),get data(){return {...model};},set data(value){model={...DEFAULTS,...(value||{})};save();render();}};
})();
