/* Kun Online v130 — consolidated inventory workspace. Existing APIs/workflows stay authoritative. */
(function(){
  'use strict';
  const root=document.getElementById('root');
  if(!root)return;
  const version='130.0';
  const tabs=[
    ['overview','نظرة عامة'],['products','المنتجات'],['units','القطع والباركود'],
    ['batches','الدفعات'],['history','حركات المخزون'],['operations','التجهيز والجرد']
  ];
  let activeTab='overview',stockFilter='all',query='',category='',orderBy='default',page=1,pageSize=25,records=[];
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
  const money=v=>new Intl.NumberFormat('ar-EG',{maximumFractionDigits:0}).format(Number(v)||0);
  const count=v=>new Intl.NumberFormat('ar-EG').format(Number(v)||0);
  const number=v=>Number.isFinite(Number(v))?Number(v):0;
  const notify=message=>window.KunActionsV23?.notify?.(message)||window.showToast?.(message);
  const isActive=()=>!!document.querySelector('.nav button.active[data-view="inventory"]');
  function currentProducts(){
    try{return typeof state!=='undefined'&&Array.isArray(state.products)?state.products:[];}catch{return [];}
  }
  function toRecords(){
    return currentProducts().map((p,index)=>{
      const stock=number(p.stock),threshold=Number(p.lowStockThreshold??p.low_stock_threshold)||5;
      const sku=String(p.sku||'').trim(),barcode=String(p.barcode||p.product_tracking_code||'').trim();
      const category=String(p.category||'').trim();
      const variants=Array.isArray(p.variants)?p.variants.map(v=>[v.name,v.sku,v.barcode].join(' ')).join(' '):'';
      return {id:String(p.id||''),index,name:String(p.name||'منتج بدون اسم'),sku,barcode,category,
        stock,threshold,cost:number(p.cost),value:stock*number(p.cost),
        search:[p.name,sku,barcode,category,variants].join(' ').toLocaleLowerCase('ar-EG'),
        status:stock<=0?'out':stock<=threshold?'low':'healthy'};
    });
  }
  function metric(label,value,hint,filter,kind){
    return '<button type="button" class="ki130-stat" data-ki130-filterjump="'+esc(filter)+'" data-kind="'+esc(kind||'')+'" aria-label="'+esc(label+' — '+value+'، عرض التفاصيل')+'"><span class="ki130-stat-label">'+esc(label)+'</span><span class="ki130-stat-value">'+esc(value)+'</span><span class="ki130-stat-hint">'+esc(hint)+'</span></button>';
  }
  function statusHtml(s){
    return '<span class="ki130-status '+(s==='low'?'low':s==='out'?'out':'')+'">'+(s==='out'?'نفد':s==='low'?'منخفض':'متوفر')+'</span>';
  }
  function actions(r){
    const id=esc(r.id);
    return '<div class="ki130-rowactions"><button type="button" class="btn soft" data-ki130-product="'+id+'">تفاصيل</button>'+
      '<button type="button" class="btn soft" data-ki130-units="'+id+'">أكواد القطع</button>'+
      '<button type="button" class="btn soft" data-ki130-print="'+id+'">طباعة</button></div>';
  }
  function rowHtml(r){
    return '<tr><td><div class="ki130-name">'+esc(r.name)+'</div><div class="ki130-meta">'+esc(r.category||'غير مصنف')+'</div></td>'+
      '<td><span class="ki130-code">'+esc(r.sku||r.barcode||'—')+'</span></td>'+
      '<td><span class="ki130-number">'+count(r.stock)+'</span></td><td>'+count(r.threshold)+'</td>'+
      '<td>'+money(r.value)+' ج.م</td><td>'+statusHtml(r.status)+'</td><td>'+actions(r)+'</td></tr>';
  }
  function mobileHtml(r){
    return '<article class="ki130-mobile-item"><div class="ki130-mobile-top"><div><div class="ki130-name">'+esc(r.name)+'</div><div class="ki130-meta">'+esc(r.category||'غير مصنف')+'</div></div>'+statusHtml(r.status)+'</div>'+
      '<div class="ki130-mobile-fields"><div><small>الرصيد المسجل</small><strong>'+count(r.stock)+'</strong></div><div><small>حد التنبيه</small><strong>'+count(r.threshold)+'</strong></div>'+
      '<div><small>SKU / الكود</small><span class="ki130-code">'+esc(r.sku||r.barcode||'—')+'</span></div><div><small>القيمة بالتكلفة</small><strong>'+money(r.value)+' ج.م</strong></div></div>'+actions(r)+'</article>';
  }
  function selectedRecords(){
    const normalized=query.toLocaleLowerCase('ar-EG').trim();
    const out=records.filter(r=>(stockFilter==='all'||r.status===stockFilter)&&
      (!category||r.category===category)&&(!normalized||r.search.includes(normalized)));
    if(orderBy==='name')out.sort((a,b)=>a.name.localeCompare(b.name,'ar'));
    if(orderBy==='stock-asc')out.sort((a,b)=>a.stock-b.stock||a.index-b.index);
    if(orderBy==='stock-desc')out.sort((a,b)=>b.stock-a.stock||a.index-b.index);
    if(orderBy==='value-desc')out.sort((a,b)=>b.value-a.value||a.index-b.index);
    return out;
  }
  function updateTable(){
    const shell=document.getElementById('ki130Workspace');if(!shell)return;
    const arr=selectedRecords(),pages=Math.max(1,Math.ceil(arr.length/pageSize));page=Math.min(Math.max(1,page),pages);
    const subset=arr.slice((page-1)*pageSize,page*pageSize);
    const tbody=shell.querySelector('#ki130Rows'),mobile=shell.querySelector('#ki130Mobile');
    tbody.innerHTML=subset.length?subset.map(rowHtml).join(''):'<tr><td colspan="7"><div class="ki130-empty">لا توجد منتجات مطابقة للبحث. جرّب إزالة الفلاتر.</div></td></tr>';
    mobile.innerHTML=subset.length?subset.map(mobileHtml).join(''):'<div class="ki130-empty">لا توجد منتجات مطابقة للبحث. جرّب إزالة الفلاتر.</div>';
    shell.querySelector('#ki130Found').textContent='عرض '+count(subset.length)+' من '+count(arr.length)+' منتج مطابق — الصفحة '+count(page)+' من '+count(pages);
    shell.querySelector('#ki130Prev').disabled=page<=1;
    shell.querySelector('#ki130Next').disabled=page>=pages;
    shell.querySelectorAll('[data-ki130-status]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.ki130Status===stockFilter)));
    shell.querySelectorAll('[data-ki130-filterjump]').forEach(b=>b.setAttribute('aria-current',String(activeTab==='products'&&b.dataset.ki130Filterjump===stockFilter)));
  }
  function updateMetrics(){
    const shell=document.getElementById('ki130Workspace');if(!shell)return;
    const total=records.reduce((a,r)=>a+r.stock,0),value=records.reduce((a,r)=>a+r.value,0);
    const low=records.filter(r=>r.status==='low'),out=records.filter(r=>r.status==='out');
    shell.querySelector('#ki130Metrics').innerHTML=[
      metric('المنتجات',count(records.length),'كل الأصناف في العرض الحالي','all','all'),
      metric('رصيد المنتجات',count(total),'إجمالي رصيد الأصناف المسجل','all','units'),
      metric('قيمة المخزون',money(value)+' ج.م','التكلفة × الرصيد المسجل','all','value'),
      metric('مخزون منخفض',count(low.length),'أصناف اقتربت من النفاد','low','low'),
      metric('نفد المخزون',count(out.length),'أصناف تحتاج معالجة','out','out')
    ].join('');
    const alerts=[...out,...low].sort((a,b)=>a.stock-b.stock).slice(0,7);
    shell.querySelector('#ki130Alerts').innerHTML=alerts.length?alerts.map(r=>
      '<div class="ki130-alert-row"><div class="ki130-alert-copy"><b>'+esc(r.name)+'</b><small>الرصيد '+count(r.stock)+' — حد التنبيه '+count(r.threshold)+'</small></div>'+statusHtml(r.status)+
      '<button type="button" class="btn soft" data-ki130-product="'+esc(r.id)+'">عرض</button></div>').join(''):
      '<div class="ki130-empty">المعروض حاليًا لا يحتوي على أصناف منخفضة أو نافدة.</div>';
  }
  function integrationState(){
    const shell=document.getElementById('ki130Workspace');if(!shell)return;
    const messages={units:['unit128Panel','وحدة الباركود وتتبّع القطع'],batches:['v39BatchList','سجل الدفعات'],history:['v37InventoryHistory','سجل الحركات']};
    Object.entries(messages).forEach(([key,[id,title]])=>{
      const notice=shell.querySelector('[data-ki130-wait="'+key+'"]');
      if(notice)notice.hidden=!!document.getElementById(id);
    });
  }
  function setTab(tab,focus=false){
    if(!tabs.some(t=>t[0]===tab))return;
    activeTab=tab;root.dataset.ki130Tab=tab;
    const shell=document.getElementById('ki130Workspace');if(!shell)return;
    shell.querySelectorAll('[data-ki130-tab]').forEach(btn=>{
      const chosen=btn.dataset.ki130Tab===tab;
      btn.setAttribute('aria-selected',String(chosen));btn.tabIndex=chosen?0:-1;
      if(focus&&chosen)btn.focus();
    });
    integrationState();
  }
  function openStockAdjust(){
    const trigger=document.getElementById('stockAdjust');
    if(trigger)trigger.click();else if(window.KunActionsV23?.openStockAdjust)window.KunActionsV23.openStockAdjust().catch(e=>notify(e.message));
    else notify('إجراء تسوية المخزون غير متاح حاليًا.');
  }
  function openBatch(){
    const trigger=document.getElementById('v39NewBatch')||document.getElementById('v39NewBatchInside');
    if(trigger)trigger.click();else if(window.KunStockBatchVariantsV50?.open)window.KunStockBatchVariantsV50.open().catch(e=>notify(e.message));
    else notify('جارٍ تجهيز نموذج إضافة الدفعة. افتح تبويب الدفعات.');
  }
  function openWarehouse(){
    const trigger=document.querySelector('#unit128Panel [data-warehouse-ops]');
    if(trigger)trigger.click();else{setTab('units');notify('أدوات الجرد والتجهيز قيد التحميل.');}
  }
  function openCamera(){
    if(window.KunUnitTrackingV128?.scan)window.KunUnitTrackingV128.scan();
    else{setTab('units');notify('الماسح قيد التحميل.');}
  }
  function goProduct(id){
    if(!id)return notify('هذا المنتج ليس له معرّف متاح.');
    if(typeof openProduct==='function')openProduct(id);
    else{document.querySelector('.nav button[data-view="products"]')?.click();notify('افتح المنتج من قسم المنتجات.');}
  }
  function unitAction(id,type){
    if(!id)return notify('لا يوجد معرّف منتج لعرض الأكواد.');
    const attr=type==='print'?'unitPrintProduct':'unitOpenProduct';
    const button=[...document.querySelectorAll('#unit128Panel [data-'+(type==='print'?'unit-print-product':'unit-open-product')+']')]
      .find(b=>b.dataset[attr]===id);
    if(button){button.click();return;}
    setTab('units');
    notify('افتح القطع والباركود لمراجعة أكواد المنتج بعد اكتمال التحميل.');
  }
  function exportCsv(){
    const data=selectedRecords();
    const safe=value=>{
      const s=String(value??'');
      const protectedText=/^\s*[=+@-]/.test(s)?"'"+s:s;
      return '"'+protectedText.replace(/"/g,'""')+'"';
    };
    const lines=[['المنتج','SKU','باركود المنتج','التصنيف','الرصيد','حد التنبيه','تكلفة الوحدة','قيمة المخزون','الحالة'],
      ...data.map(x=>[x.name,x.sku,x.barcode,x.category,x.stock,x.threshold,x.cost,x.value,x.status==='out'?'نفد':x.status==='low'?'منخفض':'متوفر'])];
    const csv='\uFEFF'+lines.map(x=>x.map(safe).join(',')).join('\r\n');
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download='kun-inventory-filtered.csv';document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    notify('تم تجهيز ملف المنتجات المفلترة.');
  }
  function mount(){
    if(!isActive()){root.classList.remove('ki130-ready');return;}
    if(document.getElementById('ki130Workspace')){integrationState();return;}
    const head=[...root.children].find(x=>x.classList?.contains('page-head'));
    if(!head)return;
    records=toRecords();query='';stockFilter='all';category='';orderBy='default';page=1;
    const shell=document.createElement('div');shell.id='ki130Workspace';shell.className='ki130';
    const tabButtons=tabs.map(([id,label])=>'<button id="ki130-tab-'+id+'" class="ki130-tab" type="button" role="tab" data-ki130-tab="'+id+'" aria-selected="false" tabindex="-1" aria-controls="ki130-panel-'+id+'">'+esc(label)+'</button>').join('');
    const categories=[...new Set(records.map(r=>r.category).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ar'));
    const categoryOptions='<option value="">كل التصنيفات</option>'+categories.map(c=>'<option value="'+esc(c)+'">'+esc(c)+'</option>').join('');
    shell.innerHTML=
      '<section class="ki130-hero" aria-label="لوحة إدارة المخزون"><div><div class="ki130-eyebrow">KUN ONLINE / INVENTORY</div><h1 class="ki130-title">إدارة المخزون</h1><p class="ki130-sub">رصيد واضح، حركات موثقة، وأكواد مستقلة لكل قطعة. كل عمليات المخزن في مساحة عمل واحدة.</p></div><div class="ki130-actions">'+
      '<button type="button" class="btn primary" data-ki130-action="batch">+ إضافة دفعة مخزون</button>'+
      '<button type="button" class="btn soft" data-ki130-action="adjust">تسوية الرصيد</button>'+
      '<button type="button" class="btn soft" data-ki130-action="camera">مسح باركود</button>'+
      '</div></section>'+
      '<div id="ki130Metrics" class="ki130-cards" aria-label="مؤشرات المخزون"></div>'+
      '<div class="ki130-tabs" role="tablist" aria-label="أقسام المخزون">'+tabButtons+'</div>'+
      '<section id="ki130-panel-overview" data-ki130-panel="overview" role="tabpanel" aria-labelledby="ki130-tab-overview"><div class="ki130-grid">'+
      '<div class="ki130-box"><h2>تنبيهات تحتاج إجراء</h2><p class="ki130-lead">الأصناف التي نفدت أو اقتربت من حد إعادة الطلب؛ افتح المنتج لفحص بياناته.</p><div id="ki130Alerts"></div><button type="button" class="btn soft mt" data-ki130-jump="products" data-ki130-filter-value="low">عرض المخزون المنخفض</button></div>'+
      '<div class="ki130-box"><h2>دورة القطعة في المخزن</h2><p class="ki130-lead">كل خطوة مرتبطة بأدوات النظام الأصلية دون تكرار سجل أو رقم.</p><div class="ki130-steps">'+
      '<div class="ki130-step"><span class="ki130-step-number">1</span><div><b>استلام البضاعة وتكويدها</b><small>أضف دفعة جديدة ثم راجع تغطية أكواد القطع.</small></div></div>'+
      '<div class="ki130-step"><span class="ki130-step-number">2</span><div><b>تجهيز الطلب بالمسح</b><small>افتح شاشة التشغيل وامسح كود الطلب والقطع قبل تسليم الشحنة.</small></div></div>'+
      '<div class="ki130-step"><span class="ki130-step-number">3</span><div><b>الجرد والمرتجع</b><small>طابق القطع ثم سجّل فحص المرتجع وتحديد مصيره عبر العمليات المعتمدة.</small></div></div></div>'+
      '<div class="ki130-oper-actions"><button type="button" class="btn primary" data-ki130-action="warehouse">فتح تجهيز / جرد</button><button type="button" class="btn soft" data-ki130-jump="units">تتبّع القطع</button></div></div></div></section>'+
      '<section id="ki130-panel-products" data-ki130-panel="products" role="tabpanel" aria-labelledby="ki130-tab-products"><div class="ki130-box">'+
      '<div class="ki130-hero-lite"><h2>أرصدة المنتجات</h2><p class="ki130-lead">ابحث ورتّب وراجع تفاصيل المنتج أو الأكواد المرتبطة به. البيانات للقراءة فقط؛ تغييرات الرصيد تتم من الإجراءات المعتمدة.</p></div>'+
      '<div class="ki130-table-toolbar"><label><span class="ki130-label">البحث</span><input id="ki130Search" class="input ki130-search" type="search" autocomplete="off" placeholder="اسم المنتج، SKU، الباركود..." aria-label="بحث في المخزون"></label>'+
      '<label><span class="ki130-label">التصنيف</span><select id="ki130Category" class="select" aria-label="فلتر التصنيف">'+categoryOptions+'</select></label>'+
      '<label><span class="ki130-label">الترتيب</span><select id="ki130Sort" class="select" aria-label="ترتيب النتائج"><option value="default">الترتيب الحالي</option><option value="name">بالاسم</option><option value="stock-asc">الأقل كمية</option><option value="stock-desc">الأعلى كمية</option><option value="value-desc">الأعلى قيمة</option></select></label></div>'+
      '<div class="ki130-filterbar" role="group" aria-label="حالة المخزون">'+
      '<button class="ki130-filter" type="button" data-ki130-status="all" aria-pressed="true">الكل</button>'+
      '<button class="ki130-filter" type="button" data-ki130-status="healthy" aria-pressed="false">متوفر</button>'+
      '<button class="ki130-filter" type="button" data-ki130-status="low" aria-pressed="false">منخفض</button>'+
      '<button class="ki130-filter" type="button" data-ki130-status="out" aria-pressed="false">نفد</button>'+
      '<button class="btn soft" type="button" data-ki130-action="export">تصدير النتائج CSV</button></div>'+
      '<div class="table-wrap ki130-table-wrap"><table class="ki130-table"><thead><tr><th>المنتج</th><th>SKU</th><th>المتاح</th><th>حد التنبيه</th><th>القيمة</th><th>الحالة</th><th>الإجراءات</th></tr></thead><tbody id="ki130Rows"></tbody></table></div>'+
      '<div class="ki130-mobile-list" id="ki130Mobile"></div>'+
      '<div class="ki130-foot"><span id="ki130Found" role="status" aria-live="polite"></span><div class="ki130-pager"><label for="ki130Size">في الصفحة</label><select class="select" id="ki130Size" style="width:auto"><option value="25">25</option><option value="50">50</option><option value="100">100</option></select><button type="button" class="btn soft" id="ki130Prev">السابق</button><button type="button" class="btn soft" id="ki130Next">التالي</button></div></div>'+
      '</div></section>'+
      '<section id="ki130-panel-units" data-ki130-panel="units" role="tabpanel" aria-labelledby="ki130-tab-units"><div class="ki130-warning">عرض أكواد القطع، طباعة الملصقات، المسح، وسجل حركة كل قطعة موجود أسفل هذا التوضيح، باستخدام نظام التتبع الأساسي دون تغيير بياناته.</div><div data-ki130-wait="units" class="ki130-empty mt">جارٍ تحميل وحدة الباركود وتتبّع القطع…</div></section>'+
      '<section id="ki130-panel-batches" data-ki130-panel="batches" role="tabpanel" aria-labelledby="ki130-tab-batches"><div class="ki130-oper-actions"><button type="button" class="btn primary" data-ki130-action="batch">+ إضافة دفعة مخزون</button></div><div data-ki130-wait="batches" class="ki130-empty mt">جارٍ تحميل دفعات المخزون…</div></section>'+
      '<section id="ki130-panel-history" data-ki130-panel="history" role="tabpanel" aria-labelledby="ki130-tab-history"><div data-ki130-wait="history" class="ki130-empty">جارٍ تحميل الحركات وسجل التسويات…</div></section>'+
      '<section id="ki130-panel-operations" data-ki130-panel="operations" role="tabpanel" aria-labelledby="ki130-tab-operations"><div class="ki130-grid">'+
      '<div class="ki130-box"><h2>غرفة عمليات المخزن</h2><p class="ki130-lead">شاشة واحدة متصلة بإجراءات المسح الموجودة: تجهيز أوردر، بوليصة J&T، تسليم، جرد، نقل، مرتجع وفحص.</p>'+
      '<div class="ki130-oper-actions"><button type="button" class="btn primary" data-ki130-action="warehouse">فتح شاشة التشغيل</button><button type="button" class="btn soft" data-ki130-action="camera">مسح كود قطعة</button></div></div>'+
      '<div class="ki130-box"><h2>ضوابط التشغيل</h2><div class="ki130-steps"><div class="ki130-step"><span class="ki130-step-number">✓</span><div><b>لا يتم اعتبار القطعة مشحونة بمجرد طباعة الكود</b><small>الحالة تتغير عبر خطوات التسليم المعتمدة.</small></div></div>'+
      '<div class="ki130-step"><span class="ki130-step-number">✓</span><div><b>المرتجع يحتاج قرار فحص</b><small>صالح للمخزون، حجر، أو تالف وفق صلاحيات النظام.</small></div></div></div></div></div></section>';
    root.prepend(shell);
    root.classList.add('ki130-ready');root.dataset.ki130Tab=activeTab;
    bind(shell);updateMetrics();updateTable();setTab(activeTab);integrationState();
  }
  function bind(shell){
    shell.addEventListener('click',event=>{
      const b=event.target.closest('button');if(!b||!shell.contains(b))return;
      if(b.hasAttribute('data-ki130-tab')){setTab(b.dataset.ki130Tab);return;}
      if(b.hasAttribute('data-ki130-filterjump')){
        stockFilter=b.dataset.ki130Filterjump;page=1;setTab('products');updateTable();return;
      }
      if(b.hasAttribute('data-ki130-status')){stockFilter=b.dataset.ki130Status;page=1;updateTable();return;}
      if(b.hasAttribute('data-ki130-jump')){
        if(b.dataset.ki130FilterValue){stockFilter=b.dataset.ki130FilterValue;page=1;}
        setTab(b.dataset.ki130Jump);updateTable();return;
      }
      if(b.hasAttribute('data-ki130-product'))return goProduct(b.dataset.ki130Product);
      if(b.hasAttribute('data-ki130-units'))return unitAction(b.dataset.ki130Units,'units');
      if(b.hasAttribute('data-ki130-print'))return unitAction(b.dataset.ki130Print,'print');
      if(b.hasAttribute('data-ki130-action')){
        const actions={adjust:openStockAdjust,batch:openBatch,camera:openCamera,warehouse:openWarehouse,export:exportCsv};
        actions[b.dataset.ki130Action]?.();
      }
    });
    shell.querySelector('.ki130-tabs').addEventListener('keydown',e=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
      const current=tabs.findIndex(([id])=>id===activeTab),last=tabs.length-1;
      const next=e.key==='Home'?0:e.key==='End'?last:(current+(e.key==='ArrowLeft'?1:-1)+tabs.length)%tabs.length;
      e.preventDefault();setTab(tabs[next][0],true);
    });
    shell.querySelector('#ki130Search').addEventListener('input',e=>{query=e.target.value;page=1;updateTable();});
    shell.querySelector('#ki130Category').addEventListener('change',e=>{category=e.target.value;page=1;updateTable();});
    shell.querySelector('#ki130Sort').addEventListener('change',e=>{orderBy=e.target.value;page=1;updateTable();});
    shell.querySelector('#ki130Size').addEventListener('change',e=>{pageSize=Number(e.target.value)||25;page=1;updateTable();});
    shell.querySelector('#ki130Prev').addEventListener('click',()=>{page=Math.max(1,page-1);updateTable();});
    shell.querySelector('#ki130Next').addEventListener('click',()=>{page++;updateTable();});
  }
  const observer=new MutationObserver(mount);
  observer.observe(root,{childList:true,subtree:false});
  document.addEventListener('click',e=>{
    if(e.target.closest?.('.nav button[data-view="inventory"]'))setTimeout(mount,0);
  },true);
  mount();
  window.KunInventoryWorkspaceV130={version,goToTab:setTab,refresh:mount};
})();
