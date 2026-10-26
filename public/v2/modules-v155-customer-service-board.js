/* Kun Online 155 — drag/drop orders across CS stages, reusing existing validation and stock-confirmation workflow. */
(function(){
  if(window.KunCustomerServiceBoardV155)return;
  const VALID_STAGES=new Set(['pending','no_answer','confirmed','preparing','shipped']);
  const active=()=>document.querySelector('.nav button.active[data-view="customer-service"]')&&document.querySelector('#root .cs-page');
  const toast=message=>window.showToast?.(message)||console.log(message);
  const cardFor=element=>element?.closest?.('#root .cs-page [data-cs-order]')||null;
  const columnFor=element=>element?.closest?.('#root .cs-page .cs-column[data-state]')||null;
  let draggedId='',sourceState='',target=null;
  const isControl=element=>Boolean(element?.closest?.('button,a,input,select,textarea,[contenteditable],.cs-actions,.cs-note-field'));
  function clear(){
    document.querySelectorAll('#root .cs-column.cs-drop-target').forEach(node=>node.classList.remove('cs-drop-target'));
    document.querySelectorAll('#root .cs-order.cs-is-dragging').forEach(node=>node.classList.remove('cs-is-dragging'));
    draggedId='';sourceState='';target=null;
  }
  function eligible(orderId,next){
    if(!orderId||!VALID_STAGES.has(next))return false;
    const card=[...document.querySelectorAll('#root .cs-order[data-cs-order]')].find(item=>String(item.dataset.csOrder)===String(orderId));
    if(!card)return false;
    const select=card.querySelector('select[data-cs-state]');
    return Boolean(select&&select.querySelector(`option[value="${next}"]`));
  }
  function updateTarget(column){
    if(target===column)return;
    document.querySelectorAll('#root .cs-column.cs-drop-target').forEach(node=>node.classList.remove('cs-drop-target'));
    target=column;
    if(target)target.classList.add('cs-drop-target');
  }
  function attemptMove(orderId,next){
    const card=[...document.querySelectorAll('#root .cs-order[data-cs-order]')].find(item=>String(item.dataset.csOrder)===String(orderId));
    const select=card?.querySelector('select[data-cs-state]');
    if(!card||!select||!VALID_STAGES.has(next))return;
    const current=String(select.dataset.current||select.value||sourceState);
    if(current===next)return;
    if(next==='shipped'){
      if(!['confirmed','preparing'].includes(current)){toast('أكد الأوردر أولًا قبل إرساله للشحن.');return;}
      const ship=window.KunPrintingV79?.shipById;
      if(typeof ship!=='function'){toast('افتح قسم الطباعة لإرسال الطلب إلى J&T.');document.querySelector('.nav button[data-view="printing"]')?.click();return;}
      ship(orderId).catch(()=>{}); // Error is shown by the shared shipping flow.
      return;
    }
    if(next==='no_answer'&&Number(card.querySelector('[data-cs-contact-count]')?.textContent||0)<1){
      toast('سجّل محاولة التواصل أولًا قبل تصنيف العميل لا يرد.');
      return;
    }
    if(!eligible(orderId,next)){
      toast('هذا الانتقال غير متاح من حالة الأوردر الحالية.');
      return;
    }
    select.value=next;
    select.dispatchEvent(new Event('change',{bubbles:true}));
    toast(next==='confirmed'?'راجع المخزون وأكّد الأوردر في النافذة التي ظهرت.':'جارٍ حفظ تغيير حالة الأوردر…');
  }
  document.addEventListener('dragstart',event=>{
    if(!active())return;
    const card=cardFor(event.target);if(!card||isControl(event.target)){event.preventDefault();return;}
    draggedId=String(card.dataset.csOrder||'');
    sourceState=String(card.querySelector('[data-cs-state]')?.dataset.current||'');
    if(!draggedId){event.preventDefault();return;}
    if(event.dataTransfer){event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',draggedId);}
    card.classList.add('cs-is-dragging');
  });
  document.addEventListener('dragover',event=>{
    if(!draggedId||!active())return;
    const col=columnFor(event.target),next=String(col?.dataset.state||'');
    if(!col||!eligible(draggedId,next)||next===sourceState){updateTarget(null);return;}
    event.preventDefault();
    if(event.dataTransfer)event.dataTransfer.dropEffect='move';
    updateTarget(col);
  });
  document.addEventListener('drop',event=>{
    if(!draggedId)return;
    const next=String(columnFor(event.target)?.dataset.state||'');
    if(next&&eligible(draggedId,next)){event.preventDefault();const id=draggedId;clear();attemptMove(id,next);}else clear();
  });
  document.addEventListener('dragend',clear);
  // On touchscreens, a long press on the card header enters drag mode.
  // Normal taps and vertical swipes continue to scroll and use existing buttons.
  let touch=null;
  function resetTouch(){if(touch?.timer)clearTimeout(touch.timer);touch=null;clear();}
  document.addEventListener('touchstart',event=>{
    if(!active()||event.touches.length!==1)return;
    const card=cardFor(event.target);if(!card||isControl(event.target)||!event.target.closest('.cs-order-head'))return;
    const point=event.touches[0];
    touch={x:point.clientX,y:point.clientY,id:String(card.dataset.csOrder||''),card,started:false,timer:setTimeout(()=>{
      if(!touch||!touch.card?.isConnected)return;
      touch.started=true;draggedId=touch.id;sourceState=String(touch.card.querySelector('[data-cs-state]')?.dataset.current||'');
      touch.card.classList.add('cs-is-dragging');
      if(navigator.vibrate)navigator.vibrate(20);
    },420)};
  },{passive:true});
  document.addEventListener('touchmove',event=>{
    if(!touch)return;
    const point=event.touches[0];if(!point)return;
    if(!touch.started){
      if(Math.hypot(point.clientX-touch.x,point.clientY-touch.y)>12)resetTouch();
      return;
    }
    event.preventDefault();
    const under=document.elementFromPoint(point.clientX,point.clientY),col=columnFor(under);
    updateTarget(col&&eligible(draggedId,col.dataset.state)?col:null);
  },{passive:false});
  document.addEventListener('touchend',event=>{
    if(!touch)return;
    const wasDragging=touch.started,id=touch.id,point=event.changedTouches[0],col=wasDragging&&point?columnFor(document.elementFromPoint(point.clientX,point.clientY)):null;
    const next=String(col?.dataset.state||'');resetTouch();
    if(wasDragging&&next)attemptMove(id,next);
  },{passive:true});
  document.addEventListener('touchcancel',resetTouch,{passive:true});
  window.KunCustomerServiceBoardV155={version:'155.1',attemptMove};
})();
