/* Kun Online v125.0 — persistent visible period selector in every main dashboard section */
(()=>{
  if(window.KunDashboardSectionPeriodsV125)return;
  const VERSION='125.0';
  const MAIN_SECTIONS=new Set(['overview','trend','finance','ads','rates','provinces','ai']);
  const PRESETS=[
    ['today','اليوم'],
    ['yesterday','أمس'],
    ['week_to_date','من بداية الأسبوع'],
    ['last_7_days','آخر ٧ أيام'],
    ['month_to_date','من بداية الشهر'],
    ['last_month','آخر شهر'],
    ['custom','مدة معينة']
  ];
  let timer=0;
  const $=(s,r=document)=>r?.querySelector?.(s)||null;
  const $$=(s,r=document)=>r?[...r.querySelectorAll(s)]:[];
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const active=()=>$('.nav button.active')?.dataset.view==='dashboard'&&$('.v33-dashboard');
  const periodApi=()=>window.KunDashboardPeriodsProvinceV124||null;
  const selected=()=>periodApi()?.selected?.()||'today';
  const labelFor=key=>PRESETS.find(([value])=>value===key)?.[1]||'مدة معينة';
  const options=current=>PRESETS.map(([value,label])=>`<option value="${value}" ${current===value?'selected':''}>${label}</option>`).join('');

  function rangeFor(key){
    try{return periodApi()?.rangeForPreset?.(key)||null;}catch{return null;}
  }
  function rangeText(key){
    const r=rangeFor(key);
    if(!r?.from||!r?.to)return labelFor(key);
    return r.from===r.to?r.from:`${r.from} — ${r.to}`;
  }
  function style(){
    if($('#kunDashboardSectionPeriods125Style'))return;
    const el=document.createElement('style');
    el.id='kunDashboardSectionPeriods125Style';
    el.textContent=`
      .v33-dashboard .dash-section-head.dash-v125-head{display:flex;flex-wrap:wrap;align-items:flex-start;gap:10px}
      .v33-dashboard .dash-section-head.dash-v125-head>.dash-v125-period-bar{order:20;flex:1 0 100%;width:100%;display:flex!important;align-items:center;gap:10px;padding:9px 11px;border:1px solid var(--line,#e2e8f0);border-radius:12px;background:linear-gradient(180deg,#fbfdff,#f8fafc);box-sizing:border-box}
      .dash-v125-period-copy{display:grid;gap:2px;min-width:150px}.dash-v125-period-copy>span{color:var(--muted,#64748b);font-size:8px;font-weight:900}.dash-v125-period-copy>strong{color:var(--ink,#0f172a);font-size:10px;font-weight:900;line-height:1.4}
      .dash-v125-period-select{margin-inline-start:auto;min-width:178px;height:36px;padding:0 11px;border:1px solid var(--line,#dbe3ec);border-radius:10px;background:var(--card,#fff);color:var(--ink,#0f172a);font:inherit;font-size:10px;font-weight:900;outline:0;cursor:pointer}
      .dash-v125-period-select:focus{border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.09)}
      .v33-dashboard .dash-section-actions .dash-v124-period-control{display:none!important}
      body[data-theme="dark"] .v33-dashboard .dash-section-head.dash-v125-head>.dash-v125-period-bar{background:linear-gradient(180deg,#172033,var(--card));border-color:var(--line)}
      body[data-theme="dark"] .dash-v125-period-select{background:var(--card);border-color:var(--line)}
      @media(max-width:680px){
        .v33-dashboard .dash-section-head.dash-v125-head>.dash-v125-period-bar{display:grid!important;grid-template-columns:minmax(0,1fr) minmax(150px,.8fr);gap:8px;padding:8px 9px}
        .dash-v125-period-copy{min-width:0}.dash-v125-period-select{width:100%;min-width:0;margin-inline-start:0}
      }
      @media(max-width:390px){.v33-dashboard .dash-section-head.dash-v125-head>.dash-v125-period-bar{grid-template-columns:1fr}.dash-v125-period-select{height:38px}}
    `;
    document.head.appendChild(el);
  }
  function barHtml(section,current){
    return `<div class="dash-v125-period-bar" data-v125-period-bar="${esc(section)}"><div class="dash-v125-period-copy"><span>الفترة الزمنية</span><strong data-v125-range>${esc(rangeText(current))}</strong></div><select class="dash-v125-period-select" data-v125-period="${esc(section)}" aria-label="تحديد فترة ${esc(section)}">${options(current)}</select></div>`;
  }
  function decorateSection(sec){
    const section=String(sec?.dataset?.dashSection||'');
    if(!MAIN_SECTIONS.has(section))return;
    const head=$('.dash-section-head',sec);if(!head)return;
    head.classList.add('dash-v125-head');
    let bar=$(`.dash-v125-period-bar[data-v125-period-bar="${section}"]`,head);
    const current=selected();
    if(!bar){head.insertAdjacentHTML('beforeend',barHtml(section,current));bar=$(`.dash-v125-period-bar[data-v125-period-bar="${section}"]`,head);}
    const select=$('[data-v125-period]',bar),range=$('[data-v125-range]',bar);
    if(select&&select.value!==current)select.value=current;
    if(range)range.textContent=rangeText(current);
    $$('.dash-section-actions .dash-v124-period-control',sec).forEach(node=>node.setAttribute('aria-hidden','true'));
  }
  function decorate(){
    if(!active())return;
    style();
    const root=$('#root');if(!root)return;
    $$('.dash-section[data-dash-section]',root).forEach(decorateSection);
  }
  function schedule(delay=60){clearTimeout(timer);timer=setTimeout(decorate,delay);}
  function apply(value){
    if(!PRESETS.some(([key])=>key===value))return;
    const api=periodApi();
    if(!api?.apply)return;
    api.apply(value);
    schedule(80);setTimeout(()=>schedule(0),260);setTimeout(()=>schedule(0),700);
  }
  function hook(){
    style();
    const root=$('#root');if(root)new MutationObserver(()=>schedule(80)).observe(root,{childList:true,subtree:true});
    document.addEventListener('change',event=>{
      const select=event.target.closest?.('[data-v125-period]');if(!select)return;
      event.stopPropagation();apply(select.value);
    });
    document.addEventListener('click',event=>{if(event.target.closest?.('.nav button[data-view="dashboard"]'))schedule(340);});
    setTimeout(decorate,420);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',hook);else hook();
  window.KunDashboardSectionPeriodsV125={version:VERSION,refresh:decorate,apply,selected,sections:[...MAIN_SECTIONS]};
})();
