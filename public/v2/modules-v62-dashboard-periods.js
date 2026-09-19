/* Kun Online v62 — synchronized dashboard period dropdowns */
(function(){
  const PRESETS=[
    ['today','اليوم'],
    ['yesterday','أمس'],
    ['last_week','الأسبوع الماضي'],
    ['month_to_date','من بداية الشهر'],
    ['last_month','الشهر الماضي'],
    ['custom','مدة معينة']
  ];
  let selected='today',lastData=null,decorateTimer=null;
  const nativeFetch=window.fetch.bind(window);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num=v=>new Intl.NumberFormat('ar-EG',{maximumFractionDigits:2}).format(Number(v)||0);
  const pct=v=>`${num(v)}%`;
  const active=()=>document.querySelector('.nav button.active')?.dataset.view==='dashboard'&&document.querySelector('.v33-dashboard');
  function today(){const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()),g=t=>p.find(x=>x.type===t)?.value||'';return `${g('year')}-${g('month')}-${g('day')}`;}
  function addDays(date,delta){const d=new Date(`${date}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+delta);return d.toISOString().slice(0,10);}
  function monthStart(date){return `${String(date).slice(0,7)}-01`;}
  function shiftMonthStart(date,delta){const d=new Date(`${monthStart(date)}T00:00:00Z`);d.setUTCMonth(d.getUTCMonth()+delta,1);return d.toISOString().slice(0,10);}
  function currentWeekStart(date){const d=new Date(`${date}T00:00:00Z`),daysSinceSaturday=(d.getUTCDay()-6+7)%7;return addDays(date,-daysSinceSaturday);}
  function rangeForPreset(preset,anchor=today()){
    if(preset==='today')return {from:anchor,to:anchor};
    if(preset==='yesterday'){const d=addDays(anchor,-1);return {from:d,to:d};}
    if(preset==='last_week'){const start=currentWeekStart(anchor);return {from:addDays(start,-7),to:addDays(start,-1)};}
    if(preset==='month_to_date')return {from:monthStart(anchor),to:anchor};
    if(preset==='last_month'){const from=shiftMonthStart(anchor,-1);return {from,to:addDays(monthStart(anchor),-1)};}
    const current=window.KunDashboardV33?.range?.();
    if(current?.from&&current?.to&&current.from!=='beginning')return current;
    return {from:anchor,to:anchor};
  }
  const labelFor=preset=>PRESETS.find(([key])=>key===preset)?.[1]||'مدة معينة';
  function selectHtml(scope){return `<label class="dash-period-control"><span>التاريخ</span><select class="dash-period-select" data-dash-period="${esc(scope)}" aria-label="تحديد فترة ${esc(scope)}">${PRESETS.map(([key,label])=>`<option value="${key}" ${selected===key?'selected':''}>${label}</option>`).join('')}</select></label>`;}
  function selectedRange(){if(selected==='custom'){const current=window.KunDashboardV33?.range?.();if(current?.from&&current?.to&&current.from!=='beginning')return current;}return rangeForPreset(selected);}
  function syncSelects(){document.querySelectorAll('[data-dash-period]').forEach(select=>{if(select.value!==selected)select.value=selected;});}
  function removeModal(){document.getElementById('dashPeriodModal')?.remove();}
  function openCustomModal(){
    removeModal();const r=selectedRange(),modal=document.createElement('div');modal.id='dashPeriodModal';modal.className='dash-period-modal';
    modal.innerHTML=`<div class="dash-period-dialog" role="dialog" aria-modal="true" aria-labelledby="dashPeriodTitle"><div class="dash-period-dialog-head"><div><span>الفترة الزمنية</span><h3 id="dashPeriodTitle">مدة معينة</h3></div><button type="button" class="dash-period-close" data-period-close aria-label="إغلاق">×</button></div><div class="dash-period-fields"><label><span>من</span><input class="input" type="date" id="dashPeriodFrom" value="${esc(r.from)}"></label><label><span>إلى</span><input class="input" type="date" id="dashPeriodTo" value="${esc(r.to)}"></label></div><div class="dash-period-dialog-actions"><button class="btn soft" type="button" data-period-close>إلغاء</button><button class="btn primary" type="button" id="dashPeriodApply">تطبيق</button></div></div>`;
    document.body.appendChild(modal);modal.querySelector('#dashPeriodFrom')?.focus();
    modal.querySelectorAll('[data-period-close]').forEach(button=>button.onclick=()=>{removeModal();syncSelects();});
    modal.onclick=e=>{if(e.target===modal){removeModal();syncSelects();}};
    modal.querySelector('#dashPeriodApply').onclick=()=>{const from=modal.querySelector('#dashPeriodFrom')?.value,to=modal.querySelector('#dashPeriodTo')?.value;if(!from||!to)return window.showToast?.('حدد بداية ونهاية الفترة');if(from>to)return window.showToast?.('بداية الفترة يجب أن تكون قبل نهايتها');selected='custom';removeModal();applyLegacyCustom(from,to);};
  }
  function applyLegacyCustom(from,to){
    const root=document.getElementById('root'),custom=root?.querySelector('[data-dash-preset="custom"]');if(!custom)return;
    custom.click();
    const fresh=document.getElementById('root'),fromInput=fresh?.querySelector('#dashFrom'),toInput=fresh?.querySelector('#dashTo'),apply=fresh?.querySelector('#dashApplyRange');
    if(!fromInput||!toInput||!apply)return;
    fromInput.value=from;toInput.value=to;apply.click();scheduleDecorate(80);
  }
  function applyPreset(preset){
    if(preset==='custom'){openCustomModal();return;}
    selected=preset;
    if(preset==='today'){
      const todayButton=document.getElementById('root')?.querySelector('[data-dash-preset="today"]');
      if(todayButton){todayButton.click();scheduleDecorate(80);}return;
    }
    const r=rangeForPreset(preset);applyLegacyCustom(r.from,r.to);
  }
  function rateCard(r){if(!r)return '';return `<div class="dash-rate-card dash-rate-selected"><div class="dash-rate-title"><span>${esc(labelFor(selected))}</span><small>${esc(r.from)} — ${esc(r.to)}</small></div><div class="dash-rate-main"><div><span>متوسط نسبة التأكيد</span><strong>${pct(r.confirmationRate)}</strong><small>${num(r.confirmed)} من ${num(r.total)} طلب</small></div><div><span>متوسط نسبة التسليم</span><strong>${pct(r.deliveryRate)}</strong><small>المُسلّم ÷ (المُسلّم + المرتجع)</small></div><div><span>نسبة المرتجع</span><strong>${pct(r.returnRate)}</strong><small>${num(r.returned)} مرتجع من نتائج الشحن</small></div></div><div class="dash-rate-foot">المرتجعات ÷ كل ما دخل مرحلة الشحن × 100 = <b>${pct(r.returnOfShippedRate)}</b></div></div>`;}
  function decorateRates(){
    const section=document.querySelector('[data-dash-section="rates"]'),rate=lastData?.rates?.selected;if(!section||!rate)return;
    const p=section.querySelector('.dash-section-head p');if(p)p.textContent='نسب التأكيد والتسليم والمرتجعات محسوبة على نفس الفترة المختارة للداشبورد.';
    const grid=section.querySelector('.dash-rate-grid');if(grid){grid.classList.add('dash-rate-grid-single');grid.innerHTML=rateCard(rate);}
  }
  function decorateAiTitle(){const span=document.querySelector('.dash-ai-analysis-head>div>span');if(span)span.textContent=`تحليل الإعلانات بالـAI — ${labelFor(selected)}`;}
  function decorate(){
    if(!active())return;const root=document.getElementById('root'),legacy=root?.querySelector('.dash-range');if(!root||!legacy)return;
    legacy.classList.add('dash-range-legacy');
    let toolbar=root.querySelector('.dash-period-toolbar');if(!toolbar){toolbar=document.createElement('div');toolbar.className='dash-period-toolbar';legacy.before(toolbar);}
    const r=lastData?.from&&lastData?.to?{from:lastData.from,to:lastData.to}:selectedRange();
    toolbar.innerHTML=`<div><span>الفترة الزمنية</span><strong>${esc(labelFor(selected))}</strong><small>${esc(r.from)} — ${esc(r.to)}</small></div>${selectHtml('dashboard')}`;
    root.querySelectorAll('.dash-section[data-dash-section]').forEach(section=>{const actions=section.querySelector('.dash-section-actions');if(!actions)return;const scope=section.dataset.dashSection||'section';if(!actions.querySelector('[data-dash-period]'))actions.insertAdjacentHTML('afterbegin',selectHtml(scope));});
    root.querySelectorAll('.dash-period-chip').forEach(chip=>chip.textContent=labelFor(selected));
    const hero=root.querySelector('.dash-hero-side');if(hero){const strong=hero.querySelector('strong'),small=hero.querySelector('small');if(strong)strong.textContent=labelFor(selected);if(small)small.textContent=`${r.from} — ${r.to}`;}
    decorateRates();decorateAiTitle();syncSelects();
  }
  function scheduleDecorate(delay=0){clearTimeout(decorateTimer);decorateTimer=setTimeout(decorate,delay);}
  window.fetch=async function(...args){
    const response=await nativeFetch(...args);let url='';try{const input=args[0];url=typeof input==='string'?input:input?.url||'';const path=new URL(url,location.origin).pathname;if(path==='/api/dashboard'){response.clone().json().then(data=>{if(data?.ok){lastData=data;scheduleDecorate(25);}}).catch(()=>{});}else if(path==='/api/ai/business-brief')scheduleDecorate(180);}catch{}
    return response;
  };
  function hook(){
    const root=document.getElementById('root');if(root)new MutationObserver(()=>scheduleDecorate(0)).observe(root,{childList:true,subtree:false});
    document.addEventListener('change',e=>{const select=e.target.closest?.('[data-dash-period]');if(!select)return;e.stopPropagation();applyPreset(select.value);});
    document.addEventListener('click',e=>{if(e.target.closest?.('[data-dash-trend]'))scheduleDecorate(20);if(e.target.closest?.('.nav button[data-view="dashboard"]'))scheduleDecorate(260);});
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.getElementById('dashPeriodModal')){removeModal();syncSelects();}});
    setTimeout(decorate,220);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',hook);else hook();
  window.KunDashboardPeriods62={apply:applyPreset,rangeForPreset,selected:()=>selected,weekStartsOn:'saturday',version:'62.0'};
})();
