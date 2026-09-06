/* Kun Online v75.2 — reliable Customer Service note/contact/call/confirm interactions with unified attempt counters. */
(function(){
  if(window.KunCustomerServiceInteractionsV75)return;
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const notify=message=>window.showToast?.(message)||console.log(message);
  const pending=new Set();

  async function clientId(){return window.kunClientId?await window.kunClientId():'';}
  async function api(path,options={}){
    const response=await fetch(path,{credentials:'include',...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})}});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw Object.assign(new Error(data.error||`HTTP ${response.status}`),{status:response.status,code:data.code,data});
    return data;
  }
  const active=()=>document.querySelector('.nav button.active[data-view]')?.dataset.view==='customer-service'||Boolean(document.querySelector('#root .cs-page'));
  function orderId(card){return String(card?.dataset?.csOrder||'').trim();}
  function route(id,suffix,cid){return `/api/customer-service/orders/${encodeURIComponent(id)}/${suffix}?clientId=${encodeURIComponent(cid)}`;}
  function setBusy(button,busy){
    if(!button)return;
    if(busy){button.dataset.csV75Busy='1';button.setAttribute('aria-busy','true');if(button.tagName==='BUTTON')button.disabled=true;}
    else{button.dataset.csV75Busy='0';button.removeAttribute('aria-busy');if(button.tagName==='BUTTON')button.disabled=false;}
  }
  function clearError(card){card?.querySelector('.cs-v75-error')?.remove();}
  function showError(card,message){
    if(!card){notify(message);return;}
    let box=card.querySelector('.cs-v75-error');if(!box){box=document.createElement('div');box.className='cs-v75-error';box.style.cssText='margin:8px 0;padding:8px 10px;border:1px solid #fecaca;border-radius:8px;background:#fef2f2;color:#991b1b;font-size:11px;font-weight:800;line-height:1.65';const actions=card.querySelector('.cs-actions');if(actions)actions.before(box);else card.appendChild(box);}
    box.textContent=message;notify(message);
  }
  function updateLatestNote(card,note){
    let latest=card.querySelector('.cs-internal-latest');
    if(!latest){latest=document.createElement('div');latest.className='cs-internal-latest';const field=card.querySelector('.cs-note-field');if(field)field.before(latest);else card.appendChild(latest);}
    latest.innerHTML=`<b>آخر ملاحظة داخلية:</b> ${esc(note)}`;
  }
  function updateContactCount(card,data){
    const log=Array.isArray(data?.log)?data.log:[],count=Number.isFinite(Number(data?.contactCount))?Number(data.contactCount):log.length,id=orderId(card);
    const button=card.querySelector('[data-cs-action="contact"]'),counter=card.querySelector('[data-cs-contact-count]'),noAnswer=card.querySelector('[data-cs-state] option[value="no_answer"]');
    if(button)button.textContent=`تواصل (${count})`;if(counter)counter.textContent=String(count);if(noAnswer)noAnswer.textContent=`العميل لا يرد — ${count} محاولة تواصل`;window.KunCustomerServiceV31?.updateContactCount?.(id,count);
  }
  async function saveNote(card,button){
    const id=orderId(card),input=card.querySelector('[data-cs-note]'),note=String(input?.value||'').trim();
    if(!note){notify('اكتب الملاحظة الأول');return;}
    clearError(card);const cid=await clientId();if(!cid)throw new Error('تعذر تحديد حساب المتجر');
    const data=await api(route(id,'notes',cid),{method:'POST',body:JSON.stringify({clientId:cid,note})});
    if(input&&String(input.value||'').trim()===note)input.value='';
    updateLatestNote(card,note);notify('تم حفظ الملاحظة الداخلية في سجل الأوردر');
    return data;
  }
  async function saveContact(card,isCall=false){
    const id=orderId(card),cid=await clientId();if(!cid)throw new Error('تعذر تحديد حساب المتجر');
    clearError(card);const data=await api(route(id,'contact',cid),{method:'POST',keepalive:isCall,body:JSON.stringify({clientId:cid,channel:'phone',intent:isCall?'call':'contact'})});
    updateContactCount(card,data);
    notify(isCall?'تم تسجيل المكالمة في سجل الأوردر':'تم تسجيل محاولة التواصل في سجل الأوردر');
    return data;
  }
  function handle(event){
    if(!active())return;
    const button=event.target.closest?.('[data-cs-action]'),card=button?.closest?.('#root [data-cs-order]');if(!card)return;
    const action=String(button.dataset.csAction||'');if(!['note','contact','call'].includes(action))return;
    const id=orderId(card);if(!id)return;
    if(action!=='call')event.preventDefault();
    event.stopPropagation();event.stopImmediatePropagation();
    const key=`${id}:${action}`;if(pending.has(key))return;
    pending.add(key);setBusy(button,true);
    const work=action==='note'?saveNote(card,button):saveContact(card,action==='call');
    Promise.resolve(work).catch(error=>showError(card,action==='call'?`تم فتح الاتصال، لكن تعذر تسجيل المكالمة: ${error.message}`:error.message)).finally(()=>{pending.delete(key);setBusy(button,false);});
  }
  function handleConfirm(event){
    if(!active())return;
    const select=event.target.closest?.('[data-cs-state]');if(!select||select.value!=='confirmed'||select.dataset.current==='confirmed')return;
    const card=select.closest?.('#root [data-cs-order]'),id=orderId(card);if(!card||!id)return;
    event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
    const previous=select.dataset.current||'pending';select.value=previous;clearError(card);
    const key=`${id}:confirm`;if(pending.has(key))return;
    const opener=window.KunConfirmInventoryV58?.open;
    if(typeof opener!=='function'){showError(card,'تعذر تحميل نافذة تأكيد الطلب. حدّث القسم وحاول مرة أخرى.');return;}
    pending.add(key);select.setAttribute('aria-busy','true');
    Promise.resolve(opener(id,select)).catch(error=>{select.value=previous;showError(card,error?.message||'تعذر تأكيد الطلب');}).finally(()=>{pending.delete(key);select.removeAttribute('aria-busy');});
  }

  document.addEventListener('click',handle,true);
  document.addEventListener('change',handleConfirm,true);
  window.KunCustomerServiceInteractionsV75={version:'75.2',pending,saveNote,saveContact,confirmState:handleConfirm};
  document.documentElement.dataset.customerServiceInteractions='v75-ready';
})();
