/* Kun Online v77.1 — authoritative Customer Service no-reload guard + post-shipping click isolation. */
(function(){
  if(window.KunCustomerServiceNoReloadV77)return;
  const cs=()=>window.KunCustomerServiceV31;
  const root=()=>document.getElementById('root');
  const activeView=()=>document.querySelector('.nav button.active[data-view]')?.dataset.view||'';
  const activeCustomerService=()=>activeView()==='customer-service'&&Boolean(root()?.querySelector('.cs-page'));
  let workflowSuppression=null,classification=null;

  function scrollNodes(){
    const out=[],seen=new Set(),add=node=>{if(!node||seen.has(node))return;seen.add(node);out.push(node);};
    add(document.scrollingElement);add(document.querySelector('.main'));add(document.querySelector('.content'));
    document.querySelectorAll('#root .cs-page').forEach(start=>{let node=start;while(node&&node!==document.body){const style=getComputedStyle(node);if(/(auto|scroll|overlay)/.test(`${style.overflowY} ${style.overflow}`)&&node.scrollHeight>node.clientHeight+1)add(node);node=node.parentElement;}});
    return out;
  }
  function captureScroll(){return {windowY:window.scrollY,windowX:window.scrollX,nodes:scrollNodes().map(node=>({node,top:node.scrollTop,left:node.scrollLeft}))};}
  function restoreScroll(snapshot){if(!snapshot)return;requestAnimationFrame(()=>requestAnimationFrame(()=>{for(const item of snapshot.nodes||[]){if(item.node?.isConnected||item.node===document.scrollingElement){item.node.scrollTop=Number(item.top)||0;item.node.scrollLeft=Number(item.left)||0;}}window.scrollTo({top:Number(snapshot.windowY)||0,left:Number(snapshot.windowX)||0,behavior:'auto'});}));}
  const normalizeState=state=>state==='exchange'?'returned':String(state||'');
  function localMove(item){
    if(!item?.orderId||!item?.state)return;
    cs()?.moveState?.(item.orderId,normalizeState(item.state),item.deferUntil||'');
    Promise.resolve(window.KunCustomerServiceRichCards?.refresh?.(item.orderId)).catch(()=>{});
    restoreScroll(item.scroll);
  }

  function wrapCustomerServiceRender(){
    const api=cs();if(!api?.render||api.render.__kunV77Wrapped)return;
    const original=api.render.bind(api);
    const guarded=async function(...args){
      const now=Date.now();
      if(workflowSuppression&&workflowSuppression.expires<now)workflowSuppression=null;
      if(classification&&classification.expires<now)classification=null;
      if(workflowSuppression&&activeCustomerService()){
        const item=workflowSuppression;workflowSuppression=null;localMove(item);return {ok:true,suppressedRender:true,source:item.source||'workflow'};
      }
      if(classification?.armed){
        const item=classification;classification=null;localMove(item);return {ok:true,suppressedRender:true,source:'classification'};
      }
      return original(...args);
    };
    guarded.__kunV77Wrapped=true;guarded.__kunV77Original=original;api.render=guarded;
  }

  window.addEventListener('kun:order-workflow-updated',event=>{
    if(!activeCustomerService())return;
    const detail=event.detail||{},orderId=String(detail.orderId||''),state=normalizeState(detail.state);if(!orderId||!state)return;
    workflowSuppression={orderId,state,deferUntil:detail.deferUntil||'',scroll:captureScroll(),source:'order-workflow',expires:Date.now()+5000};
    localMove(workflowSuppression);
  });

  window.addEventListener('change',event=>{
    const select=event.target.closest?.('#root .cs-page select[data-cs-state]');if(!select)return;
    const state=String(select.value||''),card=select.closest('.cs-order[data-cs-order]'),orderId=String(card?.dataset?.csOrder||'');if(!orderId)return;
    if(state==='shipped'&&String(select.dataset.current||'')!=='shipped'){
      workflowSuppression={orderId,state:'shipped',scroll:captureScroll(),source:'state-only-shipping',expires:Date.now()+10000};
      return;
    }
    if(!['returned','cancelled','exchange'].includes(state))return;
    classification={orderId,state:normalizeState(state),scroll:captureScroll(),armed:false,expires:Date.now()+600000};
  },true);
  window.addEventListener('click',event=>{
    if(event.target.closest?.('#v56ConfirmOutcome')&&classification){classification.armed=true;classification.expires=Date.now()+120000;return;}
    if(event.target.closest?.('#v56ModalBack [data-v56-close]')||event.target?.id==='v56ModalBack')classification=null;
  },true);

  function isolateDeliveredButton(){
    const button=document.getElementById('v47ConfirmDelivered');if(!button||button.dataset.kunV77Isolated==='1'||typeof button.onclick!=='function')return;
    const original=button.onclick;button.dataset.kunV77Isolated='1';button.onclick=function(event){let result;try{result=original.call(this,event);}finally{event?.stopPropagation?.();event?.stopImmediatePropagation?.();}return result;};
  }
  const observer=new MutationObserver(()=>{wrapCustomerServiceRender();isolateDeliveredButton();});observer.observe(document.body,{childList:true,subtree:true});
  wrapCustomerServiceRender();isolateDeliveredButton();
  window.KunCustomerServiceNoReloadV77={wrap:wrapCustomerServiceRender,captureScroll,restoreScroll,version:'77.1'};
  document.documentElement.dataset.customerServiceNoReload='v77.1-ready';
})();