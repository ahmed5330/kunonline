/* Kun Online v84.2 — complete J&T Egypt Create Order sender setup + optional Enterprise credentials + Bill Code. */
(function(){
  function field(label,secret,{required=true,type='text',placeholder='اتركه فارغًا للاحتفاظ بالقيمة الحالية'}={}){const req=required?' <span class="meta">مطلوب لإنشاء الشحنة</span>':' <span class="meta">اختياري</span>';return `<label>${label}${req}<input class="input intSecret" type="${type}" autocomplete="new-password" data-secret="${secret}" aria-label="${label}" placeholder="${placeholder}"></label>`;}
  function markBusinessOptional(input,label){if(!input)return;delete input.dataset.jt84Required;const meta=input.closest('label')?.querySelector('.meta');if(meta)meta.textContent='اختياري — فقط إذا J&T طلبته لحسابك';input.placeholder=`${label} من J&T — اتركه فارغًا إن لم تستلمه`;
  }
  function enhance(panel){if(!panel||!panel.textContent.includes('J&T Express Egypt'))return;const grid=panel.querySelector('.form-grid');if(!grid)return;
    markBusinessOptional(grid.querySelector('[data-secret="customer_code"]'),'Customer Code');markBusinessOptional(grid.querySelector('[data-secret="customer_password"]'),'Customer Password');
    if(grid.querySelector('[data-jt84-sender]'))return;
    const box=document.createElement('div');box.dataset.jt84Sender='1';box.style.display='contents';box.innerHTML=`<div class="insight info v5-wide"><b>بيانات J&T المطلوبة لإنشاء البوليصة</b><div>الأساسي في J&T Egypt Create Order هو API Account وPrivate Key وSource Code مع بيانات الراسل. Customer Code وCustomer Password بيانات Enterprise اختيارية، والسيرفر يضيفهما تلقائيًا فقط إذا رد J&T بأن حسابك يحتاجهما.</div></div>${field('اسم الراسل','sender_name')}${field('رقم موبايل الراسل','sender_mobile')}${field('هاتف إضافي للراسل','sender_phone',{required:false})}${field('شركة / اسم تجاري','sender_company',{required:false})}${field('محافظة الراسل','sender_prov')}${field('مدينة / حي الراسل','sender_city')}${field('منطقة الراسل','sender_area')}${field('عنوان / شارع الراسل','sender_street')}<div class="insight info v5-wide"><b>Customer Code / Customer Password</b><div>اختياريان. اتركهما فارغين ما لم تكن J&T قد سلّمتك القيمتين لحساب Enterprise. عدم وجودهما لا يمنع محاولة إنشاء الشحنة بالـDeveloper Info الأساسي.</div></div><div class="insight info v5-wide"><b>رقم البوليصة</b><div>J&T تسميه في الـAPI <b>Bill Code</b>. داخل Kun Online بنعرضه أيضًا باسم «رقم البوليصة / AWB» لأنه هو رقم التتبع الذي يرجع بعد نجاح Create Order.</div></div>`;grid.appendChild(box);
  }
  function scan(){enhance(document.getElementById('intSetupPanel'));}
  function boot(){new MutationObserver(()=>queueMicrotask(scan)).observe(document.body,{childList:true,subtree:true});scan();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
  window.KunJtCreateSetupV84={scan,version:'84.2'};
})();
