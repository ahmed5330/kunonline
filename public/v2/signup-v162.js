/* Email signup UI mounted alongside the existing, unchanged login gateway. */
(()=>{
'use strict';
if(window.__kunSignup162)return;window.__kunSignup162=true;
const styleText='#kun-signup-open{display:block;width:100%;padding:12px;margin-top:10px;border-radius:12px;border:1px solid #93c5fd;background:#eff6ff;color:#1d4ed8;font:inherit;font-weight:800;cursor:pointer}#kun-signup-modal{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;overflow:auto;padding:14px;background:linear-gradient(130deg,#0b1320,#1c395d);font-family:Cairo,Tajawal,system-ui,sans-serif;direction:rtl;color:#0f172a}#kun-signup-modal *{box-sizing:border-box}#kun-signup-modal .card{width:min(100%,470px);background:white;border-radius:22px;padding:28px;box-shadow:0 22px 70px #0005}#kun-signup-modal h2{font-size:23px;margin:0 0 8px}#kun-signup-modal p{color:#64748b;line-height:1.8;font-size:13px}#kun-signup-modal label{display:block;font-weight:700;margin:13px 0 6px;font-size:13px}#kun-signup-modal input{display:block;width:100%;border:1px solid #cbd5e1;border-radius:10px;padding:12px;font:inherit;background:white;color:#0f172a}#kun-signup-modal input[type=email],#kun-signup-modal input[type=password],#kun-signup-modal #su-code{direction:ltr;text-align:left}#kun-signup-modal button{font:inherit;cursor:pointer}#kun-signup-modal button:disabled{opacity:.6;cursor:wait}#kun-signup-modal .primary{width:100%;margin-top:18px;border:0;border-radius:10px;padding:13px;background:#1d4ed8;color:white;font-weight:800}#kun-signup-modal .quiet{border:0;background:transparent;color:#1d4ed8;font-weight:700;padding:10px}#kun-signup-modal .feedback{color:#991b1b;font-size:13px;line-height:1.8;min-height:10px;margin-top:10px}#kun-signup-modal .top{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:20px}#kun-signup-modal .brand{font-size:23px;font-weight:900}#kun-signup-modal .brand span{color:#2563eb}#kun-signup-modal .info{padding:10px;border-radius:10px;background:#eff6ff;color:#1e3a8a;font-size:13px;line-height:1.8}@media(max-width:520px){#kun-signup-modal .card{padding:20px}}';
let modal=null,info=null,turnstileToken='',turnstileWidget=null;
function msg(s){const e=modal?.querySelector('#su-feedback');if(e)e.textContent=s||'';}
function stage(next){modal.querySelector('#su-details').hidden=next!=='details';modal.querySelector('#su-verify').hidden=next!=='verify';msg('');if(info)modal.querySelector('#su-address').textContent=info.email;}
async function api(path,data){
 const r=await fetch(path,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
 const b=await r.json().catch(()=>({}));if(!r.ok)throw new Error(b.error||'تعذر الاتصال بالخادم. حاول تاني.');return b;
}
function close(){if(turnstileWidget!==null&&window.turnstile?.remove)window.turnstile.remove(turnstileWidget);turnstileWidget=null;turnstileToken='';modal?.remove();modal=null;}
async function challengeSetup(){
 const btn=modal?.querySelector('#su-details button[type=submit]');if(!btn)return;
 btn.disabled=true;
 try{
  const r=await fetch('/api/auth/signup/config',{cache:'no-store',credentials:'same-origin'});
  const data=await r.json().catch(()=>({}));
  if(!r.ok||!data.enabled||!data.turnstileSiteKey)throw new Error('التسجيل الجديد غير متاح حاليًا. جرّب لاحقًا.');
  if(!window.turnstile){await new Promise((resolve,reject)=>{
   const script=document.createElement('script');script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';script.async=true;script.onload=resolve;script.onerror=()=>reject(new Error('تعذر تحميل التحقق الأمني. جرّب مرة أخرى.'));document.head.appendChild(script);
  });}
  if(!window.turnstile?.render)throw new Error('تعذر بدء التحقق الأمني.');
  turnstileWidget=window.turnstile.render(modal.querySelector('#su-turnstile'),{
   sitekey:data.turnstileSiteKey,theme:'light',callback:token=>{turnstileToken=token;},
   'expired-callback':()=>{turnstileToken='';},'error-callback':()=>{turnstileToken='';msg('تعذر التحقق الأمني. جرّب إعادة تحميل الصفحة.');}
  });
  btn.disabled=false;
 }catch(e){msg(e?.message||'تعذر بدء التحقق الأمني.');}
}
function open(){
 if(modal)return;
 if(!document.getElementById('su-style')){const s=document.createElement('style');s.id='su-style';s.textContent=styleText;document.head.appendChild(s);}
 modal=document.createElement('section');modal.id='kun-signup-modal';modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-label','التسجيل في كن أونلاين');
 modal.innerHTML='<div class="card"><div class="top"><div class="brand">كن <span>أونلاين</span></div><button class="quiet" type="button" id="su-close">رجوع للدخول ×</button></div><h2>ابدأ 30 يوم مجانًا</h2><p>سجل بياناتك، وبعدها وصلك كود على الإيميل. التجربة بتبدأ بعد التفعيل.</p>'+
 '<form id="su-details"><label for="su-name">اسمك</label><input id="su-name" name="name" required minlength="2" maxlength="120" autocomplete="name" placeholder="اسم صاحب المتجر"><label for="su-store">اسم المتجر</label><input id="su-store" name="storeName" required minlength="2" maxlength="120" placeholder="اسم متجرك"><label for="su-email">البريد الإلكتروني</label><input id="su-email" name="email" type="email" required autocomplete="email" placeholder="you@example.com"><div id="su-turnstile" style="min-height:64px;margin-top:15px"></div><button type="submit" class="primary">إرسال كود التفعيل</button></form>'+
 '<form id="su-verify" hidden><div class="info">لو البريد متاح، هتوصلك رسالة بكود من 8 أرقام على <strong id="su-address"></strong></div><label for="su-code">كود التفعيل</label><input id="su-code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{8}" maxlength="8" required placeholder="12345678"><label for="su-pass">اختار كلمة مرور (12 حرف على الأقل)</label><input id="su-pass" type="password" autocomplete="new-password" minlength="12" maxlength="128" required><label for="su-confirm">تأكيد كلمة المرور</label><input id="su-confirm" type="password" autocomplete="new-password" minlength="12" maxlength="128" required><button type="submit" class="primary">تفعيل الحساب وبدء التجربة</button><button type="button" class="quiet" id="su-resend">إعادة إرسال الكود</button><button type="button" class="quiet" id="su-edit">تغيير الإيميل</button></form><div class="feedback" id="su-feedback" role="alert" aria-live="polite"></div></div>';
 document.body.appendChild(modal);
 modal.querySelector('#su-close').addEventListener('click',close);
 modal.querySelector('#su-edit').addEventListener('click',()=>stage('details'));
 const details=modal.querySelector('#su-details'),verify=modal.querySelector('#su-verify');
 details.addEventListener('submit',async ev=>{
  ev.preventDefault();const btn=details.querySelector('button[type=submit]');if(btn.disabled)return;
  info={name:details.elements.namedItem('name').value.trim(),storeName:details.elements.namedItem('storeName').value.trim(),email:details.elements.namedItem('email').value.trim().toLowerCase()};
  btn.disabled=true;msg('');
  if(!turnstileToken){msg('كمّل التحقق الأمني الأول.');btn.disabled=false;return;}
  try{await api('/api/auth/signup',{...info,turnstileToken});stage('verify');modal.querySelector('#su-code').focus();}
  catch(e){msg(e.message);}finally{btn.disabled=false;turnstileToken='';if(turnstileWidget!==null&&window.turnstile?.reset)window.turnstile.reset(turnstileWidget);}
 });
 verify.addEventListener('submit',async ev=>{
  ev.preventDefault();const btn=verify.querySelector('button[type=submit]');if(btn.disabled)return;
  const pass=modal.querySelector('#su-pass').value;
  if(pass!==modal.querySelector('#su-confirm').value){msg('كلمتا المرور مش متطابقتين.');return;}
  btn.disabled=true;msg('');
  try{
   await api('/api/auth/activate',{email:info.email,code:modal.querySelector('#su-code').value,password:pass});
   const form=document.getElementById('kun-v142-login-form');
   const email=document.getElementById('kun-v142-email'),password=document.getElementById('kun-v142-password');
   close();
   if(form&&email&&password){email.value=info.email;password.value=pass;info=null;form.requestSubmit();}
   else{location.assign('/v2/');}
  }catch(e){msg(e.message);}finally{btn.disabled=false;}
 });
 modal.querySelector('#su-resend').addEventListener('click',()=>{stage('details');msg('اضغط إرسال الكود مرة تانية بعد 90 ثانية مع تجديد التحقق الأمني.');});
 stage('details');modal.querySelector('#su-name').focus();challengeSetup();
}
function attach(){
 const form=document.getElementById('kun-v142-login-form');if(!form||document.getElementById('kun-signup-open'))return false;
 const btn=document.createElement('button');btn.id='kun-signup-open';btn.type='button';btn.textContent='إنشاء حساب جديد — 30 يوم مجانًا';btn.addEventListener('click',open);
 const note=form.querySelector('.login-note');if(note)note.before(btn);else form.appendChild(btn);return true;
}
window.KunSelfSignup={open};
if(!attach()){const observer=new MutationObserver(()=>{if(attach())observer.disconnect();});observer.observe(document.documentElement,{childList:true,subtree:true});}
})();
