/* Kun Online v75 — reliable Customer Service note/contact/call interactions. */
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
  function updateLatestNote(card,note){
    let latest=card.querySelector('.cs-internal-latest');
    if(!latest){latest=document.createElement('div');latest.className='cs-internal-latest';const field=card.querySelector('.cs-note-field');if(field)field.before(latest);else card.appendChild(latest);}
    latest.innerHTML=`<b>آخر ملاحظة داخلية:</b> ${esc(note)}`;
  }
  function updateContactCount(card,data){
    const log=Array.isArray(data?.log)?data.log:[],count=Number.isFinite(Number(data?.contactCount))?Number(data.contactCount):log.length;
    const button=card.querySelector('[data-cs-action="contact"]');if(button)button.textContent=`تواصل (${count})`;
  }
  async function saveNote(card,button){
    const id=orderId(card),input=card.querySelector('[data-cs-note]'),note=String(input?.value||'').trim();
    if(!note){notify('اكتب الملاحظة الأول');return;}
    const cid=await clientId();if(!cid)throw new Error('تعذر تحديد حساب المتجر');
    const data=await api(route(id,'notes',cid),{method:'POST',body:JSON.stringify({clientId:cid,note})});
    if(input&&String(input.value||'').trim()===note)input.value='';
    updateLatestNote(card,note);notify('تم حفظ الملاحظة الداخلية في سجل الأوردر');
    return data;
  }
  async function saveContact(card,isCall=false){
    const id=orderId(card),cid=await clientId();if(!cid)throw new Error('تعذر تحديد حساب المتجر');
    const data=await api(route(id,'contact',cid),{method:'POST',keepalive:isCall,body:JSON.stringify({clientId:cid,channel:'phone',intent:isCall?'call':'contact'})});
    updateContactCount(card,data);
    notify(isCall?'تم تسجيل المكالمة في سجل الأوردر':'تم تسجيل محاولة التواصل في سجل الأوردر');
    return data;
  }
  function handle(event){
    if(!active())return;
    const button=event.target.closest?.('[data-cs-action]'),card=button?.closest?.('#root [data-cs-order]');if(!card)return;
    const action=String(button.dataset.csAction||'');if(!['note','contact','call'].includes(action))return;
    const id=orderId(card);if(!id)return;

    // v31 originally listened in bubble phase. Stop propagation here so later decorators cannot swallow
    // the interaction and so the same action cannot be submitted twice.
    if(action!=='call')event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const key=`${id}:${action}`;if(pending.has(key))return;
    pending.add(key);setBusy(button,true);
    const work=action==='note'?saveNote(card,button):saveContact(card,action==='call');
    Promise.resolve(work).catch(error=>notify(action==='call'?`تم فتح الاتصال، لكن تعذر تسجيل المكالمة: ${error.message}`:error.message)).finally(()=>{pending.delete(key);setBusy(button,false);});
    // For call we deliberately do not preventDefault: the tel: action continues while the same-origin
    // keepalive request is already in flight, so the click is recorded without delaying the dialer.
  }

  document.addEventListener('click',handle,true);
  window.KunCustomerServiceInteractionsV75={version:'75.0',pending,saveNote,saveContact};
  document.documentElement.dataset.customerServiceInteractions='v75-ready';
})();
