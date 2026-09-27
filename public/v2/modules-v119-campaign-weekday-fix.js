/* Kun Online v119.1 — force weekday labels + weekday-only aggregation on Campaign Hub comparison. */
(function(){
  const modes={campaign:'date',adset:'date',ad:'date'};
  const originals=new WeakMap();
  const analysisOriginals=new WeakMap();
  const weekdayOrder=[6,0,1,2,3,4,5];
  const n=v=>Number.isFinite(Number(v))?Number(v):0;
  const r2=v=>Math.round(n(v)*100)/100;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=v=>n(v).toLocaleString('ar-EG',{maximumFractionDigits:2});
  const integer=v=>Math.round(n(v)).toLocaleString('ar-EG');
  const metrics=[
    {key:'spend',label:'الإنفاق',hint:'Spend',format:v=>`${money(v)} ج`},
    {key:'purchases',label:'المشتريات',hint:'Purchases',format:v=>integer(v)},
    {key:'cpp',label:'تكلفة الشراء',hint:'CPP',format:v=>`${money(v)} ج`},
    {key:'roas',label:'العائد على الإنفاق',hint:'ROAS',format:v=>`${money(v)}x`},
    {key:'ctr',label:'نسبة النقر',hint:'CTR',format:v=>`${money(v)}%`},
    {key:'cpm',label:'تكلفة ألف ظهور',hint:'CPM',format:v=>`${money(v)} ج`},
    {key:'frequency',label:'التكرار',hint:'Frequency',format:v=>money(v)}
  ];
  function parseDate(value){const d=new Date(`${value}T12:00:00Z`);return Number.isNaN(d.getTime())?null:d;}
  function weekdayLabel(value){const d=parseDate(value);if(!d)return value;try{return new Intl.DateTimeFormat('ar-EG',{weekday:'long',timeZone:'Africa/Cairo'}).format(d);}catch{return value;}}
  function weekdayIndex(value){const d=parseDate(value);return d?d.getUTCDay():-1;}
  function normalize(raw={}){
    const spend=n(raw.spend),purchases=n(raw.purchases);
    let impressions=n(raw.impressions),reach=n(raw.reach),clicks=n(raw.clicks),purchaseValue=n(raw.purchaseValue);
    if(!purchaseValue&&spend&&n(raw.roas))purchaseValue=spend*n(raw.roas);
    if(!impressions&&spend&&n(raw.cpm))impressions=spend/n(raw.cpm)*1000;
    if(!clicks&&impressions&&n(raw.ctr))clicks=impressions*n(raw.ctr)/100;
    if(!reach&&impressions&&n(raw.frequency))reach=impressions/n(raw.frequency);
    return {spend,purchases,purchaseValue,impressions,reach,clicks};
  }
  function aggregate(rows=[]){
    const t=rows.reduce((a,row)=>{const x=normalize(row);for(const k of Object.keys(a))a[k]+=x[k];return a;},{spend:0,purchases:0,purchaseValue:0,impressions:0,reach:0,clicks:0});
    return {spend:r2(t.spend),purchases:r2(t.purchases),cpp:t.purchases?r2(t.spend/t.purchases):0,roas:t.spend?r2(t.purchaseValue/t.spend):0,ctr:t.impressions?r2(t.clicks/t.impressions*100):0,cpm:t.impressions?r2(t.spend/t.impressions*1000):0,frequency:t.reach?r2(t.impressions/t.reach):0};
  }
  function groupedPoints(row,dates){
    const daily=Array.isArray(row?.daily)?row.daily:[],groups=new Map();
    dates.forEach((date,i)=>{const idx=weekdayIndex(date);if(idx<0)return;if(!groups.has(idx))groups.set(idx,{idx,label:weekdayLabel(date),dates:[],rows:[]});const g=groups.get(idx);g.dates.push(date);g.rows.push(daily[i]||{});});
    return weekdayOrder.filter(idx=>groups.has(idx)).map(idx=>{const g=groups.get(idx);return {label:g.label,count:g.dates.length,metric:aggregate(g.rows)};});
  }
  function ensureStyle(){
    if(document.getElementById('kunCampaignWeekdayV119Style'))return;
    const s=document.createElement('style');s.id='kunCampaignWeekdayV119Style';s.textContent=`
      .ux119-toggle{display:inline-flex;gap:3px;padding:3px;border:1px solid var(--line,#e5e7eb);border-radius:11px;background:var(--card,#fff);direction:rtl}
      .ux119-toggle button{border:0;background:transparent;color:inherit;padding:6px 11px;border-radius:8px;font:inherit;font-size:11px;font-weight:800;cursor:pointer;white-space:nowrap}
      .ux119-toggle button.active{background:var(--ink,#111827);color:#fff}
      .ux119-weekday-table th b{display:block}.ux119-weekday-table th small{display:block;margin-top:2px;color:var(--muted,#64748b);font-size:10px}
    `;document.head.appendChild(s);
  }
  function patchDateHeaders(table,dates){
    const cells=[...table.querySelectorAll('thead th')];
    if(cells.length<dates.length+2)return;
    dates.forEach((date,i)=>{const th=cells[i+1];const html=`<b>${esc(weekdayLabel(date))}</b><small>${esc(date)}</small>`;if(th.innerHTML!==html)th.innerHTML=html;});
    table.classList.add('ux119-weekday-table');
  }
  function weekdayTable(row,dates){
    const points=groupedPoints(row,dates),total=row?.total||{};
    return `<thead><tr><th class="ux67-metric-col">المعيار الأساسي</th>${points.map(p=>`<th><b>${esc(p.label)}</b><small>${integer(p.count)} ${p.count===1?'يوم':'أيام'}</small></th>`).join('')}<th>إجمالي الفترة</th></tr></thead><tbody>${metrics.map(metric=>`<tr><th class="ux67-metric-col"><b>${metric.label}</b><small>${metric.hint}</small></th>${points.map(p=>`<td><span class="ux67-value">${metric.format(p.metric[metric.key])}</span></td>`).join('')}<td><span class="ux67-value">${metric.format(total?.[metric.key])}</span></td></tr>`).join('')}</tbody>`;
  }
  function setMode(level,mode){if(modes[level]===mode)return;modes[level]=mode;render(true);}
  function ensureToggle(container,level){
    let toggle=container.querySelector('.ux119-toggle');
    if(!toggle){toggle=document.createElement('div');toggle.className='ux119-toggle';const head=container.querySelector('.ux67-head');if(head)head.insertBefore(toggle,head.querySelector('.spacer'));}
    if(!toggle)return;
    const mode=modes[level]||'date';
    if(toggle.dataset.mode===mode)return;
    toggle.dataset.mode=mode;
    toggle.innerHTML=`<button type="button" data-ux119-mode="date" class="${mode==='date'?'active':''}">حسب التاريخ</button><button type="button" data-ux119-mode="weekday" class="${mode==='weekday'?'active':''}">تحليل باليوم فقط</button>`;
  }
  function render(force=false){
    ensureStyle();
    const hub=window.KunCampaignHubV66,root=document.getElementById('root');if(!hub||!root)return;
    const level=hub.state?.level,section=hub.state?.sections?.[level];if(!level||section?.mode!=='comparison'||!section?.comparison)return;
    const data=section.comparison||{},dates=Array.isArray(data.dates)?data.dates:[],rows=Array.isArray(data.rows)?data.rows:[];
    const container=root.querySelector('.campaign67-comparison');if(!container)return;
    ensureToggle(container,level);
    const note=container.querySelector('.ux67-weekday-note'),noteText=(modes[level]==='weekday'?'كل عمود يجمع كل مرات نفس اليوم داخل الفترة المختارة.':'اسم يوم الأسبوع ظاهر أعلى التاريخ في كل عمود.');if(note&&note.textContent!==noteText)note.textContent=noteText;
    const sig=`${modes[level]}:${dates.join('|')}`;
    const entities=[...container.querySelectorAll('[data-ux67-entity]')];
    entities.forEach((entity,i)=>{
      if(!force&&entity.dataset.ux119Sig===sig)return;
      const table=entity.querySelector('.ux67-matrix'),analysis=entity.querySelector('.ux67-analysis');if(!table)return;
      if(!originals.has(table))originals.set(table,table.innerHTML);
      if(analysis&&!analysisOriginals.has(analysis))analysisOriginals.set(analysis,analysis.innerHTML);
      if(modes[level]==='weekday'){
        table.innerHTML=weekdayTable(rows[i]||{},dates);table.classList.add('ux119-weekday-table');
        if(analysis)analysis.innerHTML='<div class="ux67-analysis-title"><b>تحليل حسب يوم الأسبوع</b><span>تم تجميع كل جمعة مع كل الجمعات، وكل سبت مع كل السبوت، وهكذا، ثم أُعيد حساب مؤشرات الكفاءة من الإجماليات.</span></div>';
      }else{
        const original=originals.get(table);if(original)table.innerHTML=original;
        patchDateHeaders(table,dates);
        if(analysis){const originalAnalysis=analysisOriginals.get(analysis);if(originalAnalysis)analysis.innerHTML=originalAnalysis;}
      }
      entity.dataset.ux119Sig=sig;
    });
  }
  function onClick(event){const button=event.target.closest?.('[data-ux119-mode]');if(!button)return;event.preventDefault();event.stopPropagation();const hub=window.KunCampaignHubV66,level=hub?.state?.level;if(!level)return;setMode(level,button.dataset.ux119Mode==='weekday'?'weekday':'date');}
  const root=document.getElementById('root');if(root){root.addEventListener('click',onClick,true);new MutationObserver(()=>queueMicrotask(()=>render(false))).observe(root,{childList:true,subtree:true});}
  document.addEventListener('click',e=>{if(e.target.closest?.('.campaign66 [data-section-mode],.campaign66 [data-campaign-section],.campaign66 [data-date-preset],.campaign66 [data-status]'))setTimeout(()=>render(false),0);},true);
  window.KunCampaignWeekdayV119={render,version:'119.1'};
  document.documentElement.dataset.campaignWeekday='v119-1-ready';
  setTimeout(()=>render(false),0);
})();
