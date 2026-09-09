/* Kun Online v84.0 — complete J&T Egypt Create Order sender setup and clarify optional Enterprise Info + Bill Code. */
(function(){
  function field(label,secret,{required=true,type='text',placeholder='اتركه فارغًا للاحتفاظ بالقيمة الحالية'}={}){const req=required?' <span class="meta">مطلوب لإنشاء الشحنة</span>':' <span class="meta">اختياري</span>';return `<label>${label}${req}<input class="input intSecret" type="${type}" autocomplete="new-password" data-secret="${secret}" aria-label="${label}" placeholder="${placeholder}"></label>`;}
  function markOptional(input){if(!input)return;input.dataset.jt84Required='0';const meta=input.closest('label')?.querySelector('.meta');if(meta)meta.textContent='اختياري — Enterprise Info';input.placeholder='اتركه فارغًا إلا إذا طلبه حساب J&T';}
  function enhance(panel){if(!panel||!panel.textContent.includes('J&T Express Egypt'))return;const grid=panel.querySelector('.form-grid');if(!grid)return;
    markOptional(grid.querySelector('[data-secret="customer_code"]'));markOptional(grid.querySelector('[data-secret="customer_password"]'));
    if(grid.querySelector('[data-jt84-sender]'))return;
    const box=document.createElement('div');box.dataset.jt84Sender='1';box.style.display='contents';box.innerHTML=`<div class="insight info v5-wide"><b>بيانات الراسل المطلوبة لـ J&T Create Order</b><div>دي بيانات شركتك/المخزن اللي J&T يستلم منه الشحنات، وليست بيانات العميل. اختبار الاتصال الحقيقي أكد إن J&T ترفض Create Order لو البيانات دي ناقصة. تُحفظ مرة واحدة داخل إعداد J&T وتُرسل تلقائيًا مع كل بوليصة.</div></div>${field('اسم الراسل','sender_name')}${field('رقم موبايل الراسل','sender_mobile')}${field('هاتف إضافي للراسل','sender_phone',{required:false})}${field('شركة / اسم تجاري','sender_company',{required:false})}${field('محافظة الراسل','sender_prov')}${field('مدينة / حي الراسل','sender_city')}${field('منطقة الراسل','sender_area')}${field('عنوان / شارع الراسل','sender_street')}<div class="insight info v5-wide"><b>Enterprise Info</b><div>Customer Code وCustomer Password يظلوا اختياريين. لا تضفهم إلا لو حساب J&T نفسه طلبهم في رد Create Order.</div></div><div class="insight info v5-wide"><b>رقم البوليصة</b><div>J&T تسميه في الـAPI <b>Bill Code</b>. داخل Kun Online بنعرضه أيضًا باسم «رقم البوليصة / AWB» لأنه هو رقم التتبع الذي يرجع بعد نجاح Create Order.</div></div>`;grid.appendChild(box);
  }
  function scan(){enhance(document.getElementById('intSetupPanel'));}
  function boot(){new MutationObserver(()=>queueMicrotask(scan)).observe(document.body,{childList:true,subtree:true});scan();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
  window.KunJtCreateSetupV84={scan,version:'84.0'};
})();
