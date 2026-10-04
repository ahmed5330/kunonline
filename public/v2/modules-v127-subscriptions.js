/* Kun Online v127.0 — subscriptions, free trial, wallet lock and payment proof workspace */
(()=>{
  if(window.KunSubscriptionsV127)return;
  const VERSION='127.9';
  const $=(s,r=document)=>r?.querySelector?.(s)||null;
  const $$=(s,r=document)=>r?[...r.querySelectorAll(s)]:[];
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const n=v=>Number(v)||0;
  const num=v=>new Intl.NumberFormat('ar-EG',{maximumFractionDigits:2}).format(n(v));
  const money=(v,c='EGP')=>`${num(v)} ${String(c||'EGP').toUpperCase()==='EGP'?'ج.م':esc(c)}`;
  const state={me:null,access:null,adminClients:[],topups:[],timer:0,locked:false,proofCache:new Map()};
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
      .sub127-payment{display:grid;grid-template-columns:72px minmax(140px,1fr) repeat(3,minmax(100px,.7fr)) auto;gap:9px;align-items:center;padding:10px 0;border-bottom:1px solid var(--line,#e2e8f0)}.sub127-proof{width:68px;height:54px;object-fit:cover;border-radius:8px;border:1px solid var(--line,#e2e8f0);background:#f8fafc;cursor:zoom-in}.sub127-actions{display:flex;gap:5px}.sub127-payment-cell{display:flex;align-items:center;gap:7px;flex-wrap:wrap}.sub127-payment-cell .btn{padding:6px 9px;font-size:8px}.sub127-payment-phone{font-weight:900;direction:ltr;display:inline-block}.sub127-proof-large{display:block;width:min(100%,680px);max-height:68vh;object-fit:contain;margin:14px auto 0;border-radius:14px;border:1px solid var(--line,#e2e8f0);background:#0f172a}.sub127-payment-details{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:14px}.sub127-payment-detail{padding:10px;border:1px solid var(--line,#e2e8f0);border-radius:10px}.sub127-payment-detail span{display:block;color:var(--muted,#64748b);font-size:8px}.sub127-payment-detail b{display:block;margin-top:4px;font-size:11px}
      .sub127-modal-back{position:fixed;inset:0;z-index:99999;background:rgba(15,23,42,.48);display:grid;place-items:center;padding:16px}.sub127-modal{width:min(720px,96vw);max-height:92vh;overflow:auto;background:var(--card,#fff);border-radius:18px;padding:18px;box-shadow:0 26px 80px rgba(15,23,42,.28)}.sub127-modal-head{display:flex;align-items:flex-start;gap:10px}.sub127-modal-head h2{margin:0}.sub127-form{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:15px}.sub127-form label{display:grid;gap:5px;font-size:9px;font-weight:800;color:var(--muted,#64748b)}.sub127-modal-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:15px}
      html[data-kun-subscription-locked="1"] .nav .nav-group,html[data-kun-subscription-locked="1"] .nav button[data-view]:not([data-view="dashboard"]),html[data-kun-subscription-locked="1"] .nav [data-kun-shortcuts-nav],html[data-kun-subscription-locked="1"] #quickBtn{display:none!important}
      body[data-theme="dark"] .sub127-client-panel,body[data-theme="dark"] .sub127-kpi,body[data-theme="dark"] .sub127-modal{background:var(--card);border-color:var(--line)}body[data-theme="dark"] .sub127-table th{background:#172033}
      @media(max-width:850px){.sub127-kpis,.sub127-summary{grid-template-columns:1fr 1fr}.sub127-topup{grid-template-columns:1fr 1fr}.sub127-topup .btn{grid-column:1/-1}.sub127-payment{grid-template-columns:64px 1fr auto}.sub127-payment>:nth-child(3),.sub127-payment>:nth-child(4),.sub127-payment>:nth-child(5){display:none}}
      @media(max-width:520px){.sub127-kpis,.sub127-summary,.sub127-form,.sub127-topup{grid-template-columns:1fr}.sub127-client-head{flex-wrap:wrap}.sub127-badge{margin-inline-start:0}.sub127-toolbar .input{min-width:0;width:100%}.sub127-payment{grid-template-columns:58px 1fr}.sub127-actions{grid-column:1/-1}.sub127-proof{width:56px;height:50px}.sub127-payment-details{grid-template-columns:1fr 1fr}}
    `;document.head.appendChild(el);
  }

  const statusText=a=>a?.trialActive?'تجربة مجانية':a?.locked?'متوقف لعدم كفاية الرصيد':a?.subscriptionStatus==='unmanaged'?'غير مفعّل على نظام الاشتراكات':'نشط';
  const reasonText=a=>a?.reason==='monthly_minimum_due'?'الرصيد لا يكفي الحد الأدنى الشهري':a?.reason==='balance_empty'?'الرصيد انتهى':a?.reason==='subscription_paused'?'الاشتراك موقوف من الإدارة':a?.reason==='wallet_paused'?'المحفظة موقوفة':'';

  async function proofData(file){
    if(!file)throw new Error('ارفع صورة إثبات التحويل');
    if(!String(file.type||'').startsWith('image/'))throw new Error('الملف لازم يكون صورة إثبات تحويل');
    const read=f=>new Promise((resolve,reject)=>{const fr=new FileReader();fr.onload=()=>resolve(String(fr.result||''));fr.onerror=()=>reject(new Error('تعذر قراءة الصورة'));fr.readAsDataURL(f);});
    const supported=/^image\/(jpeg|png|webp)$/i.test(file.type),raw=await read(file);
    if(supported&&raw.length<=360000)return raw;
    let image=null,width=0,height=0,release=()=>{};
    try{
      if(typeof createImageBitmap==='function'){
        image=await createImageBitmap(file);width=image.width;height=image.height;release=()=>image.close?.();
      }else{
        image=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('تعذر فتح الصورة على هذا الجهاز'));img.src=raw;});
        width=image.naturalWidth||image.width;height=image.naturalHeight||image.height;
      }
      const maxSide=1100,scale=Math.min(1,maxSide/Math.max(width,height)),canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
      const ctx=canvas.getContext('2d');if(!ctx)throw new Error('تعذر تجهيز صورة التحويل');
      ctx.drawImage(image,0,0,canvas.width,canvas.height);
      for(const q of [.78,.66,.54,.44,.34]){const out=canvas.toDataURL('image/jpeg',q);if(out.length<=420000){release();return out;}}
      release();throw new Error('صورة التحويل كبيرة جدًا. التقط Screenshot أصغر ثم حاول مرة أخرى.');
    }catch(error){
      release();
      if(supported&&raw.length<=440000)return raw;
      throw new Error(error?.message||'تعذر تجهيز صورة التحويل على هذا الجهاز');
    }
  }

  async function restoreNav({reloadPermissions=false}={}){
    delete document.documentElement.dataset.kunSubscriptionLocked;
    $$('[data-sub127-hidden="1"]').forEach(b=>{b.hidden=false;b.style.display='';delete b.dataset.sub127Hidden;});
    $$('.nav .nav-group').forEach(group=>{group.hidden=false;group.style.removeProperty('display');});
    try{
      if(reloadPermissions&&window.KunPermissionNavigationV51?.load)await window.KunPermissionNavigationV51.load();
      else window.KunPermissionNavigationV51?.apply?.();
    }catch(error){console.warn('permission navigation restore failed',error);}
    window.KunSidebarGroupsV90?.sync?.();
    window.KunEcommerceCalculatorShortcutV93?.sync?.();
    window.KunFinanceCommandCenterV96?.mergeNavigation?.();
    setTimeout(()=>window.KunSidebarGroupsV90?.sync?.(),60);
    window.dispatchEvent(new CustomEvent('kun:subscription-access-restored',{detail:{access:state.access}}));
  }
  function lockNav(){
    if(!state.access?.locked)return;
    document.documentElement.dataset.kunSubscriptionLocked='1';
    $$('.nav button[data-view]').forEach(b=>{if(b.dataset.view==='dashboard')return;b.dataset.sub127Hidden='1';b.hidden=true;b.style.display='none';});
    window.KunSidebarGroupsV90?.sync?.();
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
    return `<section class="sub127-client-panel ${cls}" data-sub127-client-panel="1"><div class="sub127-client-head"><div><h3>${locked?'استكمال تشغيل Kun Online':'الاشتراك والرصيد'}</h3><p>${locked?`${esc(reasonText(a))}. الداشبورد متاح، وبمجرد اعتماد التحويل سيعود النظام للعمل تلقائيًا.`:trial?`الفترة المجانية فعالة حتى ${esc(a.trialEndsAt||'—')} ولا يتم خلالها خصم رسوم شهرية أو رسوم على الأوردرات.`:'متابعة الرصيد ورسوم التشغيل الحالية.'}</p></div><span class="sub127-badge">${esc(badge)}</span></div><div class="sub127-kpis"><div class="sub127-kpi"><span>الرصيد الحالي</span><b>${money(a?.balance,currency)}</b></div><div class="sub127-kpi"><span>الحد الأدنى الشهري</span><b>${trial?'مجانًا':money(a?.monthlyMinimum,currency)}</b></div><div class="sub127-kpi"><span>رسوم كل أوردر</span><b>${trial?'مجانًا':money(a?.orderFee,currency)}</b></div><div class="sub127-kpi"><span>الحالة</span><b>${esc(badge)}</b></div></div><div class="sub127-topup"><label>المبلغ المحوّل<input class="input" id="sub127Amount" type="number" min="1" step="0.01" placeholder="مثال: 500"></label><label>رقم الهاتف المحوّل منه<input class="input" id="sub127Phone" type="tel" placeholder="01xxxxxxxxx"></label><label>صورة إثبات التحويل<input class="input" id="sub127Proof" type="file" accept="image/*"></label><button class="btn primary" id="sub127Submit" type="button">إرسال طلب الشحن</button></div><div class="sub127-note">بعد الإرسال يظهر الطلب لدى الإدارة في قسم «الاشتراكات». عند اعتماد التحويل يتم شحن الرصيد وفحص الحد الأدنى الشهري وتفعيل الأقسام تلقائيًا إذا أصبح الرصيد كافيًا.</div></section>`;
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
      const wasLocked=state.locked,a=await api('/api/subscription/access');state.access=a;state.locked=Boolean(a.locked);
      if(state.locked)lockNav();
      else await restoreNav({reloadPermissions:wasLocked||!window.KunPermissionNavigationV51?.snapshot?.role});
      ensureClientPanel();
      if(wasLocked&&!state.locked)window.showToast?.('تم شحن الرصيد وتفعيل النظام وكل الأقسام تلقائيًا');
      else if(force)window.showToast?.(a.locked?'الرصيد ما زال غير كافٍ للتفعيل':'تم تفعيل النظام');
      return a;
    }catch(error){console.warn('subscription access unavailable',error);return null;}
  }
  function scheduleAccessRefresh(){
    clearTimeout(state.timer);if(!state.me?.clientId||state.me.role==='admin')return;
    state.timer=setTimeout(async()=>{await refreshAccess(false);scheduleAccessRefresh();},state.locked?5000:60000);
  }

  function addAdminNav(){
    if(state.me?.role!=='admin')return;
    const nav=$('.nav');if(!nav)return;
    let b=$('button[data-view="subscriptions"]',nav);if(!b){b=document.createElement('button');b.type='button';b.dataset.view='subscriptions';b.className='v27-admin-only';b.textContent='الاشتراكات';const admin=$('button[data-view="admin-clients"]',nav);admin?admin.after(b):nav.appendChild(b);}
    b.hidden=false;b.style.display='';
  }
  function setAdminActive(){
    $$$('.nav button[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view==='subscriptions'));
  }
  function adminStatus(c){
    const cls=c.trialActive?'trial':c.locked?'locked':c.subscriptionStatus==='unmanaged'?'unmanaged':'';
    return `<span class="sub127-status ${cls}">${esc(c.trialActive?'تجربة مجانية':c.locked?'متوقف':c.subscriptionStatus==='unmanaged'?'غير مُدار':'نشط')}</span>`;
  }
  function clientPendingTopups(clientId){
    return state.topups.filter(p=>String(p.client_id)===String(clientId));
  }
  function pendingPaymentCell(c){
    const items=clientPendingTopups(c.clientId);
    if(!items.length)return '—';
    const latest=items[items.length-1]||items[0],phone=latest?.sender_phone||'—';
    return `<div class="sub127-payment-cell"><span><b>${num(items.length)} طلب</b> · ${money(c.pendingTopupAmount,c.currency)}</span><span class="sub127-payment-phone">${esc(phone)}</span><button class="btn soft" type="button" data-sub127-view-client-payment="${esc(c.clientId)}">عرض التحويل</button></div>`;
  }
  function adminRow(c){
    return `<tr data-sub127-search="${esc([c.name,c.ownerName,c.ownerEmail,c.clientId].join(' ').toLowerCase())}"><td class="sub127-client-name"><b>${esc(c.name||c.clientId)}</b><small>${esc(c.ownerName||'')} · ${esc(c.ownerEmail||'')}</small></td><td>${adminStatus(c)}</td><td><b>${money(c.balance,c.currency)}</b></td><td>${money(c.monthlyMinimum,c.currency)}</td><td>${money(c.orderFee,c.currency)}</td><td>${c.trialActive?esc(c.trialEndsAt||'—'):'—'}</td><td>${pendingPaymentCell(c)}</td><td><button class="btn soft" data-sub127-manage="${esc(c.clientId)}">إدارة الاشتراك</button></td></tr>`;
  }
  function paymentRow(p){
    const hasProof=Boolean(Number(p.has_proof));
    const proofCell=hasProof?`<button class="btn soft" type="button" data-sub127-view-payment="${esc(p.id)}"><span class="sub127-proof" style="display:grid;place-items:center">عرض<br>الإثبات</span></button>`:'<div class="sub127-proof" style="display:grid;place-items:center"><span class="meta">بدون صورة</span></div>';
    const client=state.adminClients.find(c=>String(c.clientId)===String(p.client_id));
    return `<div class="sub127-payment">${proofCell}<div><b>${esc(client?.name||p.client_id)}</b><div class="meta">${esc(p.requested_at||'')}</div></div><div><span class="meta">المبلغ</span><b>${money(p.amount,p.currency)}</b></div><div><span class="meta">رقم الهاتف</span><b class="sub127-payment-phone">${esc(p.sender_phone||'—')}</b></div><div><span class="meta">الطريقة</span><b>${esc(p.transfer_method||'تحويل')}</b></div><div class="sub127-actions">${hasProof?`<button class="btn soft" type="button" data-sub127-view-payment="${esc(p.id)}">عرض الصورة</button>`:''}<button class="btn primary" data-sub127-approve="${esc(p.id)}">اعتماد</button><button class="btn soft" data-sub127-reject="${esc(p.id)}">رفض</button></div></div>`;
  }

  function closeModal(){$('.sub127-modal-back')?.remove();}
  async function paymentProof(paymentId){
    const key=String(paymentId);
    if(state.proofCache.has(key))return state.proofCache.get(key);
    const data=await api(`/api/admin/wallet/topups/${encodeURIComponent(key)}/proof`);
    state.proofCache.set(key,data);return data;
  }
  async function openPaymentProof(paymentId){
    const summary=state.topups.find(x=>String(x.id)===String(paymentId));if(!summary)return;
    const client=state.adminClients.find(c=>String(c.clientId)===String(summary.client_id));
    closeModal();const back=document.createElement('div');back.className='sub127-modal-back';
    back.innerHTML=`<div class="sub127-modal"><div class="sub127-modal-head"><div><h2>تفاصيل التحويل</h2><div class="meta">${esc(client?.name||summary.client_id||'')}</div></div><div class="spacer"></div><button class="btn soft" data-sub127-close>إغلاق</button></div><div class="card empty mt" data-sub127-proof-loading>جارٍ تحميل صورة التحويل...</div></div>`;
    document.body.appendChild(back);back.onclick=e=>{if(e.target===back)closeModal();};$('[data-sub127-close]',back).onclick=closeModal;
    try{
      const p=await paymentProof(paymentId);if(!back.isConnected)return;
      const proof=p.proof_data_url||p.proof_url||'',modal=$('.sub127-modal',back);if(!modal)return;
      modal.innerHTML=`<div class="sub127-modal-head"><div><h2>تفاصيل التحويل</h2><div class="meta">${esc(client?.name||p.client_id||'')}</div></div><div class="spacer"></div><button class="btn soft" data-sub127-close>إغلاق</button></div><div class="sub127-payment-details"><div class="sub127-payment-detail"><span>المبلغ</span><b>${money(p.amount,p.currency)}</b></div><div class="sub127-payment-detail"><span>رقم الهاتف المحوّل منه</span><b class="sub127-payment-phone">${esc(p.sender_phone||'—')}</b></div><div class="sub127-payment-detail"><span>تاريخ الطلب</span><b>${esc(p.requested_at||'—')}</b></div></div>${proof?`<img class="sub127-proof-large" src="${esc(proof)}" alt="سكرين إثبات التحويل">`:'<div class="empty mt">لا توجد صورة مرفوعة لهذا الطلب.</div>'}<div class="sub127-modal-actions"><button class="btn primary" data-sub127-approve="${esc(p.id)}">اعتماد التحويل</button><button class="btn soft" data-sub127-reject="${esc(p.id)}">رفض</button></div>`;
      $('[data-sub127-close]',back).onclick=closeModal;
      $('[data-sub127-approve]',back).onclick=()=>approveTopup(p.id).then(closeModal).catch(e=>window.showToast?.(e.message));
      $('[data-sub127-reject]',back).onclick=()=>rejectTopup(p.id).then(closeModal).catch(e=>window.showToast?.(e.message));
    }catch(error){
      if(!back.isConnected)return;const loading=$('[data-sub127-proof-loading]',back);
      if(loading)loading.innerHTML=`<b>تعذر تحميل صورة التحويل</b><div class="meta mt">${esc(error.message)}</div><button class="btn soft mt" data-sub127-proof-retry>إعادة المحاولة</button>`;
      $('[data-sub127-proof-retry]',back)?.addEventListener('click',()=>{state.proofCache.delete(String(paymentId));closeModal();openPaymentProof(paymentId);},{once:true});
    }
  }
  function openClientPayment(clientId){
    const items=clientPendingTopups(clientId);if(!items.length){window.showToast?.('لا توجد دفعات معلقة لهذا العميل');return;}
    openPaymentProof(items[items.length-1]?.id||items[0].id);
  }
  function openManage(clientId){
    const c=state.adminClients.find(x=>String(x.clientId)===String(clientId));if(!c)return;
    closeModal();const back=document.createElement('div');back.className='sub127-modal-back';back.innerHTML=`<div class="sub127-modal"><div class="sub127-modal-head"><div><h2>اشتراك ${esc(c.name||clientId)}</h2><div class="meta">${esc(c.ownerEmail||clientId)}</div></div><div class="spacer"></div><button class="btn soft" data-sub127-close>إغلاق</button></div><div class="sub127-kpis"><div class="sub127-kpi"><span>الرصيد</span><b>${money(c.balance,c.currency)}</b></div><div class="sub127-kpi"><span>الحالة</span><b>${esc(statusText(c))}</b></div><div class="sub127-kpi"><span>الفترة المجانية</span><b>${c.trialActive?esc(c.trialEndsAt):'غير مفعلة'}</b></div><div class="sub127-kpi"><span>طلبات شحن معلقة</span><b>${num(c.pendingTopups)}</b></div></div><div class="sub127-form"><label>الحد الأدنى الشهري<input class="input" id="sub127Monthly" type="number" min="0" step="1" value="${esc(c.monthlyMinimum)}"></label><label>رسوم كل أوردر — المبلغ النهائي<input class="input" id="sub127OrderFee" type="number" min="0" step="0.25" value="${esc(c.baseOrderFee??c.orderFee)}"><span class="meta">هذا هو نفس المبلغ الذي سيُخصم فعليًا على الأوردر، بدون أي إضافات مخفية.</span></label><label>حالة الاشتراك<select class="select" id="sub127Status"><option value="">بدون تغيير</option><option value="active">نشط</option><option value="paused">موقوف</option></select></label><label><span>الفترة المجانية</span><span><input type="checkbox" id="sub127TrialToggle" ${c.trialActive?'checked':''}> منح 30 يوم مجانًا لهذا الحساب</span></label></div><div class="sub127-modal-actions"><button class="btn primary" id="sub127Save">حفظ إعدادات الاشتراك</button><button class="btn soft" id="sub127Reconcile">فحص وتفعيل الآن</button></div><div class="sub127-note">الفترة المجانية اختيارية من الإدارة فقط وليست مرتبطة بالخطة. إذا لم تكن مفعلة، يطبق الحد الأدنى الشهري ورسوم الأوردرات مباشرة. إلغاء الفترة المجانية يطبق دورة الدفع فورًا.</div></div>`;document.body.appendChild(back);back.onclick=e=>{if(e.target===back)closeModal();};$('[data-sub127-close]',back).onclick=closeModal;
    $('#sub127Save',back).onclick=async()=>{try{
      const body={monthlyMinimum:Number($('#sub127Monthly',back).value||0),baseOrderFee:Number($('#sub127OrderFee',back).value||0)},st=$('#sub127Status',back).value,trialWanted=Boolean($('#sub127TrialToggle',back)?.checked);
      if(st)body.status=st;
      const saved=await api(`/api/admin/subscriptions/${encodeURIComponent(clientId)}`,{method:'PATCH',body:JSON.stringify(body)});
      if(trialWanted&&!c.trialActive)await api(`/api/admin/subscriptions/${encodeURIComponent(clientId)}/start-trial`,{method:'POST',body:'{}'});
      if(!trialWanted&&c.trialActive)await api(`/api/admin/subscriptions/${encodeURIComponent(clientId)}/end-trial`,{method:'POST',body:'{}'});
      const feeNow=saved?.access?.orderFee;
      window.showToast?.(trialWanted&&!c.trialActive?'تم حفظ الإعدادات ومنح 30 يوم مجانًا':!trialWanted&&c.trialActive?'تم إلغاء الفترة المجانية وتطبيق الدفع':Number.isFinite(Number(feeNow))?`تم حفظ الإعدادات — رسوم الأوردر الآن ${money(feeNow,saved?.access?.currency||c.currency)}`:'تم حفظ إعدادات الاشتراك');closeModal();renderAdmin();
    }catch(e){window.showToast?.(e.message)}};
    $('#sub127Reconcile',back).onclick=async()=>{try{const d=await api(`/api/admin/subscriptions/${encodeURIComponent(clientId)}/reconcile`,{method:'POST',body:'{}'});window.showToast?.(d.access?.locked?'الرصيد ما زال غير كافٍ':'العميل نشط الآن');closeModal();renderAdmin();}catch(e){window.showToast?.(e.message)}};
  }

  async function approveTopup(id){
    const result=await api(`/api/admin/wallet/topups/${encodeURIComponent(id)}/approve`,{method:'POST',body:JSON.stringify({note:'Approved from subscriptions center'})});
    state.proofCache.delete(String(id));
    const billed=result?.orderReconcile||{},currency=result?.currency||'EGP',parts=[`تم إضافة ${money(result?.creditedAmount,currency)}`];
    if(Number(billed.chargedOrders)>0)parts.push(`خصم ${money(billed.chargedAmount,currency)} مقابل ${num(billed.chargedOrders)} أوردر`);
    parts.push(`الرصيد النهائي ${money(result?.balance,currency)}`);
    parts.push(result?.access?(result.access.locked?'الحساب ما زال موقوفًا':'الحساب نشط'):'تم الشحن ويحتاج فحص حالة الاشتراك');
    window.showToast?.(parts.join(' — '));await renderAdmin();
  }
  async function rejectTopup(id){
    if(!confirm('رفض طلب الشحن؟'))return;
    await api(`/api/admin/wallet/topups/${encodeURIComponent(id)}/reject`,{method:'POST',body:JSON.stringify({note:'Rejected from subscriptions center'})});
    state.proofCache.delete(String(id));window.showToast?.('تم رفض الطلب');await renderAdmin();
  }

  async function renderAdmin(){
    if(state.me?.role!=='admin')return;
    addAdminNav();setAdminActive();const root=$('#root');if(!root)return;
    if(root.dataset.sub127Admin==='loading')return;
    root.dataset.sub127Admin='loading';root.innerHTML='<div class="card empty">جارٍ تحميل الاشتراكات والدفعات الجديدة...</div>';
    try{
      const [subsResult,topupsResult]=await Promise.allSettled([api('/api/admin/subscriptions'),api('/api/admin/wallet/topups?limit=300')]);
      if(subsResult.status!=='fulfilled')throw subsResult.reason;
      const subs=subsResult.value||{},topups=topupsResult.status==='fulfilled'?topupsResult.value:[];
      state.adminClients=Array.isArray(subs.clients)?subs.clients:[];
      state.topups=Array.isArray(topups)?topups:(Array.isArray(topups?.items)?topups.items:(Array.isArray(topups?.results)?topups.results:[]));
      const topupWarning=topupsResult.status==='rejected'?'<div class="insight warn">تم تحميل العملاء، لكن تعذر تحميل الدفعات المعلقة. اضغط تحديث للمحاولة مرة أخرى.</div>':'';
      const locked=state.adminClients.filter(x=>x.locked).length,trials=state.adminClients.filter(x=>x.trialActive).length,pending=state.topups.length;
      root.dataset.sub127Admin='ready';root.innerHTML=`<div class="sub127-admin">${topupWarning}<div class="page-head sub127-admin-head"><div><div class="title">الاشتراكات</div><div class="sub">إدارة الشهر المجاني، الحد الأدنى الشهري، رسوم الأوردرات، الرصيد، واعتماد تحويلات العملاء.</div></div><div class="spacer"></div><button class="btn soft" id="sub127ReconcileAll">فحص الدورة الشهرية</button></div><div class="grid kpis sub127-summary"><div class="card"><div class="k-label">العملاء</div><div class="k-val small">${num(state.adminClients.length)}</div></div><div class="card"><div class="k-label">متوقفون بسبب الرصيد</div><div class="k-val small">${num(locked)}</div></div><div class="card"><div class="k-label">شهر مجاني فعال</div><div class="k-val small">${num(trials)}</div></div><div class="card"><div class="k-label">دفعات تنتظر المراجعة</div><div class="k-val small">${num(pending)}</div></div></div><section class="card"><div class="sub127-toolbar"><input class="input" id="sub127Search" placeholder="ابحث باسم العميل أو البريد أو Client ID"><span class="meta" id="sub127Count">${num(state.adminClients.length)} عميل</span></div><div class="sub127-table-wrap mt"><table class="sub127-table"><thead><tr><th>العميل</th><th>الحالة</th><th>الرصيد</th><th>الحد الشهري</th><th>رسوم الأوردر</th><th>نهاية المجاني</th><th>دفعات معلقة</th><th></th></tr></thead><tbody>${state.adminClients.map(adminRow).join('')||'<tr><td colspan="8" class="empty">لا يوجد عملاء.</td></tr>'}</tbody></table></div></section><section class="card"><h3>الدفعات الجديدة من العملاء</h3><div class="meta">راجع صورة التحويل ثم اضغط اعتماد؛ الرصيد يُشحن وفحص التفعيل يتم فورًا.</div><div class="mt">${state.topups.map(paymentRow).join('')||'<div class="empty">لا توجد دفعات جديدة تنتظر المراجعة.</div>'}</div></section></div>`;
      $$('[data-sub127-manage]',root).forEach(b=>b.onclick=()=>openManage(b.dataset.sub127Manage));
      $$('[data-sub127-view-payment]',root).forEach(b=>b.onclick=()=>openPaymentProof(b.dataset.sub127ViewPayment));
      $$('[data-sub127-view-client-payment]',root).forEach(b=>b.onclick=()=>openClientPayment(b.dataset.sub127ViewClientPayment));
      $$('[data-sub127-approve]',root).forEach(b=>b.onclick=()=>approveTopup(b.dataset.sub127Approve).catch(e=>window.showToast?.(e.message)));
      $$('[data-sub127-reject]',root).forEach(b=>b.onclick=()=>rejectTopup(b.dataset.sub127Reject).catch(e=>window.showToast?.(e.message)));
      const search=$('#sub127Search',root),rows=$$('[data-sub127-search]',root),count=$('#sub127Count',root);search.oninput=()=>{const q=search.value.trim().toLowerCase();let visible=0;rows.forEach(row=>{const show=!q||row.dataset.sub127Search.includes(q);row.hidden=!show;if(show)visible++;});count.textContent=`${num(visible)} عميل`;};
      $('#sub127ReconcileAll',root).onclick=async()=>{try{await api('/api/admin/subscriptions/reconcile',{method:'POST',body:'{}'});window.showToast?.('تم فحص دورة الاشتراكات');renderAdmin();}catch(e){window.showToast?.(e.message)}};
    }catch(error){root.dataset.sub127Admin='error';root.innerHTML=`<div class="card empty"><h3>تعذر تحميل الاشتراكات</h3><p>${esc(error.message)}</p><button class="btn soft" id="sub127Retry">إعادة المحاولة</button></div>`;$('#sub127Retry',root).onclick=renderAdmin;}
  }

  function bind(){
    document.addEventListener('click',event=>{
      const nav=event.target.closest?.('.nav button[data-view],[data-go]');
      const target=nav?.dataset?.view||nav?.dataset?.go||'';
      if(target==='subscriptions'&&state.me?.role==='admin'){setTimeout(renderAdmin,15);return;}
      if(state.locked&&target&&target!=='dashboard'){event.preventDefault();event.stopImmediatePropagation();window.showToast?.('الرصيد غير كافٍ. الداشبورد وشحن الرصيد متاحان لحين اعتماد الدفع.');$('.nav button[data-view="dashboard"]')?.click();return;}
      if(target==='dashboard')setTimeout(ensureClientPanel,300);
    },true);
    const root=$('#root');if(root)new MutationObserver(()=>{if(state.me?.role==='admin'&&$('.nav button.active[data-view="subscriptions"]')&&!root.dataset.sub127Admin)setTimeout(renderAdmin,30);if(state.me?.role!=='admin'){if(state.locked)lockNav();if($('.v33-dashboard')&&!$('[data-sub127-client-panel]'))setTimeout(ensureClientPanel,40);}}).observe(root,{childList:true,subtree:true});
  }

  function installRouteGuard(){
    if(window.__kunSubscriptionRouteGuard127)return;window.__kunSubscriptionRouteGuard127=true;
    const original=window.setView;
    if(typeof original==='function')window.setView=function(view,...rest){
      if(state.locked&&String(view)!=='dashboard'){window.showToast?.('الرصيد غير كافٍ. المتاح حاليًا هو الداشبورد وشحن الرصيد.');return original.call(this,'dashboard',...rest);}
      return original.call(this,view,...rest);
    };
  }
  function installFetchGuard(){
    if(window.__kunSubscriptionFetch127)return;window.__kunSubscriptionFetch127=true;
    window.fetch=async function(...args){
      const response=await nativeFetch(...args);
      try{
        const input=args[0],url=typeof input==='string'?input:input?.url||'',parsed=new URL(url,location.origin),method=String(args[1]?.method||input?.method||'GET').toUpperCase();
        if(response.status===402)response.clone().json().then(data=>{if(data?.code==='SUBSCRIPTION_BALANCE_REQUIRED'&&data.access){state.access=data.access;state.locked=true;lockNav();ensureClientPanel();}}).catch(()=>{});
        if(method==='POST'&&(parsed.pathname==='/api/orders'||parsed.pathname==='/api/wa-order'||parsed.pathname==='/api/orders/bulk')){
          setTimeout(()=>refreshAccess(false),800);setTimeout(()=>refreshAccess(false),2500);
        }
      }catch{}
      return response;
    };
  }
  async function boot(){
    style();bind();
    try{state.me=await api('/api/me');}catch{return;}
    if(state.me.role==='admin'){addAdminNav();return;}
    if(state.me.clientId){installRouteGuard();installFetchGuard();await refreshAccess(false);scheduleAccessRefresh();}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
  window.KunSubscriptionsV127={version:VERSION,refreshAccess,renderAdmin,get access(){return state.access;}};
})();
