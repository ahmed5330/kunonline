/* Easy Orders resilient gap recovery UI */
(function(){
  const K=window.KunActionsV23;if(!K)return;
  const labels={healthy:'مكتمل وسليم',catching_up:'جاري الاستكمال',rate_limited:'حد Easy Orders مؤقتًا',waiting_for_short_id:'بانتظار نقطة بداية',error:'خطأ في المزامنة'};
  const label=s=>labels[s]||'غير معروف';
  const statusTone=s=>s==='healthy'?'success':s==='catching_up'||s==='waiting_for_short_id'?'info':'warn';
  function summary(result){
    const rows=(result.results||[]).map(x=>`<tr><td>${K.esc(x.connectionId||'—')}</td><td>${K.esc(String(x.recovered||0))}</td><td>${K.esc(String(x.updated||0))}</td><td>${K.esc(String(x.requests||0))}</td><td>${K.esc(String(x.estimatedRemaining||0))}</td><td>${K.esc(label(x.status|| (x.error?'error':x.rateLimited?'rate_limited':'healthy')))}</td></tr>`).join('');
    const remaining=Number(result.estimatedRemaining||0),total=Number(result.recoveredTotal||0),state=result.status||(result.rateLimited?'rate_limited':'healthy');
    let note='المزامنة التلقائية تعمل كل 5 دقائق وتفحص أي فجوات جديدة بدون إنشاء أوردرات مكررة.';
    if(state==='catching_up')note=`ما زال هناك نحو ${remaining} رقم طلب داخل نطاق الفحص الحالي. النظام سيكمل تلقائيًا كل 5 دقائق، ويمكنك الضغط على «استكمال الآن» لتشغيل دفعة إضافية.`;
    else if(state==='waiting_for_short_id')note='لم يتم تحديد نقطة بداية بعد. بمجرد وصول Webhook يحمل Short ID سيبدأ الاسترجاع التلقائي.';
    else if(state==='rate_limited')note='Easy Orders أوقف الطلبات مؤقتًا بسبب حد الـAPI. الـCron سيحاول مرة أخرى تلقائيًا في التشغيل التالي.';
    else if(state==='error')note='يوجد خطأ في أحد روابط Easy Orders. راجع تفاصيل الحالة أدناه ثم أعد الفحص.';
    return `<div class="card"><div class="title" style="font-size:18px">إصلاح مزامنة Easy Orders</div><div class="grid kpis four mt"><div class="card"><div class="k-label">مسترجع في هذه الدفعة</div><div class="k-val">${K.esc(String(result.recovered||0))}</div></div><div class="card"><div class="k-label">إجمالي المسترجع تلقائيًا</div><div class="k-val">${K.esc(String(total))}</div></div><div class="card"><div class="k-label">المتبقي التقديري للفحص</div><div class="k-val">${K.esc(String(remaining))}</div></div><div class="card"><div class="k-label">حالة المزامنة</div><div class="k-val" style="font-size:16px">${K.esc(label(state))}</div></div></div><div class="insight ${statusTone(state)} mt"><strong>${K.esc(label(state))}</strong><div class="meta">${K.esc(note)}</div></div>${rows?`<div class="table-wrap mt"><table><thead><tr><th>Connection</th><th>مسترجع</th><th>محدّث</th><th>API</th><th>متبقي تقديري</th><th>الحالة</th></tr></thead><tbody>${rows}</tbody></table></div>`:''}<div class="toolbar mt"><button class="btn primary" id="runEasyOrdersRecoveryAgain">${state==='catching_up'?'استكمال الآن':'فحص مرة أخرى'}</button><button class="btn soft" id="closeEasyOrdersRecovery">العودة للطلبات</button></div></div>`;
  }
  async function scopedStatus(){
    const {cid,sid}=await K.scope(),q=new URLSearchParams();if(cid)q.set('clientId',cid);if(sid)q.set('storeId',sid);
    return K.api(`/api/commerce/order-sync/recovery-status?${q}`);
  }
  async function refreshBadge(){
    const badge=document.getElementById('easyOrdersRecoveryState');if(!badge)return;
    try{
      const status=await scopedStatus(),state=status.status||'waiting_for_short_id',remaining=Number(status.estimatedRemaining||0);
      badge.textContent=state==='catching_up'?`${label(state)} · ${remaining} متبقي`:label(state);
      badge.dataset.status=state;
      badge.title=`إجمالي المسترجع تلقائيًا: ${Number(status.recoveredTotal||0)}`;
      badge.style.cssText=`font-size:12px;padding:6px 9px;border-radius:999px;border:1px solid var(--line,#dbe2ea);opacity:${state==='healthy'?'0.8':'1'}`;
    }catch{badge.textContent='حالة المزامنة غير متاحة';}
  }
  async function runRecovery(button=null){
    try{
      if(button){button.disabled=true;button.textContent='جاري فحص الفجوات...';}
      const {cid,sid}=await K.scope(),result=await K.api('/api/commerce/order-sync/reconcile',{method:'POST',body:JSON.stringify({clientId:cid,storeId:sid||undefined,maxRequests:30,lookback:80})});
      K.drawer('إصلاح مزامنة Easy Orders',summary(result));
      const again=document.getElementById('runEasyOrdersRecoveryAgain'),close=document.getElementById('closeEasyOrdersRecovery');if(again)again.onclick=()=>runRecovery(again);if(close)close.onclick=K.refresh;
      if(Number(result.recovered||0)>0)K.notify(`تم استرجاع ${result.recovered} أوردر من Easy Orders`);else if(result.status==='catching_up')K.notify('تم فحص دفعة جديدة وسيستكمل النظام تلقائيًا');else K.notify('تم فحص مزامنة Easy Orders');
      refreshBadge();
    }catch(e){K.notify(e.message);}finally{if(button&&document.body.contains(button)){button.disabled=false;button.textContent='إصلاح مزامنة Easy Orders';}}
  }
  function inject(){
    if(typeof view==='undefined'||view!=='orders')return;const head=document.querySelector('.page-head');if(!head||document.getElementById('easyOrdersRecoveryBtn'))return;
    const anchor=document.getElementById('commerceOrderSync')||head.querySelector('.spacer');if(!anchor)return;
    const b=document.createElement('button');b.className='btn soft';b.id='easyOrdersRecoveryBtn';b.textContent='إصلاح مزامنة Easy Orders';b.title='يفحص أرقام الطلبات القصيرة ويسترجع أي أوردر فات بسبب Webhook مفقود';anchor.insertAdjacentElement('afterend',b);
    const badge=document.createElement('span');badge.id='easyOrdersRecoveryState';badge.textContent='جاري قراءة حالة المزامنة...';b.insertAdjacentElement('afterend',badge);refreshBadge();
  }
  const baseOrders=typeof orders==='function'?orders:null;if(baseOrders)orders=function(){const html=baseOrders();queueMicrotask(inject);return html;};
  document.addEventListener('click',e=>{const b=e.target.closest?.('#easyOrdersRecoveryBtn');if(!b)return;e.preventDefault();e.stopImmediatePropagation();runRecovery(b);},true);
  document.addEventListener('kun:store-changed',()=>setTimeout(refreshBadge,0));
  queueMicrotask(inject);
  document.documentElement.dataset.easyOrdersRecovery='ready';
})();
