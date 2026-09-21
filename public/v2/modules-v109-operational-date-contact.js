/* Kun Online v109.1 — unified operational date filters + server-filtered Customer Service periods + temporary contact claim release. */
(function(){
  if(window.KunOperationalDateContactV109)return;
  const ROOT_ID='root',TZ='Africa/Cairo',VIEWS=new Set(['orders','customer-service','printing','post-shipping','returns-exchanges']);
  const PERIODS=[['today','اليوم'],['last7','آخر أسبوع'],['prevweek','الأسبوع الماضي'],['month','الشهر الحالي'],['prevmonth','الشهر الماضي'],['custom','مدة معينة']];
  const claimNames=new Map(),releaseTimers=new Map();let scanQueued=false,mapCache={at:0,cid:'',orders:new Map()},claimsAt=0,pendingCall='',csReloadQueued=false,csInitialReloadDone=false;
  const nativeFetch=window.fetch.bind(window);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const root=()=>document.getElementById(ROOT_ID),activeView=()=>document.querySelector('.nav button.active[data-view]')?.dataset.view||'';
  async function cid(){return String(await(window.kunClientId?.()||Promise.resolve(''))||'');}
  function cairoToday(){const p=new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()),g=t=>p.find(x=>x.type===t)?.value||'';return `${g('year')}-${g('month')}-${g('day')}`;}
  const addDays=(s,n)=>{const d=new Date(`${s}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
  function rangeFor(period,customFrom='',customTo=''){
    const today=cairoToday(),[y,m]=today.split('-').map(Number);
    if(period==='today')return [today,today];
    if(period==='last7')return [addDays(today,-6),today];
    if(period==='prevweek'){const d=new Date(`${today}T12:00:00Z`),sinceSat=(d.getUTCDay()+1)%7,currentSat=addDays(today,-sinceSat);return [addDays(currentSat,-7),addDays(currentSat,-1)];}
    if(period==='month')return [`${String(y).padStart(4,'0')}-${String(m).padStart(2,'0')}-01`,today];
    if(period==='prevmonth'){const first=new Date(Date.UTC(y,m-2,1,12)),next=new Date(Date.UTC(y,m-1,1,12));return [first.toISOString().slice(0,10),addDays(next.toISOString().slice(0,10),-1)];}
    const fallbackFrom=`${String(y).padStart(4,'0')}-${String(m).padStart(2,'0')}-01`;return [customFrom||fallbackFrom,customTo||today];
  }
  function key(view){return `kun:operational-period:${view}`;}
  function stateFor(view){try{const saved=JSON.parse(localStorage.getItem(key(view))||'{}');return {period:PERIODS.some(x=>x[0]===saved.period)?saved.period:'today',from:saved.from||'',to:saved.to||''};}catch{return {period:'today',from:'',to:''};}}
  function saveState(view,state){try{localStorage.setItem(key(view),JSON.stringify(state));}catch{}}
  function customerServiceRange(){const state=stateFor('customer-service'),[from,to]=rangeFor(state.period,state.from,state.to);return {state,from,to};}
  function isCustomerServiceBoardRequest(input,init){
    try{
      const method=String(init?.method||(input instanceof Request?input.method:'GET')||'GET').toUpperCase();if(method!=='GET'||activeView()!=='customer-service')return false;
      const raw=input instanceof Request?input.url:String(input),url=new URL(raw,location.href);return url.origin===location.origin&&url.pathname==='/api/customer-service';
    }catch{return false;}
  }
  window.fetch=function(input,init){
    if(!isCustomerServiceBoardRequest(input,init))return nativeFetch(input,init);
    try{
      const {from,to}=customerServiceRange();
      if(input instanceof Request){const url=new URL(input.url);url.searchParams.set('periodFrom',from);url.searchParams.set('periodTo',to);return nativeFetch(new Request(url.toString(),input),init);}
      const raw=String(input),url=new URL(raw,location.href);url.searchParams.set('periodFrom',from);url.searchParams.set('periodTo',to);
      const next=/^https?:\/\//i.test(raw)?url.toString():`${url.pathname}${url.search}${url.hash}`;return nativeFetch(next,init);
    }catch{return nativeFetch(input,init);}
  };
  function reloadCustomerService(){
    if(csReloadQueued||activeView()!=='customer-service')return;csReloadQueued=true;
    setTimeout(()=>{csReloadQueued=false;if(activeView()==='customer-service')window.KunCustomerServiceV31?.render?.();},0);
  }
  function ensureStyle(){if(document.getElementById('kunOpDate109Style'))return;const style=document.createElement('style');style.id='kunOpDate109Style';style.textContent=`
    .kun-op-date-filter{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 12px;border:1px solid var(--line,#d3deda);border-radius:12px;background:var(--surface,#fff);margin:0 0 12px}.kun-op-date-filter .label{font-size:11px;font-weight:900;opacity:.72}.kun-op-date-options{display:flex;gap:5px;flex-wrap:wrap}.kun-op-date-options button{width:auto;padding:7px 10px;font-size:11px;font-weight:800}.kun-op-date-options button.active{background:var(--chrome-bg,#0e5095);color:#fff;border-color:var(--chrome-bg,#0e5095)}.kun-op-custom{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.kun-op-custom[hidden]{display:none!important}.kun-op-custom input{width:145px;min-height:34px}.kun-op-date-count{margin-inline-start:auto;font-size:11px;font-weight:900;opacity:.75}.kun-op-date-hidden{display:none!important}@media(max-width:620px){.kun-op-date-filter{align-items:stretch}.kun-op-date-options{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));width:100%}.kun-op-date-options button{width:100%}.kun-op-custom{width:100%}.kun-op-custom input{flex:1;min-width:130px}.kun-op-date-count{margin-inline-start:0;width:100%}}
  `;document.head.appendChild(style);}
  function currentPage(view){const r=root();if(!r)return null;if(view==='customer-service')return r.querySelector('.cs-page');if(view==='printing')return r.querySelector('.print79-page');if(view==='post-shipping')return r.querySelector('.ps-page');if(view==='returns-exchanges')return r.querySelector('.rx-page');if(view==='orders')return r;return null;}
  function toolbar(view,page){
    let bar=page.querySelector(':scope > .kun-op-date-filter');if(bar)return bar;const state=stateFor(view);bar=document.createElement('div');bar.className='kun-op-date-filter';bar.dataset.kunOperationalPeriod=view;
    bar.innerHTML=`<span class="label">الفترة</span><div class="kun-op-date-options">${PERIODS.map(([value,label])=>`<button type="button" class="btn soft ${state.period===value?'active':''}" data-kun-period="${value}">${label}</button>`).join('')}</div><div class="kun-op-custom" ${state.period==='custom'?'':'hidden'}><input class="input" type="date" data-kun-from value="${esc(state.from)}"><span>إلى</span><input class="input" type="date" data-kun-to value="${esc(state.to||cairoToday())}"></div><span class="kun-op-date-count"></span>`;
    const head=page.querySelector(':scope > .page-head')||page.querySelector('.page-head');head?.after(bar);if(!bar.isConnected)page.prepend(bar);
    bar.querySelectorAll('[data-kun-period]').forEach(button=>button.onclick=()=>{const next=stateFor(view);next.period=button.dataset.kunPeriod||'today';saveState(view,next);bar.querySelectorAll('[data-kun-period]').forEach(x=>x.classList.toggle('active',x===button));bar.querySelector('.kun-op-custom').hidden=next.period!=='custom';if(view==='customer-service')reloadCustomerService();else apply(view);});
    for(const input of bar.querySelectorAll('[data-kun-from],[data-kun-to]'))input.onchange=()=>{const next=stateFor(view);next.period='custom';next.from=bar.querySelector('[data-kun-from]')?.value||'';next.to=bar.querySelector('[data-kun-to]')?.value||'';saveState(view,next);if(view==='customer-service'&&next.from&&next.to)reloadCustomerService();else apply(view);};
    return bar;
  }
  function orderIdFor(node){return String(node?.dataset?.csOrder||node?.dataset?.v47Order||node?.dataset?.v56Order||node?.dataset?.print79Order||node?.querySelector?.('[data-order]')?.dataset?.order||'');}
  function dateFromNode(node){const explicit=String(node?.dataset?.orderDate||'').slice(0,10);if(/^\d{4}-\d{2}-\d{2}$/.test(explicit))return explicit;const text=node?.querySelector?.('.cs-order-meta')?.textContent||node?.textContent||'',match=String(text).match(/\b(20\d{2}-\d{2}-\d{2})\b/);return match?.[1]||'';}
  async function orderMap(){const client=await cid(),fresh=Date.now()-mapCache.at<30000&&mapCache.cid===client;if(fresh)return mapCache.orders;const map=new Map();try{const r=await fetch('/api/state',{credentials:'include'});if(r.ok){const d=await r.json();for(const o of d.orders||[])map.set(String(o.id),String(o.date||o.createdAt||o.created_at||'').slice(0,10));}}catch{}if(client){try{const r=await fetch(`/api/customer-service?clientId=${encodeURIComponent(client)}`,{credentials:'include'});if(r.ok){const d=await r.json();for(const o of d.orders||[])map.set(String(o.id),String(o.date||o.createdAt||o.created_at||'').slice(0,10));}}catch{}}mapCache={at:Date.now(),cid:client,orders:map};return map;}
  function nodesFor(view,page){if(view==='customer-service')return [...page.querySelectorAll('[data-cs-order]')];if(view==='printing')return [...page.querySelectorAll('[data-print79-order]')];if(view==='post-shipping')return [...page.querySelectorAll('[data-v47-order]')];if(view==='returns-exchanges')return [...page.querySelectorAll('[data-v56-order]')];if(view==='orders')return [...page.querySelectorAll('tbody tr')].filter(row=>row.querySelector('[data-order]'));return [];}
  function refreshCounts(view,page){
    if(view==='customer-service'){
      page.querySelectorAll('.cs-column').forEach(col=>{const n=[...col.querySelectorAll(':scope .cs-list > [data-cs-order]')].filter(x=>!x.classList.contains('kun-op-date-hidden')).length,chip=col.querySelector('.cs-count');if(chip)chip.textContent=String(n);});
      const deferred=page.querySelector('.cs-deferred-grid');if(deferred){const n=[...deferred.querySelectorAll(':scope > [data-cs-order]')].filter(x=>!x.classList.contains('kun-op-date-hidden')).length,chip=page.querySelector('.cs-deferred-head .cs-count');if(chip)chip.textContent=String(n);}
    }
    if(view==='post-shipping')page.querySelectorAll('.ps-column').forEach(col=>{const n=[...col.querySelectorAll('[data-v47-order]')].filter(x=>!x.classList.contains('kun-op-date-hidden')).length,chip=col.querySelector('.cs-count');if(chip)chip.textContent=String(n);});
    if(view==='returns-exchanges')page.querySelectorAll('.rx-column').forEach(col=>{const n=[...col.querySelectorAll('[data-v56-order]')].filter(x=>!x.classList.contains('kun-op-date-hidden')).length,chip=col.querySelector('.cs-count');if(chip)chip.textContent=String(n);});
  }
  async function apply(view=activeView()){
    if(!VIEWS.has(view))return;const page=currentPage(view);if(!page)return;ensureStyle();const bar=toolbar(view,page),state=stateFor(view),[from,to]=rangeFor(state.period,state.from,state.to),nodes=nodesFor(view,page);let visible=0;
    if(view==='customer-service'){
      for(const node of nodes){node.classList.remove('kun-op-date-hidden');visible++;}
    }else{
      const map=await orderMap();
      for(const node of nodes){const id=orderIdFor(node),date=dateFromNode(node)||map.get(id)||'';if(date)node.dataset.orderDate=date;const show=!date||(date>=from&&date<=to);node.classList.toggle('kun-op-date-hidden',!show);if(show)visible++;}
    }
    refreshCounts(view,page);const counter=bar.querySelector('.kun-op-date-count');if(counter)counter.textContent=`${visible} أوردر · ${from}${to!==from?` ← ${to}`:''}`;
  }
  async function release(orderId){if(!orderId)return;const client=await cid();if(!client)return;try{const response=await fetch(`/api/customer-service/orders/${encodeURIComponent(orderId)}/release-contact?clientId=${encodeURIComponent(client)}`,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({clientId:client})}),data=await response.json().catch(()=>({}));if(!response.ok&&response.status!==409)throw new Error(data.error||`HTTP ${response.status}`);claimNames.delete(String(orderId));window.dispatchEvent(new CustomEvent('kun:customer-service-contact-released',{detail:{orderId,state:data.state||'',releasedAt:Date.now()}}));window.KunCustomerServiceClaimV105?.refresh?.();}catch(error){console.warn('Temporary Customer Service claim release failed',error);}}
  function scheduleRelease(orderId,delay){clearTimeout(releaseTimers.get(String(orderId)));releaseTimers.set(String(orderId),setTimeout(()=>{releaseTimers.delete(String(orderId));release(orderId);},delay));}
  function paintClaimNames(){root()?.querySelectorAll('[data-cs-order]').forEach(card=>{const id=String(card.dataset.csOrder||''),info=claimNames.get(id),badge=card.querySelector('.cs-claim-badge');if(!info||!badge)return;const html=`جاري الاتصال بواسطة: <b>${esc(info.name||'عضو من الفريق')}</b>${info.mine?' <span style="opacity:.7">(أنت)</span>':''}`;if(badge.innerHTML!==html)badge.innerHTML=html;});}
  async function syncClaimNames(){if(activeView()!=='customer-service'||Date.now()-claimsAt<4000)return;claimsAt=Date.now();const client=await cid();if(!client)return;const sid=String(root()?.querySelector('.cs-store-tab.active[data-cs-store]')?.dataset.csStore||'');try{const r=await fetch(`/api/customer-service/claims?clientId=${encodeURIComponent(client)}${sid?`&storeId=${encodeURIComponent(sid)}`:''}`,{credentials:'include'});if(!r.ok)return;const d=await r.json();for(const item of d.orders||[]){if(item.claim)claimNames.set(String(item.orderId),item.claim);else claimNames.delete(String(item.orderId));}paintClaimNames();}catch{}}
  function scan(){const view=activeView();if(view==='customer-service'&&!csInitialReloadDone&&window.KunCustomerServiceV31?.render){csInitialReloadDone=true;reloadCustomerService();return;}if(VIEWS.has(view))apply(view);if(view==='customer-service'){syncClaimNames();paintClaimNames();}}
  function scheduleScan(){if(scanQueued)return;scanQueued=true;setTimeout(()=>{scanQueued=false;scan();},40);}
  window.addEventListener('kun:customer-service-contact-claimed',event=>{const d=event.detail||{},id=String(d.orderId||'');if(id&&d.claim)claimNames.set(id,d.claim);paintClaimNames();});
  window.addEventListener('kun:customer-service-contact-saved',event=>{const d=event.detail||{},id=String(d.orderId||'');if(!id)return;if(d.claim)claimNames.set(id,d.claim);paintClaimNames();if(d.intent==='call'){pendingCall=id;scheduleRelease(id,300000);}else scheduleRelease(id,2500);});
  window.addEventListener('kun:customer-service-contact-released',event=>{claimNames.delete(String(event.detail?.orderId||''));scheduleScan();});
  const finishCall=()=>{if(!pendingCall)return;const id=pendingCall;pendingCall='';scheduleRelease(id,1200);};window.addEventListener('focus',finishCall);document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')finishCall();});
  document.addEventListener('click',event=>{if(event.target.closest?.('.nav button[data-view]'))setTimeout(scheduleScan,80);});
  new MutationObserver(scheduleScan).observe(document.body,{childList:true,subtree:true});ensureStyle();scan();
  window.KunOperationalDateContactV109={version:'109.1',apply,rangeFor,stateFor,customerServiceRange,reloadCustomerService,release,syncClaimNames};document.documentElement.dataset.kunOperationalDateContact='v109.1-ready';
})();