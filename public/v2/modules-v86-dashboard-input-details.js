/* Kun Online v86 — clickable Dashboard KPI input details. */
(function(){
  const K=window.KunSafety85;if(!K||window.KunDashboardInputDetailsV86)return;
  const labels={
    'الإيراد المتوقع':'expectedRevenue',
    'تكلفة المنتج':'productCost',
    'كل المصروفات التشغيلية':'operatingExpenses',
    'صافي الربح':'netProfit',
    'هامش الربح':'profitMargin'
  };
  const groupNames={ads:'إعلانات',general:'مصروفات عامة',shipping:'الشحن',orderOther:'التغليف ومصاريف الأوردر',admin:'مصاريف الإدارة'};
  function style(){if(document.getElementById('kunDashboardInputs86Style'))return;const el=document.createElement('style');el.id='kunDashboardInputs86Style';el.textContent=`
    .kun86-input-click{cursor:pointer;position:relative;transition:box-shadow .16s ease,transform .16s ease}.kun86-input-click:after{content:'عرض المدخلات';font-size:10px;font-weight:800;opacity:.55;margin-inline-start:8px}.kun86-input-click:hover,.kun86-input-click:focus{outline:none;box-shadow:0 0 0 2px rgba(37,99,235,.14);transform:translateY(-1px)}
    .kun86-summary-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:12px}.kun86-summary-card{border:1px solid var(--line,#e2e8f0);border-radius:12px;padding:11px;background:#fff;display:grid;gap:5px}.kun86-summary-card small{opacity:.65}.kun86-summary-card b{font-size:16px}.kun86-formula{margin-top:10px;padding:10px 12px;border-radius:10px;background:#f8fafc;border:1px dashed var(--line,#cbd5e1);font-weight:700}.kun86-row-desc{display:block;opacity:.65;margin-top:2px}.kun86-total{font-weight:800}
    @media(max-width:680px){.kun86-summary-grid{grid-template-columns:1fr 1fr}}`;
    document.head.appendChild(el);
  }
  function range(){const r=window.KunDashboardV33?.range?.();if(r?.from&&r?.to)return r;const t=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());return {from:t,to:t};}
  function format(item){if(item?.text)return K.esc(item.text);if(item?.percent)return `${K.money(item.value)}%`;return item?.money?`${K.money(item.value)} ج`:`${K.money(item?.value)}`;}
  function summaryHtml(items=[]){return `<div class="kun86-summary-grid">${items.map(item=>`<div class="kun86-summary-card"><small>${K.esc(item.label||'—')}</small><b>${format(item)}</b></div>`).join('')}</div>`;}
  function rowsHtml(rows=[]){if(!rows.length)return '<div class="empty mt">لا توجد مفردات إضافية لهذا الرقم.</div>';return `<div class="table-wrap mt"><table class="table compact"><thead><tr><th>التاريخ</th><th>المدخل</th><th>القيمة</th><th>المرجع</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${K.esc(row.date||'—')}</td><td><b>${K.esc(row.label||groupNames[row.group]||'—')}</b>${row.description?`<small class="kun86-row-desc">${K.esc(row.description)}</small>`:''}</td><td class="kun86-total">${K.money(row.amount)} ج</td><td>${K.esc(row.id||'—')}</td></tr>`).join('')}</tbody></table></div>`;}
  async function openDetails(kind,label){
    try{
      const ctx=await K.context(),r=range(),path=K.withContext(`/api/system/dashboard/input-details?kind=${encodeURIComponent(kind)}&from=${encodeURIComponent(r.from)}&to=${encodeURIComponent(r.to)}`,ctx),data=await K.api(path);
      K.modal(`مدخلات ${label}`,`<div class="kun85-scope-note">${K.esc(data.from||r.from)} — ${K.esc(data.to||r.to)} · الناتج <b>${kind==='profitMargin'?`${K.money(data.total)}%`:`${K.money(data.total)} ج`}</b></div>${summaryHtml(data.summary||[])}${data.formula?`<div class="kun86-formula">المعادلة: ${K.esc(data.formula)}</div>`:''}${rowsHtml(data.rows||[])}`);
    }catch(error){K.notify(error.message);}
  }
  function decorate(){
    if(K.view()!=='dashboard')return;
    document.querySelectorAll('.dash-drilldown .dash-detail-row').forEach(row=>{
      const label=String(row.querySelector('span')?.textContent||'').trim(),kind=labels[label];if(!kind||row.dataset.kun86Input)return;
      row.dataset.kun86Input=kind;row.classList.add('kun86-input-click');row.tabIndex=0;row.setAttribute('role','button');row.setAttribute('aria-label',`عرض مدخلات ${label}`);
      const open=()=>openDetails(kind,label);row.addEventListener('click',open);row.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();open();}});
    });
  }
  function boot(){style();decorate();document.addEventListener('click',event=>{if(event.target.closest?.('[data-dash-kpi],.nav button[data-view="dashboard"],[data-dash-preset],#dashApplyRange'))setTimeout(decorate,60);},true);const root=K.root();if(root)new MutationObserver(()=>{if(K.view()==='dashboard')setTimeout(decorate,20);}).observe(root,{childList:true,subtree:false});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
  window.KunDashboardInputDetailsV86={version:'86.0',decorate,openDetails};
})();