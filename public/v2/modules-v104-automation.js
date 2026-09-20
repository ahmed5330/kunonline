/* Kun Online v104.1 — real Automation / Workflow Builder UI + management. */
(function(){
  'use strict';
  if(window.KunAutomationV104)return;

  const VIEW='automation';
  const TRIGGERS={
    order_created:'إنشاء طلب جديد',order_confirmed:'تأكيد الطلب',order_shipped:'إرسال الطلب للشحن',
    order_delivered:'تسليم الطلب',order_returned:'ارتجاع الطلب',low_stock:'انخفاض المخزون',customer_inactive:'عدم نشاط العميل'
  };
  const ACTIONS={
    add_tag:{label:'إضافة Tag للعميل',field:'tag',placeholder:'مثال: VIP'},
    assign_agent:{label:'إسناد لموظف',field:'agent',placeholder:'اسم/معرّف الموظف'},
    add_note:{label:'إضافة ملاحظة',field:'note',placeholder:'نص الملاحظة'},
    notify_team:{label:'تنبيه الفريق',field:'message',placeholder:'نص التنبيه'},
    send_whatsapp:{label:'إرسال WhatsApp',field:'message',placeholder:'نص/قالب الرسالة'},
    send_email:{label:'إرسال بريد',field:'message',placeholder:'محتوى الرسالة'},
    webhook:{label:'استدعاء Webhook',field:'url',placeholder:'https://...'}
  };
  const CONDITIONS={
    'order.total':'قيمة الطلب','order.state':'حالة الطلب','order.gov':'المحافظة','order.source':'مصدر الطلب',
    'customer.tags':'Tags العميل','product.stock':'رصيد المخزون'
  };
  const OPERATORS={eq:'يساوي',neq:'لا يساوي',gte:'أكبر من أو يساوي',lte:'أقل من أو يساوي',contains:'يحتوي',exists:'موجود'};

  let workflows=[],loading=false,routeGeneration=0,editingId='';
  const root=()=>document.getElementById('root');
  const drawer=()=>document.getElementById('drawer');
  const drawerBack=()=>document.getElementById('drawerBack');
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const active=()=>document.querySelector('.nav button.active[data-view]')?.dataset.view===VIEW;
  const snapshot=()=>window.KunPermissionNavigationV51?.snapshot||null;

  function permissionState(){
    const nav=window.KunPermissionNavigationV51;if(!nav)return 'allowed';
    const snap=nav.snapshot;if(!snap?.role)return 'pending';
    return nav.allowedView?.(VIEW,snap)?'allowed':'denied';
  }
  function canWrite(){
    const snap=snapshot();if(!snap?.role)return true;if(['admin','client'].includes(String(snap.role)))return true;
    const rules=Array.isArray(snap.permissions)?snap.permissions:[],match=window.KunPermissionNavigationV51?.match;
    return rules.some(rule=>typeof match==='function'?(match(rule,'automation.write')||match(rule,'settings')):['automation.write','automation.*','settings','*'].includes(rule));
  }
  function clientId(){return String(window.KunClientContextV24?.cachedClientId||((typeof activeClientId!=='undefined'&&activeClientId)||'')||'');}
  function storeId(){return String(document.getElementById('storeBtn')?.value||'');}
  function apiUrl(path){
    const u=new URL(path,location.origin),cid=clientId(),sid=storeId();if(cid)u.searchParams.set('clientId',cid);if(sid)u.searchParams.set('storeId',sid);return u.pathname+u.search;
  }
  async function api(path,options={}){
    const response=await fetch(path,{credentials:'include',headers:{'Content-Type':'application/json',...(options.headers||{})},...options});
    const data=await response.json().catch(()=>({}));if(!response.ok){const error=new Error(data.error||`HTTP ${response.status}`);error.code=data.code;throw error;}return data;
  }
  function syncActive(){
    document.querySelectorAll('.nav button[data-view]').forEach(button=>button.classList.toggle('active',String(button.dataset.view||'')===VIEW));
    try{view=VIEW;}catch(_){}window.KunViewPersistenceV97?.save?.(VIEW);
  }
  const triggerLabel=v=>TRIGGERS[v]||v||'—';
  const actionLabel=v=>ACTIONS[v]?.label||v||'—';
  function fmtDate(v){if(!v)return '—';try{return new Date(v).toLocaleString('ar-EG',{timeZone:'Africa/Cairo'});}catch{return String(v);}}
  function actionPayloadValue(action={}){const meta=ACTIONS[action.type];return meta?String(action.payload?.[meta.field]??''):'';}

  function workflowCard(w){
    const def=w.definition||{},conditions=Array.isArray(def.conditions)?def.conditions:[],actions=Array.isArray(def.actions)?def.actions:[],status=Number(w.active)===1;
    const controls=canWrite()?`<div class="toolbar mt" style="gap:8px;flex-wrap:wrap">
      <button class="btn soft" data-auto-action="edit" data-id="${esc(w.id)}">تعديل</button>
      <button class="btn ${status?'soft':'primary'}" data-auto-action="toggle" data-id="${esc(w.id)}">${status?'إيقاف':'تفعيل'}</button>
      <button class="btn soft" data-auto-action="delete" data-id="${esc(w.id)}">حذف</button>
    </div>`:'';
    return `<div class="card" data-workflow-id="${esc(w.id)}">
      <div class="page-head" style="margin-bottom:10px"><div><div class="title" style="font-size:18px">${esc(w.name)}</div><div class="sub">${esc(triggerLabel(w.trigger_type))} · ${esc(w.store_id?'هذا الفرع':'كل الفروع')}</div></div><div class="spacer"></div><span class="stock ${status?'ok':''}">${status?'نشط':'مسودة'}</span></div>
      <div class="grid split"><div><b>الشروط</b><div class="meta mt">${conditions.length?conditions.map(c=>`${esc(CONDITIONS[c.field]||c.field)} ${esc(OPERATORS[c.operator]||c.operator)} ${c.operator==='exists'?'':esc(c.value??'')}`).join('<br>'):'بدون شروط — يعمل عند تحقق الـTrigger'}</div></div>
      <div><b>الإجراءات</b><div class="meta mt">${actions.length?actions.map(a=>esc(actionLabel(a.type))).join('<br>'):'لا توجد إجراءات'}</div></div></div>
      <div class="meta mt">آخر تحديث ${esc(fmtDate(w.updated_at||w.created_at))} · بواسطة ${esc(w.created_by||'—')}</div>${controls}
    </div>`;
  }

  async function load(){
    if(loading||!active())return;loading=true;const el=root();
    try{
      if(el)el.innerHTML='<div class="card empty">جارٍ تحميل الأتمتات...</div>';
      const rows=await api(apiUrl('/api/workflows'));if(!active())return;workflows=Array.isArray(rows)?rows:[];renderLoaded();
    }catch(error){
      if(active()&&root())root().innerHTML=`<div class="card empty"><h2>تعذر تحميل الأتمتة</h2><p>${esc(error.message)}</p><button class="btn primary" id="auto104Retry">إعادة المحاولة</button></div>`;
      document.getElementById('auto104Retry')?.addEventListener('click',load);
    }finally{loading=false;}
  }
  function renderLoaded(){
    if(!active())return;const total=workflows.length,enabled=workflows.filter(x=>Number(x.active)===1).length,drafts=total-enabled,el=root();if(!el)return;
    el.innerHTML=`<div class="page-head"><div><div class="title">الأتمتة</div><div class="sub">Workflow Builder — أنشئ القواعد، عدّلها، فعّلها أو أوقفها من مكان واحد.</div></div><div class="spacer"></div>${canWrite()?'<button class="btn primary" id="auto104New">+ Workflow جديد</button>':''}<button class="btn soft" id="auto104Reload">تحديث</button></div>
      <div class="grid kpis four"><div class="card"><div class="k-label">إجمالي Workflows</div><div class="k-val">${total}</div></div><div class="card"><div class="k-label">نشط</div><div class="k-val">${enabled}</div></div><div class="card"><div class="k-label">مسودة / متوقف</div><div class="k-val">${drafts}</div></div><div class="card"><div class="k-label">النطاق</div><div class="k-val" style="font-size:18px">${storeId()?'الفرع الحالي':'كل الفروع'}</div></div></div>
      <div class="card mt"><b>تدفق الأتمتة</b><div class="sub mt">Trigger → Conditions → Actions. التنفيذ الحساس يظل خاضعًا للصلاحيات والموافقات وسجل النشاط.</div></div>
      <div class="grid split mt" id="auto104List">${workflows.length?workflows.map(workflowCard).join(''):'<div class="card empty" style="grid-column:1/-1"><h3>لا توجد أتمتات بعد</h3><p>أنشئ أول Workflow بدل الإعداد اليدوي المتكرر.</p></div>'}</div>`;
    document.getElementById('auto104New')?.addEventListener('click',()=>openBuilder());document.getElementById('auto104Reload')?.addEventListener('click',load);
    document.getElementById('auto104List')?.addEventListener('click',handleCardAction);
  }

  function closeBuilder(){editingId='';drawer()?.classList.remove('open');drawerBack()?.classList.remove('show');}
  function payloadPreview(){
    const type=document.getElementById('auto104Action')?.value||'add_note',meta=ACTIONS[type]||ACTIONS.add_note,label=document.getElementById('auto104PayloadLabel'),input=document.getElementById('auto104Payload');
    if(label)label.textContent=meta.label;if(input)input.placeholder=meta.placeholder;
  }
  function openBuilder(workflow=null){
    if(!canWrite()){window.showToast?.('ليس لديك صلاحية تعديل الأتمتة');return;}
    const def=workflow?.definition||{},conditions=Array.isArray(def.conditions)?def.conditions:[],actions=Array.isArray(def.actions)?def.actions:[];
    if(workflow&&(conditions.length>1||actions.length>1)){window.showToast?.('هذا الـWorkflow يحتوي عدة شروط/إجراءات؛ التعديل المرئي الحالي يدعم شرطًا وإجراءً واحدًا. يمكنك تفعيله أو إيقافه بدون فقد البيانات.');return;}
    editingId=workflow?.id||'';const condition=conditions[0]||{},action=actions[0]||{},d=drawer();if(!d)return;
    d.innerHTML=`<div class="page-head"><div><div class="title">${editingId?'تعديل Workflow':'Workflow جديد'}</div><div class="sub">${editingId?'عدّل القاعدة الحالية مع الحفاظ على سجلها.':'سيتم الحفظ فعليًا في قاعدة بيانات المتجر.'}</div></div><div class="spacer"></div><button class="btn soft" id="auto104Close">إغلاق</button></div>
      <div class="card"><h3>1. Trigger</h3><label>اسم الأتمتة<input class="input" id="auto104Name" maxlength="120" value="${esc(workflow?.name||'')}" placeholder="مثال: تنبيه الطلبات الكبيرة"></label><label class="mt">عند حدوث<select class="select" id="auto104Trigger">${Object.entries(TRIGGERS).map(([v,l])=>`<option value="${esc(v)}" ${String(workflow?.trigger_type||'order_created')===v?'selected':''}>${esc(l)}</option>`).join('')}</select></label></div>
      <div class="card mt"><h3>2. Condition — اختياري</h3><label>الحقل<select class="select" id="auto104Condition"><option value="">بدون شرط</option>${Object.entries(CONDITIONS).map(([v,l])=>`<option value="${esc(v)}" ${String(condition.field||'')===v?'selected':''}>${esc(l)}</option>`).join('')}</select></label><div class="grid split mt"><label>المقارنة<select class="select" id="auto104Operator">${Object.entries(OPERATORS).map(([v,l])=>`<option value="${esc(v)}" ${String(condition.operator||'eq')===v?'selected':''}>${esc(l)}</option>`).join('')}</select></label><label>القيمة<input class="input" id="auto104Value" value="${esc(condition.operator==='exists'?'':condition.value??'')}" placeholder="مثال: 1000"></label></div></div>
      <div class="card mt"><h3>3. Action</h3><label>الإجراء<select class="select" id="auto104Action">${Object.entries(ACTIONS).map(([v,m])=>`<option value="${esc(v)}" ${String(action.type||'add_tag')===v?'selected':''}>${esc(m.label)}</option>`).join('')}</select></label><label class="mt"><span id="auto104PayloadLabel"></span><input class="input" id="auto104Payload" value="${esc(actionPayloadValue(action))}"></label></div>
      <div class="card mt"><label style="display:flex;align-items:center;gap:10px"><input type="checkbox" id="auto104Active" ${Number(workflow?.active||0)===1?'checked':''}> <span>Workflow نشط</span></label><div class="meta mt">يمكن إيقاف الـWorkflow بدون حذف سجل التشغيل السابق.</div></div>
      <div class="toolbar mt"><button class="btn primary" id="auto104Save">${editingId?'حفظ التعديلات':'حفظ Workflow'}</button></div>`;
    d.classList.add('open');drawerBack()?.classList.add('show');document.getElementById('auto104Close')?.addEventListener('click',closeBuilder);drawerBack()?.addEventListener('click',closeBuilder,{once:true});document.getElementById('auto104Action')?.addEventListener('change',payloadPreview);payloadPreview();document.getElementById('auto104Save')?.addEventListener('click',saveWorkflow);
  }
  async function saveWorkflow(){
    const name=String(document.getElementById('auto104Name')?.value||'').trim(),triggerType=document.getElementById('auto104Trigger')?.value||'',conditionField=document.getElementById('auto104Condition')?.value||'',operator=document.getElementById('auto104Operator')?.value||'eq',value=document.getElementById('auto104Value')?.value??'',actionType=document.getElementById('auto104Action')?.value||'',payloadValue=String(document.getElementById('auto104Payload')?.value||'').trim(),isActive=Boolean(document.getElementById('auto104Active')?.checked);
    if(!name){window.showToast?.('اكتب اسم الأتمتة');return;}if(!triggerType||!actionType){window.showToast?.('حدد الـTrigger والإجراء');return;}if(actionType!=='notify_team'&&!payloadValue){window.showToast?.('اكتب بيانات الإجراء');return;}
    const meta=ACTIONS[actionType],payload={};if(payloadValue)payload[meta.field]=payloadValue;const conditions=conditionField?[{field:conditionField,operator,value:operator==='exists'?true:value}]:[],actions=[{type:actionType,payload}],body={clientId:clientId()||undefined,storeId:storeId()||undefined,name,triggerType,conditions,actions,active:isActive};
    const button=document.getElementById('auto104Save');if(button){button.disabled=true;button.textContent='جارٍ الحفظ...';}
    try{
      const path=editingId?`/api/workflows/${encodeURIComponent(editingId)}`:'/api/workflows',method=editingId?'PATCH':'POST';await api(path,{method,body:JSON.stringify(body)});closeBuilder();window.showToast?.(editingId?'تم تحديث الـWorkflow':'تم حفظ الـWorkflow');await load();
    }catch(error){window.showToast?.(error.message);if(button){button.disabled=false;button.textContent=editingId?'حفظ التعديلات':'حفظ Workflow';}}
  }
  async function handleCardAction(event){
    const button=event.target.closest?.('[data-auto-action][data-id]');if(!button||!canWrite())return;const id=String(button.dataset.id||''),action=button.dataset.autoAction,w=workflows.find(x=>String(x.id)===id);if(!w)return;
    if(action==='edit'){openBuilder(w);return;}
    button.disabled=true;
    try{
      if(action==='toggle'){
        const next=Number(w.active)!==1;await api(`/api/workflows/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify({clientId:clientId()||undefined,storeId:storeId()||undefined,active:next})});window.showToast?.(next?'تم تفعيل الـWorkflow':'تم إيقاف الـWorkflow');await load();return;
      }
      if(action==='delete'){
        if(!window.confirm(`حذف Workflow «${w.name}»؟ إذا كان له سجل تشغيل سابق فلن يسمح النظام بالحذف.`)){button.disabled=false;return;}
        await api(apiUrl(`/api/workflows/${encodeURIComponent(id)}`),{method:'DELETE'});window.showToast?.('تم حذف الـWorkflow');await load();return;
      }
    }catch(error){window.showToast?.(error.message);button.disabled=false;}
  }

  function route(generation=routeGeneration,attempt=0){
    if(generation!==routeGeneration)return;const permission=permissionState();if(permission==='pending'){if(attempt<30)setTimeout(()=>route(generation,attempt+1),50);return;}if(permission==='denied'){window.showToast?.('القسم غير متاح ضمن صلاحيات حسابك');return;}
    try{if(typeof window.setView==='function')window.setView(VIEW);else if(typeof setView==='function')setView(VIEW);}catch(error){console.warn('Automation route',error);}syncActive();load();
  }
  function navigate(){const generation=++routeGeneration;route(generation);}
  function boot(){
    document.addEventListener('click',event=>{const target=event.target.closest?.('.nav button[data-view],[data-go]');if(!target)return;const next=String(target.dataset.view||target.dataset.go||'');if(next!==VIEW){routeGeneration++;return;}if(permissionState()==='denied')return;event.preventDefault();event.stopImmediatePropagation();navigate();},true);
    document.getElementById('storeBtn')?.addEventListener('change',()=>{if(active())setTimeout(load,0);});document.addEventListener('kun:section-reloaded',event=>{if(event.detail?.view===VIEW||active())navigate();});window.addEventListener('pageshow',()=>{if(active())navigate();});if(active())navigate();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
  window.KunAutomationV104={version:'104.1',load,navigate,openBuilder,get workflows(){return workflows.slice();}};
})();