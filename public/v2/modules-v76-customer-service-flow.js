/* Kun Online v76.1 — Customer Service workflow continuity: valid state choices + exact scroll preservation after mutations. */
(function(){
  if(window.KunCustomerServiceFlowV76)return;
  const PRE_CONFIRMATION=new Set(['pending','no_answer','deferred']);
  const POST_SHIPPING_ONLY=new Set(['signed','collecting','collected']);
  const pendingStateFocus=new Map();
  let activeEditOrderId='';

  function scrollContainers(card){
    const nodes=[],seen=new Set(),add=node=>{if(!node||seen.has(node))return;seen.add(node);nodes.push(node);};
    add(document.scrollingElement);
    let node=card?.parentElement||null;
    while(node&&node!==document.body&&node!==document.documentElement){
      const style=getComputedStyle(node),scrollable=/(auto|scroll|overlay)/.test(`${style.overflowY} ${style.overflow}`)&&node.scrollHeight>node.clientHeight+1;
      if(scrollable)add(node);node=node.parentElement;
    }
    add(document.querySelector('.main'));add(document.querySelector('.content'));
    return nodes.filter(node=>node&&Number.isFinite(Number(node.scrollTop)));
  }
  function captureAnchor(card){
    return {scrolls:scrollContainers(card).map(node=>({node,top:node.scrollTop,left:node.scrollLeft})),scrollY:window.scrollY,scrollX:window.scrollX};
  }
  function restoreAnchor(anchor){
    if(!anchor)return;
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      for(const item of anchor.scrolls||[]){if(item.node?.isConnected||item.node===document.scrollingElement){item.node.scrollTop=Number(item.top)||0;item.node.scrollLeft=Number(item.left)||0;}}
      window.scrollTo({top:Number(anchor.scrollY)||0,left:Number(anchor.scrollX)||0,behavior:'auto'});
    }));
  }
  function findCard(orderId){
    if(!orderId)return null;
    return [...document.querySelectorAll('#root .cs-page .cs-order[data-cs-order]')].find(card=>String(card.dataset.csOrder)===String(orderId))||null;
  }
  function sanitizeStateOptions(select){
    if(!select)return;
    for(const state of POST_SHIPPING_ONLY)select.querySelector(`option[value="${state}"]`)?.remove();
  }
  function ensureNoAnswerOption(select){
    if(!select)return;
    sanitizeStateOptions(select);
    const current=String(select.dataset.current||select.value||'');
    if(!PRE_CONFIRMATION.has(current))return;
    let option=select.querySelector('option[value="no_answer"]');
    if(option)return;
    const count=Number(select.closest('.cs-order')?.querySelector('[data-cs-contact-count]')?.textContent)||0;
    option=document.createElement('option');
    option.value='no_answer';
    option.textContent=`العميل لا يرد — ${count} محاولة تواصل`;
    const pending=select.querySelector('option[value="pending"]');
    if(pending?.nextSibling)select.insertBefore(option,pending.nextSibling);else if(pending)pending.after(option);else select.prepend(option);
  }
  function scan(){
    document.querySelectorAll('#root .cs-page [data-cs-state]').forEach(ensureNoAnswerOption);
  }
  function watchStateChange(select,card){
    const orderId=String(card?.dataset?.csOrder||'');if(!orderId)return;
    pendingStateFocus.set(orderId,{anchor:captureAnchor(card),parent:card.parentElement,state:String(select.dataset.current||''),expires:Date.now()+120000});
  }
  function resolveMovedOrders(){
    const now=Date.now();
    for(const [orderId,item] of pendingStateFocus){
      if(now>item.expires){pendingStateFocus.delete(orderId);continue;}
      const card=findCard(orderId);
      if(!card){restoreAnchor(item.anchor);pendingStateFocus.delete(orderId);continue;}
      const currentState=String(card.querySelector('[data-cs-state]')?.dataset.current||'');
      if(card.parentElement!==item.parent||currentState!==item.state){restoreAnchor(item.anchor);pendingStateFocus.delete(orderId);}
    }
  }
  function armEditFocus(orderId){
    const card=findCard(orderId),anchor=captureAnchor(card);if(!anchor)return;
    const started=Date.now();
    const poll=()=>{
      if(!document.getElementById('oeModalBack')){restoreAnchor(anchor);activeEditOrderId='';return;}
      if(Date.now()-started<45000)setTimeout(poll,120);
    };
    setTimeout(poll,120);
  }

  document.addEventListener('change',event=>{
    const select=event.target.closest?.('#root .cs-page [data-cs-state]');if(!select)return;
    ensureNoAnswerOption(select);
    const card=select.closest('.cs-order[data-cs-order]');
    if(card&&select.value!==select.dataset.current)watchStateChange(select,card);
  },true);
  document.addEventListener('click',event=>{
    const edit=event.target.closest?.('#root .cs-page [data-oe-edit]');
    if(edit){activeEditOrderId=String(edit.dataset.oeEdit||edit.closest('.cs-order')?.dataset.csOrder||'');return;}
    if(event.target.closest?.('#oeSave')&&activeEditOrderId)armEditFocus(activeEditOrderId);
  },true);

  const root=document.getElementById('root')||document.body;
  new MutationObserver(()=>{scan();resolveMovedOrders();}).observe(root,{childList:true,subtree:true});
  scan();
  window.KunCustomerServiceFlowV76={scan,preserveScroll:orderId=>restoreAnchor(captureAnchor(findCard(orderId))),version:'76.1'};
  document.documentElement.dataset.customerServiceFlow='v76.1-ready';
})();