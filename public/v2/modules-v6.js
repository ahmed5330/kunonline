/* kun online v6 — Profit Intelligence + COD Reconciliation */
async function profitV6(){
  root.innerHTML='<div class="card empty">جاري تحليل الربحية...</div>';
  try{
    const id=v4StoreId();
    const q=id?`?clientId=${encodeURIComponent(id)}&groupBy=product`:'?groupBy=product';
    const d=await v4Api('/api/profit-intelligence'+q),s=d.summary||{},rows=d.breakdown||[];
    root.innerHTML=`<div class="page-head"><div><div class="title">Profit Intelligence</div><div class="sub">من الإيراد إلى صافي الربح — مع Drill-down حسب المنتج</div></div></div>
    <div class="grid kpis four">${kpi('صافي الإيراد',money(s.netRevenue)+' EGP','الإيراد بعد الخصومات والاستردادات')}${kpi('تكلفة البضاعة',money(s.cogs)+' EGP','تكلفة المنتجات المباعة')}${kpi('Contribution',money(s.contribution)+' EGP','صافي الإيراد ناقص COGS والشحن والتكاليف المباشرة')}${kpi('صافي الربح',money(s.netProfit)+' EGP','Contribution ناقص المصاريف التشغيلية زائد الإيرادات الأخرى')}</div>
    <div class="grid split"><div class="card"><h3>معادلة الربح</h3><div class="v4-formula">Net Revenue − COGS − Shipping − Other Direct Costs − Operating Expenses + Other Income = Net Profit</div><div class="v6-metrics"><span>هامش الربح<b>${v4Pct(s.marginPct||0)}</b></span><span>الشحن<b>${money(s.shipping)} EGP</b></span><span>المصاريف التشغيلية<b>${money(s.operatingExpenses)} EGP</b></span></div></div><div class="card"><h3>ملاحظات الدقة</h3><p class="meta">دقة الربحية تعتمد على اكتمال product_cost وshipping_cost وother_cost والحركات المالية. Attribution الإعلاني سيتم إضافته كطبقة مستقلة.</p></div></div>
    <div class="card table-wrap mt"><table class="table"><thead><tr><th>المنتج</th><th>طلبات</th><th>صافي الإيراد</th><th>COGS</th><th>الشحن</th><th>Contribution</th><th>الهامش</th></tr></thead><tbody>${rows.length?rows.slice(0,100).map(x=>`<tr><td><b>${esc(x.label||x.key)}</b></td><td>${money(x.orders)}</td><td>${money(x.netRevenue)} EGP</td><td>${money(x.cogs)} EGP</td><td>${money(x.shipping)} EGP</td><td><b>${money(x.contribution)} EGP</b></td><td>${v4Pct(x.marginPct||0)}</td></tr>`).join(''):'<tr><td colspan="7" class="empty">لا توجد بيانات ربحية بعد</td></tr>'}</tbody></table></div>`;
    v6Bind();
  }catch(e){root.innerHTML=`<div class="card empty">${esc(e.message)}</div>`}
}

