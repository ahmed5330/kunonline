/* Kun Online v64 — hydrate Campaigns breakdown selector from the server catalog and render Action Breakdowns safely. */
(function(){
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const n=value=>Number.isFinite(Number(value))?Number(value):0;
  const num=value=>n(value).toLocaleString('ar-EG',{maximumFractionDigits:2});
  let timer=null,rendering=false;
  function catalog(){const list=window.KunCampaignHubV63?.state?.expert?.breakdownCatalog;return Array.isArray(list)?list:[];}
  function hydrate(){
    const select=document.getElementById('campaign63Breakdown'),items=catalog();if(!select||!items.length)return;
    const signature=items.map(item=>`${item.id}:${item.group}:${item.label}`).join('|');if(select.dataset.catalogSignature===signature)return;
    const current=window.KunCampaignHubV63?.state?.breakdown||select.value||'image_asset';let html='',group=null;
    for(const item of items){const next=String(item.group||'Meta Breakdowns');if(next!==group){if(group!==null)html+='</optgroup>';group=next;html+=`<optgroup label="${esc(group)}">`;}html+=`<option value="${esc(item.id||item.key)}" ${(item.id||item.key)===current?'selected':''}>${esc(item.label||item.key)}</option>`;}
    if(group!==null)html+='</optgroup>';select.innerHTML=html;select.dataset.catalogSignature=signature;
    if([...select.options].some(option=>option.value===current))select.value=current;else{select.selectedIndex=0;if(window.KunCampaignHubV63?.state)window.KunCampaignHubV63.state.breakdown=select.value;}
  }
  function actionTable(data){const rows=data?.rows||[],totals=data?.totals||{};return `${data?.note?`<div class="status-note">${esc(data.note)}</div>`:''}<div class="expert-grid mt"><div class="card expert-kpi"><small>إجمالي النتائج / الأحداث</small><strong>${num(totals.resultValue)}</strong></div><div class="card expert-kpi"><small>إجمالي قيمة الـConversion المسجلة</small><strong>${num(totals.conversionValue)}</strong></div></div><div class="table-wrap mt"><table class="table compact"><thead><tr><th>${esc(data?.label||'Action Breakdown')}</th><th>نوع الحدث</th><th>عدد / قيمة النتيجة</th><th>Conversion Value</th><th>الإعلان</th><th>المجموعة</th><th>الحملة</th><th>الحالة</th></tr></thead><tbody>${rows.length?rows.map(row=>`<tr><td><b>${esc(row.dimensionValue)}</b></td><td>${esc(row.actionType||'—')}</td><td>${num(row.resultValue)}</td><td>${num(row.conversionValue)}</td><td>${esc(row.adName||'—')}</td><td>${esc(row.adsetName||'—')}</td><td>${esc(row.campaignName||'—')}</td><td>${esc(row.status||'—')}</td></tr>`).join(''):'<tr><td colspan="8" class="empty">لا توجد أحداث مطابقة لهذا الـAction Breakdown.</td></tr>'}</tbody></table></div>`;}
  function decorateActionBreakdown(){
    if(rendering)return;const state=window.KunCampaignHubV63?.state,data=state?.breakdownData,box=document.getElementById('campaign63BreakdownBox');if(!box)return;
    if(data?.metricMode!=='actions'){delete box.dataset.actionBreakdownSignature;return;}
    const signature=`${data.dimension}|${data.rows?.length||0}|${data.totals?.resultValue||0}|${data.totals?.conversionValue||0}`;if(box.dataset.actionBreakdownSignature===signature)return;
    rendering=true;box.dataset.actionBreakdownSignature=signature;box.innerHTML=actionTable(data);rendering=false;
  }
  function refresh(){hydrate();decorateActionBreakdown();}
  function schedule(delay=0){clearTimeout(timer);timer=setTimeout(refresh,delay);}
  const root=document.getElementById('root');if(root)new MutationObserver(()=>schedule(0)).observe(root,{childList:true,subtree:true});
  document.addEventListener('click',event=>{if(event.target.closest?.('.nav button[data-view="campaigns"],.campaign63 [data-tab],.campaign63 [data-status],#campaign63BreakdownLoad'))schedule(100);},true);
  document.addEventListener('change',event=>{if(event.target.closest?.('#campaign63Breakdown'))schedule(30);},true);
  window.addEventListener('kun:section-reloaded',event=>{if(event.detail?.view==='campaigns')schedule(80);});
  setTimeout(refresh,100);
  document.documentElement.dataset.metaBreakdownCatalogV64='ready';
})();
