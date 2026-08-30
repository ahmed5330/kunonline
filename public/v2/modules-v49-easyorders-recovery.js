/* Easy Orders resilient gap recovery UI */
(function(){
  const K=window.KunActionsV23;if(!K)return;
  function summary(result){
    const rows=(result.results||[]).map(x=>`<tr><td>${K.esc(x.connectionId||'—')}</td><td>${K.esc(String(x.recovered||0))}</td><td>${K.esc(String(x.updated||0))}</td><td>${K.esc(String(x.requests||0))}</td><td>${K.esc(x.error||x.rateLimited?'محدود مؤقتًا':'سليم')}</td></tr>`).join('');
    const note=result.seeded?`تم تحديد نقطة الاستكمال تلقائيًا من آخر أوردر Easy Orders معروف، ويتم فحص الفجوات حتى أحدث رقم.`:'لم يتم العثور على نقطة بداية بعد. بمجرد وجود Webhook سابق أو وصول أوردر جديد سيبدأ الإصلاح التلقائي.';
    return `<div class="card"><div class="title" style="font-size:18px">إصلاح مزامنة Easy Orders</div><div class="grid kpis four mt"><div class="card"><div class="k-label">أوردرات تم استرجاعها</div><div class="k-val">${K.esc(String(result.recovered||0))}</div></div><div class="card"><div class="k-label">أوردرات تم تحديثها</div><div class="k-val">${K.esc(String(result.updated||0))}</div></div><div class="card"><div class="k-label">طلبات API</div><div class="k-val">${K.esc(String(result.requests||0))}</div></div><div class="card"><div class="k-label">روابط Easy Orders</div><div class="k-val">${K.esc(String(result.connections||0))}</div></div></div><div class="insight ${result.rateLimited?'warn':'info'} mt"><strong>${result.rateLimited?'تم الوصول مؤقتًا لحد Easy Orders':'المزامنة المقاومة للفجوات مفعّلة'}</strong><div class="meta">${K.esc(note)}</div></div>${rows?`<div class="table-wrap mt"><table><thead><tr><th>Connection</th><th>مسترجع</th><th>محدّث</th><th>API</th><th>الحالة</th></tr></thead><tbody>${rows}</tbody></table></div>`:''}<div class="toolbar mt"><button class="btn primary" id="runEasyOrdersRecoveryAgain">فحص مرة أخرى</button><button class="btn soft" id="closeEasyOrdersRecovery">العودة للطلبات</button></div></div>`;
  }
  async function runRecovery(button=null){
    try{
      if(button){button.disabled=true;button.textContent='جاري فحص الفجوات...';}
      const {cid,sid}=await K.scope(),result=await K.api('/api/commerce/order-sync/reconcile',{method:'POST',body:JSON.stringify({clientId:cid,storeId:sid||undefined,maxRequests:30,lookback:80})});
      K.drawer('إصلاح مزامنة Easy Orders',summary(result));
      const again=document.getElementById('runEasyOrdersRecoveryAgain'),close=document.getElementById('closeEasyOrdersRecovery');if(again)again.onclick=()=>runRecovery(again);if(close)close.onclick=K.refresh;
      if(Number(result.recovered||0)>0)K.notify(`تم استرجاع ${result.recovered} أوردر من Easy Orders`);else K.notify('تم فحص مزامنة Easy Orders');
    }catch(e){K.notify(e.message);}finally{if(button&&document.body.contains(button)){button.disabled=false;button.textContent='إصلاح مزامنة Easy Orders';}}
  }
  function inject(){
    if(typeof view==='undefined'||view!=='orders')return;const head=document.querySelector('.page-head');if(!head||document.getElementById('easyOrdersRecoveryBtn'))return;
    const anchor=document.getElementById('commerceOrderSync')||head.querySelector('.spacer');if(!anchor)return;
    const b=document.createElement('button');b.className='btn soft';b.id='easyOrdersRecoveryBtn';b.textContent='إصلاح مزامنة Easy Orders';b.title='يفحص أرقام الطلبات القصيرة ويسترجع أي أوردر فات بسبب Webhook مفقود';anchor.insertAdjacentElement('afterend',b);
  }
  const baseOrders=typeof orders==='function'?orders:null;if(baseOrders)orders=function(){const html=baseOrders();queueMicrotask(inject);return html;};
  document.addEventListener('click',e=>{const b=e.target.closest?.('#easyOrdersRecoveryBtn');if(!b)return;e.preventDefault();e.stopImmediatePropagation();runRecovery(b);},true);
  const root=document.getElementById('root')||document.body;if(root)new MutationObserver(inject).observe(root,{childList:true,subtree:true});queueMicrotask(inject);
  document.documentElement.dataset.easyOrdersRecovery='ready';
})();
