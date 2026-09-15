/* Kun Online v90.0 — verified direct admin password reset guard. */
(function(){
  if(window.__kunAdminResetVerifiedV90)return;
  window.__kunAdminResetVerifiedV90=true;
  const K=window.KunActionsV23;
  let activeClientId='';
  const remember=id=>{activeClientId=String(id||'').trim();const card=document.getElementById('v23ClientAdminActions');if(card&&activeClientId)card.dataset.clientId=activeClientId;return activeClientId;};
  if(K&&typeof K.enhanceClientDrawer==='function'){
    const original=K.enhanceClientDrawer.bind(K);
    K.enhanceClientDrawer=async id=>{remember(id);const result=await original(id);remember(id);return result;};
  }
  document.addEventListener('click',event=>{
    const opener=event.target.closest?.('.v27ClientOpen[data-id]');
    if(opener)remember(opener.dataset.id);
  },true);
  document.addEventListener('click',async event=>{
    const btn=event.target.closest?.('#v23ResetOwner');if(!btn)return;
    event.preventDefault();event.stopImmediatePropagation();
    if(btn.dataset.v90Busy==='1')return;
    const card=btn.closest?.('#v23ClientAdminActions');
    const clientId=String(card?.dataset.clientId||activeClientId||'').trim();
    const input=document.getElementById('v23ResetPassword');
    const password=String(input?.value||'').trim();
    if(!clientId){K?.notify?.('تعذر تحديد حساب العميل. اقفل بيانات العميل وافتحها من جديد ثم جرّب.');return;}
    if(password.length<8){K?.notify?.('كلمة المرور لازم تكون 8 حروف على الأقل');input?.focus?.();return;}
    const idle=btn.textContent,controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
    btn.dataset.v90Busy='1';btn.disabled=true;btn.setAttribute('aria-busy','true');btn.textContent='جاري التغيير والتحقق...';input?.blur?.();
    try{
      const endpoint=new URL(`/api/admin/clients/${encodeURIComponent(clientId)}/reset-owner-password`,location.origin).href;
      const response=await window.fetch(endpoint,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json','X-Kun-Reset-Guard':'v90.0'},body:JSON.stringify({password}),signal:controller.signal,cache:'no-store'});
      const text=await response.text();let data={};try{data=JSON.parse(text)}catch{data={raw:text}};
      if(!response.ok)throw Object.assign(new Error(data.error||`HTTP ${response.status}`),{status:response.status,code:data.code});
      if(data?.ok!==true||!data?.email)throw new Error('السيرفر لم يؤكد تغيير كلمة المرور. لم يتم اعتبار العملية ناجحة.');
      if(input)input.value='';
      K?.notify?.('تم تغيير كلمة مرور صاحب الحساب وتأكيدها من السيرفر');
    }catch(error){
      K?.notify?.(error?.name==='AbortError'?'الاتصال اتأخر وتم إلغاء المحاولة. لم يتم اعتبار التغيير ناجحًا.':(error?.message||'فشل تغيير كلمة المرور'));
    }finally{
      clearTimeout(timer);if(btn.isConnected){btn.dataset.v90Busy='0';btn.disabled=false;btn.removeAttribute('aria-busy');btn.textContent=idle;}
    }
  },true);
})();
