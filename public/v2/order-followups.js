/* Uses the existing store-scoped collaboration task service; does not send customer messages. */
(function(){
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 async function scope(){return {clientId:String(await window.kunClientId?.()||''),storeId:String(await window.kunStoreId?.()||'')};}
 async function api(bound,path='',options={}){
   const now=await scope();if(now.clientId!==bound.clientId||(now.storeId&&now.storeId!==bound.storeId))throw new Error('تغير المتجر؛ افتح المتابعة من جديد');
   const u=new URL('/api/collaboration'+path,location.origin);u.searchParams.set('clientId',bound.clientId);u.searchParams.set('storeId',bound.storeId);
   const r=await fetch(u.pathname+u.search,{credentials:'include',...options,headers:options.body?{'Content-Type':'application/json'}:{}}),d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'تعذر تحميل المتابعات');return d;
 }
 function cairoInstant(value){
   if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))throw new Error('حدد موعدًا صحيحًا بتوقيت القاهرة');
   const stamp=Date.parse(value+'Z'),matches=[],fmt=new Intl.DateTimeFormat('sv-SE',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
   for(let offset=-840;offset<=840;offset+=15){const candidate=new Date(stamp-offset*60000);if(!Number.isNaN(candidate.getTime())&&fmt.format(candidate).replace(' ','T')===value)matches.push(candidate.toISOString());}
   if(matches.length!==1)throw new Error('الموعد غير صالح أو يتكرر مع تغيير التوقيت؛ اختر ساعة أخرى');return matches[0];
 }
 function dueDay(value){
   if(!value)return '';
   if(!/(Z|[+-]\d{2}:\d{2})$/.test(value))return String(value).slice(0,10);
   const d=new Date(value);return Number.isNaN(d.getTime())?'':new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
 }
 function dialog(title){
   const previous=document.activeElement,cover=document.createElement('div');cover.style.cssText='position:fixed;inset:0;background:#0008;display:flex;align-items:center;justify-content:center;padding:14px';cover.style.zIndex=String(10000+document.querySelectorAll('[role=dialog]').length*10);
   cover.innerHTML='<section role="dialog" aria-modal="true" aria-labelledby="followupTitle" style="direction:rtl;background:white;color:#172b3a;padding:18px;border-radius:14px;width:900px;max-width:100%;max-height:92vh;overflow:auto"><h2 id="followupTitle">'+esc(title)+'</h2><button type="button" data-follow-close>إغلاق</button><div data-follow-body></div></section>';
   const close=()=>{cover.remove();document.removeEventListener('keydown',key);if(previous?.isConnected)previous.focus();};
   const key=e=>{if([...document.querySelectorAll('[role=dialog]')].at(-1)!==cover.querySelector('section'))return;if(e.key==='Escape'){e.preventDefault();close();}if(e.key==='Tab'){const nodes=[...cover.querySelectorAll('button,input,select,textarea')].filter(n=>!n.disabled&&n.getClientRects().length),first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}};
   cover.querySelector('[data-follow-close]').onclick=close;cover.onclick=e=>{if(e.target===cover)close();};document.body.appendChild(cover);document.addEventListener('keydown',key);cover.querySelector('[data-follow-close]').focus();return {cover,body:cover.querySelector('[data-follow-body]'),close};
 }
 async function create(order){
   const bound={clientId:String(order.clientId||''),storeId:String(order.storeId||'')};if(!bound.clientId||!bound.storeId){window.showToast?.('هذا الطلب يحتاج متجرًا محددًا');return;}
   const d=dialog('متابعة الطلب '+(order.ref||order.id));d.body.textContent='جارٍ تحميل فريق المتجر...';let data;
   try{data=await api(bound,'/bootstrap');}catch(e){d.body.textContent=e.message;return;}if(!d.cover.isConnected)return;
   d.body.innerHTML='<form data-follow-form style="display:grid;gap:12px;margin-top:12px"><label>عنوان المتابعة<input name="title" required maxlength="240" value="'+esc('متابعة الطلب '+(order.ref||order.id))+'"></label><label>السبب / التفاصيل<textarea name="description" required maxlength="2000"></textarea></label><label>المسؤول<select name="assignee"><option value="">بدون إسناد</option>'+data.members.map(m=>'<option value="'+esc(m.id)+'">'+esc(m.name)+'</option>').join('')+'</select></label><label>الموعد — توقيت القاهرة<input type="datetime-local" name="dueAt" required></label><label>الأولوية<select name="priority"><option value="normal">عادية</option><option value="high">عالية</option><option value="urgent">عاجلة</option><option value="low">منخفضة</option></select></label><button type="submit">حفظ المتابعة</button><p role="status" data-follow-status></p></form>';
   const form=d.body.querySelector('form');let busy=false;
   form.onsubmit=async e=>{
     e.preventDefault();if(busy)return;const feedback=form.querySelector('[data-follow-status]');let payload;
     try{const values=Object.fromEntries(new FormData(form));payload={title:values.title.trim(),description:values.description.trim(),assignedToUserId:values.assignee,priority:values.priority,dueAt:cairoInstant(values.dueAt),orderId:order.id,clientId:bound.clientId,storeId:bound.storeId};if(!payload.title||!payload.description)throw new Error('أدخل عنوان المتابعة وسببها');}catch(error){feedback.textContent=error.message;return;}
     busy=true;form.querySelector('[type=submit]').disabled=true;
     try{await api(bound,'/tasks',{method:'POST',body:JSON.stringify(payload)});feedback.textContent='تم تسجيل المتابعة؛ لم تُرسل رسالة للعميل';form.querySelectorAll('input,textarea,select').forEach(el=>el.disabled=true);}catch(error){feedback.textContent=error.message;busy=false;form.querySelector('[type=submit]').disabled=false;}
   };
 }
 async function openQueue(){
   const bound=await scope();if(!bound.clientId||!bound.storeId){window.showToast?.('اختار متجرًا محددًا لفتح متابعاته');return;}
   const d=dialog('متابعات الطلبات');d.body.textContent='جارٍ التحميل...';let data;
   try{data=await api(bound,'/bootstrap');}catch(e){d.body.textContent=e.message;return;}if(!d.cover.isConnected)return;
   const tasks=(data.tasks||[]).filter(t=>t.order_id),members=data.members||[];
   d.body.innerHTML='<p>متابعات الطلبات الظاهرة لصلاحياتك من آخر 250 مهمة محملة للمتجر؛ ليست إجمالي جميع المتابعات.</p><label>مسؤول المتابعة<select data-follow-assignee><option value="all">كل المسؤولين</option><option value="mine">متابعاتي</option><option value="unassigned">غير مسندة</option>'+members.map(m=>'<option value="'+esc(m.id)+'">'+esc(m.name)+'</option>').join('')+'</select></label><label>الموعد والحالة<select data-follow-state><option value="open">المفتوحة</option><option value="overdue">المتأخرة</option><option value="today">اليوم</option><option value="unscheduled">بلا موعد</option><option value="done">المحلولة</option><option value="all">الكل</option></select></label><div data-follow-list></div>';
   function render(){
     const assignee=d.body.querySelector('[data-follow-assignee]').value,filter=d.body.querySelector('[data-follow-state]').value;
     const rows=tasks.filter(t=>{
       const who=t.assigned_to_user_id||'',open=['open','in_progress'].includes(t.status),day=dueDay(t.due_at);
       return (assignee==='all'||assignee==='mine'&&who===data.me.id||assignee==='unassigned'&&!who||who===assignee)&&(filter==='all'||filter==='done'&&t.status==='done'||open&&(filter==='open'||filter==='today'&&day===today()||filter==='overdue'&&day&&day<today()||filter==='unscheduled'&&!day));
     });
     d.body.querySelector('[data-follow-list]').innerHTML='<p>نتائج العرض: '+rows.length+'</p>'+rows.map(t=>'<article data-follow-task="'+esc(t.id)+'" style="padding:12px;border:1px solid #cbd5e1;margin-block:8px"><b>'+esc(t.title)+'</b><p>الطلب: '+esc(t.order_id)+' · المسؤول: '+esc(t.assigned_to_name||'غير مسند')+'</p><p>'+esc(t.description||'')+'</p><p>الموعد: '+esc(t.due_at||'بلا موعد')+'</p><p>الحالة: '+esc(({open:'مفتوحة',in_progress:'جارية',done:'محلولة',cancelled:'ملغاة'})[t.status]||t.status)+'</p></article>').join('');
   }
   d.body.querySelectorAll('select').forEach(s=>s.onchange=render);render();
 }
 function mount(){
   const page=document.querySelector('.cs-page');if(!page)return;
   page.querySelectorAll('.cs-order[data-cs-order] .cs-actions').forEach(actions=>{if(actions.querySelector('[data-order-followup]'))return;const b=document.createElement('button');b.type='button';b.className='btn soft';b.dataset.orderFollowup='1';b.textContent='جدولة متابعة';b.onclick=()=>{const id=actions.closest('[data-cs-order]').dataset.csOrder,order=window.KunCustomerServiceV31?.followupOrder?.(id);if(order)create(order);};actions.appendChild(b);});
   if(!page.querySelector('[data-order-followup-queue]')){const b=document.createElement('button');b.type='button';b.className='btn soft';b.dataset.orderFollowupQueue='1';b.textContent='متابعات الطلبات';b.onclick=openQueue;page.prepend(b);}
 }
 new MutationObserver(mount).observe(document.getElementById('root')||document.body,{childList:true,subtree:true});mount();
 window.KunOrderFollowups={create,openQueue,cairoInstant,dueDay};
})();
