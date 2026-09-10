/* Kun Online v84.3 — complete J&T Egypt Create Order sender + business setup + Bill Code guidance. */
(function(){
  function field(label,secret,{required=true,type='text',placeholder='اتركه فارغًا للاحتفاظ بالقيمة الحالية'}={}){const req=required?' <span class="meta">مطلوب لإنشاء الشحنة</span>':' <span class="meta">اختياري</span>';return `<label>${label}${req}<input class="input intSecret" type="${type}" autocomplete="new-password" data-secret="${secret}" aria-label="${label}" placeholder="${placeholder}"></label>`;}
  function markBusinessRequired(input,label){if(!input)return;input.dataset.jtCreateRequired='1';const meta=input.closest('label')?.querySelector('.meta');if(meta)meta.textContent='مطلوب لإنشاء البوليصة';input.placeholder=label==='Customer Code'?'Customer Code / Merchant Code الذي أصدرته J&T':'Customer Password / API Password من J&T — ليست Private Key';}
  function enhance(panel){if(!panel||!panel.textContent.includes('J&T Express Egypt'))return;const grid=panel.querySelector('.form-grid');if(!grid)return;
    markBusinessRequired(grid.querySelector('[data-secret="customer_code"]'),'Customer Code');markBusinessRequired(grid.querySelector('[data-secret="customer_password"]'),'Customer Password');
    if(grid.querySelector('[data-jt84-sender]'))return;
    const box=document.createElement('div');box.dataset.jt84Sender='1';box.style.display='contents';box.innerHTML=`<div class="insight info v5-wide"><b>بيانات J&T المطلوبة لإنشاء البوليصة</b><div>Developer Info: API Account + Private Key + Source Code. Create Order يحتاج فوقهم Business Info: Customer Code / Merchant Code + Customer Password / API Password، بالإضافة إلى بيانات الراسل التالية. لا تستخدم Private Key بدل Customer Password.</div></div>${field('اسم الراسل','sender_name')}${field('رقم موبايل الراسل','sender_mobile')}${field('هاتف إضافي للراسل','sender_phone',{required:false})}${field('شركة / اسم تجاري','sender_company',{required:false})}${field('محافظة الراسل','sender_prov')}${field('مدينة / حي الراسل','sender_city')}${field('منطقة الراسل','sender_area')}${field('عنوان / شارع الراسل','sender_street')}<div class="insight info v5-wide"><b>رقم البوليصة</b><div>J&T تسميه في الـAPI <b>Bill Code</b>. داخل Kun Online بنعرضه أيضًا باسم «رقم البوليصة / AWB» لأنه هو رقم التتبع الذي يرجع بعد نجاح Create Order.</div></div>`;grid.appendChild(box);
  }
  function scan(){enhance(document.getElementById('intSetupPanel'));}
  function boot(){new MutationObserver(()=>queueMicrotask(scan)).observe(document.body,{childList:true,subtree:true});scan();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
  window.KunJtCreateSetupV84={scan,version:'84.3'};
})();
