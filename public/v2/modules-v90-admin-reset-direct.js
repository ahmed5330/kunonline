/* Kun Online v90.0 — direct admin owner-password reset transport. */
(function(){
  if(window.KunAdminResetDirectV90)return;
  const K=window.KunActionsV23;
  if(!K)return;
  let clientId='';

  function directJsonRequest(path,{method='GET',body=null,timeout=20000}={}){
    return new Promise((resolve,reject)=>{
      const xhr=new XMLHttpRequest();
      xhr.open(method,path,true);
      xhr.withCredentials=true;
      xhr.timeout=timeout;
      xhr.setRequestHeader('Accept','application/json');
      if(body!==null)xhr.setRequestHeader('Content-Type','application/json');
      xhr.onload=()=>{
        let data={};
        try{data=JSON.parse(xhr.responseText||'{}')}catch{data={raw:xhr.responseText||''}}
        if(xhr.status>=200&&xhr.status<300){resolve(data);return;}
        const error=new Error(data?.error||`HTTP ${xhr.status}`);
        error.status=xhr.status;
        error.code=data?.code;
        error.data=data;
        reject(error);
      };
      xhr.onerror=()=>reject(Object.assign(new Error('تعذر الاتصال بالسيرفر'),{code:'NETWORK_ERROR'}));
      xhr.ontimeout=()=>reject(Object.assign(new Error('الاتصال اتأخر وتم إلغاء المحاولة. جرّب مرة أخرى.'),{code:'TIMEOUT'}));
      xhr.send(body===null?null:JSON.stringify(body));
    });
  }

  if(typeof K.enhanceClientDrawer==='function'&&!K.enhanceClientDrawer.__kunDirectResetV90){
    const upstream=K.enhanceClientDrawer;
    const wrapped=async function(id,...args){clientId=String(id||'');return upstream.apply(this,[id,...args]);};
    Object.defineProperty(wrapped,'__kunDirectResetV90',{value:true});
    K.enhanceClientDrawer=wrapped;
  }

  document.addEventListener('click',event=>{
    const opener=event.target.closest?.('.v27ClientOpen[data-id]');
    if(opener?.dataset?.id)clientId=String(opener.dataset.id);
  },true);

  document.addEventListener('click',async event=>{
    const button=event.target.closest?.('#v23ResetOwner');
    if(!button)return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if(button.dataset.busy==='1')return;

    const input=document.getElementById('v23ResetPassword');
    const password=String(input?.value||'').trim();
    if(password.length<8){K.notify('كلمة المرور لازم تكون 8 حروف على الأقل');input?.focus();return;}
    const targetClientId=String(clientId||'').trim();
    if(!targetClientId){K.notify('أغلق حساب العميل وافتحه من جديد ثم أعد المحاولة');return;}

    const idleText=button.textContent;
    button.dataset.busy='1';
    button.disabled=true;
    button.setAttribute('aria-busy','true');
    button.textContent='جاري تغيير كلمة المرور...';
    input?.blur();
    try{
      const result=await directJsonRequest(`/api/admin/clients/${encodeURIComponent(targetClientId)}/reset-owner-password`,{method:'POST',body:{password},timeout:20000});
      if(result?.ok===false)throw new Error(result?.error||'تعذر تغيير كلمة المرور');
      if(input)input.value='';
      K.notify('تم تغيير كلمة مرور صاحب الحساب ومسح محاولات الدخول');
    }catch(error){
      const status=Number(error?.status||0);
      const message=status===401?'جلسة الإدارة انتهت. سجّل دخول الإدارة من جديد.':status===403?'الحساب الحالي لا يملك صلاحية Admin.':error?.message||'تعذر تغيير كلمة المرور';
      K.notify(message);
    }finally{
      if(button.isConnected){
        button.dataset.busy='0';
        button.disabled=false;
        button.removeAttribute('aria-busy');
        button.textContent=idleText;
      }
    }
  },true);

  window.KunAdminResetDirectV90={version:'90.0',directJsonRequest};
})();
