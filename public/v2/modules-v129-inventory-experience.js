/* Kun Online v129 — inventory workbench UX: read-only filters and existing operational shortcuts. */
(function(){
  'use strict';
  const root=document.getElementById('root');
  if(!root)return;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
  const fmt=v=>new Intl.NumberFormat('ar-EG').format(v);
  const tell=message=>window.KunActionsV23?.notify?.(message)||window.showToast?.(message);
  const isInventory=()=>!!document.querySelector('.nav button.active[data-view="inventory"]');
  const num=v=>Number.isFinite(Number(v))?Number(v):0;
  function style(){
    if(document.getElementById('kunInventoryUXStyle'))return;
    const el=document.createElement('style');el.id='kunInventoryUXStyle';
    el.textContent=[
      '#kunInvExperience{display:grid;gap:14px;margin:18px 0;padding:18px;border:1px solid var(--line,#e2e8f0);border-radius:18px;background:var(--card,#fff);box-shadow:0 5px 18px rgba(15,23,42,.035)}',
      '.ki-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}.ki-heading{font-size:18px;font-weight:900;margin:0}.ki-help{font-size:12px;color:var(--muted,#64748b);margin-top:4px;line-height:1.9}',
      '.ki-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.ki-actions .btn{min-height:38px}.ki-controls{display:grid;grid-template-columns:minmax(220px,1fr) minmax(170px,220px);gap:10px;align-items:center}',
      '.ki-search{position:relative}.ki-search input{width:100%;padding-inline-start:39px}.ki-search:before{content:"⌕";position:absolute;right:13px;top:50%;transform:translateY(-50%);font-size:24px;color:var(--muted,#64748b);pointer-events:none}',
      '.ki-tabs{display:flex;gap:6px;flex-wrap:wrap}.ki-tab{appearance:none;border:1px solid var(--line,#dbe3ef);border-radius:10px;background:transparent;color:inherit;padding:8px 13px;cursor:pointer;min-height:38px;font-weight:800;font:inherit}.ki-tab[aria-pressed="true"]{background:#12335d;color:#fff;border-color:#12335d}',
      '.ki-foot{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;color:var(--muted,#64748b);font-size:12px}.ki-stock-card{min-width:0}.ki-stock-card .table th{white-space:nowrap}.ki-stock-card .table td{vertical-align:middle}.ki-stock-card tbody tr[hidden]{display:none!important}.ki-stock-card .ki-product{font-weight:800}.ki-stock-card .ki-sku{display:block;direction:ltr;text-align:right;font-size:11px;color:var(--muted,#64748b)}.ki-stock-card .ki-empty{padding:24px 12px;text-align:center;color:var(--muted,#64748b)}',
      '#unit128Panel{border-radius:18px}#unit128Panel .unit128-kpi{min-width:0}#unit128Panel .unit128-tools{align-items:center}#unit128Panel .unit128-code{user-select:all}#unit128Panel button{min-height:38px}#unit128Panel .table-wrap{overflow-x:auto}',
      '@media(max-width:800px){#kunInvExperience{padding:13px;margin:12px 0}.ki-controls{grid-template-columns:1fr}.ki-head{display:grid}.ki-actions{width:100%}.ki-actions .btn{flex:1 1 135px}.ki-tabs{flex-wrap:nowrap;overflow-x:auto;padding-bottom:4px}.ki-tabs .ki-tab{white-space:nowrap;flex:none}.ki-stock-card .table{min-width:660px}#unit128Panel .unit128-head{align-items:stretch}#unit128Panel .unit128-head>.btn{flex:1 1 150px}#unit128Panel .unit128-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}',
      '@media(prefers-reduced-motion:no-preference){.ki-tab,.ki-actions .btn{transition:background .15s,border-color .15s}}'
    ].join('');
    document.head.appendChild(el);
  }
  function sourceProducts(){
    try{return typeof state!=='undefined'&&Array.isArray(state.products)?state.products:[];}catch{return [];}
  }
  function getTable(){
    return [...root.querySelectorAll('.grid.split .table-wrap table')].find(t=>{
      const h=[...t.querySelectorAll('thead th')].map(x=>x.textContent.trim());
      return h.length===5&&h.includes('المنتج')&&h.includes('حد التنبيه')&&h.includes('الحالة');
    })||null;
  }
  function makeRowData(table){
    const products=sourceProducts(),trs=[...table.querySelectorAll('tbody tr')];
    return trs.map((tr,i)=>{
      const p=products[i]||null;
      const cells=[...tr.cells];
      const name=p?.name||cells[0]?.textContent?.trim()||'';
      const stock=p?num(p.stock):num(cells[1]?.textContent?.replace(/[^0-9.-]/g,''));
      const threshold=p?num(p.lowStockThreshold??p.low_stock_threshold??5):num(cells[2]?.textContent?.replace(/[^0-9.-]/g,''));
      const cost=p?num(p.cost):0;
      const term=[name,p?.sku,p?.barcode,p?.category,p?.product_tracking_code].filter(Boolean).join(' ').toLocaleLowerCase('ar-EG');
      if(p&&cells[0]&&!tr.querySelector('.ki-sku')){
        const small=document.createElement('small');small.className='ki-sku';small.textContent=p.sku||p.barcode||'';
        if(small.textContent)cells[0].appendChild(small);
        cells[0].classList.add('ki-product');
      }
      if(p?.id&&cells.length===5){
        const action=document.createElement('td'),button=document.createElement('button');
        button.type='button';button.className='btn soft';button.textContent='تفاصيل';button.setAttribute('aria-label','فتح تفاصيل '+name);
        button.addEventListener('click',()=>{if(typeof openProduct==='function')openProduct(p.id);else document.querySelector('.nav button[data-view="products"]')?.click();});
        action.appendChild(button);tr.appendChild(action);
      }
      return {tr,name,stock,threshold,value:stock*cost,term,index:i};
    });
  }
  function csv(rows){
    const safe=v=>{
      let s=String(v??'');
      if(/^[\s]*[=+@-]/.test(s))s="'"+s;
      return '"'+s.replace(/"/g,'""')+'"';
    };
    const text=[['المنتج','المتاح','حد التنبيه','حالة المخزون'],...rows.map(x=>[x.name,x.stock,x.threshold,x.stock<=0?'نفد':x.stock<=x.threshold?'منخفض':'جيد'])].map(row=>row.map(safe).join(',' )).join('\r\n');
    const blob=new Blob(['\uFEFF',text],{type:'text/csv;charset=utf-8;'});
    const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='kun-inventory-visible.csv';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function enhance(){
    if(!isInventory()||document.getElementById('kunInvExperience'))return;
    const table=getTable();if(!table)return;
    style();
    const data=makeRowData(table),tbody=table.tBodies[0],host=table.closest('.card');
    if(!tbody||!host)return;
    host.classList.add('ki-stock-card');
    const headRow=table.querySelector('thead tr');
    if(data.some(x=>x.tr.cells.length===6)&&headRow?.cells.length===5){const th=document.createElement('th');th.textContent='إجراء';headRow.appendChild(th);}
    const panel=document.createElement('section');panel.id='kunInvExperience';panel.setAttribute('aria-label','أدوات إدارة وعرض المخزون');
    panel.innerHTML='<div class="ki-head"><div><h2 class="ki-heading">مركز إدارة المخزون</h2><div class="ki-help">ابحث وصفِّ المنتجات، وانتقل مباشرة لتسوية المخزون أو تتبع القطع والجرد.</div></div><div class="ki-actions"><button type="button" class="btn soft" data-ki-action="adjust">+ تسوية مخزون</button><button type="button" class="btn soft" data-ki-action="units">الباركود والقطع</button><button type="button" class="btn soft" data-ki-action="operations">الجرد والتجهيز</button><button type="button" class="btn soft" data-ki-action="export">تصدير المعروض CSV</button></div></div><div class="ki-controls"><label class="ki-search"><span class="sr-only">بحث بالمخزون</span><input id="kiSearch" class="input" type="search" autocomplete="off" placeholder="بحث بالمنتج، SKU، الباركود أو التصنيف" aria-label="بحث في المخزون"></label><label><span class="sr-only">ترتيب المخزون</span><select id="kiSort" class="select" aria-label="ترتيب المخزون"><option value="original">الترتيب الأصلي</option><option value="name">اسم المنتج (أ–ي)</option><option value="stockAsc">الأقل كمية أولًا</option><option value="stockDesc">الأعلى كمية أولًا</option><option value="valueDesc">الأعلى قيمة أولًا</option></select></label></div><div class="ki-tabs" role="group" aria-label="فلترة حالة المخزون"><button class="ki-tab" type="button" data-ki-filter="all" aria-pressed="true">الكل</button><button class="ki-tab" type="button" data-ki-filter="healthy" aria-pressed="false">متوفر</button><button class="ki-tab" type="button" data-ki-filter="low" aria-pressed="false">مخزون منخفض</button><button class="ki-tab" type="button" data-ki-filter="out" aria-pressed="false">نفد</button></div><div class="ki-foot"><span id="kiCount" role="status" aria-live="polite"></span><span>الأرقام مأخوذة من أرصدة المنتجات الحالية؛ تتبع كل قطعة موجود بالأسفل.</span></div>';
    const split=host.closest('.grid.split');root.insertBefore(panel,split||host);
    const empty=document.createElement('div');empty.className='ki-empty';empty.hidden=true;empty.textContent='لا توجد منتجات مطابقة. جرّب تغيير البحث أو الفلاتر.';host.appendChild(empty);
    let filter='all',visible=data;
    function apply(){
      const term=panel.querySelector('#kiSearch').value.trim().toLocaleLowerCase('ar-EG');
      const sort=panel.querySelector('#kiSort').value;
      visible=data.filter(x=>(!term||x.term.includes(term))&&(filter==='all'||(filter==='out'?x.stock<=0:filter==='low'?x.stock>0&&x.stock<=x.threshold:x.stock>x.threshold)));
      const sorted=[...data].sort((a,b)=>{
        if(sort==='name')return a.name.localeCompare(b.name,'ar');
        if(sort==='stockAsc')return a.stock-b.stock;
        if(sort==='stockDesc')return b.stock-a.stock;
        if(sort==='valueDesc')return b.value-a.value;
        return a.index-b.index;
      });
      for(const x of sorted)tbody.appendChild(x.tr);
      const shown=new Set(visible);
      for(const x of data)x.tr.hidden=!shown.has(x);
      empty.hidden=visible.length!==0;
      panel.querySelector('#kiCount').textContent='عرض '+fmt(visible.length)+' من '+fmt(data.length)+' منتج';
    }
    panel.querySelector('#kiSearch').addEventListener('input',apply);
    panel.querySelector('#kiSort').addEventListener('change',apply);
    panel.querySelectorAll('[data-ki-filter]').forEach(button=>button.addEventListener('click',()=>{
      filter=button.dataset.kiFilter;
      panel.querySelectorAll('[data-ki-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
      apply();
    }));
    panel.querySelectorAll('[data-ki-action]').forEach(button=>button.addEventListener('click',()=>{
      const action=button.dataset.kiAction;
      if(action==='export')return csv(visible);
      if(action==='adjust'){const b=document.getElementById('stockAdjust');if(b)b.click();else tell('إجراء تسوية المخزون غير متاح حاليًا');return;}
      const target=action==='units'?document.getElementById('unit128Panel'):document.querySelector('[data-warehouse-ops]');
      if(!target){tell('أدوات تتبع القطع قيد التحميل؛ حاول مرة أخرى بعد ظهورها.');return;}
      if(action==='operations')target.click();else target.scrollIntoView({behavior:'smooth',block:'start'});
    }));
    apply();
  }
  const observer=new MutationObserver(()=>enhance());
  observer.observe(root,{childList:true,subtree:false});
  document.addEventListener('click',e=>{if(e.target.closest?.('.nav button[data-view="inventory"]'))setTimeout(enhance,0);},true);
  enhance();
  window.KunInventoryUXV129={version:'129.0',enhance};
})();