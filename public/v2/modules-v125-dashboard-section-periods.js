/* Kun Online v125.2 — independent server-backed ranges per dashboard section */
(()=>{
  if(window.KunDashboardSectionPeriodsV125)return;
  const VERSION='125.2';
  const MAIN_SECTIONS=new Set(['overview','trend','finance','ads','rates','provinces','ai','summary']);
  const PRESETS=[
    ['today','اليوم'],
    ['yesterday','أمس'],
    ['week_to_date','من بداية الأسبوع'],
    ['last_7_days','آخر ٧ أيام'],
    ['month_to_date','من بداية الشهر'],
    ['last_month','آخر ٣٠ يوم'],
    ['previous_month','الشهر السابق'],
    ['all_time','من البداية'],
    ['custom','مدة معينة']
  ];
  let timer=0,seq=0;
  const scoped=new Map();
  const errors=new Map();
  const LABELS={overview:'الملخص',summary:'ملخص الأداء',trend:'الاتجاهات',finance:'المالية والربحية',ads:'الحملات الإعلانية',rates:'التأكيد والتسليم',provinces:'المحافظات والشحن',ai:'توصيات الذكاء الاصطناعي'};
  const $=(s,r=document)=>r?.querySelector?.(s)||null;
  const $$=(s,r=document)=>r?[...r.querySelectorAll(s)]:[];
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const active=()=>$('.nav button.active')?.dataset.view==='dashboard'&&$('.v33-dashboard');
  const periodApi=()=>window.KunDashboardPeriodsProvinceV124||null;
  const selected=()=>periodApi()?.selected?.()||'today';
  const selection=section=>scoped.get(section)?.preset||selected();
  const labelFor=key=>PRESETS.find(([value])=>value===key)?.[1]||'مدة معينة';
  const options=current=>PRESETS.map(([value,label])=>`<option value="${value}" ${current===value?'selected':''}>${label}</option>`).join('');

  function rangeFor(key){
    try{return periodApi()?.rangeForPreset?.(key)||null;}catch{return null;}
  }
  function rangeText(key,section){
    const r=section&&scoped.get(section)?.range||rangeFor(key);
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
      .v33-dashboard .dash-f126-headline.dash-v125-head{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
      .v33-dashboard .dash-f126-headline.dash-v125-head>.dash-v125-period-bar{order:20;flex:1 0 100%;width:100%;display:flex;align-items:center;gap:10px;padding:9px 11px;border:1px solid var(--line,#e2e8f0);border-radius:12px;background:var(--card,#fff);box-sizing:border-box}
      .v33-dashboard .dash-f126-headline.dash-v125-head .dash-f126-period{display:none}
      .v33-dashboard .dash-v125-period-bar select{direction:rtl}
      .v33-dashboard .dash-v125-period-bar:focus-within{border-color:#60a5fa}
      .dash-v125-period-reset,.dash-v125-unify{border:1px solid var(--line,#cbd5e1);border-radius:9px;background:var(--card,#fff);color:var(--ink,#0f172a);font:inherit;font-size:10px;font-weight:800;cursor:pointer;padding:8px 10px}
      .dash-v125-period-status{color:var(--muted,#64748b);font-size:9px;font-weight:700}
      .dash-v125-period-error{color:#b91c1c;font-size:9px;flex:1 0 100%}
      .dash-v125-unify{margin-inline-start:8px}
      body[data-theme="dark"] .v33-dashboard .dash-section-head.dash-v125-head>.dash-v125-period-bar{background:linear-gradient(180deg,#172033,var(--card));border-color:var(--line)}
      body[data-theme="dark"] .dash-v125-period-select{background:var(--card);border-color:var(--line)}
      @media(max-width:680px){
        .v33-dashboard .dash-section-head.dash-v125-head>.dash-v125-period-bar,.v33-dashboard .dash-f126-headline.dash-v125-head>.dash-v125-period-bar{display:grid!important;grid-template-columns:minmax(0,1fr) minmax(150px,.8fr);gap:8px;padding:8px 9px}
        .dash-v125-period-copy{min-width:0}.dash-v125-period-select{width:100%;min-width:0;margin-inline-start:0}
      }
      @media(max-width:390px){.v33-dashboard .dash-section-head.dash-v125-head>.dash-v125-period-bar,.v33-dashboard .dash-f126-headline.dash-v125-head>.dash-v125-period-bar{grid-template-columns:1fr}.dash-v125-period-select{height:38px}}
    `;
    document.head.appendChild(el);
  }
  function barHtml(section,current){
    return `<div class="dash-v125-period-bar" data-v125-period-bar="${esc(section)}"><div class="dash-v125-period-copy"><span>فلتر التاريخ · ${esc(LABELS[section]||section)}</span><strong data-v125-range>${esc(rangeText(current,section))}</strong></div><select class="dash-v125-period-select" data-v125-period="${esc(section)}" aria-label="تحديد فترة ${esc(LABELS[section]||section)}">${options(current)}</select><span class="dash-v125-period-status" data-v125-status>عام</span><button type="button" class="dash-v125-period-reset" data-v125-reset="${esc(section)}" hidden>↶ الفترة العامة</button><span class="dash-v125-period-error" data-v125-error hidden></span></div>`;
  }
  function decorateSection(sec){
    const section=String(sec?.dataset?.dashSection||(sec?.dataset?.dashboardFinanceTop==='126'?'summary':''));
    if(!MAIN_SECTIONS.has(section))return;
    const head=section==='summary'?$('.dash-f126-headline',sec):$('.dash-section-head',sec);if(!head)return;
    head.classList.add('dash-v125-head');
    let bar=$(`.dash-v125-period-bar[data-v125-period-bar="${section}"]`,head);
    const current=selection(section);
    if(!bar){head.insertAdjacentHTML('beforeend',barHtml(section,current));bar=$(`.dash-v125-period-bar[data-v125-period-bar="${section}"]`,head);}
    const select=$('[data-v125-period]',bar),range=$('[data-v125-range]',bar);
    if(select&&select.value!==current)select.value=current;
    const txt=rangeText(current,section);if(range&&range.textContent!==txt)range.textContent=txt;
    const entry=scoped.get(section),status=$('[data-v125-status]',bar),reset=$('[data-v125-reset]',bar),error=$('[data-v125-error]',bar);
    if(status)status.textContent=entry?.loading?'جاري تحميل القسم…':entry?'فترة مستقلة':'الفترة العامة';
    if(reset)reset.hidden=!entry;
    if(select)select.disabled=!!entry?.loading;
    if(error){error.textContent=errors.get(section)||'';error.hidden=!errors.has(section);}
    $$('.dash-section-actions .dash-v124-period-control',sec).forEach(node=>node.setAttribute('aria-hidden','true'));
  }
  function decorate(){
    if(!active())return;
    style();
    const root=$('#root');if(!root)return;
    Array.from(root.querySelectorAll('.dash-section[data-dash-section]')).forEach(decorateSection);
    const summary=$('[data-dashboard-finance-top="126"]',root);if(summary)decorateSection(summary);
    scoped.forEach((entry,section)=>{if(section==='summary'||!entry?.data||entry.loading)return;const sec=$('.dash-section[data-dash-section="'+section+'"]',root);if(sec&&sec.dataset.v125ScopeSig!==entry.data.from+'|'+entry.data.to)window.KunDashboardV33?.renderScopedSection?.(section,entry.data);});
    const toolbar=$('.dash-period-toolbar',root);if(toolbar&&!$('[data-v125-unify]',toolbar))toolbar.insertAdjacentHTML('beforeend','<button type="button" class="dash-v125-unify" data-v125-unify="1">توحيد فترات الأقسام</button>');
  }
  function schedule(delay=60){clearTimeout(timer);timer=setTimeout(decorate,delay);}
  function snapshotUrl(from,to,clientId,storeId){
    const url=new URL('/api/dashboard',location.origin);
    url.searchParams.set('from',from);url.searchParams.set('to',to);
    if(clientId)url.searchParams.set('clientId',clientId);
    if(storeId)url.searchParams.set('storeId',storeId);
    return url.pathname+url.search;
  }
  function requestJson(url){
    // Bypass global fetch instrumentation: an isolated panel must NOT change the
    // dashboard-wide snapshot or the financial dashboard's global date.
    return new Promise((resolve,reject)=>{
      const req=new XMLHttpRequest();
      req.open('GET',url,true);req.withCredentials=true;req.timeout=25000;
      req.setRequestHeader('Accept','application/json');
      req.onload=()=>{
        let data={};try{data=JSON.parse(req.responseText||'{}');}catch{}
        if(req.status>=200&&req.status<300&&data?.ok)resolve(data);
        else reject(new Error(data?.error||'تعذر تحميل بيانات الفترة المحددة'));
      };
      req.onerror=()=>reject(new Error('تعذر الاتصال بالسيرفر'));
      req.ontimeout=()=>reject(new Error('انتهت مهلة تحميل البيانات'));
      req.send();
    });
  }
  async function loadSnapshot(range){
    const clientId=await (window.kunClientId?.()||Promise.resolve(''));
    const storeId=await (window.kunStoreId?.()||Promise.resolve(''));
    return requestJson(snapshotUrl(range.from,range.to,clientId,storeId));
  }
  function calendarDate(value){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))return false;
    const time=new Date(value+'T00:00:00Z');
    return !Number.isNaN(time.valueOf())&&time.toISOString().slice(0,10)===value;
  }
  function closeCustom(){$('#dashV125CustomModal')?.remove();}
  function customModal(section){
    closeCustom();
    const existing=scoped.get(section)?.range||rangeFor(selected())||{};
    const today=rangeFor('today')?.to||'';
    const box=document.createElement('div');box.id='dashV125CustomModal';box.className='dash-v124-modal';
    box.innerHTML='<div class="dash-v124-dialog" role="dialog" aria-modal="true" aria-label="تخصيص فترة القسم"><div class="dash-v124-dialog-head"><h3>فترة مستقلة: '+esc(LABELS[section]||section)+'</h3><button type="button" class="dash-v124-close" data-v125-close aria-label="إغلاق">×</button></div><div class="dash-v124-fields"><label>من<input class="input" type="date" data-v125-from value="'+esc(existing.from==='2000-01-01'?today:existing.from||today)+'"></label><label>إلى<input class="input" type="date" data-v125-to value="'+esc(existing.to||today)+'"></label></div><div class="dash-v124-actions"><button class="btn soft" type="button" data-v125-close>إلغاء</button><button class="btn primary" type="button" data-v125-apply-custom>تطبيق</button></div></div>';
    document.body.appendChild(box);
    box.addEventListener('click',e=>{
      if(e.target===box||e.target.closest('[data-v125-close]')){closeCustom();schedule(0);return;}
      if(e.target.closest('[data-v125-apply-custom]')){
        const from=$('[data-v125-from]',box)?.value,to=$('[data-v125-to]',box)?.value;
        if(!calendarDate(from)||!calendarDate(to)||from>to){window.showToast?.('حدد تاريخ بداية ونهاية صحيحين');return;}
        closeCustom();apply('custom',section,{from,to});
      }
    });
  }
  function clearSection(section){
    scoped.delete(section);errors.delete(section);
    if(section==='summary')window.KunDashboardFinanceTopV126?.clearScopedDashboard?.();
    else window.KunDashboardV33?.clearScopedSection?.(section);
    schedule(0);
  }
  function unify(){
    ++seq;
    [...scoped.keys()].forEach(clearSection);
    errors.clear();schedule(0);
  }
  async function apply(value,section,customRange){
    if(!PRESETS.some(([key])=>key===value))return;
    if(!section){periodApi()?.apply?.(value);return;}
    if(!MAIN_SECTIONS.has(section))return;
    if(value==='custom'&&!customRange){customModal(section);schedule(0);return;}
    const range=customRange||rangeFor(value);
    if(!calendarDate(range?.from)||!calendarDate(range?.to)||range.from>range.to){
      errors.set(section,'الفترة الزمنية غير صحيحة');schedule(0);return;
    }
    const before=scoped.get(section);
    const item={preset:value,range:{...range},data:null,loading:true,serial:++seq};
    scoped.set(section,item);errors.delete(section);schedule(0);
    try{
      const data=await loadSnapshot(range);
      if(scoped.get(section)!==item)return;
      // Navigating away mid-request must not leave a disabled selector forever.
      if(!active()){if(before)scoped.set(section,before);else scoped.delete(section);return;}
      if(data.from!==range.from||data.to!==range.to)throw new Error('الفترة المستلمة لا تطابق الاختيار');
      item.data=data;item.loading=false;
      if(section==='summary')window.KunDashboardFinanceTopV126?.setScopedDashboard?.(data);
      else if(!window.KunDashboardV33?.renderScopedSection?.(section,data))throw new Error('تعذر تحديث القسم');
      // Live ACTIVE campaign membership is not an historical metric.
      if(section==='ads'){
        const panel=$('.dash-section[data-dash-section="ads"]');
        if(panel){
          const a=data.ads||{},o=data.overview||{},period=document.createElement('div');
          period.className='dash-v125-period-status';period.dataset.v125AdsMetrics='1';
          period.textContent='أرقام الفترة: صرف '+(Number(a.spend)||0).toLocaleString('ar-EG')+' ج.م · الطلبات '+(Number(o.totalOrders)||0).toLocaleString('ar-EG')+' · سعر الطلب '+(Number(a.systemCpp)||0).toLocaleString('ar-EG')+' ج.م. حالة ACTIVE المعروضة أدناه هي الحالة الحالية للحملات.';
          const head=$('.dash-section-head',panel);head?.insertAdjacentElement('afterend',period);
        }
      }
      schedule(0);
    }catch(error){
      if(scoped.get(section)!==item)return;
      if(before)scoped.set(section,before);else scoped.delete(section);
      errors.set(section,error?.message||'تعذر تحميل بيانات القسم');
      schedule(0);
    }
  }
  function reloadSection(section){
    const entry=scoped.get(section);
    if(!entry)return section==='summary'?window.KunDashboardV33?.reload?.():window.KunDashboardV33?.reloadSection?.(section);
    return apply(entry.preset,section,entry.range);
  }
  function hook(){
    style();
    const root=$('#root');if(root)new MutationObserver(()=>schedule(80)).observe(root,{childList:true,subtree:true});
    document.addEventListener('change',event=>{
      const select=event.target.closest?.('[data-v125-period]');if(!select)return;
      event.stopPropagation();apply(select.value,select.dataset.v125Period);
    });
    document.addEventListener('click',event=>{
      const reset=event.target.closest?.('[data-v125-reset]');
      if(reset){event.preventDefault();clearSection(reset.dataset.v125Reset);return;}
      if(event.target.closest?.('[data-v125-unify]')){event.preventDefault();unify();return;}
      if(event.target.closest?.('.nav button[data-view="dashboard"]'))schedule(340);
    });
    document.addEventListener('change',event=>{
      if(event.target.closest?.('#storeBtn')){unify();}
    },true);
    setTimeout(decorate,420);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',hook);else hook();
  window.KunDashboardSectionPeriodsV125={version:VERSION,refresh:decorate,apply,selected,selection,reloadSection,clearSection,unify,sections:[...MAIN_SECTIONS]};
})();
