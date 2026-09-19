/* kun online v8 — Audit Log + access visibility */
(function(){
  const previousRender=render;
  async function auditView(){
    root.innerHTML='<div class="card empty">جاري تحميل سجل النشاط...</div>';
    try{
      const clientId=(typeof v4StoreId==='function'&&v4StoreId())||'';
      const suffix=`?limit=100${clientId?`&clientId=${encodeURIComponent(clientId)}`:''}`;
      const [rows,access]=await Promise.all([v4Api('/api/audit-log'+suffix),v4Api('/api/access/snapshot')]);
      const perms=(access.permissions||[]).slice(0,12);
      root.innerHTML=`<div class="page-head"><div><div class="title">سجل النشاط والأمان</div><div class="sub">من نفّذ ماذا ومتى — مع إظهار نطاق الصلاحيات الفعلي للحساب الحالي.</div></div></div>
      <div class="grid split"><div class="card"><h3>الحساب الحالي</h3><div class="meta">الدور</div><b>${esc(access.role||'—')}</b><div class="meta mt">نطاق المتجر</div><b>${esc(access.clientId||clientId||'اختيار متجر مطلوب للحساب الإداري')}</b></div><div class="card"><h3>الصلاحيات الفعالة</h3><div class="chips">${perms.length?perms.map(p=>`<span class="chip">${esc(p)}</span>`).join(''):'<span class="meta">لا توجد صلاحيات إضافية</span>'}</div></div></div>
      <div class="card table-wrap mt"><table class="table compact"><thead><tr><th>الوقت</th><th>المستخدم</th><th>العملية</th><th>النوع</th><th>المعرّف</th></tr></thead><tbody>${rows.length?rows.map(x=>`<tr><td>${esc((x.created_at||'').replace('T',' ').slice(0,19))}</td><td>${esc(x.actor_email||'System')}</td><td><b>${esc(x.action||'—')}</b></td><td>${esc(x.entity_type||'—')}</td><td>${esc(x.entity_id||'—')}</td></tr>`).join(''):'<tr><td colspan="5" class="empty">لا توجد عمليات مسجلة حتى الآن.</td></tr>'}</tbody></table></div>`;
    }catch(e){
      const needsStore=/clientId/i.test(e.message||'');
      root.innerHTML=`<div class="card empty"><b>${needsStore?'اختر متجرًا أولًا':'تعذر تحميل سجل النشاط'}</b><div class="meta mt">${esc(e.message||'حدث خطأ')}</div></div>`;
    }
  }
  render=function(){if(view==='audit')return auditView();return previousRender()};
})();
