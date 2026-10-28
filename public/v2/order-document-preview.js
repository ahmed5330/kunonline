/* Read-only customer document. No carrier calls, invoice posting or browser storage. */
(function(){
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const sizes={A4:'A4',A5:'A5',receipt:'80mm auto'};
  function documentHtml(order,size='A4',layout='standard',options={}){
    if(!Object.hasOwn(sizes,size))throw new Error('مقاس غير متاح');
    if(!['standard','compact'].includes(layout))throw new Error('تصميم غير متاح');
    const address=[order.province||order.gov,order.city,order.area,order.street||order.address].filter(Boolean).join(' — ');
    const amount=order.total!==null&&order.total!==undefined&&order.total!==''&&Number.isFinite(Number(order.total))
      ?new Intl.NumberFormat('ar-EG',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(order.total))+' ج.م':'غير متاح';
    const brand=options.brand||{},templates=window.KunDocumentSettings?.templates||[],template=templates.find(t=>t.id===options.template)||{id:'classic',color:'#0f766e',decoration:'line'};
    const accent=template.color,brandColor=/^#[0-9a-f]{6}$/i.test(brand.color||'')?brand.color:accent;
    const logo=typeof brand.logo==='string'&&brand.logo.length<=180000&&/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(brand.logo)?brand.logo:'';
    const html=`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>بيان طلب ${esc(order.ref||order.id)}</title><style>
      @page{size:${sizes[size]};margin:${size==='receipt'?'4mm':'12mm'}}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#172b3a;background:white;margin:0;padding:12px;font-size:${layout==='compact'?'12':'15'}px;line-height:1.7;overflow-wrap:anywhere}main{max-width:${size==='receipt'?'72mm':size==='A5'?'124mm':'186mm'};margin:auto}h1{font-size:1.5em;margin:0}header{border-bottom:2px solid #0f766e;padding-bottom:12px}dl{display:grid;grid-template-columns:auto 1fr;gap:5px 12px}dt{font-weight:bold}dd{margin:0;white-space:pre-wrap}table{width:100%;border-collapse:collapse;margin-top:16px}th,td{border:1px solid #cbd5e1;padding:8px;text-align:right;white-space:pre-wrap}footer{margin-top:18px;border-top:1px solid #cbd5e1;padding-top:8px;font-size:.85em}tr{break-inside:avoid}@media print{body{padding:0}}
      </style></head><body><main><header><h1>بيان طلب العميل</h1><div>${esc(order.storeName||'')}</div><b>رقم الطلب: ${esc(order.ref||order.id)}</b></header><dl><dt>العميل</dt><dd>${esc(order.name||'—')}</dd><dt>الهاتف</dt><dd dir="ltr">${esc(order.phone||'—')}</dd><dt>العنوان</dt><dd>${esc(address||'—')}</dd><dt>تاريخ الطلب</dt><dd>${esc(order.date||order.createdAt||'—')}</dd></dl><table><thead><tr><th>وصف الطلب المسجل</th><th>الكمية المسجلة</th></tr></thead><tbody><tr><td>${esc(order.product||'غير متاح')}</td><td>${esc(order.qty??'غير متاح')}</td></tr></tbody></table><p><strong>المبلغ المسجل للطلب: ${amount}</strong></p><footer>بيان بيانات الطلب؛ لا يثبت السداد أو التسليم ولا يُعد فاتورة ضريبية. المبلغ كما هو مسجل، دون احتساب ضرائب أو مبالغ إضافية.</footer></main></body></html>`;
    const decoration={none:'header{border:0}',double:'header{border-bottom:5px double '+accent+'}',box:'main{border:2px solid '+accent+';padding:12px}',band:'header{background:'+accent+';color:white;padding:12px}',dashed:'header{border-bottom:2px dashed '+accent+'}'}[template.decoration]||'';
    const extra='header{border-color:'+accent+'}th{background:'+accent+';color:white}.document-brand{font-size:1.15em;font-weight:bold;color:'+brandColor+';background:white;padding:4px}.document-logo{max-width:130px;max-height:70px;object-fit:contain}'+decoration+(template.id==='compact'?'body{font-size:12px}td,th{padding:4px}':template.id==='spacious'?'dl{gap:14px}td,th{padding:14px}':'');
    return html.replace('<main>','<main data-template="'+esc(template.id)+'">').replace('</style>',extra+'</style>').replace('<h1>بيان طلب العميل</h1>',(logo?'<img class="document-logo" alt="شعار النشاط" src="'+logo+'">':'')+'<h1>بيان طلب العميل</h1><div class="document-brand">'+esc(brand.name||'')+'</div><div>'+esc(brand.address||'')+'</div><div dir="ltr">'+esc(brand.phone||'')+'</div>').replace('</footer>',(brand.footer?'<p>'+esc(brand.footer)+'</p>':'')+'</footer>');
  }
  let closeActive=null;
  function open(order,options={}){
    closeActive?.();
    const previous=document.activeElement,cover=document.createElement('div');
    cover.style.cssText='position:fixed;inset:0;z-index:10000;background:#0008;display:flex;align-items:center;justify-content:center;padding:12px';
    cover.style.zIndex=String(10000+document.querySelectorAll('[role=dialog]').length*10);
    cover.innerHTML='<section role="dialog" aria-modal="true" aria-labelledby="orderPreviewTitle" style="background:white;color:#172b3a;padding:16px;border-radius:12px;width:900px;max-width:100%;max-height:95vh;overflow:auto"><h2 id="orderPreviewTitle">معاينة بيان طلب العميل</h2><div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px"><label>المقاس <select data-document-size><option>A4</option><option>A5</option><option value="receipt">80 مم</option></select></label><label>التصميم <select data-document-layout><option value="standard">عادي</option><option value="compact">مختصر</option></select></label><button type="button" data-document-print>طباعة البيان</button><button type="button" data-document-close>إغلاق</button></div><p>هذه المعاينة لا ترسل شحنة ولا تسجّل فاتورة أو دفعة. اختر المقاس نفسه في إعدادات الطابعة.</p><iframe title="معاينة بيان الطلب" sandbox="allow-same-origin allow-modals" style="width:100%;height:60vh;border:1px solid #cbd5e1;background:white"></iframe><div role="status" aria-live="polite" data-document-status></div></section>';
    const frame=cover.querySelector('iframe'),size=cover.querySelector('[data-document-size]'),layout=cover.querySelector('[data-document-layout]'),print=cover.querySelector('[data-document-print]');
    print.textContent='طباعة / حفظ PDF';
    const templateControl=document.createElement('label');templateControl.innerHTML='القالب <select data-document-template>'+ (window.KunDocumentSettings?.templates||[{id:'classic',name:'كلاسيكي'}]).map(t=>'<option value="'+esc(t.id)+'">'+esc(t.name)+'</option>').join('')+'</select>';print.before(templateControl);
    const template=templateControl.querySelector('select');
    if(options.profile){size.value=options.profile.size;template.value=options.profile.template;}
    if(options.onHistory){const b=document.createElement('button');b.type='button';b.textContent='سجل طلبات الطباعة';b.onclick=options.onHistory;print.before(b);}
    function refresh(){print.disabled=true;frame.srcdoc=documentHtml(order,size.value,layout.value,{brand:options.settings?.brand,template:template.value});}
    frame.onload=()=>{print.disabled=false;};
    function close(){document.removeEventListener('keydown',keyboard);cover.remove();closeActive=null;if(previous?.isConnected)previous.focus();}
    function keyboard(event){
      if([...document.querySelectorAll('[role=dialog]')].at(-1)!==cover.querySelector('section'))return;
      if(event.key==='Escape'){event.preventDefault();close();}
      if(event.key==='Tab'){
        const controls=[...cover.querySelectorAll('select,button,iframe')].filter(el=>!el.disabled),first=controls[0],last=controls.at(-1);
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
      }
    }
    cover.querySelector('[data-document-close]').onclick=close;
    cover.onclick=e=>{if(e.target===cover)close();};
    size.onchange=layout.onchange=template.onchange=refresh;
    print.onclick=()=>{try{frame.contentWindow.focus();frame.contentWindow.print();if(options.onPrintRequested)Promise.resolve(options.onPrintRequested(template.value,size.value)).catch(()=>{cover.querySelector('[data-document-status]').textContent='تم طلب فتح الطباعة، لكن تعذر حفظ ذلك في السجل.';});}catch{cover.querySelector('[data-document-status]').textContent='تعذر فتح الطباعة. استخدم متصفحًا يدعم طباعة المعاينة.';}};
    closeActive=close;document.body.appendChild(cover);document.addEventListener('keydown',keyboard);refresh();size.focus();
  }
  // Event delegation keeps this independent of the shipping/send handlers.
  document.addEventListener('click',event=>{
    const button=event.target.closest?.('[data-print79-document]');if(!button)return;
    const id=button.closest('[data-print79-order]')?.dataset.print79Order;
    const order=window.KunPrintingV79?.documentOrder?.(id);if(order){if(window.KunDocumentSettings)window.KunDocumentSettings.openOrder(order);else open(order);}
  });
  window.KunOrderDocumentPreview={open,documentHtml};
})();
