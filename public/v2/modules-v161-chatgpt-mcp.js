/* ChatGPT uses Kun Online as an OAuth-protected MCP resource, not OpenAI API billing. */
(function(){
 if(window.KunChatgptMcpV161)return;
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
 const endpoint='https://app.kun-online.com/mcp';
 async function api(path,opts={}){
   const r=await fetch(path,{credentials:'include',cache:'no-store',...opts,headers:{'Content-Type':'application/json',...(opts.headers||{})}});
   const data=await r.json().catch(()=>({}));
   if(!r.ok)throw new Error(data.error||'تعذر قراءة تفويض ChatGPT');
   return data;
 }
 let loadEpoch=0;
 async function mount(root){
   const target=root?.querySelector('#intGroups');if(!target)return;
   let section=root.querySelector('#kunChatgptMcp');
   if(!section){section=document.createElement('section');section.id='kunChatgptMcp';section.className='kun-ai-integrations';target.after(section);}
   const epoch=++loadEpoch;
   section.innerHTML='<div class="card">جارٍ تحميل ربط ChatGPT...</div>';
   try{
     const clientId=window.kunClientId?String(await window.kunClientId()||''):'';
     const r=await api('/api/integrations/chatgpt'+(clientId?'?clientId='+encodeURIComponent(clientId):''));
     if(epoch!==loadEpoch||!section.isConnected)return;
     section.innerHTML='<div class="ai-intro"><div><h3>ربط ChatGPT عبر MCP</h3><p>استخدم ChatGPT نفسه لتحليل بيانات متجرك. لا تحتاج مفتاح OpenAI API ولا شراء توكنز من كن أونلاين لهذا الربط.</p></div><span class="badge">قراءة فقط</span></div>'+
      '<div class="card"><p>رابط خادم MCP:</p><code style="direction:ltr;display:block;overflow-wrap:anywhere">'+esc(endpoint)+'</code>'+
      '<div class="toolbar mt"><button type="button" class="btn soft" id="kunMcpCopy">نسخ رابط MCP</button></div>'+
      '<p class="meta">يجب توصيل الخادم من حساب ChatGPT الذي يدعم إضافة MCP مخصص، ثم تسجيل الدخول إلى كن أونلاين والموافقة على متجر محدد. حساب Plus الفردي لا يدعم حاليًا إضافة خادم MCP مخصص بنفسه؛ إتاحته له تتطلب نشر إضافة Kun Online عبر دليل ChatGPT واعتمادها.</p>'+
      '<div class="title" style="font-size:16px;margin-top:18px">المتاجر والتفويضات</div>'+
      (r.stores||[]).map(s=>'<div class="ai-mcp-store"><strong>'+esc(s.name)+'</strong><span class="badge">'+(s.linked?'مفوّض لـ ChatGPT':'غير مربوط')+'</span>'+(s.linked?'<button type="button" class="btn soft" data-mcp-revoke="'+esc(s.id)+'">إلغاء التفويض</button>':'')+'</div>').join('')+
      '<p class="meta">البيانات المتاحة: أعداد الطلبات وحالاتها، قيمة الأوردرات، إنفاق الحملات المستورد، وأكثر المنتجات طلبًا. لا توجد صلاحية تعديل أو إرسال بيانات شخصية.</p></div>';
     section.querySelector('#kunMcpCopy').onclick=async()=>{
       try{await navigator.clipboard.writeText(endpoint);section.querySelector('#kunMcpCopy').textContent='تم نسخ الرابط';}
       catch{window.prompt('انسخ عنوان الخادم',endpoint);}
     };
     section.querySelectorAll('[data-mcp-revoke]').forEach(btn=>btn.onclick=async()=>{
       const storeId=btn.dataset.mcpRevoke;
       if(!confirm('هل تريد فصل صلاحية ChatGPT عن هذا المتجر وإيقاف كل التوكنز النشطة؟'))return;
       btn.disabled=true;btn.textContent='جارٍ الفصل...';
       try{await api('/api/integrations/chatgpt',{method:'POST',body:JSON.stringify({clientId,storeId})});await mount(root);}
       catch(e){btn.disabled=false;btn.textContent=e.message;}
     });
   }catch(e){if(epoch===loadEpoch&&section.isConnected)section.innerHTML='<div class="card">تعذر تحميل ربط ChatGPT: '+esc(e.message)+'</div>';}
 }
 function hook(){document.addEventListener('click',e=>{if(e.target.closest?.('.nav button[data-view="integrations"]'))setTimeout(()=>mount(document.getElementById('root')),150);});}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',hook);else hook();
 window.KunChatgptMcpV161={mount,version:'161.0',endpoint};
})();
