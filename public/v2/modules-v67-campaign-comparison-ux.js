/* Kun Online v67 — expert comparison UX layer for Campaign Hub v66. */
(function(){
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]));
  const n=v=>Number.isFinite(Number(v))?Number(v):0;
  const money=v=>n(v).toLocaleString('ar-EG',{maximumFractionDigits:2});
  const integer=v=>Math.round(n(v)).toLocaleString('ar-EG');
  const levelLabels={campaign:'الحملات',adset:'المجموعات الإعلانية',ad:'الإعلانات'};
  const metrics=[
    {key:'spend',label:'الإنفاق',hint:'Spend',format:v=>`${money(v)} ج`},
    {key:'purchases',label:'المشتريات',hint:'Purchases',format:v=>integer(v)},
    {key:'cpp',label:'تكلفة الشراء',hint:'CPP',format:v=>`${money(v)} ج`},
    {key:'roas',label:'العائد على الإنفاق',hint:'ROAS',format:v=>`${money(v)}x`},
    {key:'ctr',label:'نسبة النقر',hint:'CTR',format:v=>`${money(v)}%`},
    {key:'cpm',label:'تكلفة ألف ظهور',hint:'CPM',format:v=>`${money(v)} ج`},
    {key:'frequency',label:'التكرار',hint:'Frequency',format:v=>money(v)}
  ];
  const severityRank={high:3,watch:2,good:1};

  function ensureStyle(){
    if(document.getElementById('kunCampaignUXV67Style'))return;
    const s=document.createElement('style');s.id='kunCampaignUXV67Style';s.textContent=`
      .campaign67-comparison{display:grid;gap:14px}
      .campaign67-comparison .ux67-head{display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap}
      .campaign67-comparison .ux67-head .spacer{flex:1}
      .campaign67-comparison .ux67-legend{display:flex;gap:8px;flex-wrap:wrap;align-items:center;font-size:12px;color:var(--muted,#64748b)}
      .campaign67-comparison .ux67-legend span{display:inline-flex;align-items:center;gap:5px;padding:5px 8px;border:1px solid var(--line,#e5e7eb);border-radius:999px;background:var(--card,#fff)}
      .campaign67-comparison .ux67-dot{width:9px;height:9px;border-radius:50%;display:inline-block}
      .campaign67-comparison .ux67-dot.high{background:#dc2626}.campaign67-comparison .ux67-dot.watch{background:#d97706}.campaign67-comparison .ux67-dot.good{background:#16a34a}
      .campaign67-comparison .ux67-entity{border:1px solid var(--line,#e5e7eb);border-radius:16px;background:var(--card,#fff);overflow:hidden}
      .campaign67-comparison .ux67-entity-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:13px 14px;border-bottom:1px solid var(--line,#e5e7eb);direction:rtl}
      .campaign67-comparison .ux67-entity-head h4{margin:0;font-size:15px}.campaign67-comparison .ux67-entity-head .muted{font-size:12px}
      .campaign67-comparison .ux67-summary{display:flex;gap:7px;flex-wrap:wrap;margin-inline-start:auto}
      .campaign67-comparison .ux67-summary span{display:grid;gap:1px;min-width:72px;padding:6px 8px;border:1px solid var(--line,#e5e7eb);border-radius:9px;text-align:center}
      .campaign67-comparison .ux67-summary small{font-size:10px;color:var(--muted,#64748b)}.campaign67-comparison .ux67-summary b{font-size:12px}
      .campaign67-comparison .ux67-scroll{overflow:auto;direction:ltr;scrollbar-gutter:stable;padding-bottom:2px;background:var(--card,#fff)}
      .campaign67-comparison .ux67-matrix{border-collapse:separate;border-spacing:0;min-width:max-content;width:100%;direction:ltr}
      .campaign67-comparison .ux67-matrix th,.campaign67-comparison .ux67-matrix td{min-width:116px;padding:10px 12px;border-bottom:1px solid var(--line,#e5e7eb);border-inline-end:1px solid var(--line,#e5e7eb);text-align:center;white-space:nowrap;background:var(--card,#fff)}
      .campaign67-comparison .ux67-matrix thead th{position:sticky;top:0;z-index:3;font-size:11px;color:var(--muted,#64748b);font-weight:800;background:var(--card,#fff)}
      .campaign67-comparison .ux67-matrix .ux67-metric-col{position:sticky;left:0;z-index:5;min-width:166px;max-width:166px;text-align:right;direction:rtl;background:var(--card,#fff);box-shadow:10px 0 18px -18px rgba(15,23,42,.8)}
      .campaign67-comparison .ux67-matrix thead .ux67-metric-col{z-index:7}
      .campaign67-comparison .ux67-metric-col b{display:block;font-size:12px}.campaign67-comparison .ux67-metric-col small{display:block;font-size:10px;color:var(--muted,#64748b);margin-top:2px}
      .campaign67-comparison .ux67-matrix tbody tr:hover td,.campaign67-comparison .ux67-matrix tbody tr:hover th{background:color-mix(in srgb,var(--card,#fff) 92%,#64748b 8%)}
      .campaign67-comparison .ux67-value{display:inline-flex;align-items:center;justify-content:center;position:relative;min-width:58px;padding:5px 9px;border:1px solid transparent;border-radius:999px;font-weight:800;cursor:default;transition:transform .15s ease,box-shadow .15s ease}
      .campaign67-comparison .ux67-value[data-ux67-signal]{cursor:pointer}
      .campaign67-comparison .ux67-value[data-ux67-signal]:hover{transform:translateY(-1px)}
      .campaign67-comparison .ux67-value.high{border-color:#dc2626;background:rgba(220,38,38,.08);box-shadow:0 0 0 2px rgba(220,38,38,.08)}
      .campaign67-comparison .ux67-value.watch{border-color:#d97706;background:rgba(217,119,6,.08);box-shadow:0 0 0 2px rgba(217,119,6,.08)}
      .campaign67-comparison .ux67-value.good{border-color:#16a34a;background:rgba(22,163,74,.08);box-shadow:0 0 0 2px rgba(22,163,74,.08)}
      .campaign67-comparison .ux67-marker{position:absolute;top:-8px;right:-8px;width:18px;height:18px;border-radius:50%;display:grid;place-items:center;font-size:10px;font-weight:900;color:white;box-shadow:0 1px 5px rgba(15,23,42,.25)}
      .campaign67-comparison .ux67-value.high .ux67-marker{background:#dc2626}.campaign67-comparison .ux67-value.watch .ux67-marker{background:#d97706}.campaign67-comparison .ux67-value.good .ux67-marker{background:#16a34a}
      .campaign67-comparison .ux67-analysis{padding:12px 14px 14px;direction:rtl;background:color-mix(in srgb,var(--card,#fff) 96%,#64748b 4%)}
      .campaign67-comparison .ux67-analysis-title{display:flex;gap:8px;align-items:center;margin-bottom:9px}.campaign67-comparison .ux67-analysis-title b{font-size:13px}.campaign67-comparison .ux67-analysis-title span{font-size:11px;color:var(--muted,#64748b)}
      .campaign67-comparison .ux67-analysis-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
      .campaign67-comparison .ux67-insight{position:relative;display:grid;grid-template-columns:auto 1fr;gap:9px;padding:10px;border:1px solid var(--line,#e5e7eb);border-radius:11px;background:var(--card,#fff);scroll-margin-top:90px}
      .campaign67-comparison .ux67-insight.high{border-inline-start:4px solid #dc2626}.campaign67-comparison .ux67-insight.watch{border-inline-start:4px solid #d97706}.campaign67-comparison .ux67-insight.good{border-inline-start:4px solid #16a34a}
      .campaign67-comparison .ux67-insight-marker{width:24px;height:24px;border-radius:50%;display:grid;place-items:center;color:#fff;font-size:11px;font-weight:900}.campaign67-comparison .ux67-insight.high .ux67-insight-marker{background:#dc2626}.campaign67-comparison .ux67-insight.watch .ux67-insight-marker{background:#d97706}.campaign67-comparison .ux67-insight.good .ux67-insight-marker{background:#16a34a}
      .campaign67-comparison .ux67-insight strong{font-size:12px}.campaign67-comparison .ux67-insight p{margin:3px 0;font-size:11px;color:var(--muted,#64748b);line-height:1.7}.campaign67-comparison .ux67-insight em{font-style:normal;font-size:11px;font-weight:700}
      .campaign67-comparison .ux67-insight.flash{animation:ux67Flash 1.1s ease}
      .campaign67-comparison .ux67-no-signal{padding:10px;border:1px dashed var(--line,#e5e7eb);border-radius:10px;color:var(--muted,#64748b);font-size:12px;background:var(--card,#fff)}
      .campaign67-comparison .ux67-empty{padding:22px;text-align:center;color:var(--muted,#64748b)}
      @keyframes ux67Flash{0%,100%{transform:none}35%{transform:scale(1.012);box-shadow:0 0 0 3px rgba(59,130,246,.14)}}
      @media(max-width:760px){.campaign67-comparison .ux67-analysis-grid{grid-template-columns:1fr}.campaign67-comparison .ux67-summary{width:100%;margin:0}.campaign67-comparison .ux67-matrix th,.campaign67-comparison .ux67-matrix td{min-width:104px;padding:9px}.campaign67-comparison .ux67-matrix .ux67-metric-col{min-width:145px;max-width:145px}}
    `;document.head.appendChild(s);
  }
  function statusBadge(status){const v=String(status||'').toLowerCase();const label=v==='active'?'شغالة':v.includes('paused')?'متوقفة':v==='archived'?'مؤرشفة':v||'—';return `<span class="badge ${v==='active'?'b-delivered':v.includes('paused')||v==='archived'?'b-pending':'b-cancelled'}">${esc(label)}</span>`;}
  function dateLabel(value){try{return new Intl.DateTimeFormat('ar-EG',{day:'numeric',month:'short',timeZone:'Africa/Cairo'}).format(new Date(`${value}T12:00:00Z`));}catch{return value;}}
  function change(cur,prev){const a=n(cur),b=n(prev);return b?((a-b)/Math.abs(b))*100:null;}
  function addSignal(list,signal){if(!signal||!signal.metric||!signal.date)return;list.push(signal);}
  function buildSignals(row,dates){
    const daily=Array.isArray(row?.daily)?row.daily:[],candidates=[];
    for(let i=0;i<daily.length;i++){
      const d=daily[i]||{},date=dates[i]||String(i+1),prev=i?daily[i-1]||{}:null;
      if(n(d.spend)>0&&n(d.purchases)===0)addSignal(candidates,{metric:'purchases',date,severity:'high',score:130+n(d.spend),title:'إنفاق بدون مشتريات',reason:`تم إنفاق ${money(d.spend)} ج في ${dateLabel(date)} بدون تسجيل مشتريات.`,action:'راجع التتبع وجودة الزيارات والكرياتيف قبل استمرار نفس مستوى الإنفاق.'});
      if(!prev)continue;
      const roasCh=change(d.roas,prev.roas),cppCh=change(d.cpp,prev.cpp),ctrCh=change(d.ctr,prev.ctr),cpmCh=change(d.cpm,prev.cpm),spendCh=change(d.spend,prev.spend);
      if(roasCh!=null&&roasCh<=-30&&n(d.spend)>0)addSignal(candidates,{metric:'roas',date,severity:'high',score:110+Math.abs(roasCh),title:'هبوط واضح في ROAS',reason:`ROAS انخفض ${money(Math.abs(roasCh))}% مقارنة باليوم السابق.`,action:'راجع مصدر الهبوط قبل زيادة الميزانية؛ ابدأ بالكرياتيف والجمهور ثم صفحة المنتج/الشراء.'});
      else if(roasCh!=null&&roasCh>=35&&n(d.purchases)>0)addSignal(candidates,{metric:'roas',date,severity:'good',score:45+roasCh,title:'تحسن يستحق المتابعة في ROAS',reason:`ROAS ارتفع ${money(roasCh)}% مقارنة باليوم السابق مع وجود مشتريات.`,action:'راقب ثبات التحسن قبل التوسيع، ثم زد الميزانية تدريجيًا إذا استمر الأداء.'});
      if(cppCh!=null&&cppCh>=30&&n(d.purchases)>0)addSignal(candidates,{metric:'cpp',date,severity:'high',score:105+cppCh,title:'ارتفاع تكلفة الشراء',reason:`CPP ارتفع ${money(cppCh)}% عن اليوم السابق.`,action:'قارن CTR وCPM وFrequency لتحديد هل المشكلة من الإعلان، المزاد، أم التشبع.'});
      else if(cppCh!=null&&cppCh<=-25&&n(d.purchases)>0)addSignal(candidates,{metric:'cpp',date,severity:'good',score:42+Math.abs(cppCh),title:'تحسن تكلفة الشراء',reason:`CPP تحسن ${money(Math.abs(cppCh))}% عن اليوم السابق.`,action:'حافظ على المتغيرات الحالية وراقب هل التحسن مستمر قبل التوسع.'});
      if(ctrCh!=null&&ctrCh<=-25&&n(d.spend)>0)addSignal(candidates,{metric:'ctr',date,severity:'watch',score:80+Math.abs(ctrCh),title:'CTR يتراجع',reason:`نسبة النقر انخفضت ${money(Math.abs(ctrCh))}% عن اليوم السابق.`,action:'راجع الـHook والصورة/الفيديو والنص، خصوصًا إذا كان Frequency يرتفع في نفس الوقت.'});
      if(cpmCh!=null&&cpmCh>=30&&n(d.spend)>0)addSignal(candidates,{metric:'cpm',date,severity:'watch',score:75+cpmCh,title:'CPM أعلى من اليوم السابق',reason:`تكلفة ألف ظهور ارتفعت ${money(cpmCh)}%.`,action:'راجع شدة المنافسة وحجم الجمهور والـPlacement قبل الحكم على الكرياتيف وحده.'});
      if(spendCh!=null&&spendCh>=35&&roasCh!=null&&roasCh<=-20)addSignal(candidates,{metric:'spend',date,severity:'high',score:120+spendCh+Math.abs(roasCh),title:'الإنفاق زاد بينما الكفاءة انخفضت',reason:`الإنفاق زاد ${money(spendCh)}% بالتزامن مع هبوط ROAS ${money(Math.abs(roasCh))}%.`,action:'أوقف الزيادة مؤقتًا وحدد هل التوسع سبب تدهور الكفاءة قبل ضخ ميزانية إضافية.'});
    }
    const total=row?.total||{};
    if(n(total.frequency)>=3.5)addSignal(candidates,{metric:'frequency',date:'__total__',severity:'watch',score:86+n(total.frequency)*4,title:'Frequency مرتفع خلال الفترة',reason:`التكرار وصل إلى ${money(total.frequency)} خلال الفترة المختارة.`,action:'راقب علامات إجهاد الكرياتيف؛ جهّز نسخة/زاوية جديدة إذا CTR أو ROAS يتراجعان.'});
    const seen=new Set(),selected=[];
    candidates.sort((a,b)=>(severityRank[b.severity]-severityRank[a.severity])||(b.score-a.score));
    for(const s of candidates){const key=`${s.metric}:${s.date}`;if(seen.has(key))continue;seen.add(key);selected.push({...s,id:selected.length+1});if(selected.length>=6)break;}
    return selected;
  }
  function signalMap(signals){return new Map(signals.map(s=>[`${s.metric}:${s.date}`,s]));}
  function valueCell(metric,day,date,map){const signal=map.get(`${metric.key}:${date}`),value=metric.format(day?.[metric.key]);return `<span class="ux67-value ${signal?signal.severity:''}" ${signal?`data-ux67-signal="${signal.id}" title="${esc(signal.title)}"`:''}>${value}${signal?`<sup class="ux67-marker">${signal.id}</sup>`:''}</span>`;}
  function insightHtml(signal,entityIndex){const label=signal.severity==='high'?'راجع الآن':signal.severity==='watch'?'راقب':'فرصة إيجابية';return `<div class="ux67-insight ${signal.severity}" id="ux67Insight-${entityIndex}-${signal.id}"><div class="ux67-insight-marker">${signal.id}</div><div><strong>${esc(signal.title)} · ${label}</strong><p>${esc(signal.reason)}</p><em>${esc(signal.action)}</em></div></div>`;}
  function entityCard(row,dates,index){
    const signals=buildSignals(row,dates),map=signalMap(signals),daily=Array.isArray(row.daily)?row.daily:[],total=row.total||{},parent=[row.campaignName,row.adsetName].filter(Boolean).join(' · ');
    const header=`<div class="ux67-entity-head"><div><h4>${esc(row.name||'بدون اسم')}</h4>${parent?`<div class="muted">${esc(parent)}</div>`:''}</div>${statusBadge(row.status)}<div class="ux67-summary"><span><small>Spend</small><b>${money(total.spend)} ج</b></span><span><small>Purchases</small><b>${integer(total.purchases)}</b></span><span><small>CPP</small><b>${money(total.cpp)} ج</b></span><span><small>ROAS</small><b>${money(total.roas)}x</b></span></div></div>`;
    const table=`<div class="ux67-scroll"><table class="ux67-matrix"><thead><tr><th class="ux67-metric-col">المعيار الأساسي</th>${dates.map(d=>`<th><b>${esc(dateLabel(d))}</b><small style="display:block">${esc(d)}</small></th>`).join('')}<th>إجمالي الفترة</th></tr></thead><tbody>${metrics.map(metric=>`<tr><th class="ux67-metric-col"><b>${metric.label}</b><small>${metric.hint}</small></th>${dates.map((date,i)=>`<td>${valueCell(metric,daily[i]||{},date,map)}</td>`).join('')}<td>${valueCell(metric,total,'__total__',map)}</td></tr>`).join('')}</tbody></table></div>`;
    const analysis=`<div class="ux67-analysis"><div class="ux67-analysis-title"><b>الأرقام التي تستحق النظر</b><span>الأرقام المحاطة بعلامة لها تفسير وإجراء مقترح هنا.</span></div>${signals.length?`<div class="ux67-analysis-grid">${signals.map(s=>insightHtml(s,index)).join('')}</div>`:'<div class="ux67-no-signal">لا توجد إشارة قوية أو تغير غير طبيعي يستحق وضع علامة في الفترة الحالية. استمر في المتابعة بدل اتخاذ قرار من حركة صغيرة.</div>'}</div>`;
    return `<section class="ux67-entity" data-ux67-entity="${index}">${header}${table}${analysis}</section>`;
  }
  function enhance(){
    const hub=window.KunCampaignHubV66,root=document.getElementById('root');if(!hub||!root)return;
    const level=hub.state?.level,section=hub.state?.sections?.[level];if(!level||section?.mode!=='comparison'||!section?.comparison)return;
    const oldTable=root.querySelector('.campaign66 table.compare');if(!oldTable)return;const card=oldTable.closest('.card');if(!card||card.dataset.ux67==='1')return;
    ensureStyle();const data=section.comparison||{},rows=Array.isArray(data.rows)?data.rows:[],dates=Array.isArray(data.dates)?data.dates:[],range=typeof hub.rangeFor==='function'?hub.rangeFor(level):null;card.dataset.ux67='1';
    card.innerHTML=`<div class="campaign67-comparison"><div class="ux67-head"><div><h3 style="margin:0">مقارنة ${esc(levelLabels[level]||level)} — قراءة بصرية</h3><div class="muted">المعايير الأساسية ثابتة على الشمال، والأيام تتحرك فقط. ${range?`${esc(range.from)} ← ${esc(range.to)}`:''}</div></div><div class="spacer"></div><div class="ux67-legend"><span><i class="ux67-dot high"></i>راجع الآن</span><span><i class="ux67-dot watch"></i>راقب</span><span><i class="ux67-dot good"></i>فرصة إيجابية</span></div></div>${rows.length?rows.map((row,i)=>entityCard(row,dates,i)).join(''):'<div class="ux67-empty">لا توجد عناصر مطابقة للفترة والفلتر الحاليين.</div>'}</div>`;
  }
  function focusSignal(event){const hit=event.target.closest?.('[data-ux67-signal]');if(!hit)return;const entity=hit.closest('[data-ux67-entity]'),id=hit.dataset.ux67Signal,index=entity?.dataset.ux67Entity,target=document.getElementById(`ux67Insight-${index}-${id}`);if(!target)return;target.scrollIntoView({behavior:'smooth',block:'center'});target.classList.remove('flash');requestAnimationFrame(()=>target.classList.add('flash'));setTimeout(()=>target.classList.remove('flash'),1300);}
  const root=document.getElementById('root');if(root){new MutationObserver(()=>queueMicrotask(enhance)).observe(root,{childList:true,subtree:true});root.addEventListener('click',focusSignal);}
  window.addEventListener('kun:section-reloaded',()=>setTimeout(enhance,0));document.addEventListener('click',e=>{if(e.target.closest?.('.campaign66 [data-section-mode],.campaign66 [data-campaign-section],.campaign66 [data-date-preset],.campaign66 [data-status]'))setTimeout(enhance,0);},true);
  window.KunCampaignUXV67={enhance,buildSignals,metrics,version:'67.0'};
  document.documentElement.dataset.campaignUx='v67-ready';
  setTimeout(enhance,0);
})();