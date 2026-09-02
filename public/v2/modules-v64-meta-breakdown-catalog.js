/* Kun Online v64 — hydrate Campaigns breakdown selector from the server's current Meta catalog. */
(function(){
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  let timer=null;
  function catalog(){const list=window.KunCampaignHubV63?.state?.expert?.breakdownCatalog;return Array.isArray(list)?list:[];}
  function hydrate(){
    const select=document.getElementById('campaign63Breakdown'),items=catalog();if(!select||!items.length)return;
    const signature=items.map(item=>`${item.id}:${item.group}:${item.label}`).join('|');if(select.dataset.catalogSignature===signature)return;
    const current=window.KunCampaignHubV63?.state?.breakdown||select.value||'image_asset';let html='',group=null;
    for(const item of items){const next=String(item.group||'Meta Breakdowns');if(next!==group){if(group!==null)html+='</optgroup>';group=next;html+=`<optgroup label="${esc(group)}">`;}html+=`<option value="${esc(item.id||item.key)}" ${(item.id||item.key)===current?'selected':''}>${esc(item.label||item.key)}</option>`;}
    if(group!==null)html+='</optgroup>';select.innerHTML=html;select.dataset.catalogSignature=signature;
    if([...select.options].some(option=>option.value===current))select.value=current;else{select.selectedIndex=0;if(window.KunCampaignHubV63?.state)window.KunCampaignHubV63.state.breakdown=select.value;}
  }
  function schedule(delay=0){clearTimeout(timer);timer=setTimeout(hydrate,delay);}
  const root=document.getElementById('root');if(root)new MutationObserver(()=>schedule(0)).observe(root,{childList:true,subtree:true});
  document.addEventListener('click',event=>{if(event.target.closest?.('.nav button[data-view="campaigns"],.campaign63 [data-tab],.campaign63 [data-status]'))schedule(80);},true);
  window.addEventListener('kun:section-reloaded',event=>{if(event.detail?.view==='campaigns')schedule(80);});
  setTimeout(hydrate,100);
  document.documentElement.dataset.metaBreakdownCatalogV64='ready';
})();
