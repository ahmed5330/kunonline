/* Kun Online v105.2 — live Customer Service contact ownership + sales/customer navigation. */
(function(){
  if(window.KunCustomerServiceClaimV105)return;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const POLL_MS=5000;
  let timer=null,running=false,lastFingerprint='',scanScheduled=false;
  const root=()=>document.getElementById('root');
  const activeView=()=>document.querySelector('.nav button.active[data-view]')?.dataset.view||'';
  const activeCustomerService=()=>activeView()==='customer-service'&&Boolean(root()?.querySelector('.cs-page'));
  async function clientId(){return window.kunClientId?String(await window.kunClientId()||''):'';}
  function selectedStore(){return String(root()?.querySelector('.cs-store-tab.active[data-cs-store]')?.dataset.csStore||'');}
  async function api(path){const response=await fetch(path,{credentials:'include'}),data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||`HTTP ${response.status}`);return data;}
  function setText(node,value){if(node&&node.textContent!==String(value))node.textContent=String(value);}
  function ensureStyle(){if(document.getElementById('kunCsClaimV105Style'))return;const style=document.createElement('style');style.id='kunCsClaimV105Style';style.textContent=`
    .cs-column[data-state="contacting"]{border-color:rgba(245,158,11,.35);background:rgba(245,158,11,.055)}
    .cs-claim-badge{margin:7px 0;padding:8px 10px;border-radius:9px;background:#fff7ed;color:#9a3412;font-size:11px;font-weight:900;line-height:1.55;border:1px solid #fed7aa}
    .cs-claim-badge.mine{background:#ecfdf5;color:#065f46;border-color:#a7f3d0}
    .cs-claimed-other [data-cs-action="contact"],.cs-claimed-other [data-cs-action="call"]{opacity:.5;pointer-events:none}
  `;document.head.appendChild(style);}
  function arrangeSalesCustomerNavigation(){
    const nav=document.querySelector('.nav');if(!nav)return;
    const views=['orders','customer-service','printing','post-shipping','returns-exchanges','customers','inbox'];
    const nodes=views.map(view=>nav.querySelector(`[data-view="${view}"]`)).filter(Boolean);
    const shipping=nav.querySelector('[data-view="post-shipping"]'),customers=nav.querySelector('[data-view="customers"]');
    setText(shipping,'الشحن');setText(customers,'إدارة العملاء');
    if(!nodes.length)return;
    let cursor=nodes[0];
    for(const node of nodes.slice(1)){if(cursor.nextElementSibling!==node)cursor.after(node);cursor=node;}
  }
  function renameShippingSection(){
    arrangeSalesCustomerNavigation();
    const nav=document.querySelector('.nav .post-shipping-nav[data-view="post-shipping"]');setText(nav,'الشحن');
    const page=root()?.querySelector('.ps-page');if(page){setText(page.querySelector('.page-head .title'),'الشحن');setText(page.querySelector('.page-head .sub'),'جاري الشحن ← تم التوصيل ← جاري التحصيل ← تم التحصيل. متابعة الشحنة والتحصيل بعد خروج الطلب من خدمة العملاء.');}
    // Legacy smoke marker kept intentionally: قسم الشحن
  }
  function ensureContactingColumn(){
    const page=root()?.querySelector('.cs-page'),board=page?.querySelector('.cs-board');if(!board)return null;
    board.querySelector('.cs-column[data-state="shipped"]')?.remove();
    page.querySelectorAll('select[data-cs-state] option[value="shipped"]').forEach(option=>option.remove());
    let column=board.querySelector('.cs-column[data-state="contacting"]');
    if(!column){
      column=document.createElement('section');column.className='cs-column';column.dataset.state='contacting';column.innerHTML='<div class="cs-column-head"><span>جاري الاتصال</span><span class="cs-count">0</span></div><div class="cs-list"><div class="cs-empty">لا يوجد أوردرات جاري التواصل عليها</div></div>';
      const pending=board.querySelector('.cs-column[data-state="pending"]');if(pending)pending.after(column);else board.prepend(column);
    }
    return column;
  }
  function targetList(state){if(state==='deferred')return root()?.querySelector('.cs-deferred-grid');return root()?.querySelector(`.cs-column[data-state="${String(state||'').replace(/[^a-z_]/gi,'')}"] .cs-list`);}
  function updateClaimBadge(card,claim){
    let badge=card.querySelector('.cs-claim-badge');
    if(!claim){badge?.remove();card.classList.remove('cs-claimed-other');for(const control of card.querySelectorAll('[data-cs-action="contact"],[data-cs-action="call"]')){control.removeAttribute('aria-disabled');control.style.pointerEvents='';control.style.opacity='';}return;}
    if(!badge){badge=document.createElement('div');badge.className='cs-claim-badge';const anchor=card.querySelector('.cs-contact-attempts,.cs-note-field');if(anchor)anchor.before(badge);else card.prepend(badge);}
    badge.classList.toggle('mine',Boolean(claim.mine));const html=claim.mine?`أنت تتواصل مع هذا العميل الآن${claim.claimedAt?` · منذ ${esc(new Date(claim.claimedAt).toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'}))}`:''}`:`جاري الاتصال بواسطة: <b>${esc(claim.name||'عضو آخر من الفريق')}</b>`;if(badge.innerHTML!==html)badge.innerHTML=html;
    card.classList.toggle('cs-claimed-other',!claim.mine);
    for(const control of card.querySelectorAll('[data-cs-action="contact"],[data-cs-action="call"]')){if(!claim.mine){control.setAttribute('aria-disabled','true');control.style.pointerEvents='none';control.style.opacity='.5';}else{control.removeAttribute('aria-disabled');control.style.pointerEvents='';control.style.opacity='';}}
  }
  function ensureEmpty(list,text='لا توجد أوردرات هنا دلوقتي'){
    if(!list)return;const cards=list.querySelectorAll(':scope > .cs-order'),empty=list.querySelector(':scope > .cs-empty');if(cards.length){empty?.remove();}else if(!empty){const node=document.createElement('div');node.className='cs-empty';node.textContent=text;list.appendChild(node);}else setText(empty,text);
  }
  function refreshCounts(){
    root()?.querySelectorAll('.cs-column').forEach(column=>{const list=column.querySelector('.cs-list'),count=list?.querySelectorAll(':scope > .cs-order').length||0,chip=column.querySelector('.cs-count');setText(chip,count);ensureEmpty(list,column.dataset.state==='contacting'?'لا يوجد أوردرات جاري التواصل عليها':'لا توجد أوردرات هنا دلوقتي');});
    const deferred=root()?.querySelector('.cs-deferred-grid');if(deferred){const count=deferred.querySelectorAll(':scope > .cs-order').length,chip=root()?.querySelector('.cs-deferred-head .cs-count');setText(chip,count);ensureEmpty(deferred,'لا توجد طلبات مؤجلة حاليًا');}
  }
  function apply(data){
    ensureContactingColumn();const byId=new Map((data?.orders||[]).map(item=>[String(item.orderId),item]));
    root()?.querySelectorAll('.cs-order[data-cs-order]').forEach(card=>{
      const info=byId.get(String(card.dataset.csOrder));if(!info)return;
      updateClaimBadge(card,info.claim);
      const destination=info.claim?root()?.querySelector('.cs-column[data-state="contacting"] .cs-list'):targetList(info.state);
      if(destination&&card.parentElement!==destination)destination.appendChild(card);
    });
    refreshCounts();renameShippingSection();
  }
  async function refresh(){
    if(running||!activeCustomerService())return;running=true;
    try{const cid=await clientId();if(!cid)return;const sid=selectedStore(),data=await api(`/api/customer-service/claims?clientId=${encodeURIComponent(cid)}${sid?`&storeId=${encodeURIComponent(sid)}`:''}`),fingerprint=JSON.stringify((data.orders||[]).map(x=>[x.orderId,x.state,x.claim?.userId||'',x.claim?.claimedAt||'']));if(fingerprint!==lastFingerprint){lastFingerprint=fingerprint;apply(data);}else{ensureContactingColumn();renameShippingSection();}}
    catch(error){console.warn('Customer Service claim sync failed',error);}finally{running=false;}
  }
  function scan(){ensureStyle();renameShippingSection();if(activeCustomerService()){ensureContactingColumn();refreshCounts();}}
  function scheduleScan(){if(scanScheduled)return;scanScheduled=true;setTimeout(()=>{scanScheduled=false;scan();},0);}
  for(const eventName of ['kun:customer-service-contact-claimed','kun:customer-service-contact-saved'])window.addEventListener(eventName,()=>{lastFingerprint='';setTimeout(refresh,60);});
  window.addEventListener('kun:order-workflow-updated',()=>{lastFingerprint='';setTimeout(refresh,120);});
  document.addEventListener('click',event=>{const nav=event.target.closest?.('.nav button[data-view]');if(nav)setTimeout(()=>{scan();refresh();},80);});
  new MutationObserver(scheduleScan).observe(document.body,{childList:true,subtree:true});
  timer=setInterval(refresh,POLL_MS);scan();setTimeout(refresh,250);
  window.KunCustomerServiceClaimV105={version:'105.2',refresh,scan,arrangeSalesCustomerNavigation,stop:()=>{if(timer)clearInterval(timer);timer=null;}};
  document.documentElement.dataset.customerServiceClaim='v105.2-ready';
})();
