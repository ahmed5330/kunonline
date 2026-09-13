/* kun online v19.1 — release readiness center with stale-view guards */
(function(){
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function api(path){const r=await fetch(path,{credentials:'include'});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||`HTTP ${r.status}`);return d;}
  const row=(label,ok,detail='')=>`<div class="rowline"><div><strong>${esc(label)}</strong>${detail?`<div class="meta">${esc(detail)}</div>`:''}</div><span class="badge ${ok?'b-delivered':'b-pending'}">${ok?'جاهز':'مطلوب'}</span></div>`;
  const mounted=(root,selector)=>root===document.getElementById('root')&&Boolean(root?.querySelector(selector));
  async function render(root){
    if(!root)return;
    root.innerHTML=`<div class="page-head"><div><div class="title">جاهزية النظام</div><div class="sub">فحص مباشر للبيئة، قاعدة البيانات، الجلسات والتشفير قبل أي اعتماد نهائي.</div></div><div class="spacer"></div><button class="btn soft" id="rrReload">إعادة الفحص</button></div><div id="rrKpis" class="grid kpis four"><div class="card">جارٍ الفحص...</div></div><div class="grid split mt"><div class="card"><div class="title" style="font-size:18px">فحوصات البيئة</div><div id="rrChecks"></div></div><div class="card"><div class="title" style="font-size:18px">جداول النظام الأساسية</div><div id="rrTables"></div></div></div>`;
    const load=async()=>{
      try{
        const d=await api('/api/release/readiness');if(!mounted(root,'#rrKpis'))return;
        const c=d.checks||{},tables=d.tables||{},keyDetail=d.integrationEncryptionKeySource==='dedicated'?'مفتاح مستقل من بيئة Cloudflare':d.integrationEncryptionKeySource==='preview_derived'?'مفتاح Preview معزول مشتق من SESSION_SECRET':'مطلوب لحفظ بيانات ربط المنصات بشكل مشفر';
        const kpis=root.querySelector('#rrKpis'),checks=root.querySelector('#rrChecks'),tableBox=root.querySelector('#rrTables');if(!kpis||!checks||!tableBox)return;
        kpis.innerHTML=`<div class="card"><div class="k-label">Code Ready</div><div class="k-val small">${d.codeReady?'جاهز':'غير مكتمل'}</div></div><div class="card"><div class="k-label">Integrations Ready</div><div class="k-val small">${d.integrationsReady?'جاهز':'يحتاج مفتاح'}</div></div><div class="card"><div class="k-label">البيئة</div><div class="k-val small">${esc(d.environment||'—')}</div></div><div class="card"><div class="k-label">الجداول الأساسية</div><div class="k-val">${Object.values(tables).filter(Boolean).length}/${Object.keys(tables).length}</div></div>`;
        checks.innerHTML=[row('قاعدة البيانات',!!c.database),row('SESSION_SECRET',!!c.sessionSecret,'مطلوب لاستقرار جلسات المستخدمين'),row('INTEGRATION_ENCRYPTION_KEY',!!c.integrationEncryptionKey,keyDetail),row('Preview Environment',!!c.previewEnvironment,'يجب أن تبقى هذه النسخة معزولة عن Production')].join('');
        tableBox.innerHTML=Object.entries(tables).map(([k,v])=>row(k,!!v)).join('');
      }catch(e){const kpis=root?.querySelector?.('#rrKpis');if(!kpis)return;kpis.innerHTML=`<div class="card">${esc(e.message)}</div>`;const checks=root.querySelector('#rrChecks'),tables=root.querySelector('#rrTables');if(checks)checks.innerHTML='';if(tables)tables.innerHTML='';}
    };
    root.querySelector('#rrReload')?.addEventListener('click',load);load();
  }
  function hook(){document.addEventListener('click',e=>{const b=e.target.closest('.nav button');if(b?.dataset.view==='readiness')setTimeout(()=>render(document.getElementById('root')),0);});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',hook);else hook();
})();
