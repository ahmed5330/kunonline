/* Kun Online v121 — Production dashboard sync guard. No secrets or tenant identifiers are rendered. */
(()=>{
  if(window.KunDashboardSyncGuardV121)return;
  const STYLE_ID='kunDashSyncGuardStyle',BOX_ID='kunDashSyncGuard';
  let pending=false,lastCheck=0,cached=null;
  function style(){
    if(document.getElementById(STYLE_ID))return;
    const s=document.createElement('style');s.id=STYLE_ID;s.textContent=`
      #${BOX_ID}{margin:12px 0;padding:12px 14px;border:1px solid #f59e0b55;border-radius:14px;background:#fffbeb;color:#7c2d12;display:flex;gap:12px;align-items:center;flex-wrap:wrap;font-family:Cairo,Tajawal,sans-serif}
      #${BOX_ID} .kdsg-copy{flex:1;min-width:260px}#${BOX_ID} strong{display:block;margin-bottom:3px;color:#9a3412}#${BOX_ID} p{margin:0;font-size:12px;line-height:1.8;color:#92400e}
      #${BOX_ID} .kdsg-actions{display:flex;gap:7px;flex-wrap:wrap}#${BOX_ID} button{border:1px solid #f59e0b;background:#fff;border-radius:10px;padding:8px 11px;font-family:inherit;font-weight:700;cursor:pointer;color:#92400e}#${BOX_ID} button.primary{background:#92400e;color:#fff;border-color:#92400e}
      #${BOX_ID}.info{border-color:#60a5fa55;background:#eff6ff;color:#1e3a8a}#${BOX_ID}.info strong,#${BOX_ID}.info p{color:#1e40af}#${BOX_ID}.info button{border-color:#93c5fd;color:#1e40af}
    `;document.head.appendChild(s);
  }
  function dashboardActive(){return document.querySelector('.nav button.active')?.dataset.view==='dashboard'&&document.querySelector('#root .v33-dashboard');}
  async function health(force=false){
    const now=Date.now();if(!force&&cached&&now-lastCheck<30000)return cached;
    lastCheck=now;cached=null;
    try{const r=await fetch(`/health/easyorders-sync?_=${now}`,{credentials:'include',cache:'no-store'});const data=await r.json().catch(()=>null);if(!r.ok&&data?.status!=='unavailable')return null;cached=data;return cached;}catch{return null;}
  }
  function openView(view){const b=document.querySelector(`.nav button[data-view="${view}"]`);if(b)b.click();}
  function currentScopeNote(){const s=document.getElementById('storeBtn');return !s||s.value?'':' العرض الحالي على «كل الفروع»؛ عند مقارنة Preview وProduction اختر نفس الفرع في الاثنين.';}
  function box(kind){
    if(kind==='invalid')return `<div id="${BOX_ID}"><div class="kdsg-copy"><strong>تعذر مزامنة بعض اتصالات Easy Orders — الأرقام قد تكون ناقصة</strong><p>Easy Orders يرفض بيانات الوصول لأحد الاتصالات في مصدر البيانات المستخدم حاليًا. افتح مركز التكاملات وأعد ربط Easy Orders بمفتاح Public API صالح. لا ترسل المفتاح في الشات؛ أدخله داخل النظام فقط.${currentScopeNote()}</p></div><div class="kdsg-actions"><button class="primary" data-kdsg="integrations">فتح مركز التكاملات</button><button data-kdsg="orders">فتح الطلبات</button></div></div>`;
    if(kind==='unreadable')return `<div id="${BOX_ID}"><div class="kdsg-copy"><strong>تعذر قراءة بيانات ربط Easy Orders</strong><p>تعذر قراءة بيانات أحد اتصالات Easy Orders في مصدر البيانات المستخدم حاليًا. أعد حفظ API Key من مركز التكاملات ثم شغّل إصلاح المزامنة من الطلبات.${currentScopeNote()}</p></div><div class="kdsg-actions"><button class="primary" data-kdsg="integrations">فتح مركز التكاملات</button></div></div>`;
    if(kind==='unavailable')return `<div id="${BOX_ID}" class="info"><div class="kdsg-copy"><strong>تعذر التحقق من حالة Easy Orders الآن</strong><p>حالة المزامنة غير مؤكدة مؤقتًا. حاول تحديث الصفحة لاحقًا؛ لا تحتاج لإعادة إدخال المفتاح بسبب هذا الفحص.</p></div></div>`;
    if(kind==='disconnected')return `<div id="${BOX_ID}"><div class="kdsg-copy"><strong>لا يوجد اتصال Easy Orders متصل في مصدر البيانات الحالي</strong><p>راجع حالة الربط في مركز التكاملات.</p></div><div class="kdsg-actions"><button data-kdsg="integrations">فتح مركز التكاملات</button></div></div>`;
    if(kind==='rate_limited')return `<div id="${BOX_ID}" class="info"><div class="kdsg-copy"><strong>تأخير مؤقت في مزامنة Easy Orders</strong><p>تم الوصول إلى حد الطلبات لدى Easy Orders. ستعاود المزامنة المحاولة تلقائيًا.</p></div></div>`;
    if(kind==='error')return `<div id="${BOX_ID}"><div class="kdsg-copy"><strong>توجد مشكلة في مزامنة بعض اتصالات Easy Orders</strong><p>راجع تفاصيل المزامنة في الطلبات ومركز التكاملات؛ الأرقام قد تكون غير مكتملة.</p></div><div class="kdsg-actions"><button data-kdsg="orders">فتح الطلبات</button></div></div>`;
    if(kind==='scope')return `<div id="${BOX_ID}" class="info"><div class="kdsg-copy"><strong>ملاحظة عند مقارنة Preview وProduction</strong><p>هذه الصفحة تعرض «كل الفروع». للمقارنة الدقيقة اختر نفس الفرع ونفس الفترة في الرابطين.</p></div></div>`;
    return '';
  }
  function bind(el){el?.querySelector('[data-kdsg="integrations"]')?.addEventListener('click',()=>openView('integrations'));el?.querySelector('[data-kdsg="orders"]')?.addEventListener('click',()=>openView('orders'));}
  async function render(force=false){
    if(pending||!dashboardActive())return;pending=true;
    try{
      const root=document.getElementById('root'),hero=root?.querySelector('.v33-dashboard .dash-hero');if(!root||!hero)return;
      const d=await health(force);if(!dashboardActive())return;
      let kind='';const diag=d?.runtimeDiagnostics||{};
      // Production's legacy diagnostics cannot describe the Preview-backed app.
      if(!d||d.source!=='preview'||d.ok!==true)kind='unavailable';
      else if(diag.failureCode==='EASYORDERS_API_KEY_INVALID')kind='invalid';
      else if(diag.failureCode==='EASYORDERS_API_KEY_UNREADABLE')kind='unreadable';
      else if(diag.failureCode==='EASYORDERS_NOT_CONNECTED')kind='disconnected';
      else if(diag.failureCode==='EASYORDERS_RATE_LIMITED')kind='rate_limited';
      else if(diag.failureCode||Number(d.canonical?.errorConnections)>0)kind='error';
      else if(document.getElementById('storeBtn')?.value==='')kind='scope';
      document.getElementById(BOX_ID)?.remove();if(!kind)return;
      hero.insertAdjacentHTML('afterend',box(kind));bind(document.getElementById(BOX_ID));
    }finally{pending=false;}
  }
  function hook(){style();const root=document.getElementById('root');if(root){new MutationObserver(()=>{if(dashboardActive()&&!document.getElementById(BOX_ID))setTimeout(()=>render(false),0);}).observe(root,{childList:true,subtree:false});}document.addEventListener('click',e=>{const b=e.target.closest?.('.nav button');if(b?.dataset.view==='dashboard')setTimeout(()=>render(true),350);});setTimeout(()=>render(true),500);}
  window.KunDashboardSyncGuardV121={version:'121.1',refresh:()=>render(true)};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',hook);else hook();
})();
