/* Kun Online v122.0 — executive dashboard UX, de-duplication and analytical depth */
(()=>{
  if(window.KunDashboardExperienceV122)return;
  const VERSION='122.0';
  const nativeFetch=window.fetch.bind(window);
  const sectionOrder=['overview','trend','finance','ads','rates','provinces','ai'];
  const sectionMeta={
    overview:['الملخص','المؤشرات الأساسية','الأرقام التي تحتاجها أولًا، مع إمكانية فتح تفاصيل تكوين كل مؤشر.'],
    trend:['الاتجاهات','اتجاهات الأداء','كيف تحركت الطلبات والإيرادات والربحية والإنفاق داخل الفترة نفسها.'],
    finance:['الربحية','الربحية وهيكل التكلفة','تفكيك الإيراد والتكلفة والمصروفات للوصول إلى صافي الربح الحقيقي.'],
    ads:['النمو','اقتصاديات الإعلانات','قراءة الإنفاق وكفاءة الاكتساب والعائد الإعلاني وربطها بنتائج الطلبات الفعلية.'],
    rates:['التشغيل','جودة دورة الطلب','التأكيد والتسليم والمرتجعات على نفس الفترة المختارة للداشبورد.'],
    provinces:['الشحن','كفاءة الشحن حسب المحافظة','أين يأتي الحجم وأين تتحسن أو تتراجع جودة التسليم والمرتجعات.'],
    ai:['الذكاء','قراءة AI وخطوات العمل','الإشارات والتوصيات العملية بعد ربط التسويق والتشغيل والمالية.']
  };
  let lastData=null,timer=0,decorating=false;
  const $=(s,r=document)=>r.querySelector(s);
  const $$=(s,r=document)=>[...r.querySelectorAll(s)];
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const n=v=>Number(v)||0;
  const num=v=>new Intl.NumberFormat('ar-EG',{maximumFractionDigits:1}).format(n(v));
  const money=(v,c='EGP')=>`${num(v)} ${c==='EGP'?'ج.م':esc(c)}`;
  const pct=v=>`${num(v)}%`;
  const active=()=>$('.nav button.active')?.dataset.view==='dashboard'&&$('.v33-dashboard');
  const safeRatio=(a,b)=>n(b)?n(a)/n(b)*100:0;
  function style(){
    if($('#kunDashExperience122Style'))return;
    const s=document.createElement('style');s.id='kunDashExperience122Style';s.textContent=`
      .v33-dashboard{--dx-ink:#0f172a;--dx-muted:#64748b;--dx-line:#e2e8f0;--dx-blue:#2563eb;--dx-green:#16a34a;--dx-amber:#d97706;--dx-violet:#7c3aed;gap:14px!important}
      .v33-dashboard .dash-hero{min-height:168px;padding:28px 30px;border-radius:26px;background:radial-gradient(circle at 8% 14%,rgba(37,99,235,.11),transparent 31%),radial-gradient(circle at 88% 78%,rgba(22,163,74,.10),transparent 30%),linear-gradient(135deg,#fff 0%,#f8fbff 56%,#f3fbf6 100%);box-shadow:0 18px 46px rgba(15,23,42,.075)}
      .v33-dashboard .dash-hero:after{width:330px;height:330px;inset:auto -120px -190px auto;opacity:.8}.v33-dashboard .dash-eyebrow{letter-spacing:.08em}.v33-dashboard .dash-hero .title{font-size:32px;letter-spacing:-.7px}.v33-dashboard .dash-hero .sub{max-width:720px;font-size:13px;line-height:1.8}
      .dash-x-hero-side{display:grid;gap:4px}.dash-x-hero-side strong{font-size:14px}.dash-x-hero-side small{line-height:1.6}
      .dash-period-toolbar{position:sticky;top:8px;z-index:25;padding:11px 13px;border-radius:17px;box-shadow:0 10px 28px rgba(15,23,42,.07);backdrop-filter:blur(12px);background:color-mix(in srgb,var(--card) 92%,transparent)}
      .dash-x-nav{display:flex;gap:6px;overflow:auto;padding:3px 2px 5px;scrollbar-width:none}.dash-x-nav::-webkit-scrollbar{display:none}.dash-x-nav button{flex:0 0 auto;border:1px solid var(--line);background:var(--card);color:var(--muted);border-radius:999px;padding:7px 11px;font:inherit;font-size:10px;font-weight:800;cursor:pointer;transition:.16s ease}.dash-x-nav button:hover{border-color:#a9bdd3;color:var(--ink);transform:translateY(-1px)}
      .dash-x-executive{position:relative;overflow:hidden;padding:20px!important;border-radius:22px!important;background:linear-gradient(145deg,#0f172a 0%,#172b46 62%,#123b32 100%)!important;border-color:transparent!important;color:#fff!important;box-shadow:0 18px 42px rgba(15,23,42,.16)!important}.dash-x-executive:after{content:'';position:absolute;width:260px;height:260px;border-radius:50%;inset:-150px -70px auto auto;background:radial-gradient(circle,rgba(96,165,250,.28),transparent 66%);pointer-events:none}.dash-x-exec-head{position:relative;z-index:1;display:flex;align-items:flex-start;gap:12px;margin-bottom:15px}.dash-x-exec-head span{display:block;font-size:9px;font-weight:900;letter-spacing:.08em;color:#93c5fd}.dash-x-exec-head h2{margin:4px 0 0;font-size:19px;color:#fff}.dash-x-exec-head p{margin:5px 0 0;max-width:700px;color:#cbd5e1;font-size:10.5px;line-height:1.7}.dash-x-exec-range{margin-inline-start:auto;border:1px solid rgba(255,255,255,.13);background:rgba(255,255,255,.07);border-radius:12px;padding:8px 10px;font-size:9px;color:#cbd5e1;white-space:nowrap}
      .dash-x-metrics{position:relative;z-index:1;display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px}.dash-x-metric{min-width:0;padding:12px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(255,255,255,.07);box-shadow:inset 0 1px 0 rgba(255,255,255,.035)}.dash-x-metric span{display:block;color:#aebed1;font-size:9px}.dash-x-metric strong{display:block;margin:5px 0 3px;font-size:18px;line-height:1.25;color:#fff;overflow-wrap:anywhere}.dash-x-metric small{display:block;color:#8fa2b8;font-size:8.5px;line-height:1.45}.dash-x-metric em{display:inline-flex;margin-top:7px;padding:3px 6px;border-radius:999px;background:rgba(255,255,255,.08);color:#dbeafe;font-style:normal;font-size:8px;font-weight:800}
      .dash-x-insights{position:relative;z-index:1;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:9px}.dash-x-insight{padding:9px 10px;border-radius:11px;background:rgba(2,6,23,.18);border:1px solid rgba(255,255,255,.075)}.dash-x-insight span{display:block;color:#94a3b8;font-size:8.5px}.dash-x-insight b{display:block;margin-top:3px;color:#e2e8f0;font-size:10px;line-height:1.55}
      .v33-dashboard .dash-section[data-dash-section]{position:relative;overflow:hidden;padding:20px;border-radius:20px;box-shadow:0 10px 30px rgba(15,23,42,.045)}.v33-dashboard .dash-section[data-dash-section]:before{content:'';position:absolute;inset:0 0 auto;height:3px;background:linear-gradient(90deg,var(--dx-accent,#2563eb),transparent 70%)}
      [data-dash-section="overview"]{--dx-accent:#2563eb}[data-dash-section="trend"]{--dx-accent:#7c3aed}[data-dash-section="finance"]{--dx-accent:#16a34a}[data-dash-section="ads"]{--dx-accent:#d97706}[data-dash-section="rates"]{--dx-accent:#0891b2}[data-dash-section="provinces"]{--dx-accent:#db2777}[data-dash-section="ai"]{--dx-accent:#6d28d9}
      .dash-x-kicker{display:inline-flex;align-items:center;gap:6px;margin-bottom:4px;color:var(--dx-accent,#2563eb);font-size:8.5px;font-weight:900;letter-spacing:.05em}.dash-x-kicker:before{content:'';width:16px;height:2px;border-radius:999px;background:currentColor}.dash-section-head h2{font-size:17px;letter-spacing:-.2px}.dash-section-head p{max-width:820px;font-size:10.5px}.dash-section-actions .dash-period-control,.dash-section-actions .dash-period-chip,.dash-drill-head>.dash-period-chip,.dash-updated{display:none!important}
      .dash-kpis{grid-template-columns:repeat(4,minmax(0,1fr))!important;gap:9px}.dash-kpi[data-dash-kpi="actualOrderCost"],.dash-kpi[data-dash-kpi="margin"],.dash-kpi[data-dash-kpi="adSpend"]{display:none!important}.dash-kpi{padding:15px;border-radius:14px}.dash-kpi strong{font-size:19px}.dash-kpi small{min-height:auto}.dash-kpi-open{opacity:.85}.dash-drilldown{margin-top:10px;border-radius:14px}
      .dash-finance-grid{gap:9px}.dash-fin-card{padding:15px;border-radius:14px}.dash-fin-card>strong{font-size:22px}.dash-ad-summary{grid-template-columns:repeat(4,minmax(0,1fr));gap:7px}.dash-ad-grid{grid-template-columns:repeat(7,minmax(105px,1fr));gap:7px}.dash-ad-metric{padding:11px;border-radius:12px}.dash-campaign-strip{display:none!important}
      .dash-ai-ad-kpis{display:none!important}.dash-ai-analysis{border-radius:14px}.dash-ai-analysis-head{padding:14px 15px}.dash-ai-campaigns{padding-top:3px}.dash-ai-grid{margin-top:10px}
      .dash-x-delta-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:12px}.dash-x-delta{padding:11px 12px;border:1px solid var(--line);border-radius:12px;background:linear-gradient(180deg,#fafcff,#fff)}.dash-x-delta span{display:block;color:var(--muted);font-size:9px}.dash-x-delta strong{display:block;margin:4px 0;font-size:14px}.dash-x-delta small{display:block;color:var(--muted);font-size:8px;line-height:1.45}.dash-x-delta em{font-style:normal;font-weight:900}.dash-x-delta em.up{color:#15803d}.dash-x-delta em.down{color:#b91c1c}.dash-x-delta em.flat{color:#64748b}
      .dash-chart-card{border-radius:13px}.dash-table-wrap{border-radius:12px}.dash-province-item{border-radius:11px}
      body[data-theme="dark"] .dash-x-delta{background:linear-gradient(180deg,#172033,var(--card));border-color:var(--line)}body[data-theme="dark"] .dash-x-nav button{background:var(--card)}body[data-theme="dark"] .v33-dashboard .dash-hero{background:radial-gradient(circle at 8% 14%,rgba(59,130,246,.13),transparent 31%),radial-gradient(circle at 88% 78%,rgba(34,197,94,.09),transparent 30%),linear-gradient(135deg,#101827,#121d30 58%,#10251f 100%)}
      @media(max-width:1180px){.dash-x-metrics{grid-template-columns:repeat(3,minmax(0,1fr))}.dash-x-insights{grid-template-columns:repeat(2,minmax(0,1fr))}.dash-ad-grid{grid-template-columns:repeat(4,minmax(0,1fr))}}
      @media(max-width:760px){.v33-dashboard .dash-hero{padding:18px}.v33-dashboard .dash-hero .title{font-size:26px}.dash-x-exec-head{display:grid}.dash-x-exec-range{margin-inline-start:0;width:max-content}.dash-x-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.dash-x-insights,.dash-x-delta-grid{grid-template-columns:1fr 1fr}.dash-kpis{grid-template-columns:repeat(2,minmax(0,1fr))!important}.dash-ad-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.dash-period-toolbar{top:4px}}
      @media(max-width:430px){.dash-x-metrics,.dash-x-insights,.dash-x-delta-grid,.dash-kpis,.dash-ad-grid,.dash-ad-summary{grid-template-columns:1fr!important}.dash-x-executive{padding:15px!important}.dash-x-metric strong{font-size:20px}.v33-dashboard .dash-section[data-dash-section]{padding:14px}.dash-x-nav button{padding:7px 10px}}
      @media(prefers-reduced-motion:reduce){.dash-x-nav button{transition:none}}
    `;document.head.appendChild(s);
  }
  function rangeText(d){return d?.from&&d?.to?`${esc(d.from)} — ${esc(d.to)}`:'الفترة المختارة';}
  function lastPoint(d){const p=d?.trend?.points||[];return p[p.length-1]||{};}
  function rates(d){return d?.rates?.selected||d?.rates?.d7||lastPoint(d)||{};}
  function changeMeta(points,key,type,currency){
    if(!Array.isArray(points)||points.length<2)return {value:'—',detail:'لا توجد نقاط كافية للمقارنة',tone:'flat'};
    const a=n(points[0]?.[key]),b=n(points[points.length-1]?.[key]),diff=b-a,base=Math.abs(a),percent=base?diff/base*100:0,tone=diff>0?'up':diff<0?'down':'flat';
    const formatted=type==='money'?money(diff,currency):type==='percent'?pct(diff):num(diff);
    return {value:`${diff>0?'+':''}${formatted}`,detail:`${diff===0?'بدون تغير':`${percent>0?'+':''}${num(percent)}%`} · أول نقطة ← آخر نقطة`,tone};
  }
  function executive(d){
    const c=d?.currency||'EGP',r=rates(d),f=d?.finance||{},a=d?.ads||{},o=d?.overview||{};
    const margin=safeRatio(f.netProfit,f.revenue),expenseRatio=safeRatio(f.expenses,f.revenue),productRatio=safeRatio(f.productCost,f.revenue),realRoas=n(a.realRoas);
    return `<section class="dash-section dash-x-executive" data-dash-executive="122"><div class="dash-x-exec-head"><div><span>EXECUTIVE PULSE</span><h2>نبض المتجر في قراءة واحدة</h2><p>القرار يبدأ من الربحية وجودة الطلب والعائد الحقيقي، ثم تنزل للتفاصيل عند الحاجة.</p></div><div class="dash-x-exec-range">${rangeText(d)}</div></div><div class="dash-x-metrics"><div class="dash-x-metric"><span>الطلبات</span><strong>${num(o.totalOrders)}</strong><small>كل الطلبات الداخلة للنظام</small></div><div class="dash-x-metric"><span>الإيراد المحتسب</span><strong>${money(f.revenue,c)}</strong><small>الإيراد المستخدم في حساب الربحية</small></div><div class="dash-x-metric"><span>صافي الربح</span><strong>${money(f.netProfit,c)}</strong><small>بعد تكلفة المنتج والمصروفات</small><em>هامش ${pct(margin)}</em></div><div class="dash-x-metric"><span>نسبة التأكيد</span><strong>${pct(r.confirmationRate)}</strong><small>${num(r.confirmed)} مؤكد من ${num(r.total)} طلب</small></div><div class="dash-x-metric"><span>نسبة التسليم</span><strong>${pct(r.deliveryRate)}</strong><small>من نتائج الطلبات التي دخلت الشحن</small></div><div class="dash-x-metric"><span>Real ROAS</span><strong>${num(realRoas)}x</strong><small>إيراد الطلبات المسلمة ÷ الإنفاق الإعلاني</small></div></div><div class="dash-x-insights"><div class="dash-x-insight"><span>هيكل التكلفة</span><b>تكلفة المنتج = ${pct(productRatio)} من الإيراد المحتسب</b></div><div class="dash-x-insight"><span>ضغط التشغيل</span><b>المصروفات التشغيلية = ${pct(expenseRatio)} من الإيراد المحتسب</b></div><div class="dash-x-insight"><span>تكلفة الطلب الفعلية</span><b>${money(o.actualOrderCost,c)} لكل طلب داخل النظام</b></div><div class="dash-x-insight"><span>الإنفاق الإعلاني</span><b>${money(o.adSpend,c)} خلال الفترة المختارة</b></div></div></section>`;
  }
  function nav(){return `<nav class="dash-x-nav" aria-label="أقسام الداشبورد">${sectionOrder.map(k=>`<button type="button" data-dx-jump="${k}">${esc(sectionMeta[k][1])}</button>`).join('')}</nav>`;}
  function decorateHero(root){
    const hero=$('.dash-hero',root);if(!hero||hero.dataset.dxHero==='122')return;
    const eyebrow=$('.dash-eyebrow',hero),title=$('.title',hero),sub=$('.sub',hero),side=$('.dash-hero-side',hero);
    if(eyebrow)eyebrow.textContent='Commerce Command Center';
    if(title)title.textContent='لوحة قيادة المتجر';
    if(sub)sub.textContent='من الطلب إلى الربح: رؤية موحدة للتسويق والتشغيل والشحن والمالية، بدون تكرار أو تشتيت.';
    if(side){side.classList.add('dash-x-hero-side');side.innerHTML='<span>مصدر القرار</span><strong>طلبات + إعلانات + مالية + شحن</strong><small>كل المؤشرات مربوطة بنفس سياق الفرع والفترة.</small>';}
    hero.dataset.dxHero='122';
  }
  function decorateSections(root){
    for(const key of sectionOrder){const sec=$(`[data-dash-section="${key}"]`,root),m=sectionMeta[key];if(!sec||!m||sec.dataset.dxCopy==='122')continue;const head=$('.dash-section-head>div:first-child',sec),h=$('h2',head),p=$('p',head);if(head&&!$('.dash-x-kicker',head))head.insertAdjacentHTML('afterbegin',`<span class="dash-x-kicker">${esc(m[0])}</span>`);if(h)h.textContent=m[1];if(p)p.textContent=m[2];sec.dataset.dxCopy='122';}
  }
  function dedupe(root){
    $$('.dash-section-actions .dash-period-control,.dash-section-actions .dash-period-chip,.dash-drill-head>.dash-period-chip',root).forEach(x=>x.remove());
    const hidden=['actualOrderCost','margin','adSpend'];const activeKpi=$('.dash-kpi.active',root);if(activeKpi&&hidden.includes(activeKpi.dataset.dashKpi||''))$('[data-dash-kpi="orders"]',root)?.click();
    hidden.forEach(k=>$(`[data-dash-kpi="${k}"]`,root)?.remove());
    $('[data-dash-section="ads"] .dash-campaign-strip',root)?.remove();
    $('[data-dash-section="ai"] .dash-ai-ad-kpis',root)?.remove();
  }
  function trendDepth(root,d){
    const sec=$('[data-dash-section="trend"]',root),old=$('.dash-trend-head',sec);if(!sec||!old||!d)return;const p=d?.trend?.points||[],c=d?.currency||'EGP';
    const cards=[['الطلبات',changeMeta(p,'orders','count',c)],['الإيرادات',changeMeta(p,'revenue','money',c)],['صافي الربح',changeMeta(p,'netProfit','money',c)],['الإنفاق الإعلاني',changeMeta(p,'adSpend','money',c)]];
    old.className='dash-x-delta-grid';old.innerHTML=cards.map(([label,x])=>`<div class="dash-x-delta"><span>${label}</span><strong><em class="${x.tone}">${esc(x.value)}</em></strong><small>${esc(x.detail)}</small></div>`).join('');
  }
  function ensureStructure(root,d){
    const dashboard=$('.v33-dashboard',root);if(!dashboard)return;
    const toolbar=$('.dash-period-toolbar',root),legacy=$('.dash-range',root);
    if(!$('.dash-x-nav',dashboard)){const target=toolbar||legacy||$('.dash-hero',dashboard);target?.insertAdjacentHTML('afterend',nav());}
    const sig=d?`${d.from}|${d.to}|${n(d.finance?.netProfit)}|${n(d.overview?.totalOrders)}|${n(d.ads?.realRoas)}`:'';
    let exec=$('[data-dash-executive="122"]',dashboard);if(d&&exec?.dataset.sig!==sig){const html=executive(d);if(exec)exec.outerHTML=html;else{const navEl=$('.dash-x-nav',dashboard),insertAfter=navEl||toolbar||legacy||$('.dash-hero',dashboard);insertAfter?.insertAdjacentHTML('afterend',html);}exec=$('[data-dash-executive="122"]',dashboard);if(exec)exec.dataset.sig=sig;}
    const current=$$('[data-dash-section]',dashboard).map(x=>x.dataset.dashSection).filter(Boolean);if(current.join('|')!==sectionOrder.join('|'))for(const k of sectionOrder){const sec=$(`[data-dash-section="${k}"]`,dashboard);if(sec)dashboard.appendChild(sec);}
  }
  function decorate(){
    if(decorating||!active())return;const root=$('#root');if(!root)return;decorating=true;
    try{style();decorateHero(root);ensureStructure(root,lastData);decorateSections(root);dedupe(root);trendDepth(root,lastData);}finally{decorating=false;}
  }
  function schedule(delay=40){clearTimeout(timer);timer=setTimeout(decorate,delay);}
  window.fetch=async function(...args){
    const response=await nativeFetch(...args);try{const input=args[0],url=typeof input==='string'?input:input?.url||'',path=new URL(url,location.origin).pathname;if(path==='/api/dashboard')response.clone().json().then(d=>{if(d?.ok){lastData=d;schedule(25);}}).catch(()=>{});}catch{}return response;
  };
  function hook(){
    style();const root=$('#root');if(root)new MutationObserver(()=>schedule(45)).observe(root,{childList:true,subtree:true});
    document.addEventListener('click',e=>{const jump=e.target.closest?.('[data-dx-jump]');if(jump){e.preventDefault();$(`[data-dash-section="${jump.dataset.dxJump}"]`)?.scrollIntoView({behavior:'smooth',block:'start'});return;}if(e.target.closest?.('.nav button[data-view="dashboard"]'))schedule(240);});
    setTimeout(decorate,350);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',hook);else hook();
  window.KunDashboardExperienceV122={refresh:()=>decorate(),version:VERSION};
})();
