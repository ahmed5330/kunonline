/* Kun Online v73 — choose a Campaign for Ad Set analysis and an Ad Set for Ads analysis. */
(function(){
  const clean=value=>String(value??'').trim();
  const hub=()=>window.KunCampaignHubV66;
  const state={
    adset:{campaignId:''},
    ad:{campaignId:'',adsetId:''},
    cache:{hub:null},
    reloading:false
  };
  const rowsOf=value=>Array.isArray(value)?value:Array.isArray(value?.rows)?value.rows:[];
  const replaceRows=(value,rows)=>Array.isArray(value)?rows:{...(value||{}),rows};
  const aliases=row=>new Set([
    row?.externalId,row?.external_id,row?.id,row?.entityId,row?.entity_id,
    row?.externalCampaignId,row?.external_campaign_id,row?.campaignId,row?.campaign_id,
    row?.externalAdsetId,row?.external_adset_id,row?.adsetId,row?.adset_id,row?.adSetId,row?.ad_set_id
  ].map(clean).filter(Boolean));
  const campaignIdentity=row=>clean(row?.externalCampaignId||row?.external_campaign_id||row?.externalId||row?.external_id||row?.campaignId||row?.campaign_id||row?.id);
  const entityIdentity=row=>clean(row?.externalId||row?.external_id||row?.id||row?.entityId||row?.entity_id);
  const adsetCampaign=row=>clean(row?.externalCampaignId||row?.external_campaign_id||row?.campaignId||row?.campaign_id);
  const adAdset=row=>clean(row?.externalAdsetId||row?.external_adset_id||row?.adsetId||row?.adset_id||row?.adSetId||row?.ad_set_id);
  const adCampaign=row=>clean(row?.externalCampaignId||row?.external_campaign_id||row?.campaignId||row?.campaign_id);
  const isActive=row=>clean(row?.status).toLowerCase()==='active';
  const statusVisible=row=>hub()?.state?.status==='all'||isActive(row);
  function campaignRows(data=state.cache.hub){return rowsOf(data?.campaigns).filter(statusVisible);}
  function adsetRows(data=state.cache.hub){return rowsOf(data?.adsets).filter(statusVisible);}
  function adRows(data=state.cache.hub){return rowsOf(data?.ads).filter(statusVisible);}
  function campaignAliases(selected,data=state.cache.hub){
    if(!selected)return new Set();
    const row=campaignRows(data).find(item=>campaignIdentity(item)===selected||aliases(item).has(selected));
    return row?aliases(row):new Set([selected]);
  }
  function adsetAliases(selected,data=state.cache.hub){
    if(!selected)return new Set();
    const row=adsetRows(data).find(item=>entityIdentity(item)===selected||aliases(item).has(selected));
    return row?aliases(row):new Set([selected]);
  }
  const belongsToCampaign=(row,selected,data=state.cache.hub)=>{
    if(!selected)return true;
    const allowed=campaignAliases(selected,data),direct=adsetCampaign(row)||adCampaign(row);
    if(direct&&allowed.has(direct))return true;
    const parentSet=adAdset(row);
    if(parentSet){const set=adsetRows(data).find(item=>aliases(item).has(parentSet));if(set&&allowed.has(adsetCampaign(set)))return true;}
    return false;
  };
  const belongsToAdset=(row,selected,data=state.cache.hub)=>!selected||adsetAliases(selected,data).has(adAdset(row));
  function scopedAdsets(data=state.cache.hub,selection=state.adset){
    return adsetRows(data).filter(row=>belongsToCampaign(row,selection.campaignId,data));
  }
  function scopedAds(data=state.cache.hub,selection=state.ad){
    return adRows(data).filter(row=>belongsToCampaign(row,selection.campaignId,data)&&belongsToAdset(row,selection.adsetId,data));
  }
  function filterHubPayload(data,level=hub()?.state?.level){
    if(!data||typeof data!=='object')return data;
    if(level==='adset'&&state.adset.campaignId)return {...data,adsets:replaceRows(data.adsets,scopedAdsets(data))};
    if(level==='ad'&&(state.ad.campaignId||state.ad.adsetId))return {...data,ads:replaceRows(data.ads,scopedAds(data))};
    return data;
  }
  function allowedIdentitySet(level,data=state.cache.hub){
    const source=level==='adset'?scopedAdsets(data):level==='ad'?scopedAds(data):[];
    const out=new Set();for(const row of source)for(const value of aliases(row))out.add(value);return out;
  }
  function filterComparisonPayload(data,level){
    if(!data||!Array.isArray(data.rows))return data;
    const active=level==='adset'?Boolean(state.adset.campaignId):level==='ad'?Boolean(state.ad.campaignId||state.ad.adsetId):false;
    if(!active||!state.cache.hub)return data;
    const allowed=allowedIdentitySet(level),rows=data.rows.filter(row=>[...aliases(row)].some(value=>allowed.has(value)));
    return {...data,rows,parentScopeApplied:true};
  }
  function optionsForCampaigns(data=state.cache.hub){
    const seen=new Set(),out=[];for(const row of campaignRows(data)){const id=campaignIdentity(row);if(!id||seen.has(id))continue;seen.add(id);out.push({id,name:clean(row.name)||id,status:clean(row.status)});}return out.sort((a,b)=>a.name.localeCompare(b.name,'ar'));
  }
  function optionsForAdsets(campaignId=state.ad.campaignId,data=state.cache.hub){
    const seen=new Set(),out=[];for(const row of adsetRows(data).filter(item=>belongsToCampaign(item,campaignId,data))){const id=entityIdentity(row);if(!id||seen.has(id))continue;seen.add(id);out.push({id,name:clean(row.name)||id,status:clean(row.status)});}return out.sort((a,b)=>a.name.localeCompare(b.name,'ar'));
  }
  function normalizeSelection(){
    const campaigns=optionsForCampaigns();
    if(state.adset.campaignId&&!campaigns.some(x=>x.id===state.adset.campaignId))state.adset.campaignId='';
    if(state.ad.campaignId&&!campaigns.some(x=>x.id===state.ad.campaignId)){state.ad.campaignId='';state.ad.adsetId='';}
    const sets=optionsForAdsets();if(state.ad.adsetId&&!sets.some(x=>x.id===state.ad.adsetId))state.ad.adsetId='';
  }
  const publicApi={state,filterHubPayload,filterComparisonPayload,optionsForCampaigns,optionsForAdsets,scopedAdsets,scopedAds,_testSetHubCache:data=>{state.cache.hub=data;normalizeSelection();},version:'73.0'};
  window.KunCampaignParentScopeV73=publicApi;
  if(typeof document==='undefined')return;
  const root=document.getElementById('root');if(!root)return;

  function ensureStyle(){
    if(document.getElementById('kunCampaignParentScopeV73Style'))return;
    const style=document.createElement('style');style.id='kunCampaignParentScopeV73Style';style.textContent=`
      .campaign66 .parent-scope73{display:flex;align-items:end;gap:9px;flex-wrap:wrap;padding:9px 10px;border:1px solid var(--line,#e5e7eb);border-radius:12px;background:var(--card,#fff)}
      .campaign66 .parent-scope73 label{display:grid;gap:4px;min-width:230px;flex:1;color:var(--muted,#64748b);font-size:11px;font-weight:700}
      .campaign66 .parent-scope73 select{width:100%;min-height:34px;border:1px solid var(--line,#e5e7eb);border-radius:9px;background:var(--card,#fff);color:inherit;padding:6px 9px;font-size:12px}
      .campaign66 .parent-scope73 .scope73-note{width:100%;font-size:11px;color:var(--muted,#64748b)}
      .campaign66 .parent-scope73 .scope73-current{display:inline-flex;align-items:center;gap:5px;padding:5px 8px;border-radius:999px;background:color-mix(in srgb,var(--card,#fff) 80%,#3b82f6 20%);font-size:11px;font-weight:800}
      @media(max-width:620px){.campaign66 .parent-scope73 label{min-width:100%}}
    `;document.head.appendChild(style);
  }
  function responseFrom(response,data){
    const headers=new Headers(response.headers);headers.delete('content-length');headers.delete('content-encoding');headers.set('content-type','application/json; charset=utf-8');
    return new Response(JSON.stringify(data),{status:response.status,statusText:response.statusText,headers});
  }
  function installFetchScope(){
    if(window.__kunCampaignParentScopeV73Fetch)return;
    const original=window.fetch.bind(window);window.__kunCampaignParentScopeV73Fetch=original;
    window.fetch=async(input,init)=>{
      const response=await original(input,init);let url;try{url=new URL(typeof input==='string'||input instanceof URL?input:input?.url,location.href);}catch{return response;}
      if(!response.ok||url.origin!==location.origin)return response;
      if(url.pathname==='/api/integrations/meta-ads/campaign-hub'){
        try{const data=await response.clone().json();state.cache.hub=data;normalizeSelection();queueDecorate();return responseFrom(response,filterHubPayload(data));}catch{return response;}
      }
      if(url.pathname==='/api/integrations/meta-ads/daily-comparison'){
        const level=clean(url.searchParams.get('level'));if(level!=='adset'&&level!=='ad')return response;
        try{const data=await response.clone().json();return responseFrom(response,filterComparisonPayload(data,level));}catch{return response;}
      }
      return response;
    };
  }
  function optionMarkup(items,selected,allLabel){return `<option value="">${allLabel}</option>${items.map(item=>`<option value="${item.id.replace(/&/g,'&amp;').replace(/"/g,'&quot;')}"${item.id===selected?' selected':''}>${item.name.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</option>`).join('')}`;}
  async function reload(){
    if(state.reloading)return;state.reloading=true;try{await hub()?.reload?.();}finally{state.reloading=false;setTimeout(decorate,0);}
  }
  function bind(card){
    card.querySelector('[data-scope73-campaign]')?.addEventListener('change',async event=>{
      const level=hub()?.state?.level,value=clean(event.target.value);
      if(level==='adset')state.adset.campaignId=value;
      if(level==='ad'){state.ad.campaignId=value;state.ad.adsetId='';}
      await reload();
    });
    card.querySelector('[data-scope73-adset]')?.addEventListener('change',async event=>{state.ad.adsetId=clean(event.target.value);await reload();});
  }
  function decorate(){
    const shell=root.querySelector('.campaign66');if(!shell)return;
    ensureStyle();normalizeSelection();const level=hub()?.state?.level;
    const existing=shell.querySelector('.parent-scope73');
    if(level!=='adset'&&level!=='ad'){existing?.remove();return;}
    const campaigns=optionsForCampaigns(),adsets=optionsForAdsets();
    const html=level==='adset'
      ?`<label>الحملة المراد تحليل مجموعاتها<select data-scope73-campaign>${optionMarkup(campaigns,state.adset.campaignId,'كل الحملات')}</select></label><span class="scope73-current">🎯 نطاق تحليل المجموعات</span><div class="scope73-note">الاختيار يطبق على مؤشرات الأداء، جدول المجموعات والمقارنة داخل نفس الفترة الزمنية.</div>`
      :`<label>الحملة<select data-scope73-campaign>${optionMarkup(campaigns,state.ad.campaignId,'كل الحملات')}</select></label><label>المجموعة المراد تحليل إعلاناتها<select data-scope73-adset>${optionMarkup(adsets,state.ad.adsetId,'كل المجموعات')}</select></label><span class="scope73-current">🎯 نطاق تحليل الإعلانات</span><div class="scope73-note">اختيار الحملة يضيّق قائمة المجموعات، واختيار المجموعة يطبق على مؤشرات الإعلانات وجدولها ومقارنتها.</div>`;
    if(existing&&existing.dataset.scopeSignature===`${level}|${state.adset.campaignId}|${state.ad.campaignId}|${state.ad.adsetId}|${campaigns.length}|${adsets.length}`)return;
    const card=existing||document.createElement('div');card.className='parent-scope73';card.dataset.scopeSignature=`${level}|${state.adset.campaignId}|${state.ad.campaignId}|${state.ad.adsetId}|${campaigns.length}|${adsets.length}`;card.innerHTML=html;
    if(!existing){const anchor=shell.querySelector('.date-card')||shell.querySelector('.kpis')||shell.children[2];anchor?.before(card)||shell.appendChild(card);}bind(card);
  }
  let queued=false;function queueDecorate(){if(queued)return;queued=true;queueMicrotask(()=>{queued=false;decorate();});}
  installFetchScope();const observer=new MutationObserver(queueDecorate);observer.observe(root,{childList:true,subtree:true});
  document.addEventListener('change',event=>{if(event.target.closest?.('.campaign66'))setTimeout(queueDecorate,0);},true);
  document.addEventListener('click',event=>{if(event.target.closest?.('[data-campaign-section],[data-section-mode],.date-presets button,.campaign66 .seg button'))setTimeout(queueDecorate,0);},true);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',queueDecorate,{once:true});else setTimeout(queueDecorate,0);
  document.documentElement.dataset.campaignParentScope='v73-ready';
})();
