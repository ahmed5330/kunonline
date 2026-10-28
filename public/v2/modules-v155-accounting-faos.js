/* Kun Online FAOS v1 — additive accounting workspace; no production fixture writes. */
(function(){
  'use strict';
  if(window.KunFAOSAccountingV1)return;
  const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=(v,c='EGP')=>new Intl.NumberFormat('ar-EG',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(v)||0)+' '+(c==='EGP'?'ج.م':esc(c));
  const state={view:'health',data:null,simulation:null,catalog:[],busy:false,pendingTab:null,loadedScope:null};
  const root=()=>document.querySelector('.acc100');
  const active=()=>document.querySelector('.nav button.active[data-view]')?.dataset.view==='accounting';
  const currentMonth=()=>document.getElementById('acc100Month')?.value||new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit'}).format(new Date());
  async function scope(){
    const cid=window.kunClientId?await window.kunClientId():'';
    const sid=window.kunStoreId?await window.kunStoreId():'';
    return {clientId:cid||'',storeId:sid||''};
  }
  async function api(path,{method='GET',body=null,params={},expectedScope=null}={}){
    const ctx=await scope(),u=new URL(path,location.origin);
    if(expectedScope&&(ctx.clientId!==expectedScope.clientId||ctx.storeId!==expectedScope.storeId))throw new Error('تغير المتجر؛ حدّث الدفتر قبل إعادة المحاولة');
    if(ctx.clientId)u.searchParams.set('clientId',ctx.clientId);
    if(ctx.storeId)u.searchParams.set('storeId',ctx.storeId);
    Object.entries(params).forEach(([k,v])=>v&&u.searchParams.set(k,String(v)));
    const r=await fetch(u.pathname+u.search,{method,credentials:'include',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify({...body,clientId:ctx.clientId,storeId:body.storeId||ctx.storeId}):undefined});
    const d=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(d.error||'HTTP '+r.status);
    return d;
  }
  function ensureCss(){
    if(document.getElementById('kunFaosCss'))return;
    const style=document.createElement('style');style.id='kunFaosCss';
    style.textContent=`
    .faos-v1{direction:rtl;margin:16px 0;padding:18px;background:#fff;border:1px solid #e2e8f0;border-radius:18px;box-shadow:0 2px 8px rgba(15,23,42,.03)}
    .faos-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
    .faos-head h3{margin:0;color:#15243d;font-size:19px}
    .faos-head p{font-size:12px;color:#64748b;line-height:1.7;margin:5px 0}
    .faos-tabs{display:flex;gap:7px;overflow-x:auto;margin:13px 0 16px;padding-bottom:4px}
    .faos-tabs button,.faos-action{cursor:pointer;white-space:nowrap;border:1px solid #cbd5e1;border-radius:10px;padding:8px 12px;background:#fff;color:#24344f;font-weight:700;font:inherit;font-size:12px}
    .faos-tabs button.active{background:#e8f0ff;border-color:#93b4eb;color:#1e40af}
    .faos-kpis{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
    .faos-kpi{border:1px solid #e2e8f0;border-radius:12px;padding:13px;min-width:0;background:#f8fafc}
    .faos-kpi span{display:block;color:#64748b;font-size:11px}.faos-kpi strong{display:block;margin-top:7px;font-size:19px;overflow-wrap:anywhere}
    .faos-note{font-size:12px;line-height:1.85;margin:12px 0;padding:10px 12px;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;color:#92400e}
    .faos-ok{background:#f0fdf4;border-color:#bbf7d0;color:#166534}
    .faos-table-wrap{overflow-x:auto}.faos-table{width:100%;min-width:540px;border-collapse:collapse;font-size:12px}
    .faos-table th,.faos-table td{padding:10px;border-bottom:1px solid #e2e8f0;text-align:right}.faos-table th{background:#f8fafc;color:#475569}
    .faos-actions{display:flex;flex-wrap:wrap;gap:9px;align-items:center}
    .faos-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
    .faos-form label{font-size:12px;display:grid;gap:5px}
    .faos-form input,.faos-form select{padding:9px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:#0f172a;width:100%}
    .faos-form .full{grid-column:1/-1}.faos-muted{color:#64748b;font-size:12px;line-height:1.9}
    #kunFaosNavShortcut{width:calc(100% - 12px);margin:5px 6px 12px;display:flex;align-items:center;gap:10px;text-align:right;direction:rtl;justify-content:flex-start;border:1px solid #93c5fd;border-radius:12px;background:linear-gradient(120deg,#eff6ff,#f0fdfa);color:#164e63;font-weight:800;padding:11px 12px;cursor:pointer;box-sizing:border-box}
    #kunFaosNavShortcut:hover,#kunFaosNavShortcut:focus-visible{background:#dbeafe;outline:2px solid #3b82f6;outline-offset:1px}
    #kunFaosNavShortcut .faos-shortcut-icon{font-size:19px}
    @media(max-width:680px){.faos-v1{padding:12px}.faos-kpis{grid-template-columns:1fr 1fr}.faos-form{grid-template-columns:1fr}.faos-form .full{grid-column:auto}}
    `;document.head.appendChild(style);
  }
  const tabs=[['health','مراجعة الأرقام'],['ledger','الأستاذ وميزان المراجعة'],['sim','اختبار الطلبات الوهمية'],['entry','قيد جديد']];
  function shell(){
    const section=document.createElement('section');section.className='faos-v1';section.id='kunFaosWorkspace';
    section.innerHTML='<div class="faos-head"><div><h3>مركز الحسابات والدفتر المحاسبي</h3><p>تحقق مالي ومقارنة مصادر الأرقام — وفق مرجع FAOS؛ البيانات الافتراضية منفصلة بالكامل.</p></div><button class="faos-action" id="faosRefresh">تحديث الحسابات</button></div><div class="faos-tabs">'+tabs.map(([id,label])=>'<button data-faos-tab="'+id+'">'+label+'</button>').join('')+'</div><div id="faosBody" aria-live="polite"></div>';
    section.querySelector('#faosRefresh').onclick=()=>refresh();
    section.querySelectorAll('[data-faos-tab]').forEach(b=>b.onclick=()=>{state.view=b.dataset.faosTab;render()});
    return section;
  }
  async function refresh(){
    const el=document.getElementById('faosBody');if(!el||state.busy)return;state.busy=true;
    el.innerHTML='<p class="faos-muted">جارٍ فحص مصادر الحسابات ودفتر الأستاذ...</p>';
    try{
      const loadedScope=await scope();
      const mm=currentMonth(),year=mm.split('-')[0],month=Number(mm.split('-')[1]),end=new Date(Date.UTC(Number(year),month,0)).toISOString().slice(0,10);
      const outcomes=await Promise.allSettled([
        api('/api/accounting/faos/overview',{params:{from:mm+'-01',to:end}}),
        api('/api/accounting/faos/simulation'),
        api('/api/accounting/faos/catalog')
      ]);
      const current=await scope();
      if(current.clientId!==loadedScope.clientId||current.storeId!==loadedScope.storeId){state.data={__error:'تغير المتجر؛ حدّث الدفتر'};state.loadedScope=null;render();return;}
      state.loadedScope=loadedScope;
      state.data=outcomes[0].status==='fulfilled'?outcomes[0].value:{__error:outcomes[0].reason?.message||'تعذر تحميل دفتر القيود'};
      state.simulation=outcomes[1].status==='fulfilled'?outcomes[1].value:null;
      state.catalog=outcomes[2].status==='fulfilled'?outcomes[2].value.accounts||[]:[];
      render();
    }finally{state.busy=false}
  }
  function table(cols,rows){
    return '<div class="faos-table-wrap"><table class="faos-table"><thead><tr>'+cols.map(x=>'<th>'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(c=>'<td>'+c+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
  }
  function health(){
    const x=state.data;
    if(!x||x.__error)return '<div class="faos-note">'+esc(x?.__error||'لم يتم تحميل التقرير')+'</div><p class="faos-muted">اختبار الطلبات الوهمية يظل متاحًا حتى قبل تطبيق ترحيل قاعدة البيانات.</p>';
    const old=x.legacy||{},ledger=x.ledger||{},q=x.warnings||[],quality=x.quality||{},recon=x.reconciliation||{};
    return '<div class="faos-kpis">'+
      [['طلبات محصلة دون مبلغ مؤكد',old.unverifiedCollectedOrders||0],['تحصيل بحركة مسجلة',money(old.verifiedCollectedRevenue,old.currency)],['تحصيل مُقدر داخل النظام القديم',money(Math.max(0,(old.collectedRevenue||0)-(old.verifiedCollectedRevenue||0)),old.currency)],['ميزان القيد الجديد',ledger.balanced?'متوازن':'غير متوازن']].map(([k,v])=>'<div class="faos-kpi"><span>'+esc(k)+'</span><strong>'+esc(v)+'</strong></div>').join('')+'</div>'+
      '<div class="faos-note">تنبيه محاسبي: قيمة الطلب أو حالة «تم التحصيل» وحدها لا تثبت انتقال الأموال للبنك. لا تتعامل مع صافي التدفق التشغيلي باعتباره رصيدًا بنكيًا أو مع الدفتر الجديد كقوائم نهائية قبل ترحيل كل الأحداث.</div>'+
      '<h4>تقرير مطابقة المصادر — غير معتمد</h4>'+
      '<p class="faos-muted">'+esc(recon.reason||'يجب تأكيد المستندات والتسويات قبل اعتماد الفروق.')+'</p>'+
      table(['المؤشر','التشغيل','دفتر FAOS','فرق الحساب','حالة التحقق'],(recon.rows||[]).map(r=>[
        esc(r.label),
        r.operational===null?'غير متاح':money(r.operational),
        r.ledger===null?'لم تتم المطابقة':money(r.ledger),
        r.variance===null?'—':money(r.variance),
        esc(r.status==='not_applicable'?'لا ينطبق':'بانتظار مطابقة المستندات')
      ]))+
      '<h4>مؤشرات جودة البيانات والمطابقة</h4>'+table(['الفحص','النتيجة','المعنى'],[
      ['طلبات عليها نقص في التحصيل',esc(quality.unverifiedCollectedOrders||0),'تحتاج كشف تسوية'],
      ['طلبات لم يثبت الاعتراف بإيرادها',money(quality.unrecognizedPipelineValue),'Pipeline وليس إيرادًا'],
      ['طلبات مباعة دون تكلفة مثبتة',esc(quality.missingSaleCostSnapshots||0),'التكلفة بحاجة إلى مطابقة مع المخزون'],
      ['مشتريات مصروفة يدويًا',money(quality.inventoryPurchasesExpensed),'احتمال تكرار COGS'],
      ['رسوم إدارة لم تُعكس',esc(quality.unreversedManagementFees||0),'لا يجوز تحميل المرتجع رسوم بيع'],
      ['إعلانات مدخلة يدويًا',money(quality.manualAdExpense),'تحتاج مطابقة مع مصدر Meta']
    ])+
      q.map(w=>'<p class="faos-muted">• '+esc(w.text)+(w.count?' ('+esc(w.count)+')':'')+'</p>').join('')+
      '<p class="faos-muted">صافي ربح دفتر FAOS المُرحّل فقط: '+money(ledger.netProfit,old.currency)+' — يختلف عن مؤشرات الحسابات القديمة لحين ربط الأحداث ومطابقتها.</p>';
  }
  function ledger(){
    const x=state.data;if(!x||x.__error)return '<div class="faos-note">'+esc(x?.__error||'دفتر القيود غير متاح')+'</div>';
    const l=x.ledger||{},accounts=l.accounts||[];
    const rows=accounts.map(a=>[esc(a.code),esc(a.name),money(a.debit),money(a.credit),money(a.net)]);
    const recent=(x.journals||[]).map(j=>[esc(j.entryDate),esc(j.description),esc(j.storeId),esc(j.sourceType)]);
    return '<div class="faos-kpis"><div class="faos-kpi"><span>إجمالي مدين</span><strong>'+money(l.totalDebit)+'</strong></div><div class="faos-kpi"><span>إجمالي دائن</span><strong>'+money(l.totalCredit)+'</strong></div><div class="faos-kpi"><span>الفرق</span><strong>'+money((l.totalDebit||0)-(l.totalCredit||0))+'</strong></div></div>'+
      '<div class="faos-note">القوائم التالية من دفتر FAOS المُرحّل فقط، وليست القوائم النهائية للمتجر؛ لا تزال مطابقة الطلبات والمخزون وJ&T والبنوك غير معتمدة.</div>'+
      '<h4>المركز المالي حتى '+esc(l.balanceSheet?.asOf||'—')+'</h4>'+
      '<div class="faos-kpis"><div class="faos-kpi"><span>الأصول</span><strong>'+money(l.balanceSheet?.assets)+'</strong></div><div class="faos-kpi"><span>الالتزامات</span><strong>'+money(l.balanceSheet?.liabilities)+'</strong></div><div class="faos-kpi"><span>حقوق الملكية والأرباح</span><strong>'+money(l.balanceSheet?.equity)+'</strong></div></div>'+
      '<p class="faos-muted">فرق معادلة الميزانية: '+money(l.balanceSheet?.difference)+' · '+(l.balanceSheet?.balanced?'متوازنة حسابيًا':'تحتاج مراجعة')+'</p>'+
      '<h4>قائمة الدخل للفترة المختارة</h4>'+table(['البند','المبلغ'],[['إيرادات البيع',money(l.incomeStatement?.revenue)],['مردودات ومسموحات البيع',money(l.incomeStatement?.returns)],['صافي الإيراد',money(l.incomeStatement?.netRevenue)],['المصروفات وتكلفة البضاعة',money(l.incomeStatement?.expenses)],['صافي الربح/الخسارة',money(l.incomeStatement?.netProfit)]])+
      '<h4>ميزان المراجعة — القيود الجديدة فقط</h4>'+table(['الكود','الحساب','مدين','دائن','الصافي'],rows)+
      '<h4>آخر قيود اليومية</h4>'+table(['التاريخ','البيان','المتجر','المصدر'],recent);
  }
  function simulation(){
    const s=state.simulation;if(!s)return '<div class="faos-note">تعذر تحميل سيناريو الاختبار</div>';
    const cases=(s.fakeOrders||[]).map(o=>[esc(o.id),esc(o.state),money(o.total),money(o.recognizedRevenue),esc(o.notes)]);
    const checks=(s.checks||[]).map(c=>[esc(c.id),c.pass?'✓ اجتاز':'✕ فشل']);
    return '<div class="faos-note faos-ok"><strong>اختبار معزول 100٪:</strong> لا تُنشأ طلبات على Easy Order، ولا تُخصم رسوم محفظة، ولا تُرسل بوليصات J&T. كل النتائج من قيود وهمية في الذاكرة فقط.</div>'+
      '<div class="faos-kpis"><div class="faos-kpi"><span>صافي الربح المتوقع</span><strong>'+money(s.expected?.netProfit)+'</strong></div><div class="faos-kpi"><span>صافي الربح المحسوب</span><strong>'+money(s.actual?.netProfit)+'</strong></div><div class="faos-kpi"><span>اتزان اليومية</span><strong>'+(s.balanced?'سليم':'خطأ')+'</strong></div></div>'+
      '<div class="faos-kpis"><div class="faos-kpi"><span>إجمالي الأصول</span><strong>'+money(s.actual?.assets)+'</strong></div><div class="faos-kpi"><span>إجمالي الالتزامات</span><strong>'+money(s.actual?.liabilities)+'</strong></div><div class="faos-kpi"><span>حقوق الملكية مع صافي الربح</span><strong>'+money(s.actual?.equity)+'</strong></div></div><p class="faos-muted">الأصول = الالتزامات + حقوق الملكية: '+(s.actual?.assets===s.actual?.liabilities+s.actual?.equity?'✓ متطابق':'✕ غير متطابق')+'</p>'+'<h4>طلبات وهمية (4)</h4>'+table(['الطلب','الحالة','قيمته','إيراد معترف به','التفسير'],cases)+
      '<h4>اختبارات المحاسبة</h4>'+table(['قاعدة الاختبار','النتيجة'],checks)+
      '<p class="faos-muted">القيود الافتراضية: '+esc(s.journalCount)+' قيدًا · مدين '+money(s.totals?.debit)+' · دائن '+money(s.totals?.credit)+'</p>';
  }
  function entry(){
    if(state.data?.capabilities?.financialPostingEnabled!==true)return '<div class="faos-note">إضافة القيود مغلقة حاليًا للحماية. الدفتر متاح للقراءة والمحاكاة فقط حتى تشغيل Preview المختبري والموافقة على المطابقة. لا يمكن إضافة قيود أو تغيير أرصدة العملاء في هذه الحالة.</div>';
    const accounts=state.catalog.filter(a=>a.code!=='4090'),opts=accounts.map(a=>'<option value="'+esc(a.code)+'">'+esc(a.code)+' — '+esc(a.name)+'</option>').join('');
    return '<div class="faos-note">تسجيل قيد حقيقي في دفتر FAOS المستقل. لا تعدل الأوامر أو رصيد المحفظة أو المبيعات القديمة. القيود المرحلة لا تُحذف وتصحح فقط بقيد عكسي.</div>'+
      '<form id="faosEntryForm" class="faos-form"><label>التاريخ<input type="date" name="date" required value="'+new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())+'"></label>'+
      '<label class="full">نوع القيد<select name="entryMode"><option value="quick">قيد سريع — سطران</option><option value="multi">قيد متعدد الأسطر</option></select></label>'+
      '<label data-faos-quick>قيمة القيد (جنيه)<input type="number" name="amount" required min="0.01" step="0.01"></label>'+
      '<label data-faos-quick>الحساب المدين<select name="debit" required>'+opts+'</select></label><label data-faos-quick>الحساب الدائن<select name="credit" required>'+opts+'</select></label>'+
      '<section class="full" data-faos-multi hidden style="display:none"><div class="faos-table-wrap"><table class="faos-table"><thead><tr><th>الحساب</th><th>مدين</th><th>دائن</th><th>بيان السطر</th><th>حذف</th></tr></thead><tbody data-faos-lines></tbody></table></div><button type="button" class="faos-action" data-faos-add>إضافة سطر</button><p role="status" data-faos-totals></p></section>'+
      '<label class="full">البيان<input name="description" required minlength="3" maxlength="500" placeholder="مثال: مصروف معتمد بمستند رقم ..."></label>'+
      '<div class="full faos-actions"><button class="faos-action" type="submit">مراجعة وترحيل القيد</button><span id="faosEntryFeedback" class="faos-muted"></span></div></form>';
  }
  function minor(value){
    const text=String(value??'').trim();if(text==='')return 0;
    if(!/^\d+(?:\.\d{1,2})?$/.test(text))throw new Error('أدخل مبلغًا غير سالب بدقة قرشين');
    const [whole,fraction='']=text.split('.'),n=Number(whole)*100+Number(fraction.padEnd(2,'0'));
    if(!Number.isSafeInteger(n))throw new Error('المبلغ أكبر من الحد المدعوم');return n;
  }
  function validateEntryLines(rows,catalog=state.catalog){
    if(rows.length<2||rows.length>50)throw new Error('القيد يحتاج من سطرين إلى 50 سطرًا');
    let debit=0,credit=0;const allowed=new Set(catalog.filter(a=>a.code!=='4090').map(a=>a.code));
    const lines=rows.map(r=>{
      if(!allowed.has(r.accountCode))throw new Error('اختر حسابًا من دليل الحسابات');
      const dr=minor(r.debit),cr=minor(r.credit);if((dr>0)===(cr>0))throw new Error('كل سطر يحتاج مبلغًا في المدين أو الدائن فقط');
      debit+=dr;credit+=cr;if(!Number.isSafeInteger(debit)||!Number.isSafeInteger(credit))throw new Error('إجمالي القيد أكبر من الحد المدعوم');
      return {accountCode:r.accountCode,debit:dr/100,credit:cr/100,memo:String(r.memo||'').slice(0,250)};
    });
    if(debit!==credit)throw new Error('القيد غير متوازن — الفرق '+money((debit-credit)/100));
    return lines;
  }
  function bindEntry(form){
    const multi=form.querySelector('[data-faos-multi]'),body=form.querySelector('[data-faos-lines]'),mode=form.elements.entryMode;
    const options=state.catalog.filter(a=>a.code!=='4090').map(a=>'<option value="'+esc(a.code)+'">'+esc(a.code)+' — '+esc(a.name)+'</option>').join('');
    const rows=()=>[...body.querySelectorAll('tr')].map(row=>Object.fromEntries([...row.querySelectorAll('[data-field]')].map(el=>[el.dataset.field,el.value])));
    function totals(){
      const info=form.querySelector('[data-faos-totals]');
      try{const data=rows(),dr=data.reduce((sum,r)=>sum+minor(r.debit),0),cr=data.reduce((sum,r)=>sum+minor(r.credit),0);info.textContent='مدين: '+money(dr/100)+' · دائن: '+money(cr/100)+' · الفرق: '+money((dr-cr)/100);}catch(e){info.textContent=e.message;}
      body.querySelectorAll('[data-faos-remove]').forEach(b=>b.disabled=body.children.length<=2);
      form.querySelector('[data-faos-add]').disabled=body.children.length>=50;
    }
    function add(){
      if(body.children.length>=50)return;
      const row=document.createElement('tr');row.innerHTML='<td><select data-field="accountCode" aria-label="حساب السطر">'+options+'</select></td><td><input data-field="debit" inputmode="decimal" aria-label="مدين" maxlength="16"></td><td><input data-field="credit" inputmode="decimal" aria-label="دائن" maxlength="16"></td><td><input data-field="memo" aria-label="بيان السطر" maxlength="250"></td><td><button type="button" class="faos-action" data-faos-remove>حذف السطر</button></td>';
      row.querySelector('[data-faos-remove]').onclick=()=>{if(body.children.length>2){row.remove();totals();}};body.appendChild(row);totals();
    }
    add();add();body.oninput=totals;form.querySelector('[data-faos-add]').onclick=add;
    mode.onchange=()=>{
      const isMulti=mode.value==='multi';multi.hidden=!isMulti;multi.style.display=isMulti?'':'none';
      form.querySelectorAll('[data-faos-quick]').forEach(label=>{label.hidden=isMulti;label.style.display=isMulti?'none':'';label.querySelectorAll('input,select').forEach(el=>el.disabled=isMulti);});
      form.querySelector('#faosEntryFeedback').textContent='';
    };
    return rows;
  }
  function render(){
    const body=document.getElementById('faosBody');if(!body)return;
    document.querySelectorAll('#kunFaosWorkspace [data-faos-tab]').forEach(x=>x.classList.toggle('active',x.dataset.faosTab===state.view));
    body.innerHTML=({health,ledger,sim:simulation,entry})[state.view]();
    const form=document.getElementById('faosEntryForm');
    const entryScope=state.loadedScope?{...state.loadedScope}:null;
    const entryRows=form?bindEntry(form):null;
    if(form)form.onsubmit=async e=>{
      e.preventDefault();const feedback=document.getElementById('faosEntryFeedback'),v=Object.fromEntries(new FormData(form));
      if(form.dataset.submitting==='1')return;
      let lines;
      try{
        if(v.entryMode!=='multi'&&v.debit===v.credit)throw new Error('اختار حسابين مختلفين');
        lines=validateEntryLines(v.entryMode==='multi'?entryRows():[{accountCode:v.debit,debit:v.amount},{accountCode:v.credit,credit:v.amount}]);
      }catch(error){feedback.textContent=error.message;return;}
      const ctx=await scope();if(!ctx.storeId){feedback.textContent='اختار المتجر من القائمة العلوية أولًا';return;}
      if(!entryScope||entryScope.clientId!==ctx.clientId||entryScope.storeId!==ctx.storeId){feedback.textContent='تغير المتجر؛ حدّث الدفتر قبل الترحيل';return;}
      if(!confirm('هل تؤكد ترحيل القيد إلى دفتر FAOS للمتجر الحالي؟'))return;
      const btn=form.querySelector('[type=submit]');btn.disabled=true;
      form.dataset.submitting='1';
      const payload={date:v.date,currency:'EGP',description:v.description,lines},fingerprint=JSON.stringify([ctx,payload]);
      if(form.dataset.faosFingerprint!==fingerprint){form.dataset.faosFingerprint=fingerprint;form.dataset.faosIdempotencyKey=crypto.randomUUID();}
      try{const result=await api('/api/accounting/faos/journals',{method:'POST',expectedScope:entryScope,body:{...payload,idempotencyKey:form.dataset.faosIdempotencyKey}});feedback.textContent='تم حفظ القيد '+result.id;await refresh();}
      catch(error){feedback.textContent=error.message}finally{form.dataset.submitting='0';if(btn.isConnected)btn.disabled=false}
    };
  }
  function mount(){
    if(!active())return false;
    ensureCss();
    const acc=root(),target=acc?.querySelector('#acc100Body');
    if(!target)return false;
    let section=acc.querySelector('#kunFaosWorkspace');
    if(!section){
      section=shell();
      target.before(section);
      if(state.pendingTab){state.view=state.pendingTab;state.pendingTab=null;}
      refresh();
    }else if(state.pendingTab){
      state.view=state.pendingTab;state.pendingTab=null;render();
    }
    return true;
  }
  function accountingAllowed(){
    const guard=window.KunPermissionNavigationV51;
    if(!guard?.snapshot?.role)return false;
    return typeof guard.allowedView==='function'&&guard.allowedView('accounting',guard.snapshot)===true;
  }
  function openWorkspace(tab='health'){
    if(!accountingAllowed()){
      window.showToast?.('قسم الحسابات يحتاج صلاحية الاطلاع على المالية');
      return false;
    }
    if(!tabs.some(([id])=>id===tab))tab='health';
    state.pendingTab=tab;
    state.view=tab;
    const account=document.querySelector('.nav button[data-view="accounting"]');
    if(!account)return false;
    if(!active()){
      // Use the existing accounting route guard; do not bypass permission checks.
      if(window.KunAccountingNavigationGuardV103?.navigate)window.KunAccountingNavigationGuardV103.navigate();
      else account.click();
    }
    const show=()=>{if(!mount())return;const section=document.getElementById('kunFaosWorkspace');section?.scrollIntoView?.({behavior:'smooth',block:'start'});};
    for(const delay of [0,120,360,800,1500,3000])setTimeout(show,delay);
    return true;
  }
  function syncShortcut(){
    const nav=document.querySelector('.nav');
    if(!nav)return;
    let button=nav.querySelector('#kunFaosNavShortcut');
    if(!button){
      button=document.createElement('button');
      button.type='button';button.id='kunFaosNavShortcut';
      button.setAttribute('aria-label','فتح الحسابات والدفاتر المحاسبية');
      button.innerHTML='<span class="faos-shortcut-icon" aria-hidden="true">▤</span><span>الحسابات والدفاتر</span>';
      button.addEventListener('click',()=>openWorkspace('health'));
      const finance=nav.querySelector('[data-nav-group="finance"]')||nav.querySelector('button[data-view="finance"]');
      if(finance)finance.before(button);else nav.appendChild(button);
    }
    const visible=accountingAllowed();
    if(button.hidden===visible)button.hidden=!visible;
    const display=visible?'':'none';
    if(button.style.display!==display)button.style.display=display;
    button.setAttribute('aria-hidden',visible?'false':'true');
    button.tabIndex=visible?0:-1;
  }
  const observer=new MutationObserver(()=>{
    if(active()&&!document.getElementById('kunFaosWorkspace'))queueMicrotask(mount);
  });
  function init(){
    ensureCss();
    observer.observe(document.getElementById('root')||document.body,{childList:true,subtree:true});
    const nav=document.querySelector('.nav');
    if(nav)new MutationObserver(()=>syncShortcut()).observe(nav,{childList:true,subtree:true});
    for(const delay of [0,200,600,1200,2500])setTimeout(syncShortcut,delay);
    document.addEventListener('click',event=>{
      if(event.target.closest?.('.nav button[data-view="accounting"]'))setTimeout(mount,150);
      if(event.target.closest?.('#acc100FaosOpen'))openWorkspace('ledger');
    });
    document.addEventListener('change',event=>{if(event.target?.id==='acc100Month')setTimeout(refresh,200)});
    mount();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
  window.KunFAOSAccountingV1={version:'1.2',mount,refresh,open:openWorkspace,syncShortcut,validateEntryLines,simulationOnly:true};
})();
