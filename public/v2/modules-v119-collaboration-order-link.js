/* Kun Online v119 — searchable order linking for Team Collaboration. */
(function(){
  'use strict';
  const VERSION='119.0';
  const LIST_ID='kcOrderSuggestions';
  let timer=null,seq=0;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const token=v=>String(v??'').trim().replace(/^#\s*/,'').trim();

  async function scope(){
    const clientId=window.kunClientId?await window.kunClientId():'';
    const storeId=window.kunStoreId?await window.kunStoreId():'';
    return {clientId:String(clientId||''),storeId:String(storeId||'')};
  }

  function ensureList(input){
    let list=document.getElementById(LIST_ID);
    if(!list){list=document.createElement('datalist');list.id=LIST_ID;document.body.appendChild(list);}
    input.setAttribute('list',LIST_ID);
    return list;
  }

  function ensureHint(input){
    let hint=document.getElementById('kcOrderLinkHint');
    if(!hint){
      hint=document.createElement('div');hint.id='kcOrderLinkHint';hint.className='kc-hint';
      hint.textContent='اكتب رقم الأوردر أو كود Easy Orders أو رقم البوليصة AWB — والبحث داخل الفرع الحالي فقط.';
      input.insertAdjacentElement('afterend',hint);
    }
    return hint;
  }

  function renderOptions(list,orders){
    list.innerHTML=(orders||[]).map(o=>{
      const value=o.ref||o.id||o.awb||'';
      const code=[o.ref&&`كود ${o.ref}`,o.id&&o.id!==o.ref?`ID ${o.id}`:'',o.awb?`AWB ${o.awb}`:''].filter(Boolean).join(' · ');
      const label=[code,o.name,o.phone,Number.isFinite(Number(o.total))?`${Number(o.total).toLocaleString('ar-EG')} ج.م`:'' ].filter(Boolean).join(' — ');
      return `<option value="${esc(value)}" label="${esc(label)}"></option>`;
    }).join('');
  }

  async function search(input,list,hint){
    const run=++seq,q=token(input.value),sc=await scope();
    if(run!==seq)return;
    if(!sc.clientId||!sc.storeId){list.innerHTML='';hint.textContent='اختار الفرع من أعلى الأول عشان تظهر أوردراته.';return;}
    hint.textContent=q?'جاري البحث عن الأوردر داخل الفرع الحالي...':'آخر أوردرات الفرع الحالي:';
    const u=new URL('/api/collaboration/orders/search',location.origin);u.searchParams.set('clientId',sc.clientId);u.searchParams.set('storeId',sc.storeId);u.searchParams.set('q',q);u.searchParams.set('limit','15');
    try{
      const r=await fetch(u.pathname+u.search,{credentials:'include'}),d=await r.json().catch(()=>({}));
      if(run!==seq)return;
      if(!r.ok||d.ok===false)throw new Error(d.error||`HTTP ${r.status}`);
      renderOptions(list,d.orders||[]);
      hint.textContent=(d.orders||[]).length?'اختار من الاقتراحات أو اكتب الكود كاملًا. يقبل ID / Easy Orders / AWB.':'مفيش أوردر مطابق في الفرع الحالي.';
    }catch(e){if(run===seq){list.innerHTML='';hint.textContent=e.message||'تعذر البحث عن الأوردر.';}}
  }

  function decorate(){
    const input=document.getElementById('kcOrderId');if(!input)return false;
    if(input.dataset.orderLinkVersion===VERSION)return true;
    input.dataset.orderLinkVersion=VERSION;
    input.placeholder='رقم الأوردر / كود Easy Orders / AWB';
    input.autocomplete='off';
    const list=ensureList(input),hint=ensureHint(input);
    const schedule=()=>{clearTimeout(timer);timer=setTimeout(()=>search(input,list,hint),220);};
    input.addEventListener('focus',schedule);
    input.addEventListener('input',schedule);
    input.addEventListener('change',()=>{const v=token(input.value);if(v!==input.value)input.value=v;schedule();});
    return true;
  }

  function boot(){
    decorate();
    const root=document.getElementById('root');
    if(root&&typeof MutationObserver==='function')new MutationObserver(()=>decorate()).observe(root,{childList:true,subtree:true});
    document.addEventListener('click',e=>{if(e.target.closest?.('button[data-view="collaboration"]'))setTimeout(decorate,60);},true);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
  window.KunCollaborationOrderLinkV119={version:VERSION,decorate};
})();
