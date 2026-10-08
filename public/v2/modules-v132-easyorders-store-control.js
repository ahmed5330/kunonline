/* Kun Online v132 — official Easy Orders control center. */
(function(){
'use strict';
const K=window.KunActionsV23;if(!K)return;
const ROOT='/api/integrations/easyorders/store-control';
const esc=K.esc;
const pages=[['home','الرئيسية'],['products','المنتجات'],['categories','التصنيفات'],['stock','المخزون'],['orders','الطلبات'],['shipping','الشحن'],['other','باقي الأقسام']];
const statuses=['pending','confirmed','pending_payment','paid','paid_failed','processing','waiting_for_pickup','in_delivery','delivered','canceled','returning_from_delivery','request_refund','refund_in_progress','refunded'];
const css='#eoControl{direction:rtl;text-align:right;display:grid;gap:13px;color:var(--ink,#16283d)}#eoControl *{box-sizing:border-box}#eoControl .eoc-card{padding:15px;border:1px solid var(--line,#dce5ee);border-radius:13px;background:var(--card,#fff);margin-bottom:10px}#eoControl .eoc-title{font-size:16px;font-weight:900;margin:0 0 7px}#eoControl .eoc-small{font-size:12px;line-height:1.8;color:var(--muted,#68768a)}#eoControl .eoc-tabs{display:flex;gap:7px;overflow-x:auto;padding-bottom:7px}#eoControl .eoc-tabs button{white-space:nowrap;border:1px solid var(--line,#ddd);border-radius:9px;background:transparent;color:inherit;padding:9px;font:inherit;font-size:12px;cursor:pointer}#eoControl .eoc-tabs button[aria-selected=true]{background:#183e68;color:white}#eoControl .eoc-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}#eoControl label{display:grid;gap:5px;font-size:12px}#eoControl label input,#eoControl label select,#eoControl label textarea{width:100%;min-width:0}#eoControl .eoc-wide{grid-column:1/-1}#eoControl textarea{min-height:85px}#eoControl .eoc-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}#eoControl .eoc-actions .btn{min-height:38px}#eoControl .eoc-note{background:#fff5e7;color:#74521a;border:1px solid #f0d9ac;padding:12px;border-radius:12px;font-size:12px;line-height:1.8}#eoControl .eoc-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 0;border-bottom:1px solid var(--line,#e5eaf0);flex-wrap:wrap}#eoControl .eoc-row strong{font-size:12px}#eoControl .eoc-pill{font-size:11px;background:#e8f5ee;border-radius:22px;padding:5px 9px;color:#21613d}#eoControl .eoc-pill.off{background:#f0f0ee;color:#666}#eoControl .eoc-preview{font:12px/1.7 monospace;white-space:pre-wrap;word-break:break-word;max-height:230px;overflow:auto;direction:ltr;text-align:left;background:#12283d;color:#eaf6ff;padding:12px;border-radius:10px}#eoControl .eoc-ok{background:#e6f8ee;color:#21633d;padding:12px;border-radius:9px}#eoControl .eoc-failed{color:#a93439;padding:10px;font-size:12px}@media(max-width:700px){#eoControl .eoc-fields{grid-template-columns:1fr}#eoControl .eoc-actions .btn{flex:1 1 120px}}';
let scope=null,link=null,state=null,section='home',pending=null,working=false;
function notify(message){K.notify(message);}
function style(){if(document.getElementById('eoControlCss'))return;const t=document.createElement('style');t.id='eoControlCss';t.textContent=css;document.head.appendChild(t);}
function shell(){return document.getElementById('eoControl');}
function body(){return document.getElementById('eoBody');}
async function get(resource,entityId){
 const q=new URLSearchParams({clientId:scope.cid,storeId:scope.sid,resource});
 if(entityId)q.set('entityId',entityId);if(link?.id)q.set('connectionId',link.id);
 return K.api(ROOT+'?'+q);
}
async function save(job){
 const response=await fetch(ROOT,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json','X-Kun-Store-Action':'confirmed'},body:JSON.stringify({clientId:scope.cid,storeId:scope.sid,connectionId:link.id,confirm:'CONFIRM_PUBLISH_EASYORDERS',...job,confirmShippingReplace:job.operation==='shipping.update'})});
 const d=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(d.error||'تعذر النشر في Easy Orders');return d;
}
function input(label,key,kind='text',hint=''){
 if(kind==='textarea')return '<label class="eoc-wide">'+esc(label)+'<textarea class="input" data-eoc-field="'+esc(key)+'" placeholder="'+esc(hint)+'"></textarea></label>';
 return '<label>'+esc(label)+'<input class="input" type="'+esc(kind)+'" data-eoc-field="'+esc(key)+'" placeholder="'+esc(hint)+'"></label>';
}
function form(title,op,fields,info=''){
 return '<section class="eoc-card" data-eoc-form="'+esc(op)+'"><h3 class="eoc-title">'+esc(title)+'</h3>'+(info?'<p class="eoc-small">'+esc(info)+'</p>':'')+
 '<div class="eoc-fields">'+fields+'</div><div class="eoc-actions"><button type="button" class="btn primary" data-eoc-preview="'+esc(op)+'">معاينة قبل النشر</button></div></section>';
}
function summary(){
 const rows=[
 ['المنتجات','قراءة، إنشاء، تعديل، صور وأسعار','products'],['التصنيفات','قراءة، إنشاء، تعديل','categories'],
 ['المخزون','تحديد أرصدة المنتجات والمتغيرات','stock'],['الطلبات','قراءة طلب برقم ID، حالة وملاحظة','orders'],
 ['الشحن','تعديل أسعار الشحن حسب المنطقة','shipping'],['الصفحة الرئيسية والثيمات','يتطلب API غير منشور','other'],
 ['الكوبونات والدفع والإعدادات','يتطلب API غير منشور','other']
 ];
 return '<div class="eoc-card"><h3 class="eoc-title">صلاحيات التحكم المتاحة</h3><p class="eoc-small">العمليات الرسمية المتاحة تعتمد على الصلاحيات الفعلية للمفتاح في Easy Orders، وليس مجرد اتصال المتجر.</p>'+
 rows.map(([name,desc,key])=>'<div class="eoc-row"><div><strong>'+esc(name)+'</strong><div class="eoc-small">'+esc(desc)+'</div></div><button class="btn soft" data-eoc-tab="'+esc(key)+'">فتح</button></div>').join('')+'</div>';
}
function products(){return '<div class="eoc-card"><h3 class="eoc-title">المنتجات من Easy Orders</h3><button class="btn soft" data-eoc-read="products">قراءة قائمة المنتجات</button><div id="eoList"></div></div>'+
 form('إنشاء منتج','product.create',input('اسم المنتج','name')+input('السعر الأساسي','price','number')+input('سعر العرض الاختياري','sale_price','number')+input('كود SKU','sku')+input('رابط المنتج (Slug)','slug')+input('رابط الصورة الرئيسية HTTPS','thumb')+input('روابط الصور الإضافية (رابط في كل سطر)','images','textarea')+input('معرفات التصنيفات (معرف في كل سطر)','categories','textarea')+input('الوصف','description','textarea'),'عملية الإنشاء تنشر منتجًا جديدًا في Easy Orders فقط. لازم تستورده إلى كن أونلاين قبل ربط المخزون الفعلي.')+
 form('تعديل منتج موجود','product.update',input('Product ID','entityId')+input('اسم جديد (اختياري)','name')+input('السعر الأساسي الجديد','price','number')+input('سعر العرض الجديد','sale_price','number')+input('الرابط المختصر الجديد','slug')+input('رابط الصورة الرئيسية HTTPS','thumb')+input('روابط الصور الإضافية (رابط لكل سطر)','images','textarea')+input('معرفات التصنيفات المطلوبة','categories','textarea')+input('الوصف الجديد','description','textarea'));
}
function categories(){return '<div class="eoc-card"><h3 class="eoc-title">تصنيفات Easy Orders</h3><button class="btn soft" data-eoc-read="categories">قراءة التصنيفات</button><div id="eoList"></div></div>'+
 form('إنشاء تصنيف','category.create',input('اسم التصنيف','name')+input('Slug (اختياري)','slug'))+
 form('تعديل تصنيف','category.update',input('Category ID','entityId')+input('اسم التصنيف الجديد','name')+input('الترتيب','position','number'));}
function stock(){return '<div class="eoc-note">تعديل كميات Easy Orders لا يحل محل استلام قطع فعلية أو جردها في كن أونلاين. الرصيد هنا هو الرصيد النهائي، وليس مقدار التغيير، ولا يتم تعديل كميات كن أونلاين تلقائيًا.</div>'+
 form('تعديل رصيد منتج بالـSKU','product.stock',input('SKU','entityId')+input('الكمية الجديدة','quantity','number'))+
 form('تعديل رصيد متغير','variant.stock',input('كود Taager للمنتج','productTaagerCode')+input('كود Taager للمتغير','entityId')+input('الكمية الجديدة','quantity','number'));}
function orders(){
 return '<div class="eoc-card"><h3 class="eoc-title">قراءة طلب من Easy Orders</h3><p class="eoc-small">يتيح الـPublic API قراءة طلب برقم ID؛ قائمة الطلبات العامة لا تتوفر في المسارات الموثقة.</p><label>Order ID<input class="input" id="eoOrderId" placeholder="معرف الطلب"></label><div class="eoc-actions"><button class="btn soft" data-eoc-read="order">قراءة الطلب</button></div><div id="eoList"></div></div>'+
 form('تحديث حالة الطلب','order.status',input('Order ID','entityId')+'<label>الحالة<select class="select" data-eoc-field="status">'+statuses.map(s=>'<option value="'+s+'">'+s+'</option>').join('')+'</select></label>','حالة الطلب يمكن أن تؤثر على المخزون والشحن؛ راجع دورة الطلب أولًا.')+
 form('إضافة ملاحظة لطلب','order.note',input('Order ID','entityId')+input('الملاحظة','note','textarea')+'<label>ظهور الملاحظة<select class="select" data-eoc-field="type"><option value="private">خاصة</option><option value="public">عامة للعميل</option></select></label>');
}
function shipping(){return '<div class="eoc-note">تنبيه: تحديث مناطق الشحن قد يستبدل إعدادات المناطق السابقة بالكامل. اكتب القائمة النهائية كاملة قبل التأكيد؛ لا يوجد زر إضافة مدينة فردية.</div>'+
 form('أسعار الشحن بحسب المنطقة','shipping.update',input('المنطقة:التكلفة — منطقة واحدة لكل سطر','cities','textarea','القاهرة:30\nالإسكندرية:45'));}
function other(){return '<div class="eoc-card"><h3 class="eoc-title">أقسام Easy Orders الأخرى</h3><p class="eoc-small">هذه الوظائف متاحة داخل لوحة Easy Orders، لكن لم يتم توثيق واجهة Public API تتيح إدارتها من تطبيق خارجي. لا توجد أزرار نشر وهمية.</p>'+
 ['السلايدر والبانرات والصفحة الرئيسية','الصفحات والثيمات وLiquid','الكوبونات والعروض','وسائل الدفع','الدومين والإعدادات العامة','بيانات العملاء خارج الطلبات'].map(x=>'<div class="eoc-row"><strong>'+esc(x)+'</strong><span class="eoc-pill off">غير مدعوم رسميًا</span></div>').join('')+'</div>';}
function render(tab){
 section=tab;pending=null;
 if(!body())return;
 shell().querySelectorAll('.eoc-tabs [data-eoc-tab]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.eocTab===tab)));
 if(!link){body().innerHTML='<div class="eoc-note">'+esc(state?.connectionError?.message||'اربط Easy Orders بمتجر محدد من مركز التكاملات أولًا')+'</div>';return;}
 body().innerHTML=tab==='home'?summary():tab==='products'?products():tab==='categories'?categories():tab==='stock'?stock():tab==='orders'?orders():tab==='shipping'?shipping():other();
}
async function open(){
 if(working)return;working=true;try{
  style();scope=await K.scope();
  if(!scope.sid)throw new Error('اختار متجرًا محددًا من شريط كن أونلاين أولًا');
  link=null;state=null;pending=null;section='home';
  K.drawer('التحكم في Easy Orders','<div id="eoControl"><div class="eoc-card">جارٍ فحص ربط المتجر…</div></div>');
  state=await get('capabilities');link=state.connected?state.connection:null;
  if(!shell())return;
  shell().innerHTML='<div class="eoc-card"><h2 class="eoc-title">مركز التحكم في متجر Easy Orders</h2><div class="eoc-small">'+
   (link?'متصل: '+esc(link.name)+' · '+(link.externalStoreId?'Store ID '+esc(link.externalStoreId):'Store ID غير مؤكد'):'الربط غير جاهز لهذا المتجر')+
   '</div><div class="eoc-small">المعاينة لا تنفذ تغييرًا. النشر يتطلب تأكيدًا منفصلًا وصلاحيات المالك.</div></div>'+
   '<div class="eoc-tabs" role="tablist">'+pages.map(([id,title])=>'<button type="button" data-eoc-tab="'+id+'" role="tab" aria-selected="'+(id===section)+'">'+esc(title)+'</button>').join('')+
   '</div><div id="eoBody" role="tabpanel"></div>';
  shell().addEventListener('click',click);
  render('home');
 }catch(e){if(shell())shell().innerHTML='<p class="eoc-failed">'+esc(e.message)+'</p>';else notify(e.message);}
 finally{working=false;}
}
async function read(resource,id){
 const box=document.getElementById('eoList');if(box)box.innerHTML='<p class="eoc-small">جارٍ القراءة من Easy Orders…</p>';
 try{
  const d=(await get(resource,id)).data;if(!box)return;
  const items=Array.isArray(d)?d:Array.isArray(d?.data)?d.data:Array.isArray(d?.products)?d.products:Array.isArray(d?.categories)?d.categories:Array.isArray(d?.data?.products)?d.data.products:null;
  if(items)box.innerHTML='<p class="eoc-small">نتائج الصفحة المستلمة: '+items.length+'</p>'+items.slice(0,75).map(x=>'<div class="eoc-row"><div><strong>'+esc(x.name||x.id||'عنصر')+'</strong><div class="eoc-small">'+esc([x.id,x.sku,x.price,x.quantity].filter(v=>v!==undefined&&v!==null).join(' • '))+'</div></div><button class="btn soft" data-eoc-detail="'+esc(x.id||'')+'" data-eoc-resource="'+(resource==='products'?'product':'category')+'">تفاصيل</button></div>').join('');
  else box.innerHTML='<pre class="eoc-preview">'+esc(JSON.stringify(d,null,2).slice(0,25000))+'</pre>';
 }catch(e){if(box)box.innerHTML='<p class="eoc-failed">'+esc(e.message)+'</p>';}
}
function build(op,formEl){
 const values=Object.fromEntries([...formEl.querySelectorAll('[data-eoc-field]')].map(x=>[x.dataset.eocField,x.value.trim()]));
 const payload={};
 for(const [k,v] of Object.entries(values)){if(k==='entityId'||v==='')continue;
  if(['price','sale_price','quantity','position'].includes(k)){const n=Number(v);if(!Number.isFinite(n)||n<0)throw new Error('قيمة '+k+' غير صالحة');payload[k]=n;}
  else if(k==='images'){payload.images=v.split(/[\r\n,]+/).map(x=>x.trim()).filter(Boolean);}
  else if(k==='categories'){payload.categories=v.split(/[\r\n,]+/).map(x=>x.trim()).filter(Boolean).map(id=>({id}));}
  else if(k==='cities'){payload.cities=v.split(/\r?\n/).map(t=>t.trim()).filter(Boolean).map(t=>{const i=t.lastIndexOf(':');if(i<1||!Number.isFinite(Number(t.slice(i+1))))throw new Error('صيغة الشحن غير صحيحة: '+t);return{name:t.slice(0,i).trim(),shipping_cost:Number(t.slice(i+1).trim())};});}
  else payload[k]=v;
 }
 if(op==='order.note')payload.store_id=link.externalStoreId;
 if(op.endsWith('update')||op==='product.stock'||op==='variant.stock'||op.startsWith('order.')){if(!values.entityId&&op!=='shipping.update')throw new Error('ادخل معرف العنصر أولًا');}
 if(!Object.keys(payload).length)throw new Error('لا توجد تغييرات للمعاينة');
 if(!link.externalStoreId)throw new Error('Store ID غير مؤكد؛ لا يمكن تنفيذ الكتابة بأمان.');
 return {operation:op,entityId:values.entityId||'',payload};
}
function preview(op,button){
 try{
  const form=button.closest('[data-eoc-form]');pending=build(op,form);
  form.querySelector('#eoPending')?.remove();
  const panel=document.createElement('div');panel.id='eoPending';panel.className='eoc-card';
  panel.innerHTML='<h3 class="eoc-title">معاينة التعديلات</h3><p class="eoc-small">راجع العملية قبل نشرها على متجر Easy Orders؛ لا يتم تحديث كن أونلاين محليًا تلقائيًا.</p>'+
   '<pre class="eoc-preview">'+esc(JSON.stringify(pending,null,2))+'</pre>'+
   '<label style="display:flex;align-items:center;gap:7px;margin:9px 0"><input id="eoConfirm" type="checkbox" style="width:auto"> أؤكد تطبيق التعديل على المتجر المرتبط</label>'+
   '<div class="eoc-actions"><button class="btn primary" data-eoc-publish>تأكيد ونشر</button><button class="btn soft" data-eoc-cancel>إلغاء</button></div>';
  form.appendChild(panel);panel.scrollIntoView({block:'nearest',behavior:'smooth'});
 }catch(e){notify(e.message);}
}
async function publish(button){
 if(working||!pending)return;
 if(!document.getElementById('eoConfirm')?.checked)return notify('أكد مراجعتك للعملية أولًا');
 working=true;button.disabled=true;
 try{const job={...pending},d=await save(job);pending=null;
  button.closest('#eoPending').innerHTML='<div class="eoc-ok">'+esc(d.message||'قبل Easy Orders العملية')+(d.audited?'':' — تنبيه: تعذر حفظ سجل نجاح العملية')+'</div>';
  notify('قبل Easy Orders العملية');
 }catch(e){button.disabled=false;notify(e.message);}finally{working=false;}
}
async function click(event){
 const b=event.target.closest('button');if(!b||!shell()?.contains(b))return;
 if(b.dataset.eocTab){render(b.dataset.eocTab);return;}
 if(b.dataset.eocRead){const id=b.dataset.eocRead==='order'?document.getElementById('eoOrderId')?.value.trim():null;if(b.dataset.eocRead==='order'&&!id){notify('ادخل Order ID');return;}await read(b.dataset.eocRead,id);return;}
 if(b.dataset.eocDetail){await read(b.dataset.eocResource,b.dataset.eocDetail);return;}
 if(b.dataset.eocPreview){preview(b.dataset.eocPreview,b);return;}
 if(b.hasAttribute('data-eoc-publish')){await publish(b);return;}
 if(b.hasAttribute('data-eoc-cancel')){pending=null;b.closest('#eoPending')?.remove();}
}
function inject(){
 if(!document.querySelector('.nav button.active[data-view="integrations"]'))return;
 const r=document.getElementById('root'),head=r?.querySelector('.page-head');if(!head||document.getElementById('easyordersStoreControlOpen'))return;
 const b=document.createElement('button');b.id='easyordersStoreControlOpen';b.type='button';b.className='btn primary';b.textContent='إدارة متجر Easy Orders';
 const spacer=head.querySelector('.spacer');if(spacer)spacer.after(b);else head.appendChild(b);
 b.addEventListener('click',open);
}
const root=document.getElementById('root');
if(root){let queued=false;new MutationObserver(()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;inject();});}).observe(root,{childList:true,subtree:false});}
document.addEventListener('click',e=>{if(e.target.closest?.('.nav button[data-view="integrations"]'))setTimeout(inject,0);},true);
window.addEventListener('kun:store-changed',()=>{if(shell())K.close();link=null;scope=null;});
window.KunEasyOrdersControlV132={open,version:'132.0'};
inject();
})();
