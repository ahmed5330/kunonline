/* Kun Online v123.0 — unified interactive dashboard, active ads only */
(()=>{
  if(window.KunDashboardUnifiedV123)return;
  const VERSION='123.0';
  const nativeFetch=window.fetch.bind(window);
  const state={expert:null,adsTab:'campaigns',provinceView:'quick',timer:0};
  const $=(s,r=document)=>r?.querySelector?.(s)||null;
  const $$=(s,r=document)=>r?[...r.querySelectorAll(s)]:[];
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const n=v=>Number(v)||0;
  const num=v=>new Intl.NumberFormat('ar-EG',{maximumFractionDigits:2}).format(n(v));
  const money=(v,c='EGP')=>`${num(v)} ${String(c||'EGP').toUpperCase()==='EGP'?'ج.م':esc(c)}`;
  const pct=v=>`${num(v)}%`;
  const ratio=v=>`${num(v)}x`;
  const active=()=>$('.nav button.active')?.dataset.view==='dashboard'&&$('.v33-dashboard');
  const isActive=row=>String(row?.status||'').trim().toLowerCase()==='active';
  const activeRows=(data,key)=>Array.isArray(data?.[key]?.rows)?data[key].rows.filter(isActive):[];
  const sum=(rows,key)=>rows.reduce((t,x)=>t+n(x?.[key]),0);

  function style(){
    if($('#kunDashboardUnified123Style'))return;
    const el=document.createElement('style');el.id='kunDashboardUnified123Style';el.textContent=`
      .v33-dashboard [data-dash-section^="ad48-"]{display:none!important}
      .v33-dashboard [data-dash-section="ai"] .dash-ai-analysis{display:none!important}
      .v33-dashboard [data-dash-section="ads"] .dash-ad-summary,.v33-dashboard [data-dash-section="ads"] .dash-ad-grid,.v33-dashboard [data-dash-section="ads"] .dash-campaign-strip{display:none!important}
      .dash-u-tabs{display:flex;gap:6px;align-items:center;overflow:auto;scrollbar-width:none;padding:2px;margin:2px 0 12px}.dash-u-tabs::-webkit-scrollbar{display:none}.dash-u-tab{flex:0 0 auto;border:1px solid var(--line);background:var(--card);color:var(--muted);border-radius:999px;padding:8px 11px;font:inherit;font-size:10px;font-weight:800;cursor:pointer;transition:.16s ease}.dash-u-tab:hover{border-color:#9eb4ca;color:var(--ink)}.dash-u-tab.active{background:#0d47a1;color:#fff;border-color:#0d47a1;box-shadow:0 5px 14px rgba(13,71,161,.17)}.dash-u-tab b{display:inline-grid;place-items:center;min-width:19px;height:19px;margin-inline-start:5px;padding:0 5px;border-radius:999px;background:rgba(255,255,255,.14);font-size:8px}
      .dash-u-active-note{display:flex;align-items:center;gap:8px;margin:0 0 10px;padding:9px 11px;border:1px solid rgba(22,163,74,.2);border-radius:11px;background:rgba(22,163,74,.055);color:#166534;font-size:9.5px;font-weight:700}.dash-u-active-note:before{content:'';width:8px;height:8px;border-radius:50%;background:#22c55e;box-shadow:0 0 0 4px rgba(34,197,94,.11)}
      .dash-u-ad-pulse{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:7px;margin-bottom:11px}.dash-u-ad-pulse>div{padding:11px;border:1px solid var(--line);border-radius:12px;background:linear-gradient(180deg,#fbfdff,#fff);min-width:0}.dash-u-ad-pulse span{display:block;color:var(--muted);font-size:8.5px}.dash-u-ad-pulse strong{display:block;margin-top:4px;font-size:14px;overflow-wrap:anywhere}.dash-u-ad-pulse small{display:block;margin-top:3px;color:var(--muted);font-size:7.8px;line-height:1.4}
      .dash-u-ad-table{width:100%;border-collapse:collapse;min-width:920px}.dash-u-ad-table th,.dash-u-ad-table td{padding:9px 10px;border-bottom:1px solid var(--line);text-align:right;font-size:9.5px;white-space:nowrap}.dash-u-ad-table th{position:sticky;top:0;background:#f7f9fb;color:var(--muted);z-index:1}.dash-u-ad-name{white-space:normal!important;min-width:190px}.dash-u-ad-name b{display:block}.dash-u-ad-name small{display:block;margin-top:2px;color:var(--muted)}.dash-u-status{display:inline-flex;align-items:center;gap:5px;border-radius:999px;padding:4px 7px;background:#eaf8ee;color:#15803d;font-size:8px;font-weight:900}.dash-u-status:before{content:'';width:6px;height:6px;border-radius:50%;background:#22c55e}.dash-u-empty{padding:22px;text-align:center;border:1px dashed var(--line);border-radius:13px;color:var(--muted);font-size:10px}.dash-u-ad-footer{display:flex;align-items:center;gap:8px;margin-top:10px;color:var(--muted);font-size:8.5px}.dash-u-ad-footer .btn{margin-inline-start:auto}
      .dash-u-view-toggle{display:flex;gap:5px;margin-bottom:11px}.dash-u-view-toggle button{border:1px solid var(--line);border-radius:9px;background:var(--card);color:var(--muted);padding:7px 10px;font:inherit;font-size:9px;font-weight:800;cursor:pointer}.dash-u-view-toggle button.active{border-color:#db2777;background:rgba(219,39,119,.07);color:#be185d}.dash-u-province-hidden{display:none!important}
      .dash-u-collapse{width:34px;height:34px;display:grid;place-items:center;border:1px solid var(--line);border-radius:10px;background:var(--card);color:var(--muted);font:inherit;font-size:15px;font-weight:900;cursor:pointer;transition:.15s ease}.dash-u-collapse:hover{border-color:#aabbd0;color:var(--ink);background:#f8fafc}.dash-section.dash-u-collapsed>:not(.dash-section-head){display:none!important}.dash-section.dash-u-collapsed{padding-bottom:13px!important}.dash-section.dash-u-collapsed .dash-section-head{margin-bottom:0!important}.dash-section.dash-u-collapsed .dash-u-collapse{transform:rotate(180deg)}
      .dash-u-count{display:inline-flex;align-items:center;border-radius:999px;padding:5px 8px;background:#eef6ff;color:#0d47a1;font-size:8.5px;font-weight:900;white-space:nowrap}
      body[data-theme="dark"] .dash-u-ad-pulse>div,body[data-theme="dark"] .dash-u-tab,body[data-theme="dark"] .dash-u-view-toggle button,body[data-theme="dark"] .dash-u-collapse{background:var(--card);border-color:var(--line)}body[data-theme="dark"] .dash-u-active-note{color:#86efac;background:rgba(34,197,94,.08)}body[data-theme="dark"] .dash-u-ad-table th{background:#172033}
      @media(max-width:1100px){.dash-u-ad-pulse{grid-template-columns:repeat(3,minmax(0,1fr))}}
      @media(max-width:640px){.dash-u-ad-pulse{grid-template-columns:repeat(2,minmax(0,1fr))}.dash-u-tabs{margin-inline:-3px;padding-inline:3px}.dash-u-collapse{width:32px;height:32px}.dash-u-ad-footer{align-items:flex-start;flex-direction:column}.dash-u-ad-footer .btn{margin-inline-start:0;width:100%}}
      @media(max-width:390px){.dash-u-ad-pulse{grid-template-columns:1fr}}
      @media(prefers-reduced-motion:reduce){.dash-u-tab,.dash-u-collapse{transition:none}}
    `;document.head.appendChild(el);
  }

  function campaignAggregate(rows){
    const spend=sum(rows,'spend'),orders=sum(rows,'realOrders'),delivered=sum(rows,'deliveredOrders'),impressions=sum(rows,'impressions'),clicks=sum(rows,'clicks'),deliveredRevenue=sum(rows,'deliveredRevenue'),platformValue=sum(rows,'platformPurchaseValue');
    return {spend,orders,delivered,ctr:impressions?clicks/impressions*100:0,cpp:orders?spend/orders:0,realRoas:spend?deliveredRevenue/spend:0,platformRoas:spend?platformValue/spend:0};
  }
  function adPulse(data,rows){
    const a=campaignAggregate(rows),c=rows[0]?.currency||'EGP';
    return `<div class="dash-u-ad-pulse"><div><span>الحملات النشطة</span><strong>${num(rows.length)}</strong><small>ACTIVE فقط الآن</small></div><div><span>صرف النشط</span><strong>${money(a.spend,c)}</strong><small>صرف الحملات التي تعمل حاليًا</small></div><div><span>الطلبات الفعلية</span><strong>${num(a.orders)}</strong><small>المنسوبة للحملات النشطة</small></div><div><span>CPP الفعلي</span><strong>${money(a.cpp,c)}</strong><small>Spend ÷ Real Orders</small></div><div><span>Real ROAS</span><strong>${ratio(a.realRoas)}</strong><small>العائد بعد التسليم</small></div><div><span>CTR</span><strong>${pct(a.ctr)}</strong><small>للحملات النشطة فقط</small></div></div>`;
  }
  function campaignTable(rows){
    if(!rows.length)return '<div class="dash-u-empty">لا توجد حملات حالتها ACTIVE حاليًا.</div>';
    const sorted=[...rows].sort((a,b)=>n(b.spend)-n(a.spend));
    return `<div class="dash-table-wrap"><table class="dash-u-ad-table"><thead><tr><th>الحملة النشطة</th><th>الصرف</th><th>الطلبات</th><th>تم التسليم</th><th>CPP فعلي</th><th>Real ROAS</th><th>Platform ROAS</th><th>CTR</th><th>Frequency</th></tr></thead><tbody>${sorted.map(row=>`<tr><td class="dash-u-ad-name"><b>${esc(row.name||'حملة')}</b><small><span class="dash-u-status">نشطة الآن</span></small></td><td>${money(row.spend,row.currency)}</td><td>${num(row.realOrders)}</td><td>${num(row.deliveredOrders)}</td><td>${money(row.realOrderCost,row.currency)}</td><td><b>${ratio(row.realRoas)}</b></td><td>${ratio(row.platformRoas)}</td><td>${pct(row.ctr)}</td><td>${num(row.frequency)}x</td></tr>`).join('')}</tbody></table></div>`;
  }
  function granularTable(rows,kind){
    const isAd=kind==='ads';
    if(!rows.length)return `<div class="dash-u-empty">لا توجد ${isAd?'إعلانات':'مجموعات إعلانية'} حالتها ACTIVE حاليًا.</div>`;
    const sorted=[...rows].sort((a,b)=>n(b.spend)-n(a.spend));
    return `<div class="dash-table-wrap"><table class="dash-u-ad-table"><thead><tr><th>${isAd?'الإعلان النشط':'المجموعة النشطة'}</th><th>${isAd?'المجموعة / الحملة':'الحملة'}</th><th>الصرف</th><th>Purchases</th><th>CPP</th><th>ROAS</th><th>CTR</th><th>CPC</th><th>CPM</th><th>Frequency</th><th>التقييم</th></tr></thead><tbody>${sorted.map(row=>`<tr><td class="dash-u-ad-name"><b>${esc(row.name||'—')}</b><small><span class="dash-u-status">نشط الآن</span> · Score ${num(row.score)}</small></td><td class="dash-u-ad-name">${esc(isAd?`${row.adsetName||'—'} / ${row.campaignName||'—'}`:(row.campaignName||'—'))}</td><td>${money(row.spend,row.currency)}</td><td>${num(row.purchases)}</td><td>${row.purchases?money(row.cpp,row.currency):'—'}</td><td><b>${ratio(row.roas)}</b></td><td>${pct(row.ctr)}</td><td>${money(row.cpc,row.currency)}</td><td>${money(row.cpm,row.currency)}</td><td>${num(row.frequency)}x</td><td>${(row.flags||[]).length?esc(row.flags.join(' · ')):'مراقبة'}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function adsHub(data){
    if(!data)return `<div class="dash-u-active-note">يتم تجهيز قراءة الإعلانات النشطة فقط…</div><div class="dash-u-empty">سيظهر هنا فقط ما يعمل حاليًا بعد اكتمال مزامنة Meta.</div>`;
    if(!data.connected)return `<div class="dash-u-empty">Meta Ads غير متصل بهذا المتجر. لن تُعرض إعلانات تاريخية أو غير نشطة على الصفحة الرئيسية.</div>`;
    const campaigns=activeRows(data,'campaigns'),adsets=activeRows(data,'adsets'),ads=activeRows(data,'ads');
    const tabs=[['campaigns','الحملات',campaigns.length],['adsets','المجموعات',adsets.length],['ads','الإعلانات',ads.length]];
    const panel=state.adsTab==='campaigns'?campaignTable(campaigns):granularTable(state.adsTab==='ads'?ads:adsets,state.adsTab);
    return `<div class="dash-u-active-note">هذه الصفحة تعرض العناصر الإعلانية التي حالتها ACTIVE الآن فقط؛ المتوقف والمؤرشف لا يظهران حتى لو كان لهما صرف تاريخي.</div>${adPulse(data,campaigns)}<div class="dash-u-tabs" role="tablist" aria-label="الإعلانات النشطة">${tabs.map(([key,label,count])=>`<button type="button" class="dash-u-tab ${state.adsTab===key?'active':''}" data-du-ads-tab="${key}" role="tab" aria-selected="${state.adsTab===key?'true':'false'}">${label}<b>${num(count)}</b></button>`).join('')}</div><div class="dash-u-ad-panel">${panel}</div><div class="dash-u-ad-footer"><span>آخر مزامنة: ${esc(String(data.lastSyncAt||'غير متاح').replace('T',' ').slice(0,16))}</span><button type="button" class="btn soft" data-du-sync-ads>↻ مزامنة Meta وتحديث النشط</button></div>`;
  }
  function decorateAds(root){
    const sec=$('[data-dash-section="ads"]',root);if(!sec)return;
    const head=$('.dash-section-head>div:first-child',sec),h=$('h2',head),p=$('p',head);
    if(h)h.textContent='الإعلانات النشطة الآن';
    if(p)p.textContent='قسم موحد للحملات والمجموعات والإعلانات التي تعمل حاليًا فقط، مع نتائج Kun Online الحقيقية بعد التأكيد والتسليم.';
    let hub=$('.dash-u-active-hub',sec);if(!hub){hub=document.createElement('div');hub.className='dash-u-active-hub';sec.appendChild(hub);}
    const sig=[state.adsTab,state.expert?.lastSyncAt,activeRows(state.expert,'campaigns').length,activeRows(state.expert,'adsets').length,activeRows(state.expert,'ads').length].join('|');
    if(hub.dataset.sig!==sig){hub.innerHTML=adsHub(state.expert);hub.dataset.sig=sig;}
  }

  function decorateProvinces(root){
    const sec=$('[data-dash-section="provinces"]',root);if(!sec)return;
    const list=$('.dash-province-list',sec),table=$('.dash-table-wrap',sec);if(!list||!table)return;
    let toggle=$('.dash-u-view-toggle',sec);if(!toggle){toggle=document.createElement('div');toggle.className='dash-u-view-toggle';toggle.innerHTML='<button type="button" data-du-province="quick">نظرة سريعة</button><button type="button" data-du-province="table">الجدول الكامل</button>';const head=$('.dash-section-head',sec);head?.insertAdjacentElement('afterend',toggle);}
    $$('.dash-u-view-toggle button',sec).forEach(b=>b.classList.toggle('active',b.dataset.duProvince===state.provinceView));
    list.classList.toggle('dash-u-province-hidden',state.provinceView!=='quick');
    table.classList.toggle('dash-u-province-hidden',state.provinceView!=='table');
    const h=$('.dash-section-head h2',sec),p=$('.dash-section-head p',sec);if(h)h.textContent='المحافظات وجودة الشحن';if(p)p.textContent='بيانات واحدة بطريقتين للقراءة: نظرة سريعة للقرار أو جدول كامل للتفاصيل، بدون تكرار الاثنين معًا.';
  }

  function addCollapse(root){
    $$('[data-dash-section]',root).filter(sec=>!String(sec.dataset.dashSection||'').startsWith('ad48-')).forEach(sec=>{
      const actions=$('.dash-section-actions',sec);if(!actions||$('.dash-u-collapse',actions))return;
      const b=document.createElement('button');b.type='button';b.className='dash-u-collapse';b.dataset.duCollapse='1';b.title='طي أو فتح القسم';b.setAttribute('aria-label','طي أو فتح القسم');b.textContent='⌃';actions.appendChild(b);
    });
  }
  function cleanDuplicates(root){
    $$('[data-dash-section^="ad48-"]',root).forEach(sec=>sec.setAttribute('aria-hidden','true'));
    $$('[data-dash-section="ai"] .dash-ai-campaigns,[data-dash-section="ai"] .dash-ai-analysis',root).forEach(x=>x.setAttribute('aria-hidden','true'));
  }
  function decorate(){
    if(!active())return;const root=$('#root');if(!root)return;style();cleanDuplicates(root);decorateAds(root);decorateProvinces(root);addCollapse(root);
  }
  function schedule(delay=50){clearTimeout(state.timer);state.timer=setTimeout(decorate,delay);}
  function capture(path,data){
    if(path==='/api/integrations/meta-ads/expert-analysis'&&data?.ok){state.expert=data;schedule(20);}
    if(path==='/api/integrations/meta-ads/expert-sync'&&data?.analysis){state.expert=data.analysis;schedule(20);}
  }
  window.fetch=async function(...args){
    const response=await nativeFetch(...args);try{const input=args[0],url=typeof input==='string'?input:input?.url||'',path=new URL(url,location.origin).pathname;if(path==='/api/integrations/meta-ads/expert-analysis'||path==='/api/integrations/meta-ads/expert-sync')response.clone().json().then(data=>capture(path,data)).catch(()=>{});if(path==='/api/dashboard')schedule(60);}catch{}return response;
  };
  function hook(){
    style();const root=$('#root');if(root)new MutationObserver(()=>schedule(70)).observe(root,{childList:true,subtree:true});
    document.addEventListener('click',e=>{
      const tab=e.target.closest?.('[data-du-ads-tab]');if(tab){state.adsTab=tab.dataset.duAdsTab;decorateAds($('#root'));return;}
      const pv=e.target.closest?.('[data-du-province]');if(pv){state.provinceView=pv.dataset.duProvince;decorateProvinces($('#root'));return;}
      const collapse=e.target.closest?.('[data-du-collapse]');if(collapse){const sec=collapse.closest('[data-dash-section]');if(sec){const closed=sec.classList.toggle('dash-u-collapsed');collapse.setAttribute('aria-expanded',closed?'false':'true');}return;}
      if(e.target.closest?.('[data-du-sync-ads]')){window.KunAdsExpertV48?.sync?.();return;}
      if(e.target.closest?.('.nav button[data-view="dashboard"],[data-dash-preset],#dashApplyRange'))schedule(700);
    },true);
    setTimeout(()=>{decorate();if(active()&&!state.expert)window.KunAdsExpertV48?.refresh?.();},900);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',hook,{once:true});else hook();
  window.KunDashboardUnifiedV123={version:VERSION,refresh:decorate,isActive};
})();
