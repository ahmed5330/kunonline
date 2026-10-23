/* Kun Online v23 SaaS client onboarding + lifecycle UI */
(function(){
  const K=window.KunActionsV23;if(!K)throw new Error('KunActionsV23 core missing');
  const MODULES={dashboard:'الرئيسية',onboarding:'بدء الاستخدام',stores:'المتاجر والفروع','store-access':'صلاحيات الفروع',pos:'نقطة البيع',orders:'الطلبات',crm:'العملاء CRM',inbox:'صندوق الرسائل',catalog:'المنتجات',inventory:'المخزون',suppliers:'الموردون',procurement:'المشتريات','supplier-finance':'حسابات الموردين',shipping:'الشحن',cod:'تسويات COD',campaigns:'الحملات',marketing:'التسويق',finance:'المالية',profit:'Profit Intelligence',analytics:'التحليلات',automation:'الأتمتة',ai:'kun AI',integrations:'التكاملات',team:'الفريق والصلاحيات',approvals:'الموافقات',operations:'التشغيل',audit:'سجل النشاط',wallet:'المحفظة','ad-studio':'AI Ad Studio'};
  const copyText=async text=>{const value=String(text||'');if(!value)throw new Error('لا يوجد نص للنسخ');try{if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(value);return true}}catch{}const ta=document.createElement('textarea');ta.value=value;ta.setAttribute('readonly','');ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();const ok=document.execCommand?.('copy');ta.remove();if(!ok)throw new Error('تعذر النسخ تلقائيًا');return true;};
  K.openNewClient=()=>{
    const modules=Object.entries(MODULES).map(([k,l])=>`<label><input type="checkbox" data-new-module="${K.esc(k)}" checked> ${K.esc(l)}</label>`).join('');
    K.drawer('إضافة عميل جديد',`<div class="card"><h3>بيانات النشاط وصاحب الحساب</h3><div class="v27-form">${K.field('اسم النشاط','v23BusinessName')}${K.field('اسم صاحب الحساب','v23OwnerName')}${K.field('البريد الإلكتروني','v23OwnerEmail','email','autocomplete="email"')}${K.field('رقم الهاتف','v23OwnerPhone','tel')}${K.field('اسم أول متجر','v23StoreName','text','placeholder="يُستخدم اسم النشاط لو تُرك فارغًا"')}<label>الخطة<select class="select" id="v23Plan"><option value="trial">Trial</option><option value="starter">Starter</option><option value="growth">Growth</option><option value="pro">Pro</option><option value="enterprise">Enterprise</option></select></label>${K.field('رسوم الإدارة لكل أوردر','v23BaseFee','number','min="0" step="0.25" value="2" placeholder="بدون حد أقصى"')}<label class="wide">كلمة المرور المؤقتة<div class="toolbar"><input class="input" id="v23OwnerPassword" type="text" minlength="8" autocomplete="new-password" spellcheck="false"><button class="btn soft" id="v23GeneratePassword" type="button">توليد</button><button class="btn soft" id="v23CopyPassword" type="button">نسخ</button></div><div class="meta mt">تظهر هنا قبل إنشاء الحساب، ويمكن توليدها أو تعديلها ثم نسخها للعميل.</div></label></div></div><div class="card mt"><h3>الأقسام المتاحة للعميل</h3><div class="v27-modules">${modules}</div></div><div class="card mt"><button class="btn primary" id="v23CreateClient">إنشاء العميل وحسابه ومتجره ومحفظته</button><div class="meta mt">يتم إنشاء Tenant + Owner + أول Store + Wallet + Billing + Module Entitlements مرة واحدة.</div></div>`);
    const pass=document.getElementById('v23OwnerPassword'),generate=document.getElementById('v23GeneratePassword'),copy=document.getElementById('v23CopyPassword');
    const generatePassword=()=>{const value=K.randomPassword();pass.value=value;pass.dispatchEvent(new Event('input',{bubbles:true}));return value;};
    generatePassword();generate.onclick=()=>{generatePassword();pass.focus();pass.select();};copy.onclick=async()=>{try{await copyText(pass.value);K.notify('تم نسخ كلمة المرور المؤقتة')}catch(e){K.notify(e.message)}};
    document.getElementById('v23CreateClient').onclick=async()=>{const btn=document.getElementById('v23CreateClient');try{const temporaryPassword=String(pass.value||'').trim();if(temporaryPassword.length<8)throw new Error('كلمة المرور المؤقتة لازم تكون 8 حروف على الأقل');btn.disabled=true;btn.textContent='جاري الإنشاء...';const mods={};document.querySelectorAll('[data-new-module]').forEach(x=>mods[x.dataset.newModule]={enabled:x.checked,feeDelta:0});const ownerEmail=K.val('v23OwnerEmail');const r=await K.api('/api/admin/clients',{method:'POST',body:JSON.stringify({businessName:K.val('v23BusinessName'),ownerName:K.val('v23OwnerName'),email:ownerEmail,phone:K.val('v23OwnerPhone'),storeName:K.val('v23StoreName'),plan:K.val('v23Plan'),baseOrderFee:Number(K.val('v23BaseFee')||0),password:temporaryPassword,modules:mods})});const d=document.getElementById('drawer');if(!d)return;d.innerHTML=`<div class="page-head"><div><div class="title">تم إنشاء العميل</div></div><div class="spacer"></div><button class="btn soft" id="v23DoneClient">إغلاق</button></div><div class="card"><h3>بيانات دخول صاحب الحساب</h3><div class="meta">انسخ البيانات الآن وأرسلها لصاحب الحساب. كلمة المرور لا يتم تخزينها كنص قابل للعرض بعد إغلاق هذه الشاشة.</div><div class="v27-form mt"><label>البريد الإلكتروني<input class="input" id="v23CreatedEmail" type="text" readonly value="${K.esc(ownerEmail)}"></label><label>كلمة المرور المؤقتة<input class="input" id="v23CreatedPassword" type="text" readonly value="${K.esc(temporaryPassword)}"></label></div><div class="toolbar mt"><button class="btn primary" id="v23CopyCredentials" type="button">نسخ بيانات الدخول</button><button class="btn soft" id="v23CopyCreatedPassword" type="button">نسخ كلمة المرور</button></div><div class="meta mt">Client ID: ${K.esc(r.clientId||'—')}</div></div>`;document.getElementById('v23CopyCredentials').onclick=async()=>{try{await copyText(`البريد الإلكتروني: ${ownerEmail}\nكلمة المرور المؤقتة: ${temporaryPassword}`);K.notify('تم نسخ بيانات الدخول')}catch(e){K.notify(e.message)}};document.getElementById('v23CopyCreatedPassword').onclick=async()=>{try{await copyText(temporaryPassword);K.notify('تم نسخ كلمة المرور المؤقتة')}catch(e){K.notify(e.message)}};document.getElementById('v23DoneClient').onclick=()=>{K.close();document.querySelector('[data-view="admin-clients"]')?.click()};K.notify(`تم إنشاء العميل ${r.clientId}`);}catch(e){K.notify(e.message);btn.disabled=false;btn.textContent='إنشاء العميل وحسابه ومتجره ومحفظته'}};
  };
  K.enhanceAdminPage=()=>{if(!document.querySelector('.nav button.active[data-view="admin-clients"]'))return;const h=K.root()?.querySelector('.page-head');if(!h||document.getElementById('v23NewClient'))return;const spacer=document.createElement('div');spacer.className='spacer';const b=document.createElement('button');b.className='btn primary';b.id='v23NewClient';b.textContent='+ إضافة عميل';b.onclick=K.openNewClient;h.append(spacer,b);};
  // A client drawer can be enhanced from the legacy card, the v74 command center,
  // and navigation listeners at the same time. Only one request/render is allowed.
  K.enhanceClientDrawer=async clientId=>{
    const drawer=document.getElementById('drawer');
    if(!drawer||!drawer.classList.contains('open'))return;
    const anchor=drawer.firstElementChild,clientKey=String(clientId||'');
    if(!anchor||!clientKey||drawer.querySelector('#v23ClientAdminActions'))return;
    const existing=K._v23ClientAdminPending;
    if(existing?.anchor===anchor&&existing.clientKey===clientKey)return existing.promise;
    const task=(async()=>{
      let c;
      try{c=await K.api(`/api/admin/clients/${encodeURIComponent(clientKey)}/overview`)}
      catch(e){if(drawer.firstElementChild===anchor)K.notify(e?.message||'تعذر تحميل بيانات الحساب');return}
      // A newer drawer may have opened while the overview request was in flight.
      if(!drawer.classList.contains('open')||drawer.firstElementChild!==anchor||
         drawer.querySelector('#v23ClientAdminActions')||K._v23ClientAdminPending?.promise!==task)return;

      const card=document.createElement('div');
      card.id='v23ClientAdminActions';
      card.className='card mt';
      card.dataset.clientId=clientKey;
      card.innerHTML=`<h3>إدارة الحساب</h3>
        <div class="rowline"><div><b>${K.esc(c.ownerName||'صاحب الحساب')}</b><div class="meta">${K.esc(c.ownerEmail||'—')} · ${K.esc(c.phone||'—')} · ${K.esc(c.status||'active')}</div></div><button class="btn ${c.status==='suspended'?'primary':'soft'}" id="v23ToggleClient" type="button">${c.status==='suspended'?'إعادة التفعيل':'تعليق الحساب'}</button></div>
        <div class="v27-form mt">
          <div class="wide"><label for="v23ResetPassword">كلمة مرور جديدة</label>
            <div class="toolbar"><input class="input" id="v23ResetPassword" type="password" minlength="8" autocomplete="new-password" autocapitalize="none" spellcheck="false" placeholder="8 أحرف على الأقل" style="flex:1;min-width:155px">
              <button class="btn soft" id="v23GenerateReset" type="button">توليد</button>
              <button class="btn soft" id="v23ToggleResetVisibility" type="button" aria-label="إظهار كلمة المرور">إظهار</button>
              <button class="btn soft" id="v23CopyReset" type="button">نسخ</button>
            </div>
            <div class="meta mt">التغيير يتم لحساب صاحب المتجر المحدد فقط. انسخ كلمة المرور الجديدة قبل الضغط على تغيير كلمة المرور؛ تُمسح من الحقل بعد نجاح الحفظ.</div>
          </div>
          ${K.field('شحن مباشر من الإدارة','v23AdminCredit','number','min="1" step="0.01" placeholder="المبلغ"')}
          <label>رسوم الإدارة لكل أوردر<input class="input" id="v23OrderFee" type="number" min="0" step="0.25" value="${K.esc(c.wallet?.baseOrderFee??0)}" placeholder="بدون حد أقصى"><span class="meta">مفتوحة بدون حد أقصى.</span></label>
          <label class="wide">ملاحظة داخلية<textarea class="input" id="v23AdminNote" rows="2"></textarea></label>
        </div>
        <div class="toolbar">
          <button class="btn primary" id="v23ResetOwner" type="button">تغيير كلمة المرور</button>
          <button class="btn soft" id="v23CreditWallet" type="button">شحن المحفظة</button>
          <button class="btn primary" id="v23SaveOrderFee" type="button">حفظ رسوم الإدارة</button>
          <button class="btn soft" id="v23SaveClientNote" type="button">حفظ الملاحظة</button>
        </div>
        <div class="meta mt" id="v23PasswordStatus" role="status" aria-live="polite"></div>`;
      drawer.appendChild(card);
      // Scope all selectors to the card. Duplicate IDs in stale DOM cannot hijack actions.
      const $=id=>card.querySelector('#'+id);
      const resetInput=$('v23ResetPassword'),resetBtn=$('v23ResetOwner'),passwordStatus=$('v23PasswordStatus');
      const passwordMessage=(message,error=false)=>{passwordStatus.textContent=message;passwordStatus.style.color=error?'#b91c1c':'#15803d'};
      $('v23GenerateReset').onclick=()=>{resetInput.value=K.randomPassword();passwordMessage('تم توليد كلمة مرور جديدة. اضغط تغيير كلمة المرور لحفظها.');resetInput.focus()};
      $('v23ToggleResetVisibility').onclick=()=>{const show=resetInput.type==='password';resetInput.type=show?'text':'password';$('v23ToggleResetVisibility').textContent=show?'إخفاء':'إظهار';$('v23ToggleResetVisibility').setAttribute('aria-label',show?'إخفاء كلمة المرور':'إظهار كلمة المرور')};
      $('v23CopyReset').onclick=async()=>{try{await copyText(resetInput.value);K.notify('تم نسخ كلمة المرور الجديدة')}catch(e){passwordMessage(e?.message||'تعذر نسخ كلمة المرور',true)}};
      $('v23ToggleClient').onclick=async()=>{try{const next=c.status==='suspended'?'active':'suspended';await K.api(`/api/admin/clients/${encodeURIComponent(clientKey)}/status`,{method:'PATCH',body:JSON.stringify({status:next})});K.notify(next==='active'?'تم تفعيل الحساب':'تم تعليق الحساب');K.close();document.querySelector('[data-view="admin-clients"]')?.click()}catch(e){K.notify(e.message)}};
      resetBtn.onclick=async event=>{
        event?.preventDefault?.();
        if(resetBtn.dataset.busy==='1'||resetBtn.disabled)return;
        const password=String(resetInput.value||'');
        if(password.length<8){passwordMessage('كلمة المرور لازم تكون 8 حروف على الأقل',true);resetInput.focus();return}
        const idleText=resetBtn.textContent,controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
        resetBtn.dataset.busy='1';
        resetBtn.disabled=true;
        resetBtn.setAttribute('aria-busy','true');
        resetBtn.textContent='جاري تغيير كلمة المرور...';
        resetInput.blur();
        passwordMessage('جاري حفظ كلمة المرور الجديدة...');
        try{
          const result=await K.api(`/api/admin/clients/${encodeURIComponent(clientKey)}/reset-owner-password`,{method:'POST',body:JSON.stringify({password}),signal:controller.signal});
          if(result?.ok!==true)throw new Error('لم يؤكد السيرفر تغيير كلمة المرور');
          resetInput.value='';
          passwordMessage('تم تغيير كلمة المرور بنجاح. استخدم النسخة التي نسختها قبل الحفظ وأرسلها لصاحب الحساب بطريقة آمنة.');
          K.notify('تم تغيير كلمة مرور صاحب الحساب');
        }catch(e){
          const message=e?.name==='AbortError'?'انتهت مهلة الاتصال ولم نتمكن من التأكد من نتيجة التغيير. تحقق قبل إعادة المحاولة.':(e?.message||'تعذر تغيير كلمة المرور');
          passwordMessage(message,true);
          K.notify(message);
        }finally{
          clearTimeout(timer);
          resetBtn.dataset.busy='0';
          resetBtn.disabled=false;
          resetBtn.removeAttribute('aria-busy');
          resetBtn.textContent=idleText;
        }
      };
      $('v23CreditWallet').onclick=async()=>{try{await K.api('/api/wallet/topup',{method:'POST',body:JSON.stringify({clientId:clientKey,amount:Number($('v23AdminCredit').value||0),note:'Admin direct credit'})});K.notify('تم شحن المحفظة')}catch(e){K.notify(e.message)}};
      $('v23SaveOrderFee').onclick=async()=>{try{const fee=Number($('v23OrderFee').value);if(!Number.isFinite(fee)||fee<0)throw new Error('اكتب رسوم إدارة صحيحة');await K.api(`/api/admin/clients/${encodeURIComponent(clientKey)}/billing`,{method:'PATCH',body:JSON.stringify({baseOrderFee:fee})});K.notify(`تم حفظ رسوم الإدارة: ${fee} جنيه لكل أوردر`)}catch(e){K.notify(e.message)}};
      $('v23SaveClientNote').onclick=async()=>{try{await K.api(`/api/admin/clients/${encodeURIComponent(clientKey)}/notes`,{method:'POST',body:JSON.stringify({body:$('v23AdminNote').value.trim()})});K.notify('تم حفظ الملاحظة')}catch(e){K.notify(e.message)}};
    })();
    K._v23ClientAdminPending={anchor,clientKey,promise:task};
    try{return await task}
    finally{if(K._v23ClientAdminPending?.promise===task)delete K._v23ClientAdminPending}
  };
  document.addEventListener('click',e=>{const c=e.target.closest?.('.v27ClientOpen[data-id]');if(c){setTimeout(()=>K.enhanceClientDrawer(c.dataset.id),30);return}if(e.target.closest?.('.nav button[data-view="admin-clients"]'))setTimeout(K.enhanceAdminPage,100)},true);
  const observer=new MutationObserver(()=>{if(document.querySelector('.nav button.active[data-view="admin-clients"]'))setTimeout(K.enhanceAdminPage,30)});observer.observe(document.body,{subtree:true,childList:true});setTimeout(K.enhanceAdminPage,100);
})();

// Admin v74 is additive: v23 keeps account lifecycle controls while v74 owns the command-center overview and per-client brief workspace.
{
  const id='kunAdminClientCommandV74Loader';
  if(!document.getElementById(id)){
    const script=document.createElement('script');script.id=id;script.src='/v2/modules-v74-admin-client-command-center.js?v=74.0';script.async=false;document.head.appendChild(script);
  }
}
