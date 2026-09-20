/* Kun Online v107.0 — system-driven Android app update control. */
(function(){
  'use strict';
  if(window.KunMobileAppUpdateV107)return;
  const button=()=>document.getElementById('androidDownload');
  async function metadata(){
    const response=await fetch('/api/mobile/app-update',{credentials:'same-origin',cache:'no-store'});
    const data=await response.json().catch(()=>({}));
    if(!response.ok||!data?.apkUrl)throw new Error(data?.error||`HTTP ${response.status}`);
    return data;
  }
  function apply(data){
    const link=button();if(!link)return;
    link.href=data.apkUrl;
    link.dataset.versionCode=String(data.versionCode||'');
    link.dataset.versionName=String(data.versionName||'');
    link.title=`تحديث تطبيق Kun Online للأندرويد إلى ${data.versionName||'أحدث إصدار'}`;
    link.setAttribute('aria-label',link.title);
    const label=link.querySelector('span');if(label)label.textContent=`Android ${data.versionName||''}`.trim();
    if(link.dataset.kunUpdaterBound==='1')return;
    link.dataset.kunUpdaterBound='1';
    link.addEventListener('click',event=>{
      if(window.KunNative&&typeof window.KunNative.requestAppUpdate==='function'){
        event.preventDefault();
        window.KunNative.requestAppUpdate();
      }
    });
  }
  async function refresh(){try{apply(await metadata());}catch(error){console.warn('Android update metadata failed',error);}}
  window.KunMobileAppUpdateV107={version:'107.0',refresh,metadata};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',refresh,{once:true});else refresh();
  document.documentElement.dataset.mobileAppUpdate='v107-ready';
})();
