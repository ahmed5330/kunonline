/* AI providers in Integrations: credentials never returned by the API or stored in browser storage. */
(function(){
 if(window.KunAiIntegrationsV160)return;
 const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]));
 const STATE={selectedStore:'',clientId:'',rows:null,loading:false};
 const message=(node,text,type='info')=>{if(node){node.textContent=String(text||'');node.dataset.kind=type;}};
 async function api(path,options={}){
   const response=await fetch(path,{...options,credentials:'include',headers:{'Content-Type':'application/json',...(options.headers||{})},cache:'no-store'});
   const data=await response.json().catch(()=>({}));
   if(!response.ok){const err=new Error(data.error||'تعذر تنفيذ طلب الربط');err.code=data.code||'';throw err;}
   return data;
 }
 const status=s=>s==='connected'?'تم التحقق من الاتصال':s==='configured'?'محفوظ — يحتاج تحقق':'غير متصل';
 const apiPath=()=>'/api/integrations/ai?clientId='+encodeURIComponent(STATE.clientId);
 const nodeFor=(section,provider)=>[...section.querySelectorAll('[data-ai-provider]')].find(x=>x.dataset.aiProvider===provider);
 function layout(section){
   const response=STATE.rows,stores=response?.stores||[],selected=STATE.selectedStore;
   if(!stores.length){section.innerHTML='<div class="card">لا توجد متاجر متاحة لهذا الحساب. اختر متجرًا تملك صلاحية إدارته.</div>';return;}
   const current=response.connections||[];
   section.innerHTML='<header class="ai-intro"><div><h3>تكاملات الذكاء الاصطناعي</h3><p>اربط مفتاح API منفصلًا لكل متجر. التحقق الحقيقي يقرأ النماذج المتاحة فقط ولا يولد محتوى أو يخصم توكنز.</p></div><label>اختر المتجر<select class="input" id="kunAiStore" aria-label="اختر المتجر">'+
   stores.map(store=>'<option value="'+escape(store.id)+'"'+(store.id===selected?' selected':'')+'>'+escape(store.name)+'</option>').join('')+
   '</select></label></header><div class="ai-provider-grid">'+(response.providers||[]).map(provider=>{
     const item=current.find(c=>c.provider===provider.id&&c.storeId===selected);
     const hint=item?.lastVerifiedAt?'آخر تحقق: '+item.lastVerifiedAt.slice(0,16).replace('T',' '):'لم يجرِ تحقق حقيقي بعد';
     const preview=Array.isArray(item?.modelsPreview)?item.modelsPreview.join('، '):'';
     return '<article class="ai-provider-card" data-ai-provider="'+escape(provider.id)+'">'+
       '<div class="ai-provider-head"><div><h4>'+escape(provider.name)+'</h4><span class="ai-provider-code">'+escape(provider.id)+'</span></div><span class="ai-provider-status" data-ai-status="'+escape(item?.status||'disconnected')+'">'+escape(status(item?.status))+'</span></div>'+
       '<p class="ai-provider-help">مفتاح API من <a href="'+escape(provider.site)+'" target="_blank" rel="noopener noreferrer">حساب '+escape(provider.name)+'</a> وليس اشتراك الشات العادي.</p>'+
       '<label class="ai-provider-key">API Key <input type="password" autocomplete="new-password" spellcheck="false" class="input" data-ai-key placeholder="'+(item?.hasKey?'مفتاح محفوظ ومشفر — اكتب مفتاحًا جديدًا للتغيير':'الصق مفتاح API هنا')+'"></label>'+
       '<div class="ai-provider-meta">'+escape(hint)+'</div>'+(preview?'<div class="ai-provider-meta">نماذج متاحة (عينة): '+escape(preview)+'</div>':'')+
       '<div class="ai-provider-actions"><button class="btn primary" type="button" data-ai-action="save">'+(item?.hasKey?'تغيير المفتاح واختبار':'حفظ واختبار')+'</button>'+
       '<button class="btn soft" type="button" data-ai-action="test" '+(!item?.hasKey?'disabled':'')+'>إعادة التحقق</button>'+
       (item?'<button class="btn soft ai-remove" type="button" data-ai-action="remove">فصل الربط</button>':'')+'</div>'+
       '<p class="ai-result" data-ai-result role="status" aria-live="polite"></p></article>';
   }).join('')+'</div>';
   section.querySelector('#kunAiStore').onchange=e=>{STATE.selectedStore=e.target.value;layout(section);};
   section.querySelectorAll('[data-ai-action]').forEach(button=>button.onclick=()=>action(section,button));
 }
 async function refresh(section){
   if(STATE.loading)return;
   STATE.loading=true;
   try{
     const data=await api(apiPath());
     if(!section.isConnected)return;
     STATE.rows=data;
     if(!data.stores.some(x=>x.id===STATE.selectedStore))STATE.selectedStore=data.stores[0]?.id||'';
     layout(section);
   }catch(error){if(section.isConnected)section.innerHTML='<div class="card">تعذر عرض تكاملات الذكاء الاصطناعي: '+escape(error.message)+' <button class="btn soft" type="button" id="aiRetry">إعادة المحاولة</button></div>';
     section.querySelector('#aiRetry')?.addEventListener('click',()=>refresh(section));
   }finally{STATE.loading=false;}
 }
 async function action(section,button){
   const card=button.closest('[data-ai-provider]'),provider=card?.dataset.aiProvider,storeId=STATE.selectedStore,kind=button.dataset.aiAction;
   if(!card||!provider||!storeId)return;
   const record=STATE.rows?.connections?.find(row=>row.provider===provider&&row.storeId===storeId),key=card.querySelector('[data-ai-key]'),result=card.querySelector('[data-ai-result]');
   if(kind==='remove'&&!confirm('فصل مفتاح الذكاء الاصطناعي عن هذا المتجر؟ لن يتم حذف بيانات الأوردرات.'))return;
   if(kind==='save'&&!key.value.trim()){message(result,'اكتب مفتاح API أولًا؛ الحقل الفارغ لا يغير المفتاح المحفوظ.','error');return;}
   const buttons=[...card.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);
   message(result,kind==='save'?'جارٍ حفظ المفتاح مشفرًا واختبار الاتصال...':'جارٍ تنفيذ الطلب...','info');
   try{
     let id=record?.id;
     if(kind==='save'){
       const data=await api('/api/integrations/ai/connect',{method:'POST',body:JSON.stringify({clientId:STATE.clientId,storeId,provider,apiKey:key.value})});
       id=data.connectionId;key.value='';
     }
     if(kind==='remove'){
       await api('/api/integrations/ai/connections/'+encodeURIComponent(id),{method:'DELETE',body:JSON.stringify({clientId:STATE.clientId})});
       await refresh(section);return;
     }
     if(!id)throw new Error('احفظ المفتاح أولًا');
     const verify=await api('/api/integrations/ai/connections/'+encodeURIComponent(id)+'/validate',{method:'POST',body:JSON.stringify({clientId:STATE.clientId})});
     await refresh(section);
     const fresh=nodeFor(section,provider);
     message(fresh?.querySelector('[data-ai-result]'),verify.message||'اكتمل الاختبار',verify.ok?'ok':'error');
   }catch(error){message(result,error.message,'error');buttons.forEach(b=>b.disabled=false);}
 }
 async function mount(root){
   if(!root?.querySelector('#intGroups'))return;
   let section=root.querySelector('#kunAiIntegrations');
   if(!section){section=document.createElement('section');section.id='kunAiIntegrations';section.className='kun-ai-integrations';section.innerHTML='<div class="card">جارٍ تحميل مزودي الذكاء الاصطناعي...</div>';root.querySelector('#intGroups').after(section);}
   const clientId=window.kunClientId?String(await window.kunClientId()||''):'';
   if(!section.isConnected)return;
   if(STATE.clientId!==clientId){STATE.clientId=clientId;STATE.selectedStore='';}
   await refresh(section);
 }
 function hook(){
   document.addEventListener('click',e=>{const nav=e.target.closest?.('.nav button[data-view="integrations"]');if(nav)setTimeout(()=>mount(document.getElementById('root')),100);});
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',hook);else hook();
 window.KunAiIntegrationsV160={mount,version:'160.0'};
})();
