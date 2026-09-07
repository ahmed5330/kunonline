/* Kun Online v76.0 — Customer Service workflow continuity: visible no-answer choice + previous-order focus after mutations. */
(function(){
  if(window.KunCustomerServiceFlowV76)return;
  const PRE_CONFIRMATION=new Set(['pending','no_answer','deferred']);
  const pendingStateFocus=new Map();
  let activeEditOrderId='';

  const cardsInList=card=>card?.parentElement?[...card.parentElement.children].filter(node=>node.matches?.('.cs-order[data-cs-order]')):[];
  function captureAnchor(card){
    if(!card)return null;
    const cards=cardsInList(card),index=cards.indexOf(card),previous=index>0?cards[index-1]:null,next=index>=0?cards[index+1]:null,target=previous||next||card;
    return {orderId:String(target?.dataset?.csOrder||''),scrollY:window.scrollY};
  }
  function findCard(orderId){
    if(!orderId)return null;
    return [...document.querySelectorAll('#root .cs-page .cs-order[data-cs-order]')].find(card=>String(card.dataset.csOrder)===String(orderId))||null;
  }
  function focusAnchor(anchor){
    if(!anchor)return;
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      const target=findCard(anchor.orderId);
      if(target){
        target.setAttribute('tabindex','-1');
        try{target.focus({preventScroll:true});}catch{}
        target.scrollIntoView({behavior:'auto',block:'center',inline:'nearest'});
        setTimeout(()=>{if(target.getAttribute('tabindex')==='-1')target.removeAttribute('tabindex');},700);
      }else{
        window.scrollTo({top:Number(anchor.scrollY)||0,behavior:'auto'});
      }
    }));
  }
  function ensureNoAnswerOption(select){
    if(!select)return;
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
      if(!card){focusAnchor(item.anchor);pendingStateFocus.delete(orderId);continue;}
      const currentState=String(card.querySelector('[data-cs-state]')?.dataset.current||'');
      if(card.parentElement!==item.parent||currentState!==item.state){focusAnchor(item.anchor);pendingStateFocus.delete(orderId);}
    }
  }
  function armEditFocus(orderId){
    const card=findCard(orderId),anchor=captureAnchor(card);if(!anchor)return;
    const started=Date.now();
    const poll=()=>{
      if(!document.getElementById('oeModalBack')){focusAnchor(anchor);activeEditOrderId='';return;}
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
  window.KunCustomerServiceFlowV76={scan,focusPreviousOrder:orderId=>focusAnchor(captureAnchor(findCard(orderId))),version:'76.0'};
  document.documentElement.dataset.customerServiceFlow='v76-ready';
})();