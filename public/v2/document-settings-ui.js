import {DOCUMENT_TEMPLATES,defaultDocumentSettings,normalizeDocumentSettings,selectDocumentProfile} from './document-print-model.js?v=1.0';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function current(){return {clientId:String(await window.kunClientId?.()||''),storeId:String(await window.kunStoreId?.()||'')};}
async function api(scope,suffix='',options={}){
  const now=await current();if(now.clientId!==scope.clientId||(now.storeId&&now.storeId!==scope.storeId))throw new Error('تغير المتجر؛ افتح المستند من جديد');
  const u=new URL('/api/document-settings'+suffix,location.origin);u.searchParams.set('clientId',scope.clientId);u.searchParams.set('storeId',scope.storeId);
  const r=await fetch(u.pathname+u.search,{credentials:'include',...options,headers:options.body?{'Content-Type':'application/json'}:{}}),data=await r.json();
  if(!r.ok)throw new Error(data.error||'تعذر تحميل إعدادات المستند');return data;
}
function modal(title){
  const previous=document.activeElement,cover=document.createElement('div');cover.style.cssText='position:fixed;inset:0;z-index:10002;background:#0008;display:flex;align-items:center;justify-content:center;padding:12px';
  cover.style.zIndex=String(10000+document.querySelectorAll('[role=dialog]').length*10);
  cover.innerHTML='<section role="dialog" aria-modal="true" aria-labelledby="docSettingsTitle" style="direction:rtl;background:white;color:#172b3a;padding:18px;border-radius:14px;width:1000px;max-width:100%;max-height:94vh;overflow:auto"><h2 id="docSettingsTitle">'+esc(title)+'</h2><button type="button" data-close>إغلاق</button><div data-content></div></section>';
  const close=()=>{document.removeEventListener('keydown',key,true);cover.remove();if(previous?.isConnected)previous.focus();};
  const key=e=>{if([...document.querySelectorAll('[role=dialog]')].at(-1)!==cover.querySelector('section'))return;if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();close();}if(e.key==='Tab'){const nodes=[...cover.querySelectorAll('button,input,select,textarea')].filter(n=>!n.disabled&&n.getClientRects().length);if(!nodes.length)return;const first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}};
  cover.querySelector('[data-close]').onclick=close;cover.onclick=e=>{if(e.target===cover)close();};document.body.appendChild(cover);document.addEventListener('keydown',key,true);cover.querySelector('[data-close]').focus();return {cover,body:cover.querySelector('[data-content]'),close};
}
const templateOptions=value=>DOCUMENT_TEMPLATES.map(t=>'<option value="'+t.id+'" '+(t.id===value?'selected':'')+'>'+esc(t.name)+'</option>').join('');
const sizeOptions=value=>[['A4','A4'],['A5','A5'],['receipt','80 مم']].map(([id,name])=>'<option value="'+id+'" '+(id===value?'selected':'')+'>'+name+'</option>').join('');
async function openSettings(){
  const scope=await current();if(!scope.clientId||!scope.storeId){window.showToast?.('اختار متجرًا محددًا لإعداد المستندات');return;}
  const dialog=modal('إعدادات مستندات العميل');dialog.body.textContent='جارٍ التحميل...';
  let response;
  try{response=await api(scope);}catch(e){dialog.body.textContent=e.message;return;}
  if(!dialog.cover.isConnected)return;
  let config=normalizeDocumentSettings(response.config),revision=response.revision,tab='brand',saving=false;
  const brandInput=(name,label,type='text')=>'<label style="display:grid;gap:4px">'+label+'<input data-brand="'+name+'" type="'+type+'" value="'+esc(config.brand[name])+'"></label>';
  function collect(){
    if(tab==='brand')dialog.body.querySelectorAll('[data-brand]').forEach(el=>config.brand[el.dataset.brand]=el.value);
    if(tab==='profiles'){
      config.profiles=[...dialog.body.querySelectorAll('[data-profile-row]')].map(row=>Object.fromEntries([...row.querySelectorAll('[data-profile]')].map(el=>[el.dataset.profile,el.value])));
      config.defaultProfile=dialog.body.querySelector('[data-default-profile]').value;
    }
    if(tab==='rules')config.rules=[...dialog.body.querySelectorAll('[data-rule-row]')].map(row=>Object.fromEntries([...row.querySelectorAll('[data-rule]')].map(el=>[el.dataset.rule,el.type==='checkbox'?el.checked:['minTotal','maxTotal'].includes(el.dataset.rule)?el.value===''?null:Number(el.value):el.value])));
  }
  function render(){
    dialog.body.innerHTML='<p>إعدادات خاصة بهذا المتجر. المستندات لا تغيّر الطلب أو القيود أو الشحن.</p><p data-save-policy>'+(!response.storageReady?'التخزين غير مفعل بعد؛ يمكنك تجربة التصميم دون حفظ.':!response.writeEnabled?'الحفظ مغلق في هذه البيئة؛ المعاينة متاحة.':'الحفظ متاح في البيئة المعزولة.')+'</p><div style="display:flex;gap:8px;flex-wrap:wrap">'+[['brand','الهوية التجارية'],['profiles','ملفات الطباعة'],['rules','القواعد الذكية'],['carrier','قوالب شركات الشحن']].map(([id,label])=>'<button type="button" data-tab="'+id+'" aria-pressed="'+(id===tab)+'">'+label+'</button>').join('')+'</div><div data-panel style="margin-block:16px;display:grid;gap:12px"></div><div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" data-preview>معاينة التعديلات</button><button type="button" data-save '+(!response.writeEnabled||saving?'disabled':'')+'>حفظ إعدادات المتجر</button></div><p role="status" data-feedback></p>';
    const panel=dialog.body.querySelector('[data-panel]'),feedback=dialog.body.querySelector('[data-feedback]');
    if(tab==='brand'){
      panel.innerHTML=brandInput('name','اسم النشاط')+brandInput('address','عنوان النشاط')+brandInput('phone','هاتف النشاط')+brandInput('color','لون الهوية','color')+brandInput('footer','نص ختامي')+'<label>شعار PNG أو JPEG (حتى 130 كيلوبايت)<input type="file" accept="image/png,image/jpeg" data-logo></label><button type="button" data-remove-logo>إزالة الشعار</button><span data-logo-state>'+ (config.brand.logo?'شعار مرفق':'لا يوجد شعار')+'</span>';
      panel.querySelector('[data-logo]').onchange=async e=>{const file=e.target.files[0];if(!file)return;if(!['image/png','image/jpeg'].includes(file.type)||file.size>130000){feedback.textContent='اختر صورة PNG أو JPEG حتى 130 كيلوبايت';return;}const reader=new FileReader();reader.onload=()=>{if(dialog.cover.isConnected){config.brand.logo=String(reader.result);panel.querySelector('[data-logo-state]')?.replaceChildren('شعار مرفق');}};reader.readAsDataURL(file);};
      panel.querySelector('[data-remove-logo]').onclick=()=>{config.brand.logo='';panel.querySelector('[data-logo-state]').textContent='لا يوجد شعار';};
    }
    if(tab==='profiles'){
      panel.innerHTML='<label>الملف الأساسي<select data-default-profile>'+config.profiles.map(p=>'<option value="'+esc(p.id)+'" '+(p.id===config.defaultProfile?'selected':'')+'>'+esc(p.name)+'</option>').join('')+'</select></label>'+config.profiles.map(p=>'<fieldset data-profile-row><legend>ملف طباعة</legend><input data-profile="id" value="'+esc(p.id)+'" type="hidden"><label>اسم الملف<input data-profile="name" maxlength="80" value="'+esc(p.name)+'"></label><label>المقاس<select data-profile="size">'+sizeOptions(p.size)+'</select></label><label>القالب<select data-profile="template">'+templateOptions(p.template)+'</select></label><button type="button" data-remove-profile="'+esc(p.id)+'">حذف الملف</button></fieldset>').join('')+'<button type="button" data-add-profile>إضافة ملف طباعة</button><p>11 تصميمًا أصليًا لكن؛ تغيير ملف الطباعة لا يغيّر أي بوليصة.</p>';
      panel.querySelector('[data-add-profile]').onclick=()=>{collect();if(config.profiles.length>=20)return;config.profiles.push({id:crypto.randomUUID(),name:'ملف جديد',size:'A4',template:'classic'});render();};
      panel.querySelectorAll('[data-remove-profile]').forEach(b=>b.onclick=()=>{collect();const id=b.dataset.removeProfile;if(config.profiles.length<=1||id===config.defaultProfile||config.rules.some(r=>r.profileId===id)){feedback.textContent='لا تحذف الملف الأساسي أو ملفًا مستخدمًا في قاعدة';return;}config.profiles=config.profiles.filter(p=>p.id!==id);render();});
    }
    if(tab==='rules'){
      panel.innerHTML='<p>تُطبق أول قاعدة مفعلة مطابقة بالترتيب. عند عدم التطابق يُستخدم الملف الأساسي.</p>'+config.rules.map((r,index)=>'<fieldset data-rule-row><legend>قاعدة '+(index+1)+'</legend><label>مفعلة<input type="checkbox" data-rule="enabled" '+(r.enabled?'checked':'')+'></label><label>حالة الطلب<select data-rule="state">'+['','pending','confirmed','preparing','shipped','signed','collected','returned','cancelled','deferred','no_answer'].map(s=>'<option value="'+s+'" '+(r.state===s?'selected':'')+'>'+({'':'أي حالة',pending:'جديد',confirmed:'مؤكد',preparing:'قيد التجهيز',shipped:'جاري الشحن',signed:'مسلم',collected:'محصل',returned:'مرتجع',cancelled:'ملغي',deferred:'مؤجل',no_answer:'لا يرد'}[s])+'</option>').join('')+'</select></label><label>أقل مبلغ<input type="number" min="0" step="0.01" data-rule="minTotal" value="'+(r.minTotal??'')+'"></label><label>أقصى مبلغ<input type="number" min="0" step="0.01" data-rule="maxTotal" value="'+(r.maxTotal??'')+'"></label><label>ملف الطباعة<select data-rule="profileId">'+config.profiles.map(p=>'<option value="'+esc(p.id)+'" '+(p.id===r.profileId?'selected':'')+'>'+esc(p.name)+'</option>').join('')+'</select></label><button type="button" data-rule-up="'+index+'">تقديم القاعدة</button><button type="button" data-remove-rule="'+index+'">حذف القاعدة</button></fieldset>').join('')+'<button type="button" data-add-rule>إضافة قاعدة</button>';
      panel.querySelector('[data-add-rule]').onclick=()=>{collect();if(config.rules.length>=30)return;config.rules.push({enabled:false,state:'confirmed',minTotal:null,maxTotal:null,profileId:config.defaultProfile});render();};
      panel.querySelectorAll('[data-remove-rule]').forEach(b=>b.onclick=()=>{collect();config.rules.splice(Number(b.dataset.removeRule),1);render();});
      panel.querySelectorAll('[data-rule-up]').forEach(b=>b.onclick=()=>{collect();const i=Number(b.dataset.ruleUp);if(i>0)[config.rules[i-1],config.rules[i]]=[config.rules[i],config.rules[i-1]];render();});
    }
    if(tab==='carrier')panel.innerHTML='<h3>J&amp;T — البوليصة الرسمية</h3><p>تُطلب بوليصة الناقل من مسار الشحن الحالي فقط. قوالب مستند العميل لا تستبدل البوليصة الرسمية ولا تُنشئ AWB. شركات الشحن الأخرى غير مفعلة هنا.</p>';
    dialog.body.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{collect();tab=b.dataset.tab;render();});
    dialog.body.querySelector('[data-preview]').onclick=()=>{try{collect();const settings=normalizeDocumentSettings(config),order={id:'DEMO',ref:'معاينة فقط',storeName:settings.brand.name,name:'عميل توضيحي',product:'منتج توضيحي',qty:1,total:100,state:'confirmed'};window.KunOrderDocumentPreview.open(order,{settings,profile:selectDocumentProfile(settings,order)});}catch(e){feedback.textContent=e.message;}};
    dialog.body.querySelector('[data-save]').onclick=async()=>{
      if(saving||!response.writeEnabled)return;let normalized;try{collect();normalized=normalizeDocumentSettings(config);}catch(e){feedback.textContent=e.message;return;}
      saving=true;dialog.body.querySelector('[data-save]').disabled=true;
      try{const saved=await api(scope,'',{method:'PUT',body:JSON.stringify({config:normalized,revision})});revision=saved.revision;config=saved.config;feedback.textContent='تم حفظ إعدادات هذا المتجر';}catch(e){feedback.textContent=e.message;}finally{saving=false;if(dialog.cover.isConnected)dialog.body.querySelector('[data-save]').disabled=!response.writeEnabled;}
    };
  }
  render();
}
async function openOrder(order){
  const scope={clientId:String(order.clientId||''),storeId:String(order.storeId||'')};
  try{
    const response=await api(scope),settings=normalizeDocumentSettings(response.config),profile=selectDocumentProfile(settings,order);
    window.KunOrderDocumentPreview.open(order,{settings,profile,onPrintRequested:response.printEventsWriteEnabled?async(template,size)=>api(scope,'/print-events',{method:'POST',body:JSON.stringify({id:crypto.randomUUID(),orderId:order.id,template,size})}):null,onHistory:async()=>{
      const d=modal('سجل طلبات الطباعة');try{const data=await api(scope,'/print-events?orderId='+encodeURIComponent(order.id));d.body.innerHTML='<p>السجل يثبت طلب فتح الطباعة، ولا يثبت خروج ورقة أو حفظ PDF. الإلغاء من نافذة الطابعة لا يمكن اكتشافه هنا.</p>'+(data.events?.length?'<table><thead><tr><th>الوقت</th><th>القالب</th><th>المقاس</th><th>المستخدم</th></tr></thead><tbody>'+data.events.map(e=>'<tr><td>'+esc(e.created_at)+'</td><td>'+esc(e.template_id)+'</td><td>'+esc(e.paper_size)+'</td><td>'+esc(e.actor)+'</td></tr>').join('')+'</tbody></table>':'<p>لا توجد طلبات طباعة مسجلة.</p>');}catch(e){d.body.textContent=e.message;}
    }});
  }catch(e){window.showToast?.(e.message);}
}
function mount(){const head=document.querySelector('.print79-head');if(!head||head.querySelector('[data-document-settings]'))return;const b=document.createElement('button');b.type='button';b.className='btn soft';b.dataset.documentSettings='1';b.textContent='إعدادات مستندات العميل';b.onclick=openSettings;head.appendChild(b);}
new MutationObserver(mount).observe(document.body,{childList:true,subtree:true});mount();
window.KunDocumentSettings={templates:DOCUMENT_TEMPLATES,openSettings,openOrder,defaultDocumentSettings};
