/* Kun Online v68 — selected Meta Breakdown analysis UX for Campaign Hub v66. */
(function(){
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const n=v=>Number.isFinite(Number(v))?Number(v):0;
  const money=v=>n(v).toLocaleString('ar-EG',{maximumFractionDigits:2});
  const integer=v=>Math.round(n(v)).toLocaleString('ar-EG');
  const pct=v=>`${money(v)}%`;
  const compact=v=>String(v??'—').trim()||'—';

  function ensureStyle(){
    if(document.getElementById('kunBreakdownAnalysisV68Style'))return;
    const s=document.createElement('style');s.id='kunBreakdownAnalysisV68Style';s.textContent=`
      .campaign66 .ux68-analysis{margin:12px 0 10px;padding:14px;border:1px solid var(--line,#e5e7eb);border-radius:14px;background:color-mix(in srgb,var(--card,#fff) 96%,#2563eb 4%);direction:rtl}
      .campaign66 .ux68-head{display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap;margin-bottom:11px}
      .campaign66 .ux68-head .spacer{flex:1}.campaign66 .ux68-kicker{font-size:11px;color:#2563eb;font-weight:900;letter-spacing:.01em}
      .campaign66 .ux68-title{margin:2px 0 0;font-size:16px}.campaign66 .ux68-sub{font-size:12px;color:var(--muted,#64748b);margin-top:3px}
      .campaign66 .ux68-selected{display:inline-flex;align-items:center;gap:7px;padding:7px 10px;border-radius:999px;border:1px solid #93c5fd;background:#eff6ff;color:#1d4ed8;font-size:12px;font-weight:900}
      .campaign66 .ux68-selected i{width:9px;height:9px;border-radius:50%;background:#2563eb;display:inline-block}
      .campaign66 .ux68-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
      .campaign66 .ux68-card{min-width:0;padding:11px;border:1px solid var(--line,#e5e7eb);border-radius:11px;background:var(--card,#fff)}
      .campaign66 .ux68-card small{display:block;color:var(--muted,#64748b);font-size:10px;margin-bottom:4px}.campaign66 .ux68-card strong{display:block;font-size:14px;overflow-wrap:anywhere}.campaign66 .ux68-card p{margin:5px 0 0;color:var(--muted,#64748b);font-size:11px;line-height:1.65}
      .campaign66 .ux68-card.good{border-inline-start:4px solid #16a34a}.campaign66 .ux68-card.high{border-inline-start:4px solid #dc2626}.campaign66 .ux68-card.watch{border-inline-start:4px solid #d97706}.campaign66 .ux68-card.info{border-inline-start:4px solid #2563eb}
      .campaign66 .ux68-focus{margin-top:10px;display:grid;gap:7px}.campaign66 .ux68-focus-title{font-size:12px;font-weight:900}.campaign66 .ux68-focus-row{display:flex;align-items:flex-start;gap:8px;padding:9px 10px;border:1px solid var(--line,#e5e7eb);border-radius:10px;background:var(--card,#fff)}
      .campaign66 .ux68-focus-row .mark{flex:0 0 22px;width:22px;height:22px;border-radius:50%;display:grid;place-items:center;color:#fff;font-size:11px;font-weight:900}.campaign66 .ux68-focus-row.high .mark{background:#dc2626}.campaign66 .ux68-focus-row.watch .mark{background:#d97706}.campaign66 .ux68-focus-row.good .mark{background:#16a34a}
      .campaign66 .ux68-focus-row b{font-size:12px}.campaign66 .ux68-focus-row p{margin:2px 0 0;font-size:11px;color:var(--muted,#64748b);line-height:1.65}
      .campaign66 .ux68-pending{padding:11px;border:1px dashed #93c5fd;border-radius:11px;background:#eff6ff;color:#1e40af;font-size:12px;line-height:1.7}
      .campaign66 #campaign66BreakdownBox table tbody tr.ux68-row-high{background:rgba(220,38,38,.045)}
      .campaign66 #campaign66BreakdownBox table tbody tr.ux68-row-good{background:rgba(22,163,74,.045)}
      .campaign66 #campaign66BreakdownBox table tbody tr.ux68-row-watch{background:rgba(217,119,6,.045)}
      @media(max-width:1000px){.campaign66 .ux68-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
      @media(max-width:600px){.campaign66 .ux68-grid{grid-template-columns:1fr}.campaign66 .ux68-selected{width:100%;justify-content:center}}
    `;document.head.appendChild(s);
  }

  function selectedLabel(data){
    const select=document.getElementById('campaign66Breakdown');
    return compact(data?.label||select?.selectedOptions?.[0]?.textContent||select?.value||window.KunCampaignHubV66?.state?.breakdown||'Breakdown');
  }
  function rowName(row){return compact(row?.dimensionValue||row?.actionType||row?.adName||'—');}
  function med(values){const a=values.map(n).filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return 0;const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;}
  function totals(rows){return rows.reduce((a,x)=>{a.spend+=n(x.spend);a.purchases+=n(x.purchases);a.value+=n(x.purchaseValue);a.impressions+=n(x.impressions);a.clicks+=n(x.clicks);a.results+=n(x.resultValue);a.conv+=n(x.conversionValue);return a;},{spend:0,purchases:0,value:0,impressions:0,clicks:0,results:0,conv:0});}
  function card(kind,label,row,detail){if(!row)return '';return `<div class="ux68-card ${kind}"><small>${esc(label)}</small><strong>${esc(rowName(row))}</strong><p>${esc(detail)}</p></div>`;}
  function signal(kind,title,row,reason,index){return `<div class="ux68-focus-row ${kind}"><span class="mark">${index}</span><div><b>${esc(title)} — ${esc(rowName(row))}</b><p>${esc(reason)}</p></div></div>`;}
  function deliveryAnalysis(data,label){
    const rows=(data?.rows||[]).filter(Boolean),t=totals(rows);
    if(!rows.length)return `<div class="ux68-pending">تم تحميل «${esc(label)}»، لكن لا توجد صفوف كافية للتحليل في الفترة الحالية.</div>`;
    const spent=rows.filter(x=>n(x.spend)>0),converted=spent.filter(x=>n(x.purchases)>0),best=[...converted].sort((a,b)=>n(b.roas)-n(a.roas)||n(a.cpp)-n(b.cpp))[0],worstNoPurchase=[...spent].filter(x=>n(x.purchases)===0).sort((a,b)=>n(b.spend)-n(a.spend))[0],worstEfficiency=[...converted].sort((a,b)=>n(a.roas)-n(b.roas)||n(b.cpp)-n(a.cpp))[0],highestSpend=[...spent].sort((a,b)=>n(b.spend)-n(a.spend))[0],bestCtr=[...spent].sort((a,b)=>n(b.ctr)-n(a.ctr))[0],bestPurchases=[...rows].sort((a,b)=>n(b.purchases)-n(a.purchases))[0];
    const medianRoas=med(converted.map(x=>x.roas)),medianCpp=med(converted.map(x=>x.cpp)),medianCtr=med(spent.map(x=>x.ctr)),medianCpm=med(spent.map(x=>x.cpm));
    const alerts=[];
    for(const x of spent){
      if(n(x.purchases)===0&&n(x.spend)>0)alerts.push({kind:'high',score:150+n(x.spend),title:'إنفاق بدون شراء',row:x,reason:`صرف ${money(x.spend)} ج بدون تسجيل Purchase على هذا العنصر.`});
      else if(medianRoas>0&&n(x.roas)<medianRoas*.65)alerts.push({kind:'high',score:120+(medianRoas-n(x.roas))*10,title:'ROAS أقل بوضوح من بقية العناصر',row:x,reason:`ROAS = ${money(x.roas)}x مقابل Median ${money(medianRoas)}x داخل الـBreakdown الحالي.`});
      if(medianCpp>0&&n(x.purchases)>0&&n(x.cpp)>medianCpp*1.35)alerts.push({kind:'watch',score:90+n(x.cpp)/Math.max(1,medianCpp),title:'CPP مرتفع نسبيًا',row:x,reason:`CPP = ${money(x.cpp)} ج مقابل Median ${money(medianCpp)} ج.`});
      if(medianCtr>0&&n(x.ctr)<medianCtr*.7&&n(x.spend)>0)alerts.push({kind:'watch',score:80+(medianCtr-n(x.ctr))*10,title:'CTR منخفض نسبيًا',row:x,reason:`CTR = ${pct(x.ctr)} مقابل Median ${pct(medianCtr)}.`});
      if(medianCpm>0&&n(x.cpm)>medianCpm*1.35)alerts.push({kind:'watch',score:75+n(x.cpm)/Math.max(1,medianCpm),title:'CPM مرتفع نسبيًا',row:x,reason:`CPM = ${money(x.cpm)} ج مقابل Median ${money(medianCpm)} ج.`});
      if(n(x.frequency)>=3.5)alerts.push({kind:'watch',score:70+n(x.frequency),title:'Frequency يحتاج متابعة',row:x,reason:`Frequency = ${money(x.frequency)}؛ راقب التشبع خصوصًا مع هبوط CTR أو ROAS.`});
      if(medianRoas>0&&n(x.roas)>=medianRoas*1.4&&n(x.purchases)>0)alerts.push({kind:'good',score:55+n(x.roas),title:'أداء أعلى من المتوسط',row:x,reason:`ROAS = ${money(x.roas)}x أعلى بوضوح من Median ${money(medianRoas)}x.`});
    }
    const unique=[];const seen=new Set();for(const a of alerts.sort((a,b)=>b.score-a.score)){const k=`${a.kind}|${a.title}|${rowName(a.row)}`;if(seen.has(k))continue;seen.add(k);unique.push(a);if(unique.length>=6)break;}
    const cpp=t.purchases?t.spend/t.purchases:0,roas=t.spend?t.value/t.spend:0,ctr=t.impressions?t.clicks/t.impressions*100:0;
    return `<div class="ux68-grid">
      ${card('good','أفضل عنصر كفاءة',best,best?`ROAS ${money(best.roas)}x · CPP ${money(best.cpp)} ج · ${integer(best.purchases)} Purchase`:'' )}
      ${card(worstNoPurchase?'high':'watch',worstNoPurchase?'أعلى هدر يحتاج مراجعة':'أضعف كفاءة',worstNoPurchase||worstEfficiency,(worstNoPurchase||worstEfficiency)?worstNoPurchase?`Spend ${money(worstNoPurchase.spend)} ج بدون Purchase.`:`ROAS ${money(worstEfficiency.roas)}x · CPP ${money(worstEfficiency.cpp)} ج.`:'')}
      ${card('info','أعلى إنفاق',highestSpend,highestSpend?`Spend ${money(highestSpend.spend)} ج · ${integer(highestSpend.purchases)} Purchase · ROAS ${money(highestSpend.roas)}x`:'')}
      ${card('good','أعلى مشتريات',bestPurchases,bestPurchases?`${integer(bestPurchases.purchases)} Purchase · Spend ${money(bestPurchases.spend)} ج`:'' )}
      ${card('info','أفضل CTR',bestCtr,bestCtr?`CTR ${pct(bestCtr.ctr)} · CPM ${money(bestCtr.cpm)} ج`:'' )}
      <div class="ux68-card info"><small>ملخص ${esc(label)}</small><strong>${integer(rows.length)} عنصر</strong><p>Spend ${money(t.spend)} ج · Purchases ${integer(t.purchases)} · CPP ${money(cpp)} ج · ROAS ${money(roas)}x${ctr?` · CTR ${pct(ctr)}`:''}</p></div>
    </div>${unique.length?`<div class="ux68-focus"><div class="ux68-focus-title">نقاط تستحق التركيز في «${esc(label)}»</div>${unique.map((a,i)=>signal(a.kind,a.title,a.row,a.reason,i+1)).join('')}</div>`:'<div class="ux68-pending" style="margin-top:10px">لا توجد إشارات حادة داخل العناصر الحالية. راقب الفروق مع زيادة حجم البيانات.</div>'}`;
  }
  function actionAnalysis(data,label){
    const rows=(data?.rows||[]).filter(Boolean);if(!rows.length)return `<div class="ux68-pending">تم تحميل «${esc(label)}»، لكن لا توجد أحداث كافية للتحليل في الفترة الحالية.</div>`;
    const bestResults=[...rows].sort((a,b)=>n(b.resultValue)-n(a.resultValue))[0],bestValue=[...rows].sort((a,b)=>n(b.conversionValue)-n(a.conversionValue))[0],t=totals(rows),top=[...rows].sort((a,b)=>n(b.resultValue)-n(a.resultValue)).slice(0,4);
    return `<div class="ux68-grid">${card('good','أعلى عدد نتائج',bestResults,bestResults?`${money(bestResults.resultValue)} نتيجة/حدث · ${compact(bestResults.actionType)}`:'')}${card('good','أعلى Conversion Value',bestValue,bestValue?`${money(bestValue.conversionValue)} · ${compact(bestValue.actionType)}`:'')}<div class="ux68-card info"><small>إجمالي العناصر</small><strong>${integer(rows.length)}</strong><p>${money(t.results)} نتيجة/حدث · Conversion Value ${money(t.conv)}</p></div><div class="ux68-card info"><small>طبيعة التحليل</small><strong>Action Breakdown</strong><p>لا يتم تكرار Spend أو CPM هنا؛ المقارنة على النتائج وقيمة التحويل فقط.</p></div></div><div class="ux68-focus"><div class="ux68-focus-title">أقوى النتائج داخل «${esc(label)}»</div>${top.map((x,i)=>signal('good',compact(x.actionType||'Action'),x,`${money(x.resultValue)} نتيجة/حدث · Conversion Value ${money(x.conversionValue)}`,i+1)).join('')}</div>`;
  }
  function clearRowMarks(){document.querySelectorAll('#campaign66BreakdownBox tbody tr').forEach(tr=>tr.classList.remove('ux68-row-high','ux68-row-watch','ux68-row-good'));}
  function markRows(data){clearRowMarks();if(!data?.rows?.length)return;const rows=[...document.querySelectorAll('#campaign66BreakdownBox tbody tr')];for(const [i,x] of data.rows.entries()){const tr=rows[i];if(!tr)continue;if(n(x.spend)>0&&n(x.purchases)===0)tr.classList.add('ux68-row-high');else if(n(x.roas)>=3&&n(x.purchases)>0)tr.classList.add('ux68-row-good');else if(n(x.frequency)>=3.5)tr.classList.add('ux68-row-watch');}}
  function enhance(){
    ensureStyle();const select=document.getElementById('campaign66Breakdown'),box=document.getElementById('campaign66BreakdownBox');if(!select||!box)return;
    const card=box.closest('.card');if(!card)return;
    let host=card.querySelector('.ux68-analysis');if(!host){host=document.createElement('div');host.className='ux68-analysis';card.insertBefore(host,box);}
    const data=window.KunCampaignHubV66?.state?.sections?.ad?.breakdownData||null,label=selectedLabel(data);
    const head=`<div class="ux68-head"><div><div class="ux68-kicker">تحليل الـBreakdown المختار</div><h4 class="ux68-title">العنصر محل التحليل: ${esc(label)}</h4><div class="ux68-sub">التحليل التالي يخص الاختيار الحالي فقط والفترة الزمنية الحالية لقسم الإعلانات.</div></div><div class="spacer"></div><span class="ux68-selected"><i></i>${esc(label)}</span></div>`;
    if(!data){host.innerHTML=`${head}<div class="ux68-pending">تم اختيار «${esc(label)}». اضغط <b>تحميل الـBreakdown</b> لعرض التحليل الخاص بهذا العنصر. لن يتم إبقاء تحليل اختيار قديم حتى لا تختلط النتائج.</div>`;clearRowMarks();return;}
    if(data.error){host.innerHTML=`${head}<div class="ux68-pending">تعذر تحليل «${esc(label)}»: ${esc(data.error)}</div>`;clearRowMarks();return;}
    host.innerHTML=head+(data.metricMode==='actions'?actionAnalysis(data,label):deliveryAnalysis(data,label));markRows(data);
  }
  let queued=false;function schedule(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;enhance();});}
  const observer=new MutationObserver(schedule);observer.observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('change',e=>{if(e.target?.id==='campaign66Breakdown')setTimeout(schedule,0);},true);
  document.addEventListener('click',e=>{if(e.target?.id==='campaign66BreakdownLoad')setTimeout(schedule,0);},true);
  window.addEventListener('kun:section-reloaded',schedule);
  window.KunBreakdownAnalysisV68={enhance,version:'68.0'};
  document.documentElement.dataset.breakdownAnalysis='v68-ready';
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',schedule,{once:true});else schedule();
})();
