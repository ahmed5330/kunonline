/* Kun Online V2 login gateway v142.0.
 * Dedicated authenticated entry, independent from the deprecated legacy root.
 * Never stores credentials outside this form and never logs them. */
(()=>{
  'use strict';
  if(window.__kunLoginGateway142)return;
  window.__kunLoginGateway142=true;
  const id='kun-v142-login';
  const css=`#${id}{position:fixed;inset:0;z-index:2147483646;display:grid;place-items:center;padding:20px;background:linear-gradient(135deg,#0b1320,#1e3250);direction:rtl;font-family:Cairo,Tajawal,system-ui,sans-serif;overflow:auto}
#${id} *{box-sizing:border-box}
#${id} .login-card{background:#fff;border-radius:22px;width:min(100%,440px);padding:30px;box-shadow:0 18px 80px #0005;color:#0b1320}
#${id} .login-brand{font-size:27px;font-weight:800;text-align:center;color:#0b1320;margin:0 0 3px}
#${id} .login-brand span{color:#2563eb}
#${id} p{color:#64748b;text-align:center;font-size:13px;margin:0 0 25px}
#${id} label{display:block;font-weight:700;font-size:13px;margin:15px 0 7px}
#${id} input{display:block;width:100%;padding:12px 13px;border:1px solid #cbd5e1;border-radius:10px;background:#fff;color:#0b1320;font:inherit;direction:ltr;text-align:left}
#${id} input:focus{outline:2px solid #60a5fa;outline-offset:1px}
#${id} button{width:100%;padding:13px 18px;border:0;border-radius:11px;background:#1d4ed8;color:#fff;font:inherit;font-weight:800;cursor:pointer;margin-top:20px}
#${id} button:disabled{opacity:.65;cursor:wait}
#${id} .login-error{background:#fff1f2;border:1px solid #fecdd3;color:#9f1239;border-radius:10px;padding:11px;margin-top:12px;font-size:13px;line-height:1.8}
#${id} .login-error:empty{display:none}
#${id} .login-note{color:#64748b;font-size:12px;text-align:center;margin-top:17px;line-height:1.8}
@media(max-width:520px){#${id}{padding:12px}#${id} .login-card{padding:22px 19px;border-radius:16px}}`;
  function mount(){
    let box=document.getElementById(id);
    if(box)return box;
    const st=document.createElement('style');st.id=id+'-style';st.textContent=css;document.head.appendChild(st);
    box=document.createElement('section');box.id=id;box.setAttribute('role','dialog');box.setAttribute('aria-modal','true');box.setAttribute('aria-label','تسجيل الدخول إلى كن أونلاين');
    box.innerHTML='<form class="login-card" id="kun-v142-login-form" autocomplete="on"><h1 class="login-brand">كن <span>أونلاين</span></h1><p>سجّل الدخول إلى حسابك للمتابعة</p><label for="kun-v142-email">البريد الإلكتروني</label><input id="kun-v142-email" type="email" inputmode="email" autocomplete="username" required placeholder="name@store.com"><label for="kun-v142-password">كلمة المرور</label><input id="kun-v142-password" type="password" autocomplete="current-password" required placeholder="كلمة المرور"><div class="login-error" id="kun-v142-error" role="alert" aria-live="polite"></div><button type="submit" id="kun-v142-submit">تسجيل الدخول</button><div class="login-note">الاشتراك أو الرصيد غير الكافي لا يمنعان تسجيل الدخول؛ يمكنك مراجعة المحفظة بعد الدخول.</div></form>';
    document.body.appendChild(box);
    const form=box.querySelector('form'),email=box.querySelector('#kun-v142-email'),pass=box.querySelector('#kun-v142-password');
    const error=box.querySelector('#kun-v142-error'),button=box.querySelector('#kun-v142-submit');
    form.addEventListener('submit',async e=>{
      e.preventDefault();
      if(button.disabled)return;
      const mail=email.value.trim().toLowerCase(),password=pass.value;
      if(!mail||!password){error.textContent='اكتب البريد الإلكتروني وكلمة المرور.';return;}
      button.disabled=true;button.textContent='جارٍ تسجيل الدخول...';error.textContent='';
      try{
        const response=await fetch('/api/login',{method:'POST',credentials:'include',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:mail,password})});
        const result=await response.json().catch(()=>({}));
        if(!response.ok)throw new Error(result?.error||'تعذر تسجيل الدخول. حاول مرة أخرى.');
        const verified=await fetch('/api/me',{credentials:'include',cache:'no-store',headers:{'Cache-Control':'no-cache'}});
        const user=await verified.json().catch(()=>({}));
        if(!verified.ok||!user?.role)throw new Error('تم التحقق من الحساب ولكن الجلسة لم تثبت. حدّث الصفحة وحاول تاني.');
        pass.value='';
        location.replace('/v2/?login=ok');
      }catch(e){error.textContent=e?.message||'حدث خطأ في الاتصال. حاول مرة أخرى.';button.disabled=false;button.textContent='تسجيل الدخول';}
    });
    setTimeout(()=>email.focus(),50);
    return box;
  }
  async function check(){
    try{
      const response=await fetch('/api/me',{credentials:'include',cache:'no-store',headers:{'Cache-Control':'no-cache'}});
      const me=await response.json().catch(()=>({}));
      if(response.ok&&me?.role){document.getElementById(id)?.remove();return;}
      const box=mount();
      if(!response.ok&&response.status>=500)box.querySelector('#kun-v142-error').textContent='تعذر التحقق من الجلسة حاليًا. يمكنك محاولة الدخول، ولو استمر العطل سيتم عرض خطأ الخادم.';
    }catch{
      const box=mount();
      box.querySelector('#kun-v142-error').textContent='تعذر الاتصال بالخادم. تحقق من الإنترنت وحاول تسجيل الدخول.';
    }
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',check,{once:true});else check();
})();