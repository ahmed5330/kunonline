(function(){
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 async function current(){return {clientId:String(await window.kunClientId?.()||''),storeId:String(await window.kunStoreId?.()||'')};}
 const same=(a,b)=>a.clientId===b.clientId&&a.storeId===b.storeId;
 async function api(scope,path='',options={}){
   if(!same(scope,await current()))throw new Error('تغير المتجر؛ افتح سجل الموظفين من جديد');
   const u=new URL('/api/hr'+path,location.origin);u.searchParams.set('clientId',scope.clientId);u.searchParams.set('storeId',scope.storeId);
   const r=await fetch(u.pathname+u.search,{credentials:'include',...options,headers:options.body?{'Content-Type':'application/json'}:{}}),d=await r.json().catch(()=>({}));
   if(!same(scope,await current()))throw new Error('تغير المتجر؛ افتح سجل الموظفين من جديد');
   if(!r.ok)throw new Error(d.error||'تعذر تحميل سجل الموظفين');return d;
 }
 function cents(value){if(!/^\d+(?:\.\d{1,2})?$/.test(value))throw new Error('أدخل مبلغًا أو نسبة صحيحة بدقة منزلتين');const [a,b='']=value.split('.'),n=Number(a)*100+Number(b.padEnd(2,'0'));if(!Number.isSafeInteger(n))throw new Error('القيمة أكبر من الحد المسموح');return n;}
 function cairoMonth(){const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit'}).formatToParts(new Date());return p.find(x=>x.type==='year').value+'-'+p.find(x=>x.type==='month').value;}
 async function open(){
   const bound=await current();if(!bound.clientId||!bound.storeId){window.showToast?.('اختر متجرًا محددًا لسجل الموظفين');return;}
   const previous=document.activeElement,cover=document.createElement('div');cover.style.cssText='position:fixed;inset:0;background:#0008;display:flex;align-items:center;justify-content:center;padding:12px';cover.style.zIndex=String(10000+document.querySelectorAll('[role=dialog]').length*10);
   cover.innerHTML='<section role="dialog" aria-modal="true" aria-labelledby="hrTitle" style="direction:rtl;background:white;color:#172b3a;padding:18px;border-radius:14px;width:1050px;max-width:100%;max-height:94vh;overflow:auto"><h2 id="hrTitle">الموارد البشرية — سجل الموظفين</h2><button type="button" data-hr-close>إغلاق</button><p>العمولة على صافي التحصيل الفعلي بعد المرتجعات. هذا السجل لا يصرف رواتب أو سلفًا ولا يغيّر حسابات الدخول.</p><div data-hr-content></div></section>';
   function close(){cover.remove();document.removeEventListener('keydown',key);if(previous?.isConnected)previous.focus();}
   function key(e){if([...document.querySelectorAll('[role=dialog]')].at(-1)!==cover.querySelector('section'))return;if(e.key==='Escape'){e.preventDefault();close();}if(e.key==='Tab'){const nodes=[...cover.querySelectorAll('button,input,select')].filter(n=>!n.disabled&&n.getClientRects().length),a=nodes[0],b=nodes.at(-1);if(e.shiftKey&&document.activeElement===a){e.preventDefault();b.focus();}else if(!e.shiftKey&&document.activeElement===b){e.preventDefault();a.focus();}}}
   cover.querySelector('[data-hr-close]').onclick=close;document.body.appendChild(cover);document.addEventListener('keydown',key);cover.querySelector('[data-hr-close]').focus();
   const content=cover.querySelector('[data-hr-content]');let q='',status='',offset=0,requestId=0,data=null,editing=null;
   async function load(){
     const id=++requestId;content.textContent='جارٍ تحميل سجل الموظفين...';
     try{const result=await api(bound,'/employees?q='+encodeURIComponent(q)+'&status='+encodeURIComponent(status)+'&offset='+offset);if(!cover.isConnected||id!==requestId)return;data=result;render();}catch(e){if(cover.isConnected&&id===requestId){content.textContent=e.message;const b=document.createElement('button');b.type='button';b.textContent='إعادة المحاولة';b.onclick=load;content.appendChild(b);}}
   }
   function render(){
     content.innerHTML='<p>'+(data.writeEnabled?'الحفظ متاح في البيئة المعزولة.':'العرض فقط؛ الحفظ غير مفعل في هذه البيئة أو غير متاح لصلاحيتك.')+'</p><form data-hr-search><label>البحث بالاسم أو الكود<input name="q" maxlength="120" value="'+esc(q)+'"></label><label>الحالة<select name="status"><option value="">الكل</option><option value="active" '+(status==='active'?'selected':'')+'>نشط</option><option value="inactive" '+(status==='inactive'?'selected':'')+'>غير نشط</option></select></label><button>بحث</button></form><p>الإجمالي المطابق: '+Number(data.total)+'</p><button type="button" data-hr-add '+(!data.writeEnabled?'disabled':'')+'>إضافة موظف</button><button type="button" data-hr-export '+(!data.exportEnabled?'disabled':'')+'>تصدير التقرير الحالي CSV</button><div style="overflow:auto"><table style="width:100%;border-collapse:collapse"><thead><tr><th>الكود</th><th>الموظف</th><th>الحالة</th><th>راتب أساسي</th><th>العمولة</th><th>سريان السياسة</th><th>الإجراءات</th></tr></thead><tbody>'+data.employees.map(e=>'<tr data-hr-employee="'+esc(e.id)+'"><td>'+esc(e.code)+'</td><td>'+esc(e.name)+'</td><td>'+ (e.status==='active'?'نشط':'غير نشط')+'</td><td>'+esc((e.policy.baseSalaryMinor/100).toFixed(2))+'</td><td>'+ (e.policy.commissionEnabled?esc((e.policy.commissionRateBps/100).toFixed(2))+'%':'غير مفعلة')+'</td><td>'+esc(e.effective_month)+'</td><td><button type="button" data-hr-edit '+(!data.writeEnabled?'disabled':'')+'>تعديل</button><button type="button" data-hr-history>السجل الكامل للموظف</button></td></tr>').join('')+'</tbody></table></div><button type="button" data-hr-prev '+(!offset?'disabled':'')+'>السابق</button><button type="button" data-hr-next '+(!data.hasMore?'disabled':'')+'>التالي</button><div data-hr-editor></div><p data-hr-message role="status"></p>';
     content.querySelector('[data-hr-search]').onsubmit=e=>{e.preventDefault();q=e.target.elements.q.value.trim();status=e.target.elements.status.value;offset=0;load();};
     content.querySelector('[data-hr-add]').onclick=()=>edit(null);
     content.querySelector('[data-hr-prev]').onclick=()=>{offset=Math.max(0,offset-data.limit);load();};content.querySelector('[data-hr-next]').onclick=()=>{offset+=data.limit;load();};
     content.querySelectorAll('[data-hr-edit]').forEach(b=>b.onclick=()=>edit(data.employees.find(e=>e.id===b.closest('[data-hr-employee]').dataset.hrEmployee)));
     content.querySelectorAll('[data-hr-history]').forEach(b=>b.onclick=async()=>{
       const panel=content.querySelector('[data-hr-editor]');panel.textContent='جارٍ تحميل السجل...';
       try{const h=await api(bound,'/employees/'+encodeURIComponent(b.closest('[data-hr-employee]').dataset.hrEmployee)+'/history');if(!panel.isConnected)return;panel.innerHTML='<h3>سجل سياسات الموظف — لا يُحذف أو يُستبدل</h3>'+h.policies.map(p=>'<article><b>مراجعة '+p.revision+'</b><p>'+esc(p.created_at)+' · '+esc(p.created_by)+' · سريان '+esc(p.effective_month)+'</p><p>'+esc(p.policy.name)+' · '+esc(p.policy.code)+' · أساسي '+(p.policy.baseSalaryMinor/100).toFixed(2)+' · عمولة '+(p.policy.commissionEnabled?(p.policy.commissionRateBps/100).toFixed(2)+'%':'غير مفعلة')+'</p></article>').join('');}catch(e){if(panel.isConnected)panel.textContent=e.message;}
     });
     content.querySelector('[data-hr-export]').onclick=async()=>{
       try{if(!same(bound,await current()))throw new Error('تغير المتجر؛ افتح السجل من جديد');const u=new URL('/api/hr/employees.csv',location.origin);u.searchParams.set('clientId',bound.clientId);u.searchParams.set('storeId',bound.storeId);u.searchParams.set('q',q);u.searchParams.set('status',status);const r=await fetch(u.pathname+u.search,{credentials:'include'});if(!r.ok){const e=await r.json();throw new Error(e.error||'تعذر التصدير');}if(!same(bound,await current()))throw new Error('تغير المتجر؛ أعد التصدير');const objectUrl=URL.createObjectURL(await r.blob()),a=document.createElement('a');a.href=objectUrl;a.download='hr-employees.csv';a.click();setTimeout(()=>URL.revokeObjectURL(objectUrl),1000);}catch(e){content.querySelector('[data-hr-message]').textContent=e.message;}
     };
   }
   function edit(employee){
     editing=employee;const p=employee?.policy||{baseSalaryMinor:0,commissionEnabled:false,commissionRateBps:0},id=employee?.id||crypto.randomUUID(),panel=content.querySelector('[data-hr-editor]');
     panel.innerHTML='<form data-hr-form style="display:grid;gap:10px;padding:14px;border:1px solid #cbd5e1"><h3>'+(employee?'تعديل الموظف مع الاحتفاظ بالتاريخ':'إضافة موظف')+'</h3><label>الاسم<input name="name" required maxlength="120" value="'+esc(employee?.name||'')+'"></label><label>كود الموظف<input name="code" required maxlength="60" value="'+esc(employee?.code||'')+'"></label><label>الحالة<select name="status"><option value="active">نشط</option><option value="inactive" '+(employee?.status==='inactive'?'selected':'')+'>غير نشط</option></select></label><label>الراتب الأساسي (جنيه)<input name="salary" required inputmode="decimal" value="'+(p.baseSalaryMinor/100).toFixed(2)+'"></label><label><input name="enabled" type="checkbox" '+(p.commissionEnabled?'checked':'')+'> تفعيل العمولة</label><label>العمولة % من صافي التحصيل بعد المرتجعات<input name="rate" required inputmode="decimal" value="'+(p.commissionRateBps/100).toFixed(2)+'"></label><label>شهر سريان الراتب والعمولة<input type="month" name="effective" required value="'+esc(employee?.effective_month||cairoMonth())+'"></label><button type="submit">حفظ الموظف والسياسة</button><p data-hr-feedback role="status"></p></form>';
     const form=panel.querySelector('form');let busy=false;
     form.onsubmit=async e=>{e.preventDefault();if(busy)return;const feedback=form.querySelector('[data-hr-feedback]');let payload;
       try{payload={id,revision:editing?.revision||0,effectiveMonth:form.elements.effective.value,employee:{name:form.elements.name.value.trim(),code:form.elements.code.value.trim(),status:form.elements.status.value,baseSalaryMinor:cents(form.elements.salary.value),commissionEnabled:form.elements.enabled.checked,commissionRateBps:cents(form.elements.rate.value)}};if(payload.employee.commissionRateBps>10000)throw new Error('نسبة العمولة لا تتجاوز 100%');}catch(error){feedback.textContent=error.message;return;}
       busy=true;form.querySelector('[type=submit]').disabled=true;
       try{await api(bound,'/employees'+(employee?'/'+encodeURIComponent(employee.id):''),{method:employee?'PUT':'POST',body:JSON.stringify(payload)});editing=null;await load();}catch(error){if(feedback.isConnected)feedback.textContent=error.message;}finally{busy=false;if(form.isConnected)form.querySelector('[type=submit]').disabled=false;}
     };form.elements.name.focus();
   }
   await load();
 }
 function mount(){
   const snapshot=window.KunPermissionNavigationV51?.snapshot,perms=snapshot?.permissions||[],allowed=['client','admin'].includes(snapshot?.role)||perms.some(p=>['*','hr.*','hr.read'].includes(p));
   const nav=document.querySelector('.nav'),existing=document.querySelector('[data-hr-open]');if(!allowed){existing?.remove();return;}if(!nav||existing)return;
   const b=document.createElement('button');b.type='button';b.dataset.hrOpen='1';b.textContent='الموارد البشرية';b.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();open();},true);const anchor=nav.querySelector('[data-view=access]');if(anchor)anchor.after(b);else nav.appendChild(b);
 }
 new MutationObserver(mount).observe(document.body,{childList:true,subtree:true});for(const delay of [0,300,1000,3000])setTimeout(mount,delay);
 window.KunHRDirectory={open,cents};
})();
