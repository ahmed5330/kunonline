/* Kun Online v127.0 — subscriptions, free trial, wallet lock and payment proof workspace */
(()=>{
  if(window.KunSubscriptionsV127)return;
  const VERSION='127.0';
  const $=(s,r=document)=>r?.querySelector?.(s)||null;
  const $$=(s,r=document)=>r?[...r.querySelectorAll(s)]:[];
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const n=v=>Number(v)||0;
  const num=v=>new Intl.NumberFormat('ar-EG',{maximumFractionDigits:2}).format(n(v));
  const money=(v,c='EGP')=>`${num(v)} ${String(c||'EGP').toUpperCase()==='EGP'?'ج.م':esc(c)}`;
  const state={me:null,access:null,adminClients:[],topups:[],timer:0,locked:false};
  const nativeFetch=window.fetch.bind(window);
  const api=async(path,options={})=>{const r=await nativeFetch(path,{credentials:'include',headers:{'Content-Type':'application/json',...(options.headers||{})},...options}),d=await r.json().catch(()=>({}));if(!r.ok){const e=new Error(d.error||`HTTP ${r.status}`);e.code=d.code;e.data=d;throw e;}return d;};

  function style(){
    if($('#kunSubscriptions127Style'))return;
    const el=document.createElement('style');el.id='kunSubscriptions127Style';el.textContent=`
      .sub127-client-panel{margin:0 0 12px;padding:16px;border:1px solid var(--line,#e2e8f0);border-radius:18px;background:linear-gradient(145deg,#fff,#f8fbff);box-shadow:0 10px 28px rgba(15,23,42,.05)}
      .sub127-client-panel.locked{border-color:rgba(220,38,38,.25);background:linear-gradient(145deg,#fff7f7,#fff)}.sub127-client-panel.trial{border-color:rgba(22,163,74,.24);background:linear-gradient(145deg,#f3fff7,#fff)}
      .sub127-client-head{display:flex;align-items:flex-start;gap:12px}.sub127-client-head h3{margin:0;font-size:16px}.sub127-client-head p{margin:5px 0 0;color:var(--muted,#64748b);font-size:10px;line-height:1.7}.sub127-badge{margin-inline-start:auto;padding:6px 9px;border-radius:999px;background:#eef6ff;color:#0d47a1;font-size:9px;font-weight:900;white-space:nowrap}.locked .sub127-badge{background:#fee2e2;color:#b91c1c}.trial .sub127-badge{background:#dcfce7;color:#15803d}
      .sub127-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:13px}.sub127-kpi{padding:10px;border:1px solid var(--line,#e2e8f0);border-radius:11px;background:var(--card,#fff)}.sub127-kpi span{display:block;color:var(--muted,#64748b);font-size:8.5px}.sub127-kpi b{display:block;margin-top:5px;font-size:14px}
      .sub127-topup{display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:8px;align-items:end;margin-top:13px;padding-top:13px;border-top:1px solid var(--line,#e2e8f0)}.sub127-topup label{display:grid;gap:4px;font-size:8.5px;font-weight:800;color:var(--muted,#64748b)}.sub127-topup input{width:100%}.sub127-topup .btn{height:40px}.sub127-note{margin-top:8px;color:var(--muted,#64748b);font-size:8.5px;line-height:1.6}
      .sub127-admin{display:grid;gap:12px}.sub127-admin-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.sub127-admin-head .title{font-size:24px}.sub127-summary{grid-template-columns:repeat(4,minmax(0,1fr))}.sub127-toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.sub127-toolbar .input{min-width:260px;flex:1}
      .sub127-table-wrap{overflow:auto}.sub127-table{width:100%;border-collapse:collapse;min-width:1050px}.sub127-table th,.sub127-table td{padding:10px;border-bottom:1px solid var(--line,#e2e8f0);text-align:right;font-size:9px;white-space:nowrap}.sub127-table th{color:var(--muted,#64748b);background:#f8fafc;position:sticky;top:0}.sub127-client-name{white-space:normal!important;min-width:180px}.sub127-client-name b{display:block}.sub127-client-name small{display:block;margin-top:3px;color:var(--muted,#64748b)}
      .sub127-status{display:inline-flex;padding:4px 7px;border-radius:999px;font-size:8px;font-weight:900;background:#eaf8ee;color:#15803d}.sub127-status.locked{background:#fee2e2;color:#b91c1c}.sub127-status.trial{background:#dcfce7;color:#15803d}.sub127-status.unmanaged{background:#f1f5f9;color:#64748b}
      .sub127-payment{display:grid;grid-template-columns:72px minmax(140px,1fr) repeat(3,minmax(100px,.7fr)) auto;gap:9px;align-items:center;padding:10px 0;border-bottom:1px solid var(--line,#e2e8f0)}.sub127-proof{width:68px;height:54px;object-fit:cover;border-radius:8px;border:1px solid var(--line,#e2e8f0);background:#f8fafc}.sub127-actions{display:flex;gap:5px}
      .sub127-modal-back{position:fixed;inset:0;z-index:99999;background:rgba(15,23,42,.48);display:grid;place-items:center;padding:16px}.sub127-modal{width:min(720px,96vw);max-height:92vh;overflow:auto;background:var(--card,#fff);border-radius:18px;padding:18px;box-shadow:0 26px 80px rgba(15,23,42,.28)}.sub127-modal-head{display:flex;align-items:flex-start;gap:10px}.sub127-modal-head h2{margin:0}.sub127-form{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:15px}.sub127-form label{display:grid;gap:5px;font-size:9px;font-weight:800;color:var(--muted,#64748b)}.sub127-modal-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:15px}
      body[data-theme="dark"] .sub127-client-panel,body[data-theme="dark"] .sub127-kpi,body[data-theme="dark"] .sub127-modal{background:var(--card);border-color:var(--line)}body[data-theme="dark"] .sub127-table th{background:#172033}
      @media(max-width:850px){.sub127-kpis,.sub127-summary{grid-template-columns:1fr 1fr}.sub127-topup{grid-template-columns:1fr 1fr}.sub127-topup .btn{grid-column:1/-1}.sub127-payment{grid-template-columns:64px 1fr auto}.sub127-payment>:nth-child(3),.sub127-payment>:nth-child(4),.sub127-payment>:nth-child(5){display:none}}
      @media(max-width:520px){.sub127-kpis,.sub127-summary,.sub127-form,.sub127-topup{grid-template-columns:1fr}.sub127-client-head{flex-wrap:wrap}.sub127-badge{margin-inline-start:0}.sub127-toolbar .input{min-width:0;width:100%}.sub127-payment{grid-template-columns:58px 1fr}.sub127-actions{grid-column:1/-1}.sub127-proof{width:56px;height:50px}}
    `;document.head.appendChild(el);
  }

  const statusText=a=>a?.trialActive?'تجربة مجانية':a?.locked?'متوقف لعدم كفاية الرصيد':a?.subscriptionStatus==='unmanaged'?'غير مفعّل على نظام الاشتراكات':'نشط';
  const reasonText=a=>a?.reason==='monthly_minimum_due'?'الرصيد لا يكفي الحد الأدنى الشهري':a?.reason==='balance_empty'?'الرصيد انتهى':a?.reason==='subscription_paused'?'الاشتراك موقوف من الإدارة':a?.reason==='wallet_paused'?'المحفظة موقوفة':'';

  async function proofData(file){
    if(!file)throw new Error('ارفع صورة إثبات التحويل');
    if(!/^image\/(jpeg|png|webp)$/i.test(file.type))throw new Error('الصورة لازم تكون JPG أو PNG أو WebP');
    const read=f=>new Promise((resolve,reject)=>{const fr=new FileReader();fr.onload=()=>resolve(String(fr.result||''));fr.onerror=()=>reject(new Error('تعذر قراءة الصورة'));fr.readAsDataURL(f);});
    let raw=await read(file);if(raw.length<=430000)return raw;
    const bitmap=await createImageBitmap(file),scale=Math.min(1,1400/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
    for(const q of [.8,.68,.56,.45]){raw=canvas.toDataURL('image/jpeg',q);if(raw.length<=430000)return raw;}
    throw new Error('صورة التحويل كبيرة جدًا. استخدم Screenshot أصغر.');
  }

  function restoreNav(){
    $$('[data-sub127-hidden="1"]').forEach(b=>{b.hidden=false;b.style.display='';delete b.dataset.sub127Hidden;});
    window.KunPermissionNavigationV51?.apply?.();
  }
  function lockNav(){
    if(!state.access?.locked)return restoreNav();
    $$('.nav button[data-view]').forEach(b=>{if(b.dataset.view==='dashboard')return;b.dataset.sub127Hidden='1';b.hidden=true;b.style.display='none';});
    const active=$('.nav button.active[data-view]');if(active&&active.dataset.view!=='dashboard')$('.nav button[data-view="dashboard"]')?.click();
  }

  async function submitTopup(panel){
    const amount=Number($('#sub127Amount',panel)?.value||0),phone=String($('#sub127Phone',panel)?.value||'').trim(),file=$('#sub127Proof',panel)?.files?.[0],button=$('#sub127Submit',panel);
    if(!(amount>0))throw new Error('اكتب مبلغ التحويل');
    if(phone.replace(/\s+/g,'').length<8)throw new Error('اكتب رقم الهاتف المحوّل منه');
    button.disabled=true;button.textContent='جاري الإرسال...';
    try{
      const proofDataUrl=await proofData(file);
      await api('/api/wallet/topups',{method:'POST',body:JSON.stringify({amount,senderPhone:phone,proofDataUrl,transferMethod:'wallet_transfer'})});
      window.showToast?.('تم إرسال إثبات التحويل للإدارة للمراجعة');
      $('#sub127Amount',panel).value='';$('#sub127Proof',panel).value='';
      await refreshAccess(true);
    }finally{button.disabled=false;button.textContent='إرسال طلب الشحن';}
  }

  function clientPanelHtml(a){
    const trial=a?.trialActive,locked=a?.locked,cls=locked?'locked':trial?'trial':'',badge=statusText(a),currency=a?.currency||'EGP';
    return `<section class="sub127-client-panel ${cls}" data-sub127-client-panel="1"><div class="sub127-client-head"><div><h3>${locked?'استكمال تشغيل Kun Online':'الاشتراك والرصيد'}</h3><p>${locked?`${esc(reasonText(a))}. الداشبورد متاح، وبمجرد اعتماد التحويل سيعود النظام للعمل تلقائيًا.`:trial?`الفترة المجانية فعالة حتى ${esc(a.trialEndsAt||'—')} ولا يتم خلالها خصم رسوم شهرية أو رسوم على الأوردرات.`:'متابعة الرصيد ورسوم التشغيل الحالية.'}</p></div><span class="sub127-badge">${esc(badge)}</span></div><div class="sub127-kpis"><div class="sub127-kpi"><span>الرصيد الحالي</span><b>${money(a?.balance,currency)}</b></div><div class="sub127-kpi"><span>الحد الأدنى الشهري</span><b>${trial?'مجانًا':money(a?.monthlyMinimum,currency)}</b></div><div class="sub127-kpi"><span>رسوم كل أوردر</span><b>${trial?'مجانًا':money(a?.orderFee,currency)}</b></div><div class="sub127-kpi"><span>الحالة</span><b>${esc(badge)}</b></div></div><div class="sub127-topup"><label>المبلغ المحوّل<input class="input" id="sub127Amount" type="number" min="1" step="0.01" placeholder="مثال: 500"></label><label>رقم الهاتف المحوّل منه<input class="input" id="sub127Phone" type="tel" placeholder="01xxxxxxxxx"></label><label>صورة إثبات التحويل<input class="input" id="sub127Proof" type="file" accept="image/jpeg,image/png,image/webp"></label><button class="btn primary" id="sub127Submit" type="button">إرسال طلب الشحن</button></div><div class="sub127-note">بعد الإرسال يظهر الطلب لدى الإدارة في قسم «الاشتراكات». عند اعتماد التحويل يتم شحن الرصيد وفحص الحد الأدنى الشهري وتفعيل الأقسام تلقائيًا إذا أصبح الرصيد كافيًا.</div></section>`;
  }

  function ensureClientPanel(){
    if(!state.me?.clientId||state.me.role==='admin'||!state.access)return;
    const dashboard=$('.v33-dashboard');if(!dashboard)return;
    let panel=$('[data-sub127-client-panel]',dashboard);
    const html=clientPanelHtml(state.access);
    if(panel)panel.outerHTML=html;else{const hero=$('.dash-hero',dashboard);if(hero)hero.insertAdjacentHTML('afterend',html);else dashboard.insertAdjacentHTML('afterbegin',html);}
    panel=$('[data-sub127-client-panel]',dashboard);const submit=$('#sub127Submit',panel);if(submit)submit.onclick=()=>submitTopup(panel).catch(e=>window.showToast?.(e.message));
  }

  async function refreshAccess(force=false){
    if(!state.me?.clientId||state.me.role==='admin')return null;
    try{
      const a=await api('/api/subscription/access');state.access=a;state.locked=Boolean(a.locked);lockNav();ensureClientPanel();
      if(force)window.showToast?.(a.locked?'الرصيد ما زال غير كافٍ للتفعيل':'تم تفعيل النظام');
      return a;
    }catch(error){console.warn('subscription access unavailable',error);return null;}
  }

  function addAdminNav(){
    if(state.me?.role!=='admin')return;
    const nav=$('.nav');if(!nav)return;
    let b=$('button[data-view="subscriptions"]',nav);if(!b){b=document.createElement('button');b.type='button';b.dataset.view='subscriptions';b.className='v27-admin-only';b.textContent='الاشتراكات';const admin=$('button[data-view="admin-clients"]',nav);admin?admin.after(b):nav.appendChild(b);}
    b.hidden=false;b.style.display='';
  }
  function setAdminActive(){
    $$('.nav button[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view==='subscriptions'));
  }
  function adminStatus(c){
    const cls=c.trialActive?'trial':c.locked?'locked':c.subscriptionStatus==='unmanaged'?'unmanaged':'';
    return `<span class="sub127-status ${cls}">${esc(c.trialActive?'تجربة مجانية':c.locked?'متوقف':c.subscriptionStatus==='unmanaged'?'غير مُدار':'نشط')}</span>`;
  }
  function adminRow(c){
    return `<tr data-sub127-search="${esc([c.name,c.ownerName,c.ownerEmail,c.clientId].join(' ').toLowerCase())}"><td class="sub127-client-name"><b>${esc(c.name||c.clientId)}</b><small>${esc(c.ownerName||'')} · ${esc(c.ownerEmail||'')}</small></td><td>${adminStatus(c)}</td><td><b>${money(c.balance,c.currency)}</b></td><td>${money(c.monthlyMinimum,c.currency)}</td><td>${money(c.orderFee,c.currency)}</td><td>${c.trialActive?esc(c.trialEndsAt||'—'):'—'}</td><td>${c.pendingTopups? `${num(c.pendingTopups)} طلب · ${money(c.pendingTopupAmount,c.currency)}`:'—'}</td><td><button class="btn soft" data-sub127-manage="${esc(c.clientId)}">إدارة الاشتراك</button></td></tr>`;
  }
  function paymentRow(p){
    const proof=p.proof_data_url||p.proof_url||'',img=proof?`<a href="${esc(proof)}" target="_blank" rel="noopener"><img class="sub127-proof" src="${esc(proof)}" alt="إثبات التحويل"></a>`:'<div class="sub127-proof"></div>';
    const client=state.adminClients.find(c=>String(c.clientId)===String(p.client_id));
    return `<div class="sub127-payment">${img}<div><b>${esc(client?.name||p.client_id)}</b><div class="meta">${esc(p.requested_at||'')}</div></div><div><span class="meta">المبلغ</span><b>${money(p.amount,p.currency)}</b></div><div><span class="meta">من رقم</span><b>${esc(p.sender_phone||'—')}</b></div><div><span class="meta">الطريقة</span><b>${esc(p.transfer_method||'تحويل')}</b></div><div class="sub127-actions"><button class="btn primary" data-sub127-approve="${esc(p.id)}">اعتماد</button><button class="btn soft" data-sub127-reject="${esc(p.id)}">رفض</button></div></div>`;
  }

  function closeModal(){$('.sub127-modal-back')?.remove();}
  function openManage(clientId){
    const c=state.adminClients.find(x=>String(x.clientId)===String(clientId));if(!c)return;
    closeModal();const back=document.createElement('div');back.className='sub127-modal-back';back.innerHTML=`<div class="sub127-modal"><div class="sub127-modal-head"><div><h2>اشتراك ${esc(c.name||clientId)}</h2><div class="meta">${esc(c.ownerEmail||clientId)}</div></div><div class="spacer"></div><button class="btn soft" data-sub127-close>إغلاق</button></div><div class="sub127-kpis"><div class="sub127-kpi"><span>الرصيد</span><b>${money(c.balance,c.currency)}</b></div><div class="sub127-kpi"><span>الحالة</span><b>${esc(statusText(c))}</b></div><div class="sub127-kpi"><span>التجربة</span><b>${c.trialActive?esc(c.trialEndsAt):'غير فعالة'}</b></div><div class="sub127-kpi"><span>طلبات شحن معلقة</span><b>${num(c.pendingTopups)}</b></div></div><div class="sub127-form"><label>الحد الأدنى الشهري<input class="input" id="sub127Monthly" type="number" min="0" step="1" value="${esc(c.monthlyMinimum)}"></label><label>رسوم كل أوردر<input class="input" id="sub127OrderFee" type="number" min="0" step="0.25" value="${esc(c.orderFee)}"></label><label>حالة الاشتراك<select class="select" id="sub127Status"><option value="">بدون تغيير</option><option value="active">نشط</option><option value="paused">موقوف</option></select></label></div><div class="sub127-modal-actions"><button class="btn primary" id="sub127Save">حفظ الأسعار</button><button class="btn soft" id="sub127StartTrial">تفعيل شهر مجاني</button>${c.trialActive?'<button class="btn soft" id="sub127EndTrial">إنهاء التجربة الآن</button>':''}<button class="btn soft" id="sub127Reconcile">فحص وتفعيل الآن</button></div><div class="sub127-note">الحد الأدنى يُخصم مرة واحدة لكل شهر. أثناء الشهر المجاني لا يتم خصم الحد الأدنى ولا رسوم الأوردرات.</div></div>`;document.body.appendChild(back);back.onclick=e=>{if(e.target===back)closeModal();};$('[data-sub127-close]',back).onclick=closeModal;
    $('#sub127Save',back).onclick=async()=>{try{const body={monthlyMinimum:Number($('#sub127Monthly',back).value||0),baseOrderFee:Number($('#sub127OrderFee',back).value||0)},st=$('#sub127Status',back).value;if(st)body.status=st;await api(`/api/admin/subscriptions/${encodeURIComponent(clientId)}`,{method:'PATCH',body:JSON.stringify(body)});window.showToast?.('تم حفظ إعدادات الاشتراك');closeModal();renderAdmin();}catch(e){window.showToast?.(e.message)}};
    $('#sub127StartTrial',back).onclick=async()=>{try{await api(`/api/admin/subscriptions/${encodeURIComponent(clientId)}/start-trial`,{method:'POST',body:'{}'});window.showToast?.('تم تفعيل 30 يوم مجانًا');closeModal();renderAdmin();}catch(e){window.showToast?.(e.message)}};
    const end=$('#sub127EndTrial',back);if(end)end.onclick=async()=>{try{await api(`/api/admin/subscriptions/${encodeURIComponent(clientId)}/end-trial`,{method:'POST',body:'{}'});window.showToast?.('تم إنهاء الفترة المجانية وتطبيق دورة الدفع');closeModal();renderAdmin();}catch(e){window.showToast?.(e.message)}};
    $('#sub127Reconcile',back).onclick=async()=>{try{const d=await api(`/api/admin/subscriptions/${encodeURIComponent(clientId)}/reconcile`,{method:'POST',body:'{}'});window.showToast?.(d.access?.locked?'الرصيد ما زال غير كافٍ':'العميل نشط الآن');closeModal();renderAdmin();}catch(e){window.showToast?.(e.message)}};
  }

  async function approveTopup(id){
    await api(`/api/admin/wallet/topups/${encodeURIComponent(id)}/approve`,{method:'POST',body:JSON.stringify({note:'Approved from subscriptions center'})});
    window.showToast?.('تم اعتماد التحويل وشحن الرصيد وفحص التفعيل');await renderAdmin();
  }
  async function rejectTopup(id){
    if(!confirm('رفض طلب الشحن؟'))return;
    await api(`/api/admin/wallet/topups/${encodeURIComponent(id)}/reject`,{method:'POST',body:JSON.stringify({note:'Rejected from subscriptions center'})});
    window.showToast?.('تم رفض الطلب');await renderAdmin();
  }

  async function renderAdmin(){
    if(state.me?.role!=='admin')return;
    addAdminNav();setAdminActive();const root=$('#root');if(!root)return;root.dataset.sub127Admin='loading';root.innerHTML='<div class="card empty">جارٍ تحميل الاشتراكات والدفعات الجديدة...</div>';
    try{
      const [subs,topups]=await Promise.all([api('/api/admin/subscriptions'),api('/api/admin/wallet/topups?limit=300')]);
      state.adminClients=subs.clients||[];state.topups=Array.isArray(topups)?topups:(topups.items||topups.results||[]);
      const locked=state.adminClients.filter(x=>x.locked).length,trials=state.adminClients.filter(x=>x.trialActive).length,pending=state.topups.length;
      root.dataset.sub127Admin='ready';root.innerHTML=`<div class="sub127-admin"><div class="page-head sub127-admin-head"><div><div class="title">الاشتراكات</div><div class="sub">إدارة الشهر المجاني، الحد الأدنى الشهري، رسوم الأوردرات، الرصيد، واعتماد تحويلات العملاء.</div></div><div class="spacer"></div><button class="btn soft" id="sub127ReconcileAll">فحص الدورة الشهرية</button></div><div class="grid kpis sub127-summary"><div class="card"><div class="k-label">العملاء</div><div class="k-val small">${num(state.adminClients.length)}</div></div><div class="card"><div class="k-label">متوقفون بسبب الرصيد</div><div class="k-val small">${num(locked)}</div></div><div class="card"><div class="k-label">شهر مجاني فعال</div><div class="k-val small">${num(trials)}</div></div><div class="card"><div class="k-label">دفعات تنتظر المراجعة</div><div class="k-val small">${num(pending)}</div></div></div><section class="card"><div class="sub127-toolbar"><input class="input" id="sub127Search" placeholder="ابحث باسم العميل أو البريد أو Client ID"><span class="meta" id="sub127Count">${num(state.adminClients.length)} عميل</span></div><div class="sub127-table-wrap mt"><table class="sub127-table"><thead><tr><th>العميل</th><th>الحالة</th><th>الرصيد</th><th>الحد الشهري</th><th>رسوم الأوردر</th><th>نهاية المجاني</th><th>دفعات معلقة</th><th></th></tr></thead><tbody>${state.adminClients.map(adminRow).join('')||'<tr><td colspan="8" class="empty">لا يوجد عملاء.</td></tr>'}</tbody></table></div></section><section class="card"><h3>الدفعات الجديدة من العملاء</h3><div class="meta">راجع صورة التحويل ثم اضغط اعتماد؛ الرصيد يُشحن وفحص التفعيل يتم فورًا.</div><div class="mt">${state.topups.map(paymentRow).join('')||'<div class="empty">لا توجد دفعات جديدة تنتظر المراجعة.</div>'}</div></section></div>`;
      $$('[data-sub127-manage]',root).forEach(b=>b.onclick=()=>openManage(b.dataset.sub127Manage));
      $$('[data-sub127-approve]',root).forEach(b=>b.onclick=()=>approveTopup(b.dataset.sub127Approve).catch(e=>window.showToast?.(e.message)));
      $$('[data-sub127-reject]',root).forEach(b=>b.onclick=()=>rejectTopup(b.dataset.sub127Reject).catch(e=>window.showToast?.(e.message)));
      const search=$('#sub127Search',root),rows=$$('[data-sub127-search]',root),count=$('#sub127Count',root);search.oninput=()=>{const q=search.value.trim().toLowerCase();let visible=0;rows.forEach(row=>{const show=!q||row.dataset.sub127Search.includes(q);row.hidden=!show;if(show)visible++;});count.textContent=`${num(visible)} عميل`;};
      $('#sub127ReconcileAll',root).onclick=async()=>{try{await api('/api/admin/subscriptions/reconcile',{method:'POST',body:'{}'});window.showToast?.('تم فحص دورة الاشتراكات');renderAdmin();}catch(e){window.showToast?.(e.message)}};
    }catch(error){root.dataset.sub127Admin='error';root.innerHTML=`<div class="card empty"><h3>تعذر تحميل الاشتراكات</h3><p>${esc(error.message)}</p><button class="btn soft" id="sub127Retry">إعادة المحاولة</button></div>`;$('#sub127Retry',root).onclick=renderAdmin;}
  }

  function bind(){
    document.addEventListener('click',event=>{
      const nav=event.target.closest?.('.nav button[data-view]');
      if(nav?.dataset.view==='subscriptions'&&state.me?.role==='admin'){setTimeout(renderAdmin,15);return;}
      if(state.locked&&nav&&nav.dataset.view!=='dashboard'){event.preventDefault();event.stopImmediatePropagation();window.showToast?.('الرصيد غير كافٍ. الداشبورد وشحن الرصيد متاحان لحين اعتماد الدفع.');$('.nav button[data-view="dashboard"]')?.click();return;}
      if(nav?.dataset.view==='dashboard')setTimeout(ensureClientPanel,300);
    },true);
    const root=$('#root');if(root)new MutationObserver(()=>{if(state.me?.role==='admin'&&$('.nav button.active[data-view="subscriptions"]')&&!root.dataset.sub127Admin)setTimeout(renderAdmin,30);if(state.me?.role!=='admin'&&$('.v33-dashboard')&&!$('[data-sub127-client-panel]'))setTimeout(ensureClientPanel,40);}).observe(root,{childList:true,subtree:true});
  }

  function installFetchGuard(){
    if(window.__kunSubscriptionFetch127)return;window.__kunSubscriptionFetch127=true;
    window.fetch=async function(...args){
      const response=await nativeFetch(...args);
      try{
        const input=args[0],url=typeof input==='string'?input:input?.url||'',parsed=new URL(url,location.origin),method=String(args[1]?.method||input?.method||'GET').toUpperCase();
        if(response.status===402)response.clone().json().then(data=>{if(data?.code==='SUBSCRIPTION_BALANCE_REQUIRED'&&data.access){state.access=data.access;state.locked=true;lockNav();ensureClientPanel();}}).catch(()=>{});
        if(method==='POST'&&(parsed.pathname==='/api/orders'||parsed.pathname==='/api/wa-order'||parsed.pathname==='/api/orders/bulk'))setTimeout(()=>refreshAccess(false),900);
      }catch{}
      return response;
    };
  }
  async function boot(){
    style();bind();
    try{state.me=await api('/api/me');}catch{return;}
    if(state.me.role==='admin'){addAdminNav();return;}
    if(state.me.clientId){installFetchGuard();await refreshAccess(false);setInterval(()=>refreshAccess(false),60000);}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
  window.KunSubscriptionsV127={version:VERSION,refreshAccess,renderAdmin,get access(){return state.access;}};
})();
