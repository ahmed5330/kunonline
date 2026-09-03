/* Kun Online v72 — compact Campaign Hub visual density, metric color surfaces and focused comparison view. */
(function(){
  const root=document.getElementById('root');
  if(!root)return;
  const metricOrder=['spend','purchases','cpp','roas','ctr','cpm','frequency'];
  let queued=false;

  function ensureStyle(){
    if(document.getElementById('kunCampaignVisualDensityV72Style'))return;
    const style=document.createElement('style');
    style.id='kunCampaignVisualDensityV72Style';
    style.textContent=`
      /* Campaign Hub: reduce chrome so more business data stays above the fold. */
      .campaign66{gap:10px}
      .campaign66 .page-head{margin-bottom:0}
      .campaign66 .hub-main-tabs{padding:3px;border-radius:12px}
      .campaign66 .hub-main-tabs button{padding:8px 11px;border-radius:9px;min-height:36px}
      .campaign66 .hub-controls{padding:8px 10px;min-height:48px}
      .campaign66 .seg button,.campaign66 .mode-tabs button{padding:6px 10px;min-height:32px}
      .campaign66 .date-card{padding:8px 10px}
      .campaign66 .date-presets{gap:4px}
      .campaign66 .date-presets button{padding:6px 9px;border-radius:8px;font-size:12px;min-height:31px}
      .campaign66 .kpis{gap:7px}
      .campaign66 .kpi{padding:9px 10px;border-radius:12px;min-height:70px;display:flex;flex-direction:column;justify-content:center}
      .campaign66 .kpi small{margin-bottom:3px;font-size:11px}
      .campaign66 .kpi strong{font-size:18px;line-height:1.2}
      .campaign66 .kpi[data-ux72-kpi]{border:1px solid color-mix(in srgb,var(--line,#e5e7eb) 76%,transparent)}
      .campaign66 .kpi[data-ux72-kpi="spend"]{background:color-mix(in srgb,var(--card,#fff) 82%,#3b82f6 18%)}
      .campaign66 .kpi[data-ux72-kpi="purchases"]{background:color-mix(in srgb,var(--card,#fff) 82%,#10b981 18%)}
      .campaign66 .kpi[data-ux72-kpi="cpp"]{background:color-mix(in srgb,var(--card,#fff) 82%,#f59e0b 18%)}
      .campaign66 .kpi[data-ux72-kpi="roas"]{background:color-mix(in srgb,var(--card,#fff) 80%,#22c55e 20%)}
      .campaign66 .kpi[data-ux72-kpi="ctr"]{background:color-mix(in srgb,var(--card,#fff) 82%,#06b6d4 18%)}
      .campaign66 .kpi[data-ux72-kpi="cpc"]{background:color-mix(in srgb,var(--card,#fff) 83%,#8b5cf6 17%)}
      .campaign66 .kpi[data-ux72-kpi="cpm"]{background:color-mix(in srgb,var(--card,#fff) 83%,#a855f7 17%)}
      .campaign66 .kpi[data-ux72-kpi="frequency"]{background:color-mix(in srgb,var(--card,#fff) 84%,#64748b 16%)}

      /* Comparison: compact matrix with both context columns always visible. */
      .campaign67-comparison{gap:9px}
      .campaign67-comparison .ux67-head{gap:8px;align-items:center}
      .campaign67-comparison .ux67-head h3{font-size:16px}
      .campaign67-comparison .ux67-legend{gap:5px;font-size:11px}
      .campaign67-comparison .ux67-legend span{padding:4px 7px}
      .campaign67-comparison .ux67-entity{border-radius:12px}
      .campaign67-comparison .ux67-entity-head{gap:7px;padding:8px 10px}
      .campaign67-comparison .ux67-entity-head h4{font-size:13px;line-height:1.3}
      .campaign67-comparison .ux67-entity-head .muted{font-size:10px}
      .campaign67-comparison .ux67-summary{gap:4px}
      .campaign67-comparison .ux67-summary span{min-width:62px;padding:4px 6px;border-radius:7px;text-align:center}
      .campaign67-comparison .ux67-summary small{font-size:9px}
      .campaign67-comparison .ux67-summary b{font-size:11px}
      .campaign67-comparison .ux67-summary span[data-ux72-summary="spend"]{background:color-mix(in srgb,var(--card,#fff) 80%,#3b82f6 20%)}
      .campaign67-comparison .ux67-summary span[data-ux72-summary="purchases"]{background:color-mix(in srgb,var(--card,#fff) 80%,#10b981 20%)}
      .campaign67-comparison .ux67-summary span[data-ux72-summary="cpp"]{background:color-mix(in srgb,var(--card,#fff) 80%,#f59e0b 20%)}
      .campaign67-comparison .ux67-summary span[data-ux72-summary="roas"]{background:color-mix(in srgb,var(--card,#fff) 78%,#22c55e 22%)}
      .campaign67-comparison .ux67-scroll{overflow:auto;direction:ltr;scrollbar-gutter:stable both-edges;overscroll-behavior-inline:contain;padding-bottom:2px;background:var(--card,#fff)}
      .campaign67-comparison .ux67-matrix{border-collapse:separate;border-spacing:0;min-width:max-content;width:100%;direction:ltr}
      .campaign67-comparison .ux67-matrix th,.campaign67-comparison .ux67-matrix td{box-sizing:border-box;min-width:88px;width:88px;padding:5px 6px;border-bottom:1px solid var(--line,#e5e7eb);border-inline-end:1px solid var(--line,#e5e7eb);text-align:center;white-space:nowrap;background:var(--card,#fff);font-size:11px}
      .campaign67-comparison .ux67-matrix thead th{position:sticky;top:0;z-index:3;font-size:10px;line-height:1.25;padding-block:6px;color:var(--muted,#64748b);font-weight:800;background:var(--card,#fff)}
      .campaign67-comparison .ux67-matrix thead th small{font-size:9px;opacity:.78}
      .campaign67-comparison .ux67-matrix .ux67-metric-col{position:sticky;left:0;z-index:5;box-sizing:border-box;min-width:132px;max-width:132px;width:132px;padding:6px 8px;text-align:right;direction:rtl;background:var(--card,#fff);box-shadow:10px 0 18px -18px rgba(15,23,42,.8)}
      .campaign67-comparison .ux67-matrix thead .ux67-metric-col{z-index:7}
      .campaign67-comparison .ux67-metric-col b{display:block;font-size:11px}
      .campaign67-comparison .ux67-metric-col small{display:block;font-size:9px;margin-top:1px;color:var(--muted,#64748b)}
      .campaign67-comparison .ux67-value{display:inline-flex;align-items:center;justify-content:center;position:relative;box-sizing:border-box;min-width:50px;padding:4px 6px;border:1px solid color-mix(in srgb,var(--line,#e5e7eb) 82%,transparent);border-radius:7px;font-size:11px;line-height:1.15;font-weight:800;cursor:default;transition:transform .15s ease,box-shadow .15s ease;box-shadow:none}
      .campaign67-comparison .ux67-value[data-ux67-signal]{cursor:pointer}
      .campaign67-comparison .ux67-value[data-ux67-signal]:hover{transform:translateY(-1px)}
      .campaign67-comparison .ux67-value[data-ux72-metric="spend"]{background:color-mix(in srgb,var(--card,#fff) 78%,#3b82f6 22%)}
      .campaign67-comparison .ux67-value[data-ux72-metric="purchases"]{background:color-mix(in srgb,var(--card,#fff) 76%,#10b981 24%)}
      .campaign67-comparison .ux67-value[data-ux72-metric="cpp"]{background:color-mix(in srgb,var(--card,#fff) 76%,#f59e0b 24%)}
      .campaign67-comparison .ux67-value[data-ux72-metric="roas"]{background:color-mix(in srgb,var(--card,#fff) 74%,#22c55e 26%)}
      .campaign67-comparison .ux67-value[data-ux72-metric="ctr"]{background:color-mix(in srgb,var(--card,#fff) 76%,#06b6d4 24%)}
      .campaign67-comparison .ux67-value[data-ux72-metric="cpm"]{background:color-mix(in srgb,var(--card,#fff) 78%,#a855f7 22%)}
      .campaign67-comparison .ux67-value[data-ux72-metric="frequency"]{background:color-mix(in srgb,var(--card,#fff) 80%,#64748b 20%)}
      .campaign67-comparison .ux67-value.high{background:color-mix(in srgb,var(--card,#fff) 68%,#ef4444 32%);border-color:#dc2626;box-shadow:0 0 0 1px rgba(220,38,38,.12)}
      .campaign67-comparison .ux67-value.watch{background:color-mix(in srgb,var(--card,#fff) 67%,#f59e0b 33%);border-color:#d97706;box-shadow:0 0 0 1px rgba(217,119,6,.12)}
      .campaign67-comparison .ux67-value.good{background:color-mix(in srgb,var(--card,#fff) 66%,#22c55e 34%);border-color:#16a34a;box-shadow:0 0 0 1px rgba(22,163,74,.12)}
      .campaign67-comparison .ux67-marker{position:absolute;top:-7px;right:-7px;width:16px;height:16px;border-radius:50%;display:grid;place-items:center;font-size:9px;font-weight:900;color:white;box-shadow:0 1px 5px rgba(15,23,42,.25)}
      .campaign67-comparison .ux67-value.high .ux67-marker{background:#dc2626}.campaign67-comparison .ux67-value.watch .ux67-marker{background:#d97706}.campaign67-comparison .ux67-value.good .ux67-marker{background:#16a34a}
      .campaign67-comparison .ux67-matrix thead th:last-child{position:sticky;right:0;z-index:7;background:color-mix(in srgb,var(--card,#fff) 88%,#64748b 12%);box-shadow:-10px 0 18px -18px rgba(15,23,42,.9)}
      .campaign67-comparison .ux67-matrix tbody td:last-child{position:sticky;right:0;z-index:4;background:color-mix(in srgb,var(--card,#fff) 90%,#64748b 10%);box-shadow:-10px 0 18px -18px rgba(15,23,42,.9)}
      .campaign67-comparison .ux67-analysis{padding:8px 10px 10px;direction:rtl;background:color-mix(in srgb,var(--card,#fff) 96%,#64748b 4%)}
      .campaign67-comparison .ux67-analysis-title{display:flex;gap:8px;align-items:center;margin-bottom:6px}
      .campaign67-comparison .ux67-analysis-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}
      .campaign67-comparison .ux67-insight{position:relative;display:grid;grid-template-columns:auto 1fr;gap:7px;padding:8px;border:1px solid var(--line,#e5e7eb);border-radius:9px;background:var(--card,#fff);scroll-margin-top:90px}
      .campaign67-comparison .ux67-insight p{margin:2px 0;font-size:10px;line-height:1.55;color:var(--muted,#64748b)}
      .campaign67-comparison .ux67-insight strong,.campaign67-comparison .ux67-insight em{font-size:10px}
      .campaign67-comparison .ux72-expand{display:inline-flex;align-items:center;gap:5px;white-space:nowrap;padding:6px 9px;min-height:31px}
      .campaign67-comparison .ux72-expand-icon{font-size:14px;line-height:1}
      body.ux72-no-scroll{overflow:hidden}
      .campaign67-comparison.ux72-focus{position:fixed;inset:10px;z-index:10000;overflow:auto;padding:10px;border:1px solid var(--line,#e5e7eb);border-radius:16px;background:var(--bg,#f8fafc);box-shadow:0 24px 80px rgba(15,23,42,.28)}
      .campaign67-comparison.ux72-focus .ux67-head{position:sticky;top:-10px;z-index:50;padding:10px;margin:-10px -10px 8px;background:color-mix(in srgb,var(--bg,#f8fafc) 94%,transparent);backdrop-filter:blur(10px);border-bottom:1px solid var(--line,#e5e7eb)}
      .campaign67-comparison.ux72-focus .ux67-scroll{max-height:62vh}
      .campaign67-comparison.ux72-focus .ux67-matrix th,.campaign67-comparison.ux72-focus .ux67-matrix td{min-width:94px;width:94px}
      .campaign67-comparison.ux72-focus .ux67-matrix .ux67-metric-col{min-width:138px;max-width:138px;width:138px}
      @media(min-width:1280px){.campaign66 .kpis{grid-template-columns:repeat(8,minmax(0,1fr))}}
      @media(max-width:900px){.campaign67-comparison .ux67-matrix th,.campaign67-comparison .ux67-matrix td{min-width:82px;width:82px;padding:5px}.campaign67-comparison .ux67-matrix .ux67-metric-col{min-width:122px;max-width:122px;width:122px}.campaign67-comparison .ux67-summary span{min-width:58px}}
      @media(max-width:560px){.campaign66{gap:8px}.campaign66 .hub-controls,.campaign66 .date-card{padding:7px}.campaign67-comparison .ux72-expand .ux72-expand-text{display:none}.campaign67-comparison.ux72-focus{inset:4px;padding:6px;border-radius:10px}.campaign67-comparison.ux72-focus .ux67-head{top:-6px;margin:-6px -6px 6px;padding:8px}.campaign67-comparison .ux67-matrix th,.campaign67-comparison .ux67-matrix td{min-width:78px;width:78px}.campaign67-comparison .ux67-matrix .ux67-metric-col{min-width:112px;max-width:112px;width:112px}}
    `;
    document.head.appendChild(style);
  }

  function metricFromLabel(label=''){
    const text=String(label).trim().toLowerCase();
    if(/spend|إنفاق/.test(text))return 'spend';
    if(/purchase|order|مشتريات|طلبات/.test(text))return 'purchases';
    if(/roas|عائد/.test(text))return 'roas';
    if(/cpp|تكلفة الشراء/.test(text))return 'cpp';
    if(/ctr|نسبة النقر/.test(text))return 'ctr';
    if(/cpc/.test(text))return 'cpc';
    if(/cpm/.test(text))return 'cpm';
    if(/frequency|تكرار/.test(text))return 'frequency';
    return '';
  }

  function decorateKpis(){
    root.querySelectorAll('.campaign66 .kpi').forEach(card=>{
      const metric=metricFromLabel(card.querySelector('small')?.textContent||'');
      if(metric)card.dataset.ux72Kpi=metric;
    });
  }

  function decorateComparison(){
    const comparison=root.querySelector('.campaign67-comparison');
    const campaignShell=root.querySelector('.campaign66');
    if(campaignShell)campaignShell.classList.toggle('ux72-comparison-mode',!!comparison);
    if(!comparison)return;
    ensureStyle();
    comparison.dataset.ux72='1';
    comparison.querySelectorAll('.ux67-matrix tbody tr').forEach((row,index)=>{
      const metric=metricOrder[index]||'';
      if(!metric)return;
      row.dataset.ux72Metric=metric;
      row.querySelectorAll('.ux67-value').forEach(value=>value.dataset.ux72Metric=metric);
    });
    comparison.querySelectorAll('.ux67-summary span').forEach(item=>{
      const metric=metricFromLabel(item.querySelector('small')?.textContent||'');
      if(metric)item.dataset.ux72Summary=metric;
    });
    const head=comparison.querySelector('.ux67-head');
    if(head&&!head.querySelector('[data-ux72-expand]')){
      const button=document.createElement('button');
      button.type='button';button.className='btn soft ux72-expand';button.dataset.ux72Expand='1';button.title='فتح المقارنة في عرض موسع';button.setAttribute('aria-label','فتح المقارنة في عرض موسع');button.setAttribute('aria-pressed','false');
      button.innerHTML='<span class="ux72-expand-icon" aria-hidden="true">⛶</span><span class="ux72-expand-text">عرض موسّع</span>';
      const spacer=head.querySelector('.spacer');
      if(spacer)spacer.before(button);else head.appendChild(button);
    }
  }

  function exitFocus(comparison){
    if(!comparison)return;
    comparison.classList.remove('ux72-focus');
    document.body.classList.remove('ux72-no-scroll');
    const button=comparison.querySelector('[data-ux72-expand]');
    if(button){button.setAttribute('aria-pressed','false');button.title='فتح المقارنة في عرض موسع';button.setAttribute('aria-label','فتح المقارنة في عرض موسع');const text=button.querySelector('.ux72-expand-text');if(text)text.textContent='عرض موسّع';}
  }

  function toggleFocus(button){
    const comparison=button.closest('.campaign67-comparison');if(!comparison)return;
    const opening=!comparison.classList.contains('ux72-focus');
    if(!opening){exitFocus(comparison);return;}
    document.querySelectorAll('.campaign67-comparison.ux72-focus').forEach(exitFocus);
    comparison.classList.add('ux72-focus');document.body.classList.add('ux72-no-scroll');button.setAttribute('aria-pressed','true');button.title='إغلاق العرض الموسع';button.setAttribute('aria-label','إغلاق العرض الموسع');const text=button.querySelector('.ux72-expand-text');if(text)text.textContent='إغلاق العرض';comparison.scrollTop=0;
  }

  function enhance(){queued=false;ensureStyle();decorateKpis();decorateComparison();}
  function queueEnhance(){if(queued)return;queued=true;queueMicrotask(enhance);}

  root.addEventListener('click',event=>{const button=event.target.closest?.('[data-ux72-expand]');if(button){event.preventDefault();toggleFocus(button);}});
  document.addEventListener('keydown',event=>{if(event.key!=='Escape')return;document.querySelectorAll('.campaign67-comparison.ux72-focus').forEach(exitFocus);});
  new MutationObserver(queueEnhance).observe(root,{childList:true,subtree:true});
  window.addEventListener('kun:section-reloaded',()=>setTimeout(queueEnhance,0));
  document.addEventListener('click',event=>{if(event.target.closest?.('.campaign66 [data-section-mode],.campaign66 [data-campaign-section],.campaign66 [data-date-preset],.campaign66 [data-status]'))setTimeout(queueEnhance,0);},true);
  window.KunCampaignVisualDensityV72={enhance,toggleFocus,exitFocus,metricFromLabel,version:'72.0'};
  document.documentElement.dataset.campaignVisualDensity='v72-ready';
  setTimeout(queueEnhance,0);
})();