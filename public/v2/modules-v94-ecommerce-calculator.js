/* Kun Online v94.1 — deduplicated e-commerce profitability calculator. */
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
  const finite=v=>Number.isFinite(v);
  const fmt=(v,d=2)=>new Intl.NumberFormat('ar-EG',{maximumFractionDigits:d}).format(Number(v)||0);
  const money=v=>`${fmt(v)} ج.م`;

  const GROUPS={
    product:[
      ['sellingPrice','سعر بيع المنتج','ج.م','مثال: 599'],
      ['productCost','تكلفة المنتج','ج.م','تكلفة الوحدة'],
      ['packagingCost','التغليف لكل طلب مؤكد','ج.م','كرتونة / تغليف'],
      ['forwardShipping','الشحن للطلب المؤكد','ج.م','تكلفة الشحنة الخارجة'],
      ['returnShipping','تكلفة المرتجع','ج.م','شحن رجوع / معالجة'],
      ['otherVariable','تكلفة متغيرة إضافية','ج.م','عمولة / تجهيز / هدية'],
      ['codPercent','عمولة التحصيل COD','%','نسبة من قيمة البيع'],
      ['codFixed','رسوم تحصيل ثابتة','ج.م','لكل طلب مستلم نهائيًا']
    ],
    funnel:[
      ['confirmationRate','نسبة التأكيد','%','من الطلبات الجديدة'],
      ['deliveryRate','نسبة التسليم النهائية','%','من الطلبات المؤكدة؛ المرتجع = الباقي تلقائيًا'],
      ['dailyOrders','الطلبات الجديدة يوميًا','طلب','قبل التأكيد'],
      ['workingDays','أيام التشغيل بالشهر','يوم','عادة 30']
    ],
    adsAuto:[
      ['cpm','CPM','ج.م','تكلفة 1000 ظهور'],
      ['ctr','CTR','%','نسبة النقر'],
      ['clickToOrder','Conversion Rate من النقر للطلب','%','Click → Order']
    ],
    adsManual:[
      ['cpp','CPP الفعلي','ج.م','تكلفة الحصول على طلب جديد']
    ],
    fixed:[
      ['salaries','رواتب شهرية','ج.م','إجمالي الرواتب'],
      ['rent','إيجار / مخزن شهري','ج.م','إيجار ومرافق'],
      ['software','برامج واشتراكات شهرية','ج.م','منصات وأدوات'],
      ['otherFixed','مصاريف ثابتة أخرى','ج.م','أي مصاريف شهرية ثابتة']
    ],
    goals:[
      ['targetProfit','الربح الشهري المستهدف','ج.م','مثال: 30000'],
      ['targetMargin','هامش صافي الربح المستهدف','%','مثال: 15']
    ]
  };

  const DEFAULTS={sellingPrice:0,productCost:0,packagingCost:0,forwardShipping:0,returnShipping:0,otherVariable:0,codPercent:0,codFixed:0,confirmationRate:80,deliveryRate:70,dailyOrders:20,workingDays:30,cpm:0,ctr:0,clickToOrder:0,cpp:0,adCostMode:'auto',salaries:0,rent:0,software:0,otherFixed:0,targetProfit:10000,targetMargin:15};
  let model={...DEFAULTS};

  function load(){
    try{
      const current=JSON.parse(localStorage.getItem(STORAGE)||'null');
      if(current){model={...DEFAULTS,...current};delete model.returnRate;return;}
      const legacy=JSON.parse(localStorage.getItem(LEGACY_STORAGE)||'null');
      if(legacy){model={...DEFAULTS,...legacy,adCostMode:n(legacy.cpp)>0?'manual':'auto'};delete model.returnRate;save();return;}
    }catch{}
    model={...DEFAULTS};
  }
  function save(){try{localStorage.setItem(STORAGE,JSON.stringify(model));}catch{}}

  function calculate(input){
    const price=n(input.sellingPrice),cost=n(input.productCost),pack=n(input.packagingCost),ship=n(input.forwardShipping),retShip=n(input.returnShipping),other=n(input.otherVariable),codPct=pct(input.codPercent)/100,codFixed=n(input.codFixed);
    const confirm=pct(input.confirmationRate)/100,delivery=pct(input.deliveryRate)/100,returnRate=1-delivery,days=Math.max(1,n(input.workingDays)||30),daily=Math.max(0,n(input.dailyOrders));
    const adCostMode=input.adCostMode==='manual'?'manual':'auto',cpm=n(input.cpm),ctr=pct(input.ctr)/100,cvr=pct(input.clickToOrder)/100,manualCpp=n(input.cpp);
    const targetProfit=Math.max(0,n(input.targetProfit)),targetMargin=pct(input.targetMargin)/100;

    const derivedCpc=ctr>0?cpm/(1000*ctr):0;
    const derivedCpp=ctr>0&&cvr>0?derivedCpc/cvr:0;
    const usedCpp=adCostMode==='manual'?manualCpp:derivedCpp;

    // One operational outcome input only: delivery rate. Return rate is its complement.
    const confirmedPerOrder=confirm;
    const deliveredPerOrder=confirm*delivery;
    const returnedPerOrder=confirm*returnRate;

    const revenuePerOrder=price*deliveredPerOrder;
    const productCostPerOrder=cost*deliveredPerOrder;
    const packagingPerOrder=pack*confirmedPerOrder;
    const shippingPerOrder=ship*confirmedPerOrder;
    const returnCostPerOrder=retShip*returnedPerOrder;
    const otherPerOrder=other*confirmedPerOrder;
    const codPerOrder=deliveredPerOrder*(codFixed+price*codPct);
    const nonAdVariable=productCostPerOrder+packagingPerOrder+shippingPerOrder+returnCostPerOrder+otherPerOrder+codPerOrder;
    const preAdContribution=revenuePerOrder-nonAdVariable;
    const contribution=preAdContribution-usedCpp;

    const fixed=n(input.salaries)+n(input.rent)+n(input.software)+n(input.otherFixed);
    const monthlyOrders=daily*days,monthlyRevenue=revenuePerOrder*monthlyOrders,monthlyAdSpend=usedCpp*monthlyOrders,monthlyProfit=contribution*monthlyOrders-fixed;
    const margin=monthlyRevenue>0?monthlyProfit/monthlyRevenue*100:0,roas=monthlyAdSpend>0?monthlyRevenue/monthlyAdSpend:0;

    const breakEvenDaily=contribution>0?fixed/(contribution*days):Infinity;
    const targetProfitDaily=contribution>0?(fixed+targetProfit)/(contribution*days):Infinity;
    const marginDenominator=contribution-targetMargin*revenuePerOrder;
    let targetMarginDaily=Infinity;
    if(targetMargin===0)targetMarginDaily=breakEvenDaily;
    else if(marginDenominator>0)targetMarginDaily=fixed/(marginDenominator*days);
    else if(fixed===0&&revenuePerOrder>0&&contribution/revenuePerOrder>=targetMargin)targetMarginDaily=0;

    const expectedConfirmedDaily=daily*confirmedPerOrder,expectedDeliveredDaily=daily*deliveredPerOrder,expectedReturnsDaily=daily*returnedPerOrder;
    const maxCppVariable=Math.max(0,preAdContribution),fixedAllocation=monthlyOrders>0?fixed/monthlyOrders:0,maxCppAtPlan=Math.max(0,preAdContribution-fixedAllocation);
    const priceCoefficient=deliveredPerOrder*(1-codPct);
    const nonPriceUnitCost=productCostPerOrder+packagingPerOrder+shippingPerOrder+returnCostPerOrder+otherPerOrder+deliveredPerOrder*codFixed+usedCpp;
    const minimumPriceForPositiveContribution=priceCoefficient>0?nonPriceUnitCost/priceCoefficient:Infinity;

    const trafficPlan=ordersDaily=>{
      const q=Math.max(0,n(ordersDaily));
      const result={orders:q,confirmed:q*confirmedPerOrder,delivered:q*deliveredPerOrder,returns:q*returnedPerOrder,adBudget:q*usedCpp};
      if(adCostMode==='auto'){
        result.clicks=cvr>0?q/cvr:Infinity;
        result.impressions=ctr>0&&finite(result.clicks)?result.clicks/ctr:Infinity;
      }
      return result;
    };

    return {price,cost,pack,ship,retShip,other,codPct,codFixed,confirm,delivery,returnRate,days,daily,cpm,ctr,cvr,manualCpp,adCostMode,targetProfit,targetMargin,derivedCpc,derivedCpp,usedCpp,confirmedPerOrder,deliveredPerOrder,returnedPerOrder,revenuePerOrder,nonAdVariable,preAdContribution,contribution,fixed,monthlyOrders,monthlyRevenue,monthlyAdSpend,monthlyProfit,margin,roas,breakEvenDaily,targetProfitDaily,targetMarginDaily,expectedConfirmedDaily,expectedDeliveredDaily,expectedReturnsDaily,maxCppVariable,maxCppAtPlan,minimumPriceForPositiveContribution,trafficPlan};
  }

  function style(){
    if(document.getElementById('kunEcomCalc94Style'))return;
    const s=document.createElement('style');s.id='kunEcomCalc94Style';s.textContent=`
      .kun94-subnav{font-size:12px!important;padding-inline-start:24px!important;opacity:.9}.kun94-subnav::before{content:'↳';margin-inline-end:7px;opacity:.55}
      .kun94-page{display:grid;gap:16px;direction:rtl}.kun94-head{display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap}.kun94-head .spacer{flex:1}.kun94-actions{display:flex;gap:8px;flex-wrap:wrap}
      .kun94-layout{display:grid;grid-template-columns:minmax(0,1.08fr) minmax(380px,.92fr);gap:15px;align-items:start}.kun94-inputs,.kun94-results{display:grid;gap:12px}.kun94-results{position:sticky;top:72px}.kun94-block{border:1px solid var(--line,#e2e8f0);border-radius:16px;background:var(--card,#fff);padding:16px}.kun94-block-title{font-size:15px;font-weight:850}.kun94-block-sub{font-size:11px;color:#64748b;margin:3px 0 12px}.kun94-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.kun94-field{display:grid;gap:5px}.kun94-field>span{font-size:11px;font-weight:800;color:#64748b}.kun94-input-wrap{display:grid;grid-template-columns:minmax(0,1fr) auto;border:1px solid #dbe3ea;border-radius:11px;overflow:hidden;background:#fff}.kun94-input-wrap input{border:0!important;border-radius:0!important;min-width:0}.kun94-unit{display:flex;align-items:center;padding:0 10px;background:#f8fafc;border-inline-start:1px solid #e2e8f0;font-size:10px;font-weight:800;color:#64748b;white-space:nowrap}
      .kun94-mode{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px}.kun94-mode button{border:1px solid #dbe3ea;background:#fff;border-radius:11px;padding:10px;font:inherit;font-weight:800;cursor:pointer}.kun94-mode button.active{background:#eff6ff;border-color:#93c5fd;color:#1d4ed8}.kun94-note{font-size:10.5px;line-height:1.7;color:#475569;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:9px;margin-bottom:10px}
      .kun94-kpis{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.kun94-kpi{border:1px solid #e2e8f0;border-radius:14px;background:#fff;padding:13px;display:grid;gap:5px}.kun94-kpi span{font-size:10.5px;color:#64748b;font-weight:750}.kun94-kpi strong{font-size:18px;line-height:1.25}.kun94-kpi.good strong{color:#15803d}.kun94-kpi.bad strong{color:#b91c1c}.kun94-kpi.focus{background:#eff6ff;border-color:#dbeafe}.kun94-kpi.focus strong{color:#1d4ed8}
      .kun94-scenarios{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.kun94-scenario{border:1px solid #e2e8f0;border-radius:13px;padding:12px;background:#fff;display:grid;gap:5px}.kun94-scenario .name{font-size:10.5px;color:#64748b;font-weight:800}.kun94-scenario strong{font-size:16px}.kun94-scenario small{font-size:9.5px;color:#64748b;line-height:1.6}.kun94-scenario.impossible{background:#fff7ed;border-color:#fed7aa}.kun94-scenario.impossible strong{color:#b45309}
      .kun94-row{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px dashed #e2e8f0;font-size:11px}.kun94-row:last-child{border-bottom:0}.kun94-row b{font-size:12px}.kun94-warning,.kun94-ok{padding:10px 12px;border-radius:11px;font-size:11px;line-height:1.7}.kun94-warning{background:#fff7ed;color:#9a3412;border:1px solid #fed7aa}.kun94-ok{background:#f0fdf4;color:#166534;border:1px solid #bbf7d0}
      .kun94-chart{width:100%;height:auto;display:block}.kun94-chart text{font-family:inherit;font-size:9px;fill:#64748b}.kun94-chart .axis{stroke:#cbd5e1;stroke-width:1}.kun94-chart .zero{stroke:#94a3b8;stroke-width:1;stroke-dasharray:4 4}.kun94-chart .curve{stroke:#2563eb;stroke-width:3;fill:none}.kun94-chart .break{stroke:#16a34a;stroke-width:1.5;stroke-dasharray:5 4}.kun94-chart .dot{fill:#16a34a}.kun94-chart .loss{fill:#fff1f2}.kun94-chart .profit{fill:#f0fdf4}.kun94-formula{font-size:10px;color:#475569;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:10px;line-height:1.7}
      @media(max-width:1050px){.kun94-layout{grid-template-columns:1fr}.kun94-results{position:static}.kun94-kpis{grid-template-columns:repeat(4,minmax(0,1fr))}}
      @media(max-width:760px){.kun94-fields,.kun94-scenarios{grid-template-columns:1fr}.kun94-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.kun94-actions{width:100%}.kun94-actions .btn{flex:1}}
    `;document.head.appendChild(s);
  }

  function ensureNav(){
    const nav=document.querySelector('.nav'),finance=nav?.querySelector('[data-view="finance"]');if(!nav||!finance)return;
    let b=nav.querySelector(`[data-view="${VIEW}"]`);if(!b){b=document.createElement('button');b.dataset.view=VIEW;finance.insertAdjacentElement('afterend',b);}b.classList.add('kun94-subnav');b.textContent='حاسبة التجارة الإلكترونية';
    if(b.dataset.kun94Bound==='1')return;b.dataset.kun94Bound='1';
    b.addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation();document.querySelectorAll('.nav button').forEach(x=>x.classList.toggle('active',x===b));document.querySelector('.side')?.classList.remove('mobile-open');document.body.classList.remove('kun-mobile-nav-open');render();},{capture:true});
  }

  function inputHtml(field){const [key,label,unit,placeholder]=field;return `<label class="kun94-field"><span>${esc(label)}</span><div class="kun94-input-wrap"><input class="input" type="number" step="0.01" min="0" data-kun94-input="${esc(key)}" value="${esc(n(model[key]))}" placeholder="${esc(placeholder)}"><em class="kun94-unit">${esc(unit)}</em></div></label>`;}
  function fields(group){return `<div class="kun94-fields">${(GROUPS[group]||[]).map(inputHtml).join('')}</div>`;}
  function block(title,sub,body){return `<section class="kun94-block"><div class="kun94-block-title">${title}</div><div class="kun94-block-sub">${sub}</div>${body}</section>`;}
  function adsBlock(){
    const auto=model.adCostMode!=='manual';
    const mode=`<div class="kun94-mode"><button type="button" data-kun94-admode="auto" class="${auto?'active':''}">احسب CPP تلقائيًا</button><button type="button" data-kun94-admode="manual" class="${!auto?'active':''}">عندي CPP فعلي</button></div>`;
    const note=`<div class="kun94-note">${auto?'تدخل CPM وCTR وConversion Rate فقط، والحاسبة تستنتج CPP.':'تدخل CPP فقط؛ وتم إخفاء CPM وCTR وConversion Rate حتى لا توجد أرقام لا تؤثر في الربحية.'}</div>`;
    return block('3) تكلفة الإعلان','طريقة واحدة فقط هي التي تدخل الحساب في كل مرة.',mode+note+fields(auto?'adsAuto':'adsManual'));
  }

  function practicalTarget(v){return finite(v)?Math.max(0,Math.ceil(v)):Infinity;}
  function planLine(c,v){if(!finite(v))return '';const p=c.trafficPlan(practicalTarget(v)),parts=[`مستلم: ${fmt(p.delivered,1)}/يوم`,`مرتجع: ${fmt(p.returns,1)}/يوم`,`إعلان: ${money(p.adBudget)}/يوم`];if(c.adCostMode==='auto'&&finite(p.clicks))parts.push(`نقرات: ${fmt(p.clicks,0)}`);if(c.adCostMode==='auto'&&finite(p.impressions))parts.push(`ظهور: ${fmt(p.impressions,0)}`);return parts.join(' • ');}
  function scenario(label,v,c,note=''){if(!finite(v))return `<div class="kun94-scenario impossible"><span class="name">${esc(label)}</span><strong>غير ممكن بأي عدد طلبات</strong><small>${esc(note||'هامش المساهمة غير كافٍ. حسّن السعر أو التكلفة أو CPP أو نسب التشغيل أولًا.')}</small></div>`;return `<div class="kun94-scenario"><span class="name">${esc(label)}</span><strong>${fmt(practicalTarget(v),0)} طلب/يوم</strong><small>القيمة الحسابية ≈ ${fmt(v,2)} • ${esc(planLine(c,v))}</small></div>`;}

  function chart(c){
    const W=640,H=245,p={l:58,r:18,t:22,b:42};let maxX=Math.max(10,c.daily*1.5,finite(c.breakEvenDaily)?c.breakEvenDaily*1.8:0,finite(c.targetProfitDaily)?c.targetProfitDaily*1.2:0);maxX=Math.ceil(maxX/5)*5;
    const profit=x=>c.contribution*x*c.days-c.fixed;let minY=Math.min(-c.fixed,profit(0),profit(maxX),0),maxY=Math.max(profit(maxX),0);if(Math.abs(maxY-minY)<1){minY=-1;maxY=1;}const range=maxY-minY,X=x=>p.l+x/maxX*(W-p.l-p.r),Y=y=>p.t+(maxY-y)/range*(H-p.t-p.b),zero=Y(0),ticks=[];
    for(let i=0;i<=4;i++){const x=maxX*i/4;ticks.push(`<text x="${X(x)}" y="${H-p.b+18}" text-anchor="middle">${fmt(x,0)}</text>`);}const be=finite(c.breakEvenDaily)?`<line class="break" x1="${X(c.breakEvenDaily)}" y1="${p.t}" x2="${X(c.breakEvenDaily)}" y2="${H-p.b}"/><circle class="dot" cx="${X(c.breakEvenDaily)}" cy="${zero}" r="4"/>`:'';
    return `<svg class="kun94-chart" viewBox="0 0 ${W} ${H}"><rect class="profit" x="${p.l}" y="${p.t}" width="${W-p.l-p.r}" height="${Math.max(0,zero-p.t)}"/><rect class="loss" x="${p.l}" y="${zero}" width="${W-p.l-p.r}" height="${Math.max(0,H-p.b-zero)}"/><line class="zero" x1="${p.l}" y1="${zero}" x2="${W-p.r}" y2="${zero}"/><path class="curve" d="M ${X(0)} ${Y(profit(0))} L ${X(maxX)} ${Y(profit(maxX))}"/>${be}${ticks.join('')}<text x="${W/2}" y="${H-7}" text-anchor="middle">الطلبات الجديدة يوميًا</text></svg>`;
  }

  function resultsHtml(c){
    const delta=finite(c.breakEvenDaily)?c.daily-c.breakEvenDaily:null;
    const status=!finite(c.breakEvenDaily)?`كل طلب جديد يحقق مساهمة ${money(c.contribution)}؛ زيادة العدد وحدها لن تصل للتعادل.`:delta>=0?`الخطة الحالية أعلى من التعادل بحوالي ${fmt(delta,1)} طلب يوميًا.`:`تحتاج تقريبًا ${fmt(Math.ceil(Math.abs(delta)),0)} طلب إضافي يوميًا للوصول للتعادل.`;
    const hint=`أقصى CPP قبل خسارة الوحدة ≈ ${money(c.maxCppVariable)}، والحد الأدنى التقريبي لسعر بيع بمساهمة موجبة ≈ ${finite(c.minimumPriceForPositiveContribution)?money(c.minimumPriceForPositiveContribution):'غير متاح'}.`;
    const adLabel=c.adCostMode==='auto'?'CPP المحسوب تلقائيًا':'CPP الفعلي المستخدم';
    return `<div class="kun94-results">
      ${block('النتيجة الفورية','لا يوجد مدخل مكرر؛ كل رقم ظاهر له وظيفة واحدة.',`<div class="kun94-kpis"><div class="kun94-kpi ${c.monthlyProfit<0?'bad':'good'}"><span>صافي الربح / الخسارة شهريًا</span><strong>${money(c.monthlyProfit)}</strong></div><div class="kun94-kpi focus"><span>طلبات يومية للتعادل</span><strong>${finite(c.breakEvenDaily)?fmt(practicalTarget(c.breakEvenDaily),0)+' طلب':'غير ممكن'}</strong></div><div class="kun94-kpi"><span>هامش المساهمة لكل طلب جديد</span><strong>${money(c.contribution)}</strong></div><div class="kun94-kpi"><span>${adLabel}</span><strong>${c.usedCpp?money(c.usedCpp):'—'}</strong></div><div class="kun94-kpi"><span>ROAS متوقع</span><strong>${c.roas?fmt(c.roas,2)+'x':'—'}</strong></div><div class="kun94-kpi"><span>هامش صافي الربح</span><strong>${fmt(c.margin,1)}%</strong></div></div><div class="${finite(c.breakEvenDaily)?'kun94-ok':'kun94-warning'}" style="margin-top:10px">${status}${!finite(c.breakEvenDaily)?' '+hint:''}</div>`)}
      ${block('كام طلب يومي مطلوب؟','كل الأرقام طلبات جديدة قبل التأكيد.',`<div class="kun94-scenarios"><div class="kun94-scenario"><span class="name">الخطة الحالية</span><strong>${fmt(c.daily,0)} طلب/يوم</strong><small>مستلم متوقع: ${fmt(c.expectedDeliveredDaily,1)} • مرتجع: ${fmt(c.expectedReturnsDaily,1)} • ربح: ${money(c.monthlyProfit)}</small></div>${scenario('نقطة التعادل',c.breakEvenDaily,c,hint)}${scenario('تحقيق ربح '+money(c.targetProfit)+' شهريًا',c.targetProfitDaily,c,hint)}${scenario('تحقيق هامش '+fmt(c.targetMargin*100,1)+'%',c.targetMarginDaily,c,'الهامش المطلوب أعلى من الممكن حاليًا للوحدة؛ حسّن السعر أو CPP أو التكاليف أو نسب التشغيل.')}</div>`)}
      ${block('تفاصيل الفانل والاقتصاديات','التسليم والمرتجع نتيجة واحدة: المرتجع يُستنتج تلقائيًا من نسبة التسليم.',`<div class="kun94-row"><span>نسبة التأكيد</span><b>${fmt(c.confirm*100,1)}%</b></div><div class="kun94-row"><span>نسبة التسليم النهائية</span><b>${fmt(c.delivery*100,1)}%</b></div><div class="kun94-row"><span>نسبة المرتجع المحسوبة تلقائيًا</span><b>${fmt(c.returnRate*100,1)}%</b></div><div class="kun94-row"><span>طلبات مؤكدة يوميًا</span><b>${fmt(c.expectedConfirmedDaily,1)}</b></div><div class="kun94-row"><span>طلبات مستلمة نهائيًا يوميًا</span><b>${fmt(c.expectedDeliveredDaily,1)}</b></div><div class="kun94-row"><span>مرتجعات متوقعة يوميًا</span><b>${fmt(c.expectedReturnsDaily,1)}</b></div><div class="kun94-row"><span>الإيراد الشهري</span><b>${money(c.monthlyRevenue)}</b></div><div class="kun94-row"><span>تكلفة الإعلان الشهرية</span><b>${money(c.monthlyAdSpend)}</b></div><div class="kun94-row"><span>المصاريف الثابتة الشهرية</span><b>${money(c.fixed)}</b></div>${c.adCostMode==='auto'?`<div class="kun94-row"><span>CPC المحسوب</span><b>${c.derivedCpc?money(c.derivedCpc):'—'}</b></div>`:''}<div class="kun94-row"><span>أقصى CPP لتغطية المتغيرات</span><b>${money(c.maxCppVariable)}</b></div><div class="kun94-row"><span>أقصى CPP عند حجم الطلبات الحالي لتغطية كل المصاريف</span><b>${money(c.maxCppAtPlan)}</b></div>`)}
      ${block('نقطة التعادل والربحية','المنطقة الحمراء خسارة والخضراء ربح.',chart(c))}
    </div>`;
  }

  function render(){
    style();ensureNav();const el=root();if(!el)return;load();
    el.innerHTML=`<section class="kun94-page"><div class="page-head kun94-head"><div><div class="title">حاسبة التجارة الإلكترونية</div><div class="sub">نسخة مبسطة بدون مدخلات مكررة: طلب → تأكيد → تسليم أو مرتجع → ربح ونقطة تعادل.</div></div><div class="spacer"></div><div class="kun94-actions"><button class="btn soft" data-kun94-reset>إعادة ضبط</button><button class="btn primary" data-kun94-recalc>إعادة الحساب</button></div></div><div class="kun94-layout"><div class="kun94-inputs">${block('1) اقتصاديات المنتج والطلب','كل تكلفة هنا تدخل مباشرة في الحساب.',fields('product'))}${block('2) التشغيل','أدخل نسبة التسليم فقط؛ نسبة المرتجع هي 100% ناقص نسبة التسليم، فلا يوجد تكرار.',fields('funnel'))}${adsBlock()}${block('4) المصاريف الثابتة الشهرية','تؤثر مباشرة في نقطة التعادل وعدد الطلبات المطلوبة.',fields('fixed'))}${block('5) أهدافك','كل هدف مستقل: مبلغ ربح شهري أو هامش صافي ربح.',fields('goals'))}<div class="kun94-formula"><b>القاعدة:</b> التأكيد يحدد ما يدخل التشغيل، ثم نسبة التسليم النهائية تحدد المبيعات الفعلية، والمرتجع يُحسب تلقائيًا كالباقي. وفي الإعلان تستخدم طريقة واحدة فقط: إما CPM+CTR+Conversion أو CPP فعلي.</div></div><div id="kun94Results"></div></div></section>`;
    bind();refresh();
  }

  function refresh(){if(!active())return;const host=document.getElementById('kun94Results');if(host)host.innerHTML=resultsHtml(calculate(model));}
  function bind(){
    document.querySelectorAll('[data-kun94-input]').forEach(input=>input.addEventListener('input',()=>{const key=input.dataset.kun94Input;let value=n(input.value);if(['confirmationRate','deliveryRate','codPercent','ctr','clickToOrder','targetMargin'].includes(key))value=pct(value);model[key]=value;save();refresh();}));
    document.querySelectorAll('[data-kun94-admode]').forEach(button=>button.addEventListener('click',()=>{model.adCostMode=button.dataset.kun94Admode==='manual'?'manual':'auto';save();render();}));
    document.querySelector('[data-kun94-recalc]')?.addEventListener('click',refresh);
    document.querySelector('[data-kun94-reset]')?.addEventListener('click',()=>{if(!confirm('إعادة كل أرقام الحاسبة للقيم الافتراضية؟'))return;model={...DEFAULTS};save();render();});
  }

  function boot(){style();ensureNav();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
  window.KunEcommerceCalculatorV94={version:'94.1',render,calculate,refresh,defaults:DEFAULTS};
})();
