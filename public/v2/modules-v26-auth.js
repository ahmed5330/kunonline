/* Kun Online v28 authentication shell: login gate + visible logout control. */
(function(){
  const app=document.querySelector('.app');
  const top=document.querySelector('.top');
  if(!app||!top)return;

  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const request=async(path,options={})=>{
    const response=await fetch(path,{credentials:'include',headers:{'Content-Type':'application/json',...(options.headers||{})},...options});
    const text=await response.text();let data={};try{data=JSON.parse(text)}catch{data={raw:text}};
    if(!response.ok){const error=new Error(data.error||`HTTP ${response.status}`);error.status=response.status;error.code=data.code;throw error}
    return data;
  };

  function ensureStyles(){
    if(document.getElementById('v28AuthStyles'))return;
    const style=document.createElement('style');style.id='v28AuthStyles';style.textContent=`
      #v28AuthGate{min-height:100dvh;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at 80% 10%,#e8f2ff 0,transparent 35%),#f7f9fc;direction:rtl}
      .v28-auth-card{width:min(440px,100%);background:#fff;border:1px solid #e6eaf0;border-radius:22px;padding:28px;box-shadow:0 18px 55px rgba(15,23,42,.12)}
      .v28-auth-brand{font-size:28px;font-weight:800;margin-bottom:4px}.v28-auth-brand span{color:#74d34a}.v28-auth-sub{color:#6b7280;font-size:14px;margin-bottom:20px}
      .v28-auth-tabs{display:grid;grid-template-columns:1fr 1fr;gap:6px;background:#f1f5f9;padding:4px;border-radius:12px;margin-bottom:18px}
      .v28-auth-tabs button{border:0;border-radius:9px;padding:9px;font:inherit;font-weight:700;cursor:pointer;background:transparent;color:#64748b}.v28-auth-tabs button.active{background:#fff;color:#0e5095;box-shadow:0 1px 4px rgba(15,23,42,.1)}
      .v28-auth-field{display:grid;gap:6px;margin-bottom:13px;font-weight:700;font-size:13px}.v28-auth-field input{width:100%;border:1px solid #e6eaf0;border-radius:10px;padding:11px 12px;font:inherit}
      .v28-auth-error{display:none;background:#fdecec;color:#a63c3c;border-radius:10px;padding:10px 12px;margin-bottom:12px;font-size:13px}.v28-auth-error.show{display:block}
      .v28-auth-note{background:#eef5fd;color:#1d5f9c;border-radius:12px;padding:14px;line-height:1.7;font-size:14px}.v28-auth-actions{display:grid;gap:9px;margin-top:16px}.v28-auth-actions .btn{width:100%}
      #v28SessionBox{display:flex;align-items:center;gap:8px;margin-inline-start:auto}.v28-session-name{font-size:12px;color:#6b7280;max-width:170px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      @media(max-width:620px){#v28SessionBox .v28-session-name{display:none}#v28LogoutBtn{padding:9px 10px}.top{gap:7px}}
    `;document.head.appendChild(style);
  }

  function removeGate(){document.getElementById('v28AuthGate')?.remove();app.style.display='';}

  function showAuth(initialTab='login'){
    ensureStyles();app.style.display='none';document.getElementById('v28AuthGate')?.remove();
    const gate=document.createElement('main');gate.id='v28AuthGate';
    gate.innerHTML=`<section class="v28-auth-card"><div class="v28-auth-brand">kun <span>online</span></div><div class="v28-auth-sub">Commerce OS — إدارة تجارتك الإلكترونية من مكان واحد</div><div class="v28-auth-tabs"><button id="v28LoginTab" type="button">تسجيل الدخول</button><button id="v28SignupTab" type="button">إنشاء حساب</button></div><div id="v28AuthBody"></div></section>`;
    document.body.appendChild(gate);
    const body=document.getElementById('v28AuthBody'),loginTab=document.getElementById('v28LoginTab'),signupTab=document.getElementById('v28SignupTab');

    const renderLogin=()=>{
      loginTab.classList.add('active');signupTab.classList.remove('active');
      body.innerHTML=`<div id="v28LoginError" class="v28-auth-error"></div><label class="v28-auth-field">البريد الإلكتروني<input id="v28LoginEmail" type="email" autocomplete="email" placeholder="name@example.com"></label><label class="v28-auth-field">كلمة المرور<input id="v28LoginPassword" type="password" autocomplete="current-password" placeholder="••••••••"></label><div class="v28-auth-actions"><button class="btn primary" id="v28LoginBtn" type="button">تسجيل الدخول</button></div>`;
      const submit=async()=>{const btn=document.getElementById('v28LoginBtn'),err=document.getElementById('v28LoginError'),email=document.getElementById('v28LoginEmail').value.trim(),password=document.getElementById('v28LoginPassword').value;err.classList.remove('show');if(!email||!password){err.textContent='اكتب البريد الإلكتروني وكلمة المرور';err.classList.add('show');return}try{btn.disabled=true;btn.textContent='جاري تسجيل الدخول...';await request('/api/login',{method:'POST',body:JSON.stringify({email,password})});location.reload()}catch(error){err.textContent=error.message||'تعذر تسجيل الدخول';err.classList.add('show');btn.disabled=false;btn.textContent='تسجيل الدخول'}};
      document.getElementById('v28LoginBtn').onclick=submit;['v28LoginEmail','v28LoginPassword'].forEach(id=>document.getElementById(id).addEventListener('keydown',event=>{if(event.key==='Enter')submit()}));
    };
    const renderSignup=()=>{
      signupTab.classList.add('active');loginTab.classList.remove('active');
      body.innerHTML=`<div class="v28-auth-note"><b>إنشاء الحسابات الجديدة يتم حاليًا من إدارة Kun Online.</b><br>بعد إضافة المتجر من Kun Admin، صاحب الحساب يقدر يدخل هنا بالبريد الإلكتروني وكلمة المرور المؤقتة. التسجيل الذاتي المفتوح للمتاجر غير مفعّل حاليًا حتى لا يتم إنشاء Tenant أو صلاحيات بدون إعداد الإدارة.</div><div class="v28-auth-actions"><button class="btn soft" id="v28BackLogin" type="button">عندي حساب — تسجيل الدخول</button></div>`;
      document.getElementById('v28BackLogin').onclick=renderLogin;
    };
    loginTab.onclick=renderLogin;signupTab.onclick=renderSignup;(initialTab==='signup'?renderSignup:renderLogin)();
    document.documentElement.dataset.v28Auth='anonymous';
  }

  function showSession(me){
    removeGate();let box=document.getElementById('v28SessionBox');if(!box){box=document.createElement('div');box.id='v28SessionBox';top.appendChild(box)};
    box.innerHTML=`<span class="v28-session-name" title="${esc(me.email||me.name||'')}">${esc(me.name||me.email||'الحساب')}</span><button class="btn soft" id="v28LogoutBtn" type="button">تسجيل الخروج</button>`;
    document.getElementById('v28LogoutBtn').onclick=async()=>{const btn=document.getElementById('v28LogoutBtn');try{btn.disabled=true;btn.textContent='جاري الخروج...';await request('/api/logout',{method:'POST'});}catch{}showAuth('login')};
    document.documentElement.dataset.v28Auth='authenticated';
  }

  (async()=>{
    ensureStyles();
    try{const me=await request('/api/me');if(me?.role)showSession(me);else showAuth('login')}catch{showAuth('login')}
  })();
})();
