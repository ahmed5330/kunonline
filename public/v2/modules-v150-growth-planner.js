/* Kun Online — v150: read-only growth / scaling simulator inside existing Campaigns.
 * Local UI state only. No persistence of merchant cash, provider writes or budget mutations.
 */
(function(){
  if(window.KunGrowthPlanner150)return;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
  const money=v=>Number(v||0).toLocaleString('ar-EG',{maximumFractionDigits:2});
  const state={catalog:null,loading:false};
  const field=(name,label,placeholder='',step='any',optional=false)=>`<label class="gp150-field"><span>${esc(label)}</span><input name="${name}" type="number" inputmode="decimal" min="0" step="${step}" placeholder="${esc(placeholder)}" ${optional?'':'required'}></label>`;
  const info=(title,value,unit='')=>`<div class="gp150-metric"><small>${esc(title)}</small><strong>${esc(value)} ${esc(unit)}</strong></div>`;
  function style(){
    if(document.getElementById('growthPlanner150Styles'))return;
    const s=document.createElement('style');s.id='growthPlanner150Styles';
    s.textContent=`.gp150{border:1px solid var(--line,#e2e8f0);border-radius:16px;padding:16px;margin:14px 0;background:var(--card,#fff);direction:rtl}.gp150 summary{cursor:pointer;font-size:17px;font-weight:800;list-style-position:inside}.gp150 p,.gp150 small{color:var(--muted,#64748b)}.gp150 .gp150-section{border:1px solid var(--line,#e5e7eb);border-radius:12px;padding:12px;margin:12px 0}.gp150 .gp150-section h4{margin:0 0 12px}.gp150-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(175px,1fr));gap:12px}.gp150-field{display:grid;gap:6px;font-size:12px;font-weight:700;color:inherit}.gp150-field input,.gp150-field select{width:100%;min-height:40px;border:1px solid var(--line,#cbd5e1);background:var(--card,#fff);color:inherit;border-radius:9px;padding:7px 10px;font:inherit}.gp150 .gp150-actions{display:flex;flex-wrap:wrap;gap:9px;align-items:center;margin:12px 0}.gp150 button{border:1px solid var(--line,#cbd5e1);border-radius:9px;padding:10px 16px;cursor:pointer;background:var(--card,#fff);color:inherit;font:inherit;font-weight:700}.gp150 button.primary{background:var(--ink,#182c41);color:#fff}.gp150 button:disabled{opacity:.6;cursor:wait}.gp150 .gp150-check{display:flex;gap:8px;align-items:start;margin:8px 0;font-size:12px}.gp150 .gp150-stock-row{display:grid;grid-template-columns:minmax(140px,2fr) repeat(4,minmax(72px,1fr)) auto;gap:7px;align-items:end;border:1px solid var(--line,#e2e8f0);border-radius:8px;padding:8px;margin:7px 0}.gp150 .gp150-note{padding:9px;border:1px solid var(--line,#e2e8f0);border-radius:9px;margin:6px 0}.gp150 .gp150-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(175px,1fr));gap:9px;margin:12px 0}.gp150 .gp150-metric{display:grid;gap:5px;border:1px solid var(--line,#e2e8f0);border-radius:10px;padding:12px}.gp150 .gp150-metric strong{font-size:20px}.gp150 .gp150-errors{color:#b91c1c}.gp150 ul{padding-inline-start:22px}@media(max-width:650px){.gp150{padding:12px}.gp150 .gp150-stock-row{grid-template-columns:repeat(2,minmax(0,1fr))}.gp150 .gp150-stock-row .gp150-field:first-child{grid-column:1/-1}}`;
    document.head.appendChild(s);
  }
  function template(){
    return `<details open><summary>محاكي التوسع الإعلاني والربحية — بدون تعديل الميزانيات</summary>
    <p>استخدم أرقامك المتوقعة لبناء سيناريو، ثم قارنها بالمصروف والطلبات الحقيقية داخل كن أونلاين. النتائج افتراضية ولا تعني موافقة على التوسع.</p>
    <div id="gp150-operating-facts" class="gp150-note" aria-live="polite">جارٍ مراجعة بيانات طابور الطلبات والتحصيل المسجل للمتجر...</div>
    <form id="gp150-form">
      <div class="gp150-section"><h4>1. خطة الإعلانات والطلبات</h4><div class="gp150-grid">
        ${field('horizonDays','مدة التوسع بالأيام','7','1')}
        ${field('proposedDailyBudget','ميزانية الإعلانات اليومية','جنيه/يوم')}
        ${field('costPerEnteredOrder','تكلفة الطلب الداخل المتوقعة','من اختبارات متجرك')}
        ${field('expectedDeliveryRatePct','نسبة التسليم المتوقعة (%)','مثلاً 70')}
      </div></div>
      <div class="gp150-section"><h4>2. اقتصاديات الطلب وسيولة التاجر</h4><div class="gp150-grid">
        ${field('contributionPerDeliveredOrderBeforeAds','هامش الطلب المسلم قبل الإعلان','بعد تكلفة المنتج والشحن والرسوم')}
        ${field('returnLossPerFailedOrder','خسارة الطلب غير المسلم','تكلفة التأكيد والمرتجع')}
        ${field('extraDailyOperatingCost','مصاريف تشغيل يومية إضافية على الربح','0 إذا مش موجود')}
        ${field('merchantCashAvailable','السيولة النقدية المتاحة للتاجر','ليس رصيد محفظة كن')}
        ${field('daysToNextCollection','أيام حتى التحصيل القادم','تاريخ شركة الشحن','1')}
        ${field('extraDailyCashOutflow','مصروفات نقدية أخرى يوميًا غير الإعلان','توريد + تشغيل')}
      </div>
      <label class="gp150-check"><input type="checkbox" name="cashOutflowComplete"> أؤكد إن المصروفات النقدية الأخرى تشمل جميع احتياجات التوريد والتشغيل خلال فترة انتظار التحصيل.</label></div>
      <div class="gp150-section"><h4>3. القدرة التشغيلية اليومية</h4><div class="gp150-grid">
        ${field('dailyConfirmationCapacity','أقصى أوردرات يمكن تأكيدها','أوردر/يوم')}
        ${field('dailyPackingCapacity','أقصى أوردرات يمكن تجهيزها','أوردر/يوم')}
        ${field('dailyShippingCapacity','أقصى أوردرات يمكن شحنها','أوردر/يوم')}
      </div></div>
      <div class="gp150-section"><h4>4. مكونات المخزون والباندل</h4>
        <p id="gp150-stock-note">جارٍ تحميل الأصناف من مخزون المتجر...</p><div id="gp150-bundle-actions"></div>
        <div id="gp150-stock-rows"></div>
        <div class="gp150-actions"><button type="button" id="gp150-add-stock">إضافة SKU من المخزون</button></div>
        <label class="gp150-check"><input type="checkbox" name="coversAllPromotedSkus"> أؤكد إني أدرجت كل مكونات المنتجات المعلن عنها (ومنها الباندل).</label>
      </div>
      <div class="gp150-section"><h4>5. قواعد التوسع — معاينة فقط</h4><div class="gp150-grid">
        ${field('increasePct','زيادة الميزانية المقترحة (%)','1 إلى 30','any',true)}
        ${field('maxDailyBudget','أقصى ميزانية يومية مسموحة للمراجعة','حد أمان','any',true)}
      </div><p>المعاينة لا تنفذ أي أوامر على Meta Ads. لا يتم رفع الميزانية دون صلاحيات وموافقة وتسجيل.</p></div>
      <div class="gp150-actions"><button type="submit" class="primary" id="gp150-simulate">تحليل سيناريو التوسع</button><span id="gp150-status" role="status"></span></div>
    </form><div id="gp150-output" aria-live="polite"></div>
    <details class="gp150-section"><summary>قياس نتيجة التوسع — مقارنة قبل وبعد</summary>
      <p>مقارنة فترتين من نفس المتجر مع تقييم نضج الطلبات والتسليم والتكلفة.</p>
      <form id="gp150-experiment"><div class="gp150-grid">
        <label class="gp150-field"><span>قبل — من</span><input name="beforeFrom" type="date" required></label>
        <label class="gp150-field"><span>قبل — إلى</span><input name="beforeTo" type="date" required></label>
        <label class="gp150-field"><span>بعد — من</span><input name="afterFrom" type="date" required></label>
        <label class="gp150-field"><span>بعد — إلى</span><input name="afterTo" type="date" required></label>
      </div><div class="gp150-actions"><button type="submit">قارن الفترتين</button><span id="gp150-experiment-status" role="status"></span></div></form>
      <div id="gp150-experiment-result" aria-live="polite"></div>
    </details></details>`;
  }
  function options(){return (state.catalog?.items||[]).map(p=>`<option value="${esc(p.id)}">${esc(p.name)} — ${esc(p.sku)} (مسجل ${esc(p.availableUnits)} قطعة)</option>`).join('')}
  function addStock(selectedProductId=null,requestedUnits=1){
    const root=document.getElementById('gp150-stock-rows'),list=state.catalog?.items||[];
    if(!root||!list.length)return;
    if(root.children.length>=8){note('حد أقصى 8 أصناف في الشاشة؛ الأصناف الأخرى يلزم تطوير ربط تلقائي شامل.');return;}
    const row=document.createElement('div');row.className='gp150-stock-row';
    row.innerHTML=`<label class="gp150-field"><span>الصنف / SKU</span><select class="gp150-product">${options()}</select></label>
      <label class="gp150-field"><span>قطعة/طلب</span><input class="gp150-units" type="number" min=".01" step="any" value="1" required></label>
      <label class="gp150-field"><span>نسبة الأوردرات %</span><input class="gp150-share" type="number" min="0" max="100" step="any" value="100" required></label>
      <label class="gp150-field"><span>توريد (يوم)</span><input class="gp150-lead" type="number" min="0" step="any" placeholder="مدة التوريد" required></label>
      <label class="gp150-field"><span>أمان (يوم)</span><input class="gp150-safety" type="number" min="0" step="any" placeholder="مخزون أمان" required></label>
      <button type="button" class="gp150-remove" aria-label="حذف الصنف">×</button>`;
    row.querySelector('.gp150-remove').onclick=()=>row.remove();
    if(typeof selectedProductId==='string'){row.querySelector('.gp150-product').value=selectedProductId;row.querySelector('.gp150-units').value=String(requestedUnits||1);}
    root.appendChild(row);
  }
  function note(message){const el=document.getElementById('gp150-status');if(el)el.textContent=message;}
  function operatingEvidence(){
    const target=document.getElementById('gp150-operating-facts');
    Promise.all([window.kunClientId?.(),window.kunStoreId?.()]).then(async ([clientId,storeId])=>{
      if(!clientId||!storeId)throw new Error('اختار متجرًا محددًا لعرض طابور الطلبات.');
      const to=cairoToday(),begin=new Date(to+'T00:00:00Z');begin.setUTCDate(begin.getUTCDate()-29);
      const from=begin.toISOString().slice(0,10);
      const q=new URLSearchParams({clientId,storeId,from,to});
      const r=await fetch('/api/growth/operating-evidence?'+q,{credentials:'include'});
      const data=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(data.error||'تعذر تحميل حقائق التشغيل.');
      if(!target?.isConnected)return;
      const backlog=data.currentBacklog||{},cod=data.codRecorded||{};
      target.innerHTML='<b>مؤشرات من سجلات المتجر — آخر 30 يومًا</b>'+
        '<div class="gp150-metrics">'+
        info('طلبات تنتظر التأكيد',money(backlog.pendingConfirmation||0))+
        info('تنتظر التجهيز',money(backlog.awaitingPacking||0))+
        info('في الشحن',money(backlog.awaitingDelivery||0))+
        info('تم التسليم ولم يسجل تحصيلها',money(backlog.deliveredNotMarkedCollected||0))+
        info('تحصيل بمبالغ مثبتة',money(cod.grossRecorded||0),'(ليس رصيد البنك)')+
        info('طلبات محصلة بدون مبلغ مسجل',money(cod.missingAmountCount||0))+

        info('متوسط طلب → تحصيل مسجل',cod.meanDaysFromOrderToRecordedCollection==null?'غير متاح':money(cod.meanDaysFromOrderToRecordedCollection),'يوم')+
        '</div><p>دي حالات الطلبات الحالية والتحصيل المسجل في السيستم، مش طاقة الموظفين ولا تاريخ تحويل شركة الشحن ولا سيولة متاحة فعلًا.</p>';
    }).catch(e=>{if(target?.isConnected)target.textContent='مؤشرات التشغيل غير متاحة: '+e.message;});
  }
  function catalogLoad(){
    const target=document.getElementById('gp150-stock-note');
    Promise.all([window.kunClientId?.(),window.kunStoreId?.()]).then(async ([clientId,storeId])=>{
      if(!clientId||!storeId)throw new Error('اختار متجرًا محددًا لإظهار المخزون (مش كل المتاجر).');
      const q=new URLSearchParams({clientId,storeId,limit:'150'});
      const response=await fetch('/api/growth/inventory-catalog?'+q,{credentials:'include'});
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(data.error||'تعذر تحميل بيانات المخزون.');
      state.catalog=data;
      const bundled=(data.bundles||[]).filter(bundle=>bundle.coverage==='visible'&&bundle.components?.length&&bundle.components.length<=8);
      const selector=document.getElementById('gp150-bundle-actions');
      if(selector&&bundled.length){
        selector.innerHTML='<label class="gp150-field"><span>تحميل مكونات باندل Easy Orders مرتبط بالمخزون</span><select id="gp150-bundle-select"><option value="">اختار الباندل</option>'+
          bundled.map(bundle=>'<option value="'+esc(bundle.externalId)+'">'+esc(bundle.externalId)+' — '+bundle.components.length+' مكونات</option>').join('')+
          '</select></label><div class="gp150-actions"><button type="button" id="gp150-load-bundle">إضافة مكونات الباندل</button></div>';
        selector.querySelector('#gp150-load-bundle').onclick=()=>{
          const id=selector.querySelector('#gp150-bundle-select')?.value;
          const bundle=bundled.find(x=>x.externalId===id);
          if(!bundle)return note('اختار باندل من القائمة.');
          const rows=document.getElementById('gp150-stock-rows');if(!rows)return;
          rows.innerHTML='';
          for(const part of bundle.components)addStock(String(part.productId),Number(part.quantity)||1);
          const check=document.querySelector('#gp150-form [name="coversAllPromotedSkus"]');if(check)check.checked=false;
          note('تم تحميل مكونات الباندل المسجلة. راجع مدة التوريد والأمان، وتأكد من تغطية باقي المنتجات المعلن عنها قبل اعتماد السيناريو.');
        };
      }

      if(target?.isConnected)target.textContent=`تم تحميل ${data.items?.length||0} صنف من المخزون المسجل. ${data.pagination?.truncated?'قد توجد أصناف إضافية لم تُحمّل.':''} ${data.mappingStatus==='loaded'?'ربط الباندل متاح للمراجعة.':'تحقق يدويًا من مكونات الباندل.'}`;
    }).catch(error=>{if(target?.isConnected)target.textContent=error.message;});
  }
  function parseStock(){
    return [...document.querySelectorAll('#gp150-stock-rows .gp150-stock-row')].map(row=>({
      productId:row.querySelector('.gp150-product').value,
      unitsPerOrder:Number(row.querySelector('.gp150-units').value),
      orderShare:Number(row.querySelector('.gp150-share').value)/100,
      supplierLeadDays:Number(row.querySelector('.gp150-lead').value),
      safetyDays:Number(row.querySelector('.gp150-safety').value)
    }));
  }
  function renderResult(payload){
    const host=document.getElementById('gp150-output');if(!host)return;
    const s=payload?.scenario||{},f=s.forecast||{},b=s.baseline||{},unit=payload.currency||'';
    const status={fix_blockers_first:'هناك مخاطر يجب علاجها',fix_data_first:'يوجد اختلاف في البيانات',validate_assumptions:'يلزم التحقق من الافتراضات',simulation_meets_inputs:'السيناريو اجتاز الافتراضات المدخلة'};
    const notes=(rows,label,cls='')=>rows?.length?`<div class="gp150-note ${cls}"><b>${esc(label)}</b><ul>${rows.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div>`:'';
    const table=s.stockItems?.length?`<div class="table-wrap"><table class="table compact"><thead><tr><th>SKU</th><th>المتاح</th><th>استهلاك يومي</th><th>احتياج التوريد والأمان</th><th>العجز</th></tr></thead><tbody>${s.stockItems.map(item=>`<tr><td>${esc(item.sku)}</td><td>${money(item.availableUnits)}</td><td>${money(item.dailyConsumption)}</td><td>${money(item.requiredUnits)}</td><td>${money(item.shortageUnits)}</td></tr>`).join('')}</tbody></table></div>`:'<p>لا توجد أصناف مضافة، لذا لا يمكن اعتماد جاهزية المخزون.</p>';
    host.innerHTML=`<div class="gp150-section" dir="rtl"><h4>${esc(status[s.recommendation]||'نتيجة السيناريو')}</h4><small>الفترة المرجعية: ${esc(payload.from)} إلى ${esc(payload.to)} — أساس المقارنة: ${money(b.spend)} ${esc(unit)} إعلان / ${money(b.orders)} طلب من النظام / تكلفة فعلية ${b.historicalCPP===null?'غير متاحة':money(b.historicalCPP)+' '+esc(unit)}</small>
      <div class="gp150-metrics">
        ${info('طلبات يومية متوقعة',money(f.dailyOrders))}
        ${info('طلبات متوقعة طوال الفترة',money(f.totalOrders))}
        ${info('طلبات متوقع تسليمها',money(f.deliveredOrders))}
        ${info('إنفاق الإعلانات المتوقع',money(f.adSpend),unit)}
        ${info('مساهمة متوقعة بعد الإعلان',money(f.estimatedContributionAfterAds),unit)}
        ${info('الحد التعادلي لتكلفة الطلب',money(f.breakEvenCostPerEnteredOrder),unit)}
        ${info('السيولة اللازمة قبل التحصيل',money(f.cashNeededBeforeCollection),unit)}
        ${info('العجز النقدي المتوقع',money(f.cashDeficit),unit)}
        ${info('طاقة التشغيل اليومية',money(f.dailyOperationsCapacity),'طلب')}
        ${info('عجز التنفيذ اليومي',money(f.unprocessedOrdersPerDay),'طلب')}
      </div>
      ${notes(s.blockers,'مخاطر تمنع التوسع','gp150-errors')}
      ${notes(s.warnings,'افتراضات تحتاج تحقق')}
      <h4>توقع استهلاك المخزون</h4>${table}
      ${s.rulePreview?`<div class="gp150-note"><b>معاينة قاعدة الميزانية:</b> ${money(s.rulePreview.currentDailyBudget)} ← ${money(s.rulePreview.proposedDailyBudget)} ${esc(unit)}، الحد الأعلى ${money(s.rulePreview.maxDailyBudget)}. ${esc(s.rulePreview.reason)} <b>تنفيذ تلقائي: لا.</b></div>`:''}
      <p><b>لا يوجد إذن لزيادة الميزانية.</b> ${esc(s.disclaimer||'هذه محاكاة استرشادية.')}</p>
    </div>`;
  }
  function cairoToday(){
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
    const d=key=>parts.find(p=>p.type===key)?.value||'';
    return d('year')+'-'+d('month')+'-'+d('day');
  }
  async function submit(event){
    event.preventDefault();const form=event.currentTarget,button=document.getElementById('gp150-simulate');if(state.loading)return;
    state.loading=true;if(button)button.disabled=true;note('جارٍ تحليل بيانات المتجر والسيناريو...');
    try{
      const data=Object.fromEntries(new FormData(form).entries()),storeId=await window.kunStoreId?.(),clientId=await window.kunClientId?.();
      if(!clientId||!storeId)throw new Error('اختار متجرًا محددًا قبل المحاكاة.');
      const rangeDays=Number(document.getElementById('metaCampaignDays')?.value||30);
      const to=cairoToday(),begin=new Date(to+'T00:00:00Z');begin.setUTCDate(begin.getUTCDate()-(Math.max(1,rangeDays)-1));const since=begin.toISOString().slice(0,10);
      const numeric=['horizonDays','proposedDailyBudget','costPerEnteredOrder','contributionPerDeliveredOrderBeforeAds',
        'returnLossPerFailedOrder','merchantCashAvailable','daysToNextCollection','extraDailyCashOutflow',
        'extraDailyOperatingCost','dailyConfirmationCapacity','dailyPackingCapacity','dailyShippingCapacity'];
      const plan={};for(const key of numeric)plan[key]=Number(data[key]);
      plan.expectedDeliveryRate=Number(data.expectedDeliveryRatePct)/100;
      plan.stockItems=parseStock();
      plan.coversAllPromotedSkus=!!form.elements.namedItem('coversAllPromotedSkus')?.checked;
      plan.cashOutflowComplete=!!form.elements.namedItem('cashOutflowComplete')?.checked;
      const rule=data.increasePct&&data.maxDailyBudget?{increasePct:Number(data.increasePct),maxDailyBudget:Number(data.maxDailyBudget)}:null;
      const q=new URLSearchParams({clientId,storeId,from:since,to});
      const response=await fetch('/api/growth/scenario/preview?'+q,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({clientId,storeId,plan,...(rule?{rule}:{})})});
      const result=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(result.error||result.message||'تعذر تحليل المحاكاة');
      if(!document.getElementById('gp150-form')||form!==document.getElementById('gp150-form'))return;
      renderResult(result);note('تم تحليل السيناريو بدون تعديل الإعلانات أو المحفظة أو تسجيل بيانات السيولة.');
    }catch(error){note(error.message||'تعذر إنشاء السيناريو.');}
    finally{state.loading=false;if(button?.isConnected)button.disabled=false;}
  }
  async function compare(event){
    event.preventDefault();const form=event.currentTarget,button=form.querySelector('button[type=submit]');
    button.disabled=true;const status=document.getElementById('gp150-experiment-status');
    if(status)status.textContent='جارٍ مقارنة البيانات...';
    try{
      const clientId=await window.kunClientId?.(),storeId=await window.kunStoreId?.();
      if(!clientId||!storeId)throw new Error('اختار متجرًا محددًا.');
      const p=new URLSearchParams({clientId,storeId,...Object.fromEntries(new FormData(form).entries())});
      const r=await fetch('/api/growth/experiment/compare?'+p,{credentials:'include'});
      const payload=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(payload.error||'تعذر تحميل المقارنة');
      if(!form.isConnected)return;
      const x=payload.comparison||{},before=x.before||{},after=x.after||{},change=x.change||{};
      const fmt=v=>v===null||v===undefined?'غير متاح':money(v);
      const changeCard=(name,value)=>info(name,value===null||value===undefined?'غير متاح':money(value)+'%');
      const output=document.getElementById('gp150-experiment-result');
      output.innerHTML=`<div class="gp150-note"><b>${esc(x.status==='positive_indication'?'مؤشر تحسن يحتاج متابعة':x.status==='insufficient_evidence'?'الدليل غير كافٍ':'النتيجة تحتاج مراجعة')}</b>
        <div class="gp150-metrics">
          ${changeCard('تغير الإنفاق اليومي',change.dailyAdSpendPct)}
          ${changeCard('تغير الطلبات اليومية',change.dailyOrdersPct)}
          ${changeCard('تغير تكلفة الطلب',change.enteredCppPct)}
          ${changeCard('تغير ROAS المسلم',change.realRoasPct)}
          ${changeCard('تغير هامش الطلبات المؤهلة اليومي',change.eligibleProfitPerDayPct)}
        </div>
        <p>قبل: ${fmt(before.adSpend)} إنفاق / ${fmt(before.enteredOrders)} طلب. بعد: ${fmt(after.adSpend)} إنفاق / ${fmt(after.enteredOrders)} طلب.</p>
        ${x.issues?.length?`<ul>${x.issues.map(v=>`<li>${esc(v)}</li>`).join('')}</ul>`:''}
        <p>${esc(x.caveat||'هذه مقارنة ولا تثبت السببية.')}</p></div>`;
      if(status)status.textContent='تمت المقارنة دون تعديل أي ميزانية.';
    }catch(e){if(status)status.textContent=e.message;}
    finally{if(button?.isConnected)button.disabled=false;}
  }
  function mount(){
    const anchor=document.getElementById('metaScalingReadiness');
    if(!anchor||document.getElementById('growthPlanner150'))return;
    style();const host=document.createElement('section');host.id='growthPlanner150';host.className='gp150';host.innerHTML=template();
    anchor.after(host);document.getElementById('gp150-form')?.addEventListener('submit',submit);
    document.getElementById('gp150-experiment')?.addEventListener('submit',compare);
    document.getElementById('gp150-add-stock')?.addEventListener('click',addStock);
    catalogLoad();
    operatingEvidence();
  }
  let queued=false;
  function schedule(){if(queued)return;queued=true;queueMicrotask(()=>{queued=false;mount();});}
  const init=()=>{const root=document.getElementById('root');if(!root)return;new MutationObserver(schedule).observe(root,{childList:true,subtree:true});schedule();};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
  window.KunGrowthPlanner150={version:'150.0',mount};
})();
