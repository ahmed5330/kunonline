/* Kun Online v69 — readable measured elements for Meta creative Breakdowns. */
(function(){
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const n=v=>Number.isFinite(Number(v))?Number(v):0;
  const money=v=>n(v).toLocaleString('ar-EG',{maximumFractionDigits:2});
  const integer=v=>Math.round(n(v)).toLocaleString('ar-EG');
  const textDimensions=new Set(['body_asset','title_asset','description_asset','media_text_content']);
  let lastSignature='';

  function ensureStyle(){
    if(document.getElementById('kunBreakdownElementsV69Style'))return;
    const s=document.createElement('style');s.id='kunBreakdownElementsV69Style';s.textContent=`
      .campaign66 .ux69-elements{margin:12px 0;padding:14px;border:1px solid var(--line,#e5e7eb);border-radius:14px;background:var(--card,#fff);direction:rtl}
      .campaign66 .ux69-head{display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap;margin-bottom:10px}
      .campaign66 .ux69-head h4{margin:0;font-size:15px}.campaign66 .ux69-head p{margin:3px 0 0;font-size:11px;color:var(--muted,#64748b);line-height:1.6}.campaign66 .ux69-count{margin-inline-start:auto;white-space:nowrap;padding:6px 9px;border-radius:999px;border:1px solid var(--line,#e5e7eb);font-size:11px;font-weight:800}
      .campaign66 .ux69-list{display:grid;gap:9px}.campaign66 .ux69-item{border:1px solid var(--line,#e5e7eb);border-radius:12px;overflow:hidden;background:var(--card,#fff)}
      .campaign66 .ux69-item-head{display:grid;grid-template-columns:auto minmax(0,1fr);gap:9px;align-items:start;padding:11px 12px;border-bottom:1px solid var(--line,#e5e7eb);background:color-mix(in srgb,var(--card,#fff) 97%,#64748b 3%)}
      .campaign66 .ux69-index{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;background:var(--ink,#111827);color:#fff;font-size:11px;font-weight:900}
      .campaign66 .ux69-value{font-size:13px;line-height:1.75;font-weight:800;white-space:pre-wrap;overflow-wrap:anywhere;unicode-bidi:plaintext}
      .campaign66 .ux69-meta{display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin-top:5px;font-size:10px;color:var(--muted,#64748b)}.campaign66 .ux69-id{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;direction:ltr;unicode-bidi:isolate;padding:2px 5px;border:1px solid var(--line,#e5e7eb);border-radius:6px}.campaign66 .ux69-unresolved{color:#b45309;font-weight:800}
      .campaign66 .ux69-metrics{display:grid;grid-template-columns:repeat(8,minmax(85px,1fr));gap:0}.campaign66 .ux69-metric{padding:9px 8px;text-align:center;border-inline-end:1px solid var(--line,#e5e7eb);min-width:0}.campaign66 .ux69-metric:last-child{border-inline-end:0}.campaign66 .ux69-metric small{display:block;font-size:9px;color:var(--muted,#64748b);margin-bottom:3px}.campaign66 .ux69-metric b{display:block;font-size:12px;white-space:nowrap}
      .campaign66 .ux69-item.high{border-color:color-mix(in srgb,#dc2626 45%,var(--line,#e5e7eb))}.campaign66 .ux69-item.good{border-color:color-mix(in srgb,#16a34a 45%,var(--line,#e5e7eb))}.campaign66 .ux69-item.high .ux69-index{background:#dc2626}.campaign66 .ux69-item.good .ux69-index{background:#16a34a}
      .campaign66 .ux69-scroll{overflow-x:auto;scrollbar-gutter:stable}.campaign66 .ux69-scroll .ux69-metrics{min-width:760px}
      @media(max-width:760px){.campaign66 .ux69-item-head{grid-template-columns:26px minmax(0,1fr)}.campaign66 .ux69-value{font-size:12px}.campaign66 .ux69-count{margin-inline-start:0}}
    `;document.head.appendChild(s);
  }
  function keyOf(row,index){return String(row?.dimensionAssetId||row?.dimensionValue||`${row?.adId||''}-${index}`);}
  function aggregate(rows){
    const map=new Map();
    rows.forEach((row,index)=>{
      const key=keyOf(row,index),x=map.get(key)||{key,value:String(row?.dimensionValue||'غير محدد'),assetId:String(row?.dimensionAssetId||''),resolved:row?.dimensionResolved!==false,ads:new Set(),spend:0,purchases:0,purchaseValue:0,impressions:0,reach:0,clicks:0};
      x.spend+=n(row?.spend);x.purchases+=n(row?.purchases);x.purchaseValue+=n(row?.purchaseValue);x.impressions+=n(row?.impressions);x.reach+=n(row?.reach);x.clicks+=n(row?.clicks);if(row?.adName)x.ads.add(String(row.adName));if(!x.assetId&&row?.dimensionAssetId)x.assetId=String(row.dimensionAssetId);if(row?.dimensionResolved===true)x.resolved=true;map.set(key,x);
    });
    return [...map.values()].map(x=>({...x,ads:[...x.ads],cpp:x.purchases?x.spend/x.purchases:0,roas:x.spend?x.purchaseValue/x.spend:0,ctr:x.impressions?x.clicks/x.impressions*100:0,cpc:x.clicks?x.spend/x.clicks:0,cpm:x.impressions?x.spend/x.impressions*1000:0,frequency:x.reach?x.impressions/x.reach:0})).sort((a,b)=>b.spend-a.spend||b.purchases-a.purchases);
  }
  function tone(x,medianRoas){if(x.spend>0&&x.purchases===0)return 'high';if(medianRoas>0&&x.roas>=medianRoas*1.35&&x.purchases>0)return 'good';return '';}
  function median(values){const a=values.filter(v=>Number.isFinite(v)&&v>0).sort((a,b)=>a-b);if(!a.length)return 0;const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;}
  function metric(label,value){return `<div class="ux69-metric"><small>${esc(label)}</small><b>${esc(value)}</b></div>`;}
  function card(x,index,medianRoas,isText){
    const isIdOnly=x.assetId&&String(x.value)===String(x.assetId),label=isIdOnly?'Meta لم ترجع النص لهذا الـAsset في الرد الحالي':x.value;
    return `<article class="ux69-item ${tone(x,medianRoas)}" data-ux69-key="${esc(x.key)}"><div class="ux69-item-head"><span class="ux69-index">${index+1}</span><div><div class="ux69-value">${esc(label)}</div><div class="ux69-meta">${x.assetId?`<span>Asset ID <span class="ux69-id">${esc(x.assetId)}</span></span>`:''}${x.ads.length?`<span>${integer(x.ads.length)} إعلان مرتبط</span>`:''}${isIdOnly?'<span class="ux69-unresolved">النص غير محلول بعد</span>':''}</div></div></div><div class="ux69-scroll"><div class="ux69-metrics">${metric('Spend',`${money(x.spend)} ج`)}${metric('Purchases',integer(x.purchases))}${metric('CPP',`${money(x.cpp)} ج`)}${metric('ROAS',`${money(x.roas)}x`)}${metric('CTR',`${money(x.ctr)}%`)}${metric('CPC',`${money(x.cpc)} ج`)}${metric('CPM',`${money(x.cpm)} ج`)}${metric('Frequency',money(x.frequency))}</div></div></article>`;
  }
  function render(){
    const hub=window.KunCampaignHubV66,section=hub?.state?.sections?.ad,data=section?.breakdownData,box=document.getElementById('campaign66BreakdownBox');if(!hub||!box)return;
    box.querySelector('.ux69-elements')?.remove();
    if(!data||data.error||data.metricMode==='actions'||!Array.isArray(data.rows)||!data.rows.length){lastSignature='';return;}
    const elements=aggregate(data.rows),signature=`${data.dimension}|${data.from}|${data.to}|${elements.map(x=>`${x.key}:${x.spend}:${x.purchases}:${x.value}`).join('|')}`;if(signature===lastSignature&&box.querySelector('.ux69-elements'))return;lastSignature=signature;
    ensureStyle();const isText=textDimensions.has(String(data.dimension||'')),medianRoas=median(elements.filter(x=>x.purchases>0).map(x=>x.roas)),title=isText?`كل ${data.label||'النصوص'} وأرقامها`:`كل عناصر ${data.label||'Breakdown'} وأرقامها`;
    const wrapper=document.createElement('section');wrapper.className='ux69-elements';wrapper.innerHTML=`<div class="ux69-head"><div><h4>${esc(title)}</h4><p>${isText?'كل نص ظاهر هنا بالقيمة الفعلية التي تقيسها Meta، ثم أرقامه الخاصة. الـAsset ID موجود كمرجع فقط وليس بديلًا عن النص.':'كل عنصر ظاهر بقيمته المقروءة ثم مؤشرات أدائه.'}</p></div><span class="ux69-count">${integer(elements.length)} عنصر مقاس</span></div><div class="ux69-list">${elements.map((x,i)=>card(x,i,medianRoas,isText)).join('')}</div>`;
    const table=box.querySelector('.table-wrap');if(table)table.before(wrapper);else box.appendChild(wrapper);
  }
  function schedule(){setTimeout(render,0);}
  const root=document.getElementById('root');if(root)new MutationObserver(schedule).observe(root,{childList:true,subtree:true});
  document.addEventListener('change',event=>{if(event.target?.id==='campaign66Breakdown'){lastSignature='';schedule();}},true);
  document.addEventListener('click',event=>{if(event.target?.id==='campaign66BreakdownLoad'){lastSignature='';setTimeout(schedule,250);}},true);
  window.addEventListener('kun:section-reloaded',()=>{lastSignature='';schedule();});
  window.KunBreakdownElementsV69={render,aggregate,version:'69.0'};
  document.documentElement.dataset.breakdownElements='v69-ready';schedule();
})();
