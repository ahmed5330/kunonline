/* Kun Online v101 — keep Finance Command Center aligned with unified accounting movements. */
(function(){
  'use strict';
  if(window.KunFinanceAccountingSyncV101)return;

  const state={busy:false,seq:0,timer:0};
  const n=v=>Number(v)||0;
  const fmt=(v,d=2)=>new Intl.NumberFormat('ar-EG',{maximumFractionDigits:d}).format(n(v));
  const money=(v,c='EGP')=>`${fmt(v)} ${c==='EGP'?'ج.م':String(c||'EGP')}`;
  const pct=v=>`${fmt(v,1)}%`;
  const active=()=>document.querySelector('.nav button.active[data-view]')?.dataset.view==='finance';
  const today=()=>{const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()),g=t=>p.find(x=>x.type===t)?.value||'';return `${g('year')}-${g('month')}-${g('day')}`;};
  const addDays=(date,days)=>{const d=new Date(`${date}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);};
  async function context(){return {clientId:window.kunClientId?await window.kunClientId():'',storeId:window.kunStoreId?await window.kunStoreId():''};}
  function preset(){return document.querySelector('.fin96-range [data-fin96-preset].active')?.dataset.fin96Preset||'month';}
  function range(){const t=today(),p=preset();if(p==='today')return {from:t,to:t};if(p==='7')return {from:addDays(t,-6),to:t};if(p==='30')return {from:addDays(t,-29),to:t};if(p==='all')return {from:'2000-01-01',to:t};if(p==='custom')return {from:document.getElementById('fin96From')?.value||t,to:document.getElementById('fin96To')?.value||t};return {from:`${t.slice(0,8)}01`,to:t};}
  async function get(path){const r=await fetch(path,{credentials:'include'}),d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||`HTTP ${r.status}`);return d;}
  async function source(){
    const ctx=await context(),p=preset(),u=(path)=>{const x=new URL(path,location.origin);if(ctx.clientId)x.searchParams.set('clientId',ctx.clientId);if(ctx.storeId)x.searchParams.set('storeId',ctx.storeId);return x;};
    if(p==='month'){
      const x=u('/api/accounting/monthly');x.searchParams.set('month',today().slice(0,7));const m=await get(x.pathname+x.search);
      return {currency:m.currency||'EGP',operatingNet:n(m.profit?.operatingNetProfit),otherIncome:n(m.profit?.otherIncome),accountingNet:n(m.profit?.accountingNetProfit),margin:n(m.profit?.marginPct),manualExpenses:n(m.manual?.expenses),monthly:true};
    }
    const r=range(),dashUrl=u('/api/dashboard'),accUrl=u('/api/accounting/overview');for(const x of [dashUrl,accUrl]){x.searchParams.set('from',r.from);x.searchParams.set('to',r.to);}const [dash,acc]=await Promise.all([get(dashUrl.pathname+dashUrl.search),get(accUrl.pathname+accUrl.search)]),revenue=n(dash.finance?.revenue??dash.overview?.expectedRevenue),operatingNet=n(dash.finance?.netProfit),otherIncome=n(acc.manualIncome),accountingNet=operatingNet+otherIncome;
    return {currency:dash.currency||acc.currency||'EGP',operatingNet,otherIncome,accountingNet,margin:revenue?accountingNet/revenue*100:0,manualExpenses:n(acc.manualExpenses),monthly:false};
  }
  function rowByLabel(label){return [...document.querySelectorAll('.fin96-pnl-row')].find(row=>row.querySelector('span')?.textContent.trim()===label)||null;}
  function kpiByLabel(label){return [...document.querySelectorAll('.fin96-kpi')].find(card=>card.querySelector('span')?.textContent.trim()===label)||null;}
  function apply(data){
    if(!active()||!document.querySelector('.fin96'))return;
    const netCard=kpiByLabel('صافي الربح / الخسارة')||kpiByLabel('صافي الربح المحاسبي / الخسارة');
    if(netCard){const label=netCard.querySelector('span'),value=netCard.querySelector('strong'),small=netCard.querySelector('small');if(label)label.textContent='صافي الربح المحاسبي / الخسارة';if(value)value.textContent=money(data.accountingNet,data.currency);if(small)small.textContent='صافي التشغيل + الإيرادات الأخرى المسجلة يدويًا، بدون تكرار المصروفات.';netCard.classList.toggle('good',data.accountingNet>=0);netCard.classList.toggle('bad',data.accountingNet<0);}
    const marginCard=kpiByLabel('هامش صافي الربح')||kpiByLabel('هامش صافي الربح المحاسبي');if(marginCard){const label=marginCard.querySelector('span'),value=marginCard.querySelector('strong'),small=marginCard.querySelector('small');if(label)label.textContent='هامش صافي الربح المحاسبي';if(value)value.textContent=pct(data.margin);if(small)small.textContent='صافي الربح المحاسبي ÷ إيراد المبيعات.';marginCard.classList.toggle('good',data.margin>=0);marginCard.classList.toggle('bad',data.margin<0);}
    let total=rowByLabel('= صافي الربح / الخسارة')||rowByLabel('= صافي الربح المحاسبي / الخسارة');
    if(total){
      let other=document.querySelector('.fin101-other-income-row');if(!other){other=document.createElement('div');other.className='fin96-pnl-row fin101-other-income-row';other.innerHTML='<span>+ إيرادات أخرى مسجلة يدويًا</span><b></b>';total.before(other);}other.querySelector('b').textContent=`+ ${money(data.otherIncome,data.currency)}`;
      total.querySelector('span').textContent='= صافي الربح المحاسبي / الخسارة';total.querySelector('b').textContent=money(data.accountingNet,data.currency);total.classList.toggle('good',data.accountingNet>=0);total.classList.toggle('bad',data.accountingNet<0);
    }
    const note=document.querySelector('.fin96-note');if(note)note.textContent=`المصروفات اليدوية (${money(data.manualExpenses,data.currency)}) داخلة بالفعل ضمن مصروفات التشغيل مرة واحدة، والإيرادات الأخرى (${money(data.otherIncome,data.currency)}) تُضاف بعد صافي التشغيل. التحصيل النقدي يظل منفصلًا عن إيراد المبيعات حتى لا تتكرر الأرقام.`;
    document.querySelector('.fin96')?.setAttribute('data-accounting-sync','v101');
  }
  async function sync(){if(!active()||state.busy)return;const id=++state.seq;state.busy=true;try{const data=await source();if(id===state.seq)apply(data);}catch(error){console.warn('Finance accounting sync',error);}finally{state.busy=false;}}
  function schedule(delay=80){clearTimeout(state.timer);state.timer=setTimeout(sync,delay);}
  function boot(){
    const root=document.getElementById('root');if(root)new MutationObserver(records=>{if(active()&&records.some(r=>r.type==='childList'))schedule(120);}).observe(root,{childList:true,subtree:false});
    document.addEventListener('click',event=>{if(event.target.closest?.('.nav button[data-view="finance"],.fin96-range [data-fin96-preset],#fin96Apply,#fin96Reload'))schedule(180);},true);
    document.addEventListener('kun:accounting-changed',()=>schedule(20));
    if(active())schedule(120);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
  window.KunFinanceAccountingSyncV101={version:'101.0',sync,schedule};
})();
