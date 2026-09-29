/* Kun Online v124.0 — one province view + visible period filter in every dashboard section */
(()=>{
  if(window.KunDashboardPeriodsProvinceV124)return;
  const VERSION='124.0';
  const nativeFetch=window.fetch.bind(window);
  const PRESETS=[
    ['today','اليوم'],
    ['yesterday','أمس'],
    ['week_to_date','من بداية الأسبوع'],
    ['last_7_days','آخر ٧ أيام'],
    ['month_to_date','من بداية الشهر'],
    ['last_month','آخر شهر'],
    ['custom','مدة معينة']
  ];
  const state={selected:'today',custom:null,timer:0,applying:false};
  const $=(s,r=document)=>r?.querySelector?.(s)||null;
  const $$=(s,r=document)=>r?[...r.querySelectorAll(s)]:[];
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const active=()=>$('.nav button.active')?.dataset.view==='dashboard'&&$('.v33-dashboard');

  function today(){
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
    const get=type=>parts.find(x=>x.type===type)?.value||'';
    return `${get('year')}-${get('month')}-${get('day')}`;
  }
  function addDays(date,delta){const d=new Date(`${date}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+delta);return d.toISOString().slice(0,10);}
  function monthStart(date){return `${String(date).slice(0,7)}-01`;}
  function weekStart(date){const d=new Date(`${date}T00:00:00Z`),daysSinceSaturday=(d.getUTCDay()-6+7)%7;return addDays(date,-daysSinceSaturday);}
  function rangeForPreset(preset,anchor=today()){
    if(preset==='today')return {from:anchor,to:anchor};
    if(preset==='yesterday'){const d=addDays(anchor,-1);return {from:d,to:d};}
    if(preset==='week_to_date')return {from:weekStart(anchor),to:anchor};
    if(preset==='last_7_days')return {from:addDays(anchor,-6),to:anchor};
    if(preset==='month_to_date')return {from:monthStart(anchor),to:anchor};
    if(preset==='last_month')return {from:addDays(anchor,-29),to:anchor};
    if(preset==='custom'&&state.custom?.from&&state.custom?.to)return {...state.custom};
    const current=window.KunDashboardV33?.range?.();
    return current?.from&&current?.to&&current.from!=='beginning'?current:{from:anchor,to:anchor};
  }
  const labelFor=key=>PRESETS.find(([k])=>k===key)?.[1]||'مدة معينة';
  const optionHtml=()=>PRESETS.map(([key,label])=>`<option value="${key}" ${state.selected===key?'selected':''}>${label}</option>`).join('');
  function controlHtml(scope){return `<label class="dash-v124-period-control"><span>الفترة</span><select data-v124-period="${esc(scope)}" aria-label="فلترة ${esc(scope)} حسب الفترة">${optionHtml()}</select></label>`;}

  function style(){
    if($('#kunDashboardV124Style'))return;
    const el=document.createElement('style');el.id='kunDashboardV124Style';el.textContent=`
      .dash-section-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
      .dash-v124-period-control{display:inline-flex!important;align-items:center;gap:7px;min-width:164px;padding:6px 8px;border:1px solid var(--line,#e2e8f0);border-radius:10px;background:var(--card,#fff);color:var(--muted,#64748b);font-size:8.5px;font-weight:800;white-space:nowrap}
      .dash-v124-period-control>span{opacity:.82}.dash-v124-period-control select{min-width:118px;border:0;outline:0;background:transparent;color:var(--ink,#0f172a);font:inherit;font-size:10px;font-weight:800;cursor:pointer}
      .dash-period-toolbar .dash-v124-period-control{margin-inline-start:auto;background:rgba(255,255,255,.72)}
      .dash-v124-orders{display:grid;gap:5px;min-width:118px}.dash-v124-orders>b{font-size:9.5px}.dash-v124-orders-track{display:block;width:100%;height:4px;border-radius:999px;background:#e8eef6;overflow:hidden}.dash-v124-orders-track>i{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,#7db5e8,#1554a0)}
      .dash-v124-modal{position:fixed;inset:0;z-index:99999;display:grid;place-items:center;padding:18px;background:rgba(15,23,42,.48);backdrop-filter:blur(4px)}.dash-v124-dialog{width:min(440px,100%);padding:18px;border:1px solid var(--line,#e2e8f0);border-radius:18px;background:var(--card,#fff);box-shadow:0 24px 70px rgba(15,23,42,.24);direction:rtl}.dash-v124-dialog-head{display:flex;align-items:flex-start;gap:10px;margin-bottom:14px}.dash-v124-dialog-head span{display:block;color:var(--muted,#64748b);font-size:9px;font-weight:800}.dash-v124-dialog-head h3{margin:3px 0 0;font-size:17px}.dash-v124-close{margin-inline-start:auto;width:34px;height:34px;border:1px solid var(--line,#e2e8f0);border-radius:10px;background:transparent;color:inherit;font-size:18px;cursor:pointer}.dash-v124-fields{display:grid;grid-template-columns:1fr 1fr;gap:9px}.dash-v124-fields label{display:grid;gap:5px;color:var(--muted,#64748b);font-size:9px;font-weight:800}.dash-v124-fields input{width:100%}.dash-v124-actions{display:flex;justify-content:flex-end;gap:7px;margin-top:14px}
      body[data-theme="dark"] .dash-v124-period-control{background:var(--card);border-color:var(--line)}body[data-theme="dark"] .dash-period-toolbar .dash-v124-period-control{background:rgba(15,23,42,.75)}body[data-theme="dark"] .dash-v124-orders-track{background:#263247}
      @media(max-width:680px){.dash-section-head{align-items:flex-start}.dash-section-actions{width:100%;justify-content:flex-start}.dash-v124-period-control{min-width:150px}.dash-v124-fields{grid-template-columns:1fr}.dash-period-toolbar .dash-v124-period-control{margin-inline-start:0;width:100%;justify-content:space-between}.dash-period-toolbar .dash-v124-period-control select{flex:1}}
    `;document.head.appendChild(el);
  }

  function normalizeNumber(text){
    const arabic='٠١٢٣٤٥٦٧٨٩',persian='۰۱۲۳۴۵۶۷۸۹';
    const s=String(text||'').replace(/[٠-٩]/g,d=>arabic.indexOf(d)).replace(/[۰-۹]/g,d=>persian.indexOf(d)).replace(/[٬,]/g,'');
    return Number(s.match(/-?\d+(?:\.\d+)?/)?.[0]||0);
  }
  function mergeProvinceViews(root){
    const sec=$('[data-dash-section="provinces"]',root);if(!sec)return;
    const list=$('.dash-province-list',sec),tableWrap=$('.dash-table-wrap',sec);
    if(!tableWrap)return;
    $('.dash-u-view-toggle',sec)?.remove();
    tableWrap.classList.remove('dash-u-province-hidden');
    const rows=$$('tbody tr',tableWrap).filter(tr=>tr.children.length>=3&&!tr.querySelector('.dash-empty'));
    const values=rows.map(tr=>normalizeNumber(tr.children[2]?.textContent));
    const max=Math.max(1,...values);
    rows.forEach((tr,i)=>{
      const cell=tr.children[2];if(!cell||cell.dataset.v124Merged==='1')return;
      const value=values[i]||0,label=cell.textContent.trim()||'0',width=Math.max(value?4:0,Math.round(value/max*100));
      cell.innerHTML=`<div class="dash-v124-orders"><b>${esc(label)}</b><span class="dash-v124-orders-track"><i style="width:${width}%"></i></span></div>`;
      cell.dataset.v124Merged='1';
    });
    list?.remove();
    $('.dash-u-view-toggle',sec)?.remove();
    const title=$('.dash-section-head h2',sec),sub=$('.dash-section-head p',sec);
    if(title)title.textContent='كفاءة الشحن حسب المحافظة';
    if(sub)sub.textContent='ترتيب وحجم الطلبات وجودة الشحن في جدول واحد، بدون تكرار نفس المحافظات مرتين.';
    sec.dataset.v124Province='merged';
  }

  function addSectionFilters(root){
    $$('.dash-section[data-dash-section]',root).filter(sec=>!String(sec.dataset.dashSection||'').startsWith('ad48-')).forEach(sec=>{
      const actions=$('.dash-section-actions',sec);if(!actions)return;
      let control=$('.dash-v124-period-control',actions);
      if(!control){actions.insertAdjacentHTML('afterbegin',controlHtml(sec.dataset.dashSection||'section'));control=$('.dash-v124-period-control',actions);}
      const select=$('[data-v124-period]',control);if(select&&select.value!==state.selected)select.value=state.selected;
    });
  }

  function decorateToolbar(root){
    const toolbar=$('.dash-period-toolbar',root);if(!toolbar)return;
    const r=rangeForPreset(state.selected),signature=`${state.selected}|${r.from}|${r.to}`;
    if(toolbar.dataset.v124Signature===signature&&$('.dash-v124-period-control',toolbar))return;
    toolbar.innerHTML=`<div><span>الفترة الزمنية</span><strong>${esc(labelFor(state.selected))}</strong><small>${esc(r.from)} — ${esc(r.to)}</small></div>${controlHtml('dashboard')}`;
    toolbar.dataset.v124Signature=signature;
  }

  function syncSelects(){
    $$('[data-v124-period]').forEach(select=>{if(select.value!==state.selected)select.value=state.selected;});
  }
  function removeModal(){document.getElementById('dashV124PeriodModal')?.remove();}
  function openCustomModal(){
    removeModal();const current=state.custom||window.KunDashboardV33?.range?.()||rangeForPreset('today'),modal=document.createElement('div');
    modal.id='dashV124PeriodModal';modal.className='dash-v124-modal';
    const from=current.from&&current.from!=='beginning'?current.from:today(),to=current.to||today();
    modal.innerHTML=`<div class="dash-v124-dialog" role="dialog" aria-modal="true" aria-labelledby="dashV124Title"><div class="dash-v124-dialog-head"><div><span>الفترة الزمنية</span><h3 id="dashV124Title">مدة معينة</h3></div><button type="button" class="dash-v124-close" data-v124-close aria-label="إغلاق">×</button></div><div class="dash-v124-fields"><label><span>من</span><input class="input" type="date" id="dashV124From" value="${esc(from)}"></label><label><span>إلى</span><input class="input" type="date" id="dashV124To" value="${esc(to)}"></label></div><div class="dash-v124-actions"><button class="btn soft" type="button" data-v124-close>إلغاء</button><button class="btn primary" type="button" id="dashV124Apply">تطبيق</button></div></div>`;
    document.body.appendChild(modal);
    $$('[data-v124-close]',modal).forEach(b=>b.onclick=()=>{removeModal();syncSelects();});
    modal.onclick=e=>{if(e.target===modal){removeModal();syncSelects();}};
    $('#dashV124Apply',modal).onclick=()=>{
      const fromValue=$('#dashV124From',modal)?.value,toValue=$('#dashV124To',modal)?.value;
      if(!fromValue||!toValue)return window.showToast?.('حدد بداية ونهاية الفترة');
      if(fromValue>toValue)return window.showToast?.('بداية الفترة يجب أن تكون قبل نهايتها');
      state.selected='custom';state.custom={from:fromValue,to:toValue};removeModal();applyRange(fromValue,toValue);
    };
  }

  function applyRange(from,to){
    if(state.applying)return;state.applying=true;
    try{
      const root=$('#root'),custom=$('[data-dash-preset="custom"]',root);if(!custom)return;
      custom.click();
      const fresh=$('#root'),fromInput=$('#dashFrom',fresh),toInput=$('#dashTo',fresh),apply=$('#dashApplyRange',fresh);
      if(!fromInput||!toInput||!apply)return;
      fromInput.value=from;toInput.value=to;apply.click();
    }finally{state.applying=false;schedule(180);setTimeout(()=>window.KunAdsExpertV48?.refresh?.(),520);}
  }
  function applyPreset(preset){
    if(!PRESETS.some(([key])=>key===preset))return;
    if(preset==='custom'){openCustomModal();return;}
    state.selected=preset;state.custom=null;syncSelects();
    if(preset==='today'){
      const todayButton=$('#root [data-dash-preset="today"]');if(todayButton)todayButton.click();
      schedule(180);setTimeout(()=>window.KunAdsExpertV48?.refresh?.(),520);return;
    }
    const r=rangeForPreset(preset);applyRange(r.from,r.to);
  }

  function decorate(){
    if(!active())return;const root=$('#root');if(!root)return;
    style();mergeProvinceViews(root);addSectionFilters(root);decorateToolbar(root);syncSelects();
  }
  function schedule(delay=120){clearTimeout(state.timer);state.timer=setTimeout(decorate,delay);}

  window.fetch=async function(...args){
    const response=await nativeFetch(...args);
    try{const input=args[0],url=typeof input==='string'?input:input?.url||'',path=new URL(url,location.origin).pathname;if(path==='/api/dashboard')schedule(150);}catch{}
    return response;
  };
  function hook(){
    style();const root=$('#root');if(root)new MutationObserver(()=>schedule(140)).observe(root,{childList:true,subtree:true});
    document.addEventListener('change',e=>{const select=e.target.closest?.('[data-v124-period]');if(!select)return;e.stopPropagation();applyPreset(select.value);});
    document.addEventListener('click',e=>{if(e.target.closest?.('.nav button[data-view="dashboard"]'))schedule(420);});
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.getElementById('dashV124PeriodModal')){removeModal();syncSelects();}});
    setTimeout(decorate,520);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',hook);else hook();
  window.KunDashboardPeriodsProvinceV124={version:VERSION,apply:applyPreset,rangeForPreset,selected:()=>state.selected,refresh:decorate,weekStartsOn:'saturday'};
})();