async function codV6(){
  root.innerHTML='<div class="card empty">جاري تحميل تسويات COD...</div>';
  try{
    const id=v4StoreId(),qs=id?`?clientId=${encodeURIComponent(id)}`:'';
    const [candidates,batches]=await Promise.all([v4Api('/api/cod-reconciliation/candidates'+qs),v4Api('/api/cod-reconciliation'+qs)]);
    const expected=candidates.reduce((s,x)=>s+(+x.expectedAmount||0),0);
    root.innerHTML=`<div class="page-head"><div><div class="title">COD Reconciliation</div><div class="sub">مطابقة تحصيلات شركات الشحن مع الطلبات المسلمة</div></div><div class="spacer"></div><button class="btn primary" id="v6NewCod" ${candidates.length?'':'disabled'}>+ إنشاء تسوية</button></div>
    <div class="grid kpis four">${kpi('طلبات غير مسوّاة',money(candidates.length),'طلبات Delivered لم تدخل تسوية COD بعد')}${kpi('مبلغ متوقع',money(expected)+' EGP','صافي المبالغ المتوقع تحصيلها من الطلبات غير المسواة')}${kpi('دفعات تسوية',money(batches.length),'عدد دفعات التسوية المسجلة')}${kpi('نزاعات',money(batches.filter(x=>x.status==='disputed').length),'دفعات بها فرق بين المتوقع والمبلغ الفعلي')}</div>
    <div class="grid split"><div class="card table-wrap"><h3>غير مسوّى</h3><table class="table compact"><thead><tr><th></th><th>الطلب</th><th>العميل</th><th>AWB</th><th>المتوقع</th></tr></thead><tbody>${candidates.length?candidates.map(x=>`<tr><td><input type="checkbox" class="v6-cod-check" value="${esc(x.id)}"></td><td><b>${esc(x.id)}</b></td><td>${esc(x.name||'—')}</td><td>${esc(x.awb||'—')}</td><td>${money(x.expectedAmount)} EGP</td></tr>`).join(''):'<tr><td colspan="5" class="empty">كل الطلبات المسلمة تمت تسويتها</td></tr>'}</tbody></table></div>
    <div class="card"><h3>آخر دفعات التسوية</h3>${batches.slice(0,12).map(x=>`<div class="v4-row"><span><b>${esc(x.reference||x.id)}</b><small>${esc(x.provider||'شركة شحن غير محددة')} · ${esc((x.created_at||'').slice(0,10))}</small></span><span><b>${money(x.expected_amount)} EGP</b><small class="stock ${x.status==='reconciled'?'ok':x.status==='disputed'?'danger':'warn'}">${x.status}</small></span></div>`).join('')||'<div class="empty">لا توجد دفعات بعد</div>'}</div></div>`;
    v6Bind();
  }catch(e){root.innerHTML=`<div class="card empty">${esc(e.message)}</div>`}
}

function openCodBuilderV6(){
  const selected=[...document.querySelectorAll('.v6-cod-check:checked')].map(x=>x.value);
  if(!selected.length)return toast('اختر طلبًا واحدًا على الأقل');
  drawer.innerHTML=`<div class="page-head"><div><div class="title">تسوية COD جديدة</div><div class="sub">${selected.length} طلب محدد</div></div><div class="spacer"></div><button class="btn soft" id="v6Close">إغلاق</button></div><div class="v5-form"><label>شركة الشحن<input class="input" id="v6Provider" placeholder="مثال: J&T"></label><label>مرجع التحويل<input class="input" id="v6Reference" placeholder="رقم التحويل أو كشف الحساب"></label><label>المبلغ الفعلي<input class="input" id="v6Actual" type="number" min="0" step="0.01" placeholder="اتركه فارغًا لو لم يصل التحويل بعد"></label><label class="v5-wide">ملاحظات<textarea class="input" id="v6Note" rows="3"></textarea></label></div><button class="btn primary v4-full" id="v6SaveCod">حفظ التسوية</button>`;
  drawer.classList.add('open');drawerBack.classList.add('show');document.getElementById('v6Close').onclick=closeDrawer;
  document.getElementById('v6SaveCod').onclick=async()=>{try{const id=v4StoreId();const body={clientId:id,orderIds:selected,provider:document.getElementById('v6Provider').value,reference:document.getElementById('v6Reference').value,actualAmount:document.getElementById('v6Actual').value,note:document.getElementById('v6Note').value};const saved=await v4ApiPost('/api/cod-reconciliation',body);if(saved.status==='reconciled'&&typeof state!=='undefined')for(const orderId of selected){const order=state.orders?.find(x=>String(x.id)===String(orderId));if(order)order.state='collected'}closeDrawer();toast('تم تسجيل التسوية');codV6()}catch(e){toast(e.message)}};
}
async function v4ApiPost(url,body){const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify(body)});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'تعذر الحفظ');return d}

const renderV5=render,bindV5=bind;
render=function(){if(view==='profit')return profitV6();if(view==='cod')return codV6();return renderV5()};
function v6Bind(){bindV5();document.getElementById('v6NewCod')?.addEventListener('click',openCodBuilderV6)}
bind=function(){v6Bind()};
