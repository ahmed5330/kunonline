/* kun online v10 — Operations Center */
(function(){
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function api(path,options={}){const r=await fetch(path,{credentials:'include',headers:{'Content-Type':'application/json',...(options.headers||{})},...options});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||`HTTP ${r.status}`);return d;}
  const fmt=d=>d?new Date(d).toLocaleString('ar-EG'):'—';
  const badge=s=>`<span class="badge ${s==='completed'||s==='healthy'?'b-delivered':s==='failed'||s==='dead_letter'||s==='down'?'b-cancelled':'b-pending'}">${esc(s||'unknown')}</span>`;

  async function renderOps(root){
    root.innerHTML=`<div class="page-head"><div><div class="title">مركز التشغيل</div><div class="sub">حالة النظام، طابور التنفيذ، التكاملات والتنبيهات من مكان واحد.</div></div><div class="spacer"></div><button class="btn soft" id="opsReload">تحديث</button></div><div id="opsStatus" class="empty">جارٍ التحميل...</div><div class="grid split mt"><div class="card"><div class="title" style="font-size:18px">طابور التنفيذ</div><div id="opsJobs" class="empty small-empty">جارٍ التحميل...</div></div><div class="card"><div class="title" style="font-size:18px">الإشعارات</div><div id="opsNotifications" class="empty small-empty">جارٍ التحميل...</div></div></div>`;
    const load=async()=>{try{
      const [s,jobs,notes]=await Promise.all([api('/api/system-status'),api('/api/execution-jobs'),api('/api/notifications')]);
      root.querySelector('#opsStatus').className='grid kpis four';root.querySelector('#opsStatus').innerHTML=`<div class="card"><div class="k-label">بانتظار الموافقة</div><div class="k-val">${s.pendingApprovals}</div></div><div class="card"><div class="k-label">Queued jobs</div><div class="k-val">${s.queue.queued}</div></div><div class="card"><div class="k-label">Failed / Dead letter</div><div class="k-val">${s.queue.failed+s.queue.deadLetter}</div></div><div class="card"><div class="k-label">إشعارات غير مقروءة</div><div class="k-val">${s.unreadNotifications}</div></div>`;
      const jb=root.querySelector('#opsJobs');jb.className=jobs.length?'table-wrap':'empty small-empty';jb.innerHTML=jobs.length?`<table class="table compact"><thead><tr><th>الإجراء</th><th>المصدر</th><th>الحالة</th><th>المحاولات</th><th>آخر خطأ</th><th>الوقت</th></tr></thead><tbody>${jobs.map(x=>`<tr><td>${esc(x.action_type)}</td><td>${esc(x.source)}</td><td>${badge(x.status)}</td><td>${x.attempts}/${x.max_attempts}</td><td>${esc(x.last_error||'—')}</td><td>${fmt(x.created_at)}</td></tr>`).join('')}</tbody></table>`:'لا توجد مهام تنفيذ.';
      const nb=root.querySelector('#opsNotifications');nb.className=notes.length?'':'empty small-empty';nb.innerHTML=notes.length?notes.slice(0,15).map(n=>`<div class="insight ${n.severity==='danger'?'danger':n.severity==='warn'?'warn':'info'}"><div><strong>${esc(n.title)}</strong><div class="meta">${esc(n.body||'')} · ${fmt(n.created_at)}</div></div>${!n.read_at?`<button class="link ntRead" data-id="${esc(n.id)}">تمت القراءة</button>`:''}</div>`).join(''):'لا توجد إشعارات.';nb.querySelectorAll('.ntRead').forEach(b=>b.onclick=async()=>{await api(`/api/notifications/${encodeURIComponent(b.dataset.id)}/read`,{method:'POST',body:'{}'});load();});
    }catch(e){root.querySelector('#opsStatus').className='empty';root.querySelector('#opsStatus').textContent=e.message;}};
    root.querySelector('#opsReload').onclick=load;load();
  }
  function hook(){document.addEventListener('click',e=>{const b=e.target.closest('.nav button');if(b?.dataset.view==='ops')setTimeout(()=>renderOps(document.getElementById('root')),0);});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',hook);else hook();
})();
