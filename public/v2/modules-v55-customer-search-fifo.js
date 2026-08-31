/* Kun Online v55.1 — fast local operational customer search, FIFO shipping UX and explicit order dates. */
(function(){
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[char]));
  const norm=value=>String(value??'').normalize('NFKD').replace(/[\u064B-\u065F\u0670]/g,'').replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/\s+/g,' ').trim().toLowerCase();
  const digits=value=>String(value??'').replace(/\D/g,'');
  const notify=message=>window.showToast?.(message)||console.log(message);
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  let lastMatches=[],searchBox=null,scanQueued=false;

  async function clientId(){return window.kunClientId?await window.kunClientId():'';}
  async function api(path,options={}){const response=await fetch(path,{credentials:'include',...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})}}),data=await response.json().catch(()=>({}));if(!response.ok)throw Object.assign(new Error(data.error||`HTTP ${response.status}`),{status:response.status,code:data.code});return data;}
  function activeView(){return document.querySelector('.nav button.active[data-view]')?.dataset.view||'';}
  function operationalView(){return ['customer-service','post-shipping'].includes(activeView());}
  function ensureStyle(){if(document.getElementById('kunV55SearchStyle'))return;const style=document.createElement('style');style.id='kunV55SearchStyle';style.textContent=`
    .v55-search-results{position:fixed;z-index:12000;display:none;max-height:min(430px,62vh);overflow:auto;background:var(--card,#fff);color:var(--text,#0f172a);border:1px solid var(--line,#dbe3ef);border-radius:13px;box-shadow:0 18px 55px rgba(15,23,42,.2);padding:7px;min-width:320px}.v55-search-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 9px;font-size:11px;font-weight:900;position:sticky;top:0;background:var(--card,#fff);z-index:1}.v55-search-count{padding:2px 7px;border-radius:999px;background:rgba(13,71,161,.08);color:#0d47a1}.v55-search-item{width:100%;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;text-align:right;border:0;background:transparent;color:inherit;padding:10px 9px;border-radius:9px;cursor:pointer}.v55-search-item+.v55-search-item{border-top:1px solid rgba(127,127,127,.08)}.v55-search-item:hover{background:rgba(13,71,161,.06)}.v55-search-name{font-weight:900}.v55-search-meta{font-size:10px;opacity:.68;margin-top:2px}.v55-search-store{font-size:10px;opacity:.58;white-space:nowrap}.v55-search-empty{padding:14px;text-align:center;font-size:12px;opacity:.65}
    .v55-order-date{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:7px 0;padding:7px 9px;border-radius:8px;background:rgba(13,71,161,.055);font-size:11px}.v55-order-date span{opacity:.72}.v55-order-date b{font-size:12px}.v55-filter-hidden{display:none!important}.v55-search-note{font-size:10px;opacity:.68;padding:3px 9px 8px}
    @media(max-width:650px){.v55-search-results{min-width:0;max-width:calc(100vw - 20px)}}
  `;document.head.appendChild(style);}
  function ensureSearchBox(){ensureStyle();if(searchBox?.isConnected)return searchBox;searchBox=document.createElement('div');searchBox.className='v55-search-results';searchBox.id='v55SearchResults';document.body.appendChild(searchBox);return searchBox;}
  function positionSearchBox(){const input=document.getElementById('globalSearch'),box=ensureSearchBox();if(!input||box.style.display==='none')return;const r=input.getBoundingClientRect();box.style.top=`${Math.min(innerHeight-80,r.bottom+6)}px`;box.style.left=`${Math.max(10,Math.min(innerWidth-330,r.left))}px`;box.style.width=`${Math.max(320,r.width)}px`;}
  function cardName(card){return card.querySelector('.cs-rich-name,.cs-customer')?.textContent?.trim()||'';}
  function cardPhone(card){return card.querySelector('.cs-phone')?.textContent?.trim()||'';}
  function cardStore(card){return card.querySelector('.cs-rich-store,.cs-store')?.textContent?.trim()||'';}
  function operationalCards(){return [...document.querySelectorAll('#root .cs-order[data-cs-order],#root .ps-order[data-v47-order]')];}
  function operationalCustomerMatches(query){
    const q=norm(query);if(q.length<2)return[];const seen=new Set(),out=[];
    for(const card of operationalCards()){
      const name=cardName(card);if(!name||!norm(name).includes(q))continue;
      const phone=cardPhone(card),store=cardStore(card),key=`${norm(name)}|${digits(phone)}|${norm(store)}`;
      if(seen.has(key))continue;seen.add(key);out.push({name,phone,store,key});
    }
    return out.sort((a,b)=>norm(a.name).localeCompare(norm(b.name),'ar')||digits(a.phone).localeCompare(digits(b.phone)));
  }
  function renderOperationalMatches(query,matches){
    const box=ensureSearchBox(),q=String(query||'').trim();lastMatches=matches;
    if(q.length<2||!operationalView()){box.style.display='none';return;}
    box.innerHTML=`<div class="v55-search-head"><span>كل العملاء المطابقين للاسم</span><span class="v55-search-count">${matches.length}</span></div>${matches.length?matches.map((customer,index)=>`<button type="button" class="v55-search-item" data-v55-customer="${index}"><div><div class="v55-search-name">${esc(customer.name||'بدون اسم')}</div><div class="v55-search-meta">${esc(customer.phone||'بدون رقم')}</div></div><span class="v55-search-store">${esc(customer.store||'')}</span></button>`).join(''):'<div class="v55-search-empty">لا يوجد عميل مطابق للاسم داخل هذا القسم</div>'}<div class="v55-search-note">يتم عرض كل العملاء المطابقين الموجودين في القسم الحالي تحت بعض، بدون تحميل ملف العملاء بالكامل.</div>`;
    box.style.display='block';positionSearchBox();
    box.querySelectorAll('[data-v55-customer]').forEach(button=>button.onclick=()=>{const customer=matches[Number(button.dataset.v55Customer)];if(!customer)return;const input=document.getElementById('globalSearch');if(input)input.value=customer.name;filterOperationalCards(customer.name);renderOperationalMatches(customer.name,operationalCustomerMatches(customer.name));});
  }
  function updateColumnCounts(){document.querySelectorAll('#root .cs-column,#root .ps-column').forEach(column=>{const cards=[...column.querySelectorAll('.cs-order,.ps-order')],visible=cards.filter(card=>!card.classList.contains('v55-filter-hidden')).length,count=column.querySelector('.cs-count');if(count)count.textContent=String(visible);});const deferred=document.querySelector('#root .cs-deferred');if(deferred){const cards=[...deferred.querySelectorAll('.cs-order')],count=deferred.querySelector('.cs-count');if(count)count.textContent=String(cards.filter(card=>!card.classList.contains('v55-filter-hidden')).length);}}
  function filterOperationalCards(query){const q=norm(query);if(!operationalView())return;for(const card of operationalCards()){const match=!q||norm(cardName(card)).includes(q);card.classList.toggle('v55-filter-hidden',!match);}updateColumnCounts();}
  function mirrorNativeSearch(query){const view=activeView(),id=view==='customers'?'customerSearch':view==='orders'?'orderSearch':'';if(!id)return false;const input=document.getElementById(id);if(!input)return false;input.value=query;input.dispatchEvent(new Event('input',{bubbles:true}));return true;}
  function applySearch(query){
    if(operationalView()){
      filterOperationalCards(query);renderOperationalMatches(query,operationalCustomerMatches(query));return;
    }
    ensureSearchBox().style.display='none';mirrorNativeSearch(query);
  }

  function extractDate(card){const explicit=card.dataset.v55OrderDate;if(explicit)return explicit;const texts=[...card.querySelectorAll('.cs-rich-meta-item,.cs-order-meta,.ps-awb')].map(node=>node.textContent||'');for(const text of texts){const match=text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);if(match)return match[1];}const all=(card.textContent||'').match(/\b(20\d{2}-\d{2}-\d{2})\b/);return all?.[1]||'';}
  function addDate(card){if(!card||card.querySelector('.v55-order-date'))return;const date=extractDate(card);if(!date)return;card.dataset.v55OrderDate=date;const row=document.createElement('div');row.className='v55-order-date';row.innerHTML=`<span>تاريخ الطلب</span><b>${esc(date)}</b>`;const actions=card.querySelector('.cs-actions');if(actions)actions.before(row);else card.appendChild(row);}
  function updateInventoryCopy(){if(activeView()!=='inventory')return;document.querySelectorAll('#v39BatchList .sub').forEach(node=>{if((node.textContent||'').includes('يتم اختياره عند شحن الأوردر'))node.textContent='يتم الخصم تلقائيًا عند نقل الأوردر للشحن بنظام FIFO: من أقدم استوك متاح أولًا، ثم الاستوك الذي يليه عند الحاجة.';});}
  function scan(){scanQueued=false;ensureStyle();document.querySelectorAll('#root .cs-order[data-cs-order],#root .ps-order[data-v47-order]').forEach(addDate);updateInventoryCopy();const input=document.getElementById('globalSearch');if(input?.value&&operationalView())applySearch(input.value);}
  function scheduleScan(){if(scanQueued)return;scanQueued=true;(window.requestAnimationFrame||setTimeout)(scan);}

  async function autoShip(select){const card=select.closest('[data-cs-order]'),orderId=card?.dataset.csOrder;if(!orderId)return;const previous=select.dataset.current||'preparing';select.disabled=true;try{const cid=await clientId();if(!cid)throw new Error('تعذر تحديد حساب المتجر');const history=await api(`/api/customer-service/orders/${encodeURIComponent(orderId)}/history?clientId=${encodeURIComponent(cid)}`),order=history.order||{},storeId=order.storeId||'';await api(`/api/customer-service/orders/${encodeURIComponent(orderId)}/state?clientId=${encodeURIComponent(cid)}${storeId?`&storeId=${encodeURIComponent(storeId)}`:''}`,{method:'PATCH',body:JSON.stringify({clientId:cid,...(storeId?{storeId}:{}),state:'shipped'})});select.dataset.current='shipped';notify('تم خصم المخزون تلقائيًا من الأقدم ثم التالي ونقل الأوردر إلى «جاري الشحن»');await window.KunCustomerServiceV31?.render?.();await sleep(0);scheduleScan();}catch(error){notify(error.message);select.value=previous;select.disabled=false;}}

  document.addEventListener('change',event=>{const select=event.target.closest?.('[data-cs-state]');if(!select||select.value!=='shipped'||select.dataset.current==='shipped')return;event.preventDefault();event.stopImmediatePropagation();autoShip(select);},true);
  document.addEventListener('input',event=>{if(event.target?.id==='globalSearch')applySearch(event.target.value);},true);
  document.addEventListener('keydown',event=>{if(event.target?.id!=='globalSearch'||event.key!=='Enter')return;const query=event.target.value||'',view=activeView();if(['customer-service','post-shipping'].includes(view)){event.preventDefault();event.stopImmediatePropagation();applySearch(query);return;}if(mirrorNativeSearch(query)){event.preventDefault();event.stopImmediatePropagation();}},true);
  document.addEventListener('click',event=>{if(event.target.closest?.('#globalSearch,#v55SearchResults'))return;ensureSearchBox().style.display='none';},true);
  window.addEventListener('resize',positionSearchBox);window.addEventListener('scroll',positionSearchBox,true);
  document.getElementById('storeBtn')?.addEventListener('change',()=>{const input=document.getElementById('globalSearch');if(input?.value&&operationalView())setTimeout(()=>applySearch(input.value),0);});
  function boot(){ensureStyle();const root=document.getElementById('root');if(root)new MutationObserver(scheduleScan).observe(root,{childList:true,subtree:false});scheduleScan();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
  window.KunCustomerSearchFifoV55={applySearch,filterOperationalCards,operationalCustomerMatches,scan:scheduleScan,version:'55.1'};document.documentElement.dataset.customerSearchFifo='v55.1-ready';
})();