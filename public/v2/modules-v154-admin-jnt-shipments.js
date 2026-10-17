/* Kun Online — platform admin-only J&T shipment report, separate from operational orders. */
(()=>{
  'use strict';
  if(window.KunAdminJntShipmentsV154)return;
  const VIEW='admin-jnt-shipments',PATH='/api/admin/jnt-shipments';
  const S={me:null,data:null,offset:0,limit:100,filters:{q:'',status:'',sender:'',from:'',to:''},loading:false};
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=v=>new Intl.NumberFormat('ar-EG',{maximumFractionDigits:2}).format(Number(v)||0);
  const LABELS={created:'تم إنشاء البوليصة',picked_up:'استلمتها J&T',in_transit:'جاري التوصيل',delivered:'تم التسليم',returned:'مرتجع',cancelled:'ملغي',unknown:'غير محدد'};
  const FIELD_ALIASES={
    awb:['Waybill','Waybill No.','Waybill Number','Billcode','Bill Code','AWB','رقم البوليصة','رقم الشحنة','رقم بوليصة الشحن'],
    status:['Waybill status','Waybill Status','Status','Shipment Status','حالة البوليصة','حالة الشحنة','الحالة'],
    orderRef:['Client Order No.','Client Order Number','Order No.','Order No','Customer Order No.','رقم الطلب','كود الطلب'],
    sender:['Sender name','Sender Name','Shipper Name','اسم المرسل','المرسل','اسم الراسل'],
    account:['Customer Code','Customer code','Account Code','Sender Code','رقم حساب العميل','رقم الحساب'],
    shipmentDate:['Shipment Date','Shipping Date','Pickup Date','Create Time','Created Time','Order Date','Date','تاريخ الشحن','تاريخ إنشاء الشحنة'],
    lastEventAt:['Sign Time','Returning parcel sign-in time','Delivery Time','Updated At','آخر تحديث','تاريخ التسليم'],
    receiverProvince:['Receiver Province','Receiver province','Receiving province','Destination Province','محافظة المستلم'],
    codAmount:['COD amount','COD Amount','COD','COD Value','Amount to collect','مبلغ التحصيل','قيمة التحصيل'],
    collectedAmount:['Actually Collected Amount','Collected Amount','Remitted COD','Settled Amount','المبلغ المحصل فعليًا','مبلغ التحصيل الفعلي'],
    shippingFee:['Reference delivery fees','Reference Delivery Fees','Shipping Fee','Delivery Fee','تكلفة الشحن'],
    returnReason:['Abnormal parcel description','Abnormal Parcel Description','Return Reason','سبب المرتجع']
  };
  const norm=v=>String(v??'').toLowerCase().replace(/[\s._()/-]+/g,'').trim();
  const val=(obj,field)=>obj?.[field]??'';
  const $=(q,parent=document)=>parent.querySelector(q);
  const root=()=>$('#root');
  const isActive=()=>Boolean($('.nav button.active[data-view="'+VIEW+'"]'));
  async function api(url,opts={}){
    const response=await fetch(url,{credentials:'include',...opts,headers:{...(opts.body?{'Content-Type':'application/json'}:{}),...(opts.headers||{})}});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(payload.error||'تعذر الاتصال بخدمة التقارير: HTTP '+response.status);
    return payload;
  }
  function style(){
    if($('#jnt154Style'))return;
    const el=document.createElement('style');el.id='jnt154Style';
    el.textContent='.jnt154{display:grid;gap:14px;direction:rtl}.jnt154-head{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px}.jnt154-note{padding:12px;border:1px solid #dfcf9d;border-radius:12px;background:#fff8e6;color:#7d5b12;font-size:12px;line-height:1.9}.jnt154-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px}.jnt154-kpi{border:1px solid var(--line,#eee);border-radius:12px;padding:12px;background:var(--card,#fff)}.jnt154-kpi small{display:block;color:var(--muted,#64748b);font-size:11px}.jnt154-kpi strong{display:block;font-size:19px;margin-top:5px}.jnt154-tools{display:flex;flex-wrap:wrap;align-items:end;gap:8px}.jnt154-tools label{display:grid;gap:4px;font-size:11px;flex:1;min-width:145px}.jnt154-tools .input,.jnt154-tools .select{max-width:100%;width:100%;height:40px}.jnt154-table-wrap{overflow:auto;border:1px solid var(--line,#eee);border-radius:12px;background:var(--card,#fff)}.jnt154-table{min-width:1120px;width:100%;border-collapse:collapse}.jnt154-table td,.jnt154-table th{text-align:right;padding:9px 11px;border-bottom:1px solid var(--line,#eee);font-size:12px;white-space:nowrap}.jnt154-table th{background:var(--bg,#f9fafb);color:var(--muted,#667);font-size:11px}.jnt154-state{font-size:10px;padding:5px 9px;border-radius:18px;background:#eff3f8;display:inline-block}.jnt154-foot{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap}.jnt154-import{padding:15px;border:1px solid var(--line,#e5e7eb);border-radius:12px;background:var(--card,#fff)}.jnt154-import summary{font-weight:800;cursor:pointer}.jnt154-progress{color:var(--muted,#64748b);font-size:12px}.jnt154-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.jnt154-empty{padding:28px;text-align:center}@media(max-width:900px){.jnt154-grid{grid-template-columns:repeat(3,1fr)}}@media(max-width:550px){.jnt154-grid{grid-template-columns:repeat(2,1fr)}}';
    document.head.appendChild(el);
  }
  function qs(offset=S.offset,limit=S.limit){
    const q=new URLSearchParams({offset:String(offset),limit:String(limit)});
    for(const [key,value] of Object.entries(S.filters))if(value)q.set(key,value);
    return PATH+'?'+q.toString();
  }
  function summaryHtml(d){
    const x=d?.summary||{};
    const items=[['إجمالي الشحنات',x.total],['إنشاء البوليصة',x.created],['استلمتها J&T',x.pickedUp],['جاري التوصيل',x.transit],['تم التسليم',x.delivered],['مرتجع',x.returned],['مطلوب تحصيله COD',fmt(x.codExpected)+' ج.م'],['تحصيل مثبت بكشف J&T',fmt(x.codReportedCollected)+' ج.م'],['مصاريف الشحن',fmt(x.shippingFees)+' ج.م'],['مرتبطة بكن أونلاين',x.linkedToKun]];
    return '<div class="jnt154-grid">'+items.map(([label,value])=>'<div class="jnt154-kpi"><small>'+esc(label)+'</small><strong>'+esc(value??0)+'</strong></div>').join('')+'</div>';
  }
  function render(){
    if(!isActive()||!root())return;
    style();
    const d=S.data||{items:[],summary:{},total:0,senders:[]};
    const options=['<option value="">كل الحالات</option>',...Object.entries(LABELS).map(([key,name])=>'<option value="'+key+'" '+(S.filters.status===key?'selected':'')+'>'+name+'</option>')].join('');
    const senders=['<option value="">كل المرسلين</option>',...(d.senders||[]).map(x=>'<option value="'+esc(x.sender)+'" '+(S.filters.sender===x.sender?'selected':'')+'>'+esc(x.sender)+' ('+esc(x.count)+')</option>')].join('');
    const rows=(d.items||[]).map(r=>'<tr><td><b dir="ltr">'+esc(r.awb)+'</b></td><td>'+esc(r.shipmentDate||'غير موجود')+'</td><td><span class="jnt154-state">'+esc(LABELS[r.status]||LABELS.unknown)+'</span><small style="display:block">'+esc(r.rawStatus||'')+'</small></td><td>'+esc(r.sender||'—')+'</td><td>'+esc(r.orderRef||'—')+'</td><td>'+esc(r.receiverProvince||'—')+'</td><td>'+esc(r.codAmount==null?'—':fmt(r.codAmount))+'</td><td>'+esc(r.collectedAmount==null?'غير متاح':fmt(r.collectedAmount))+'</td><td>'+esc(r.shippingFee==null?'—':fmt(r.shippingFee))+'</td><td>'+esc(r.linkedToKun?'نعم':'شحنة خارجية')+'</td><td>'+esc(r.returnReason||'—')+'</td></tr>').join('');
    root().innerHTML='<section class="jnt154" id="jnt154Root"><div class="jnt154-head"><div><div class="title">شحنات J&T — الإدارة فقط</div><div class="sub">جميع البوالص المستوردة من كشوف شركة J&T، مستقلة عن أوردرات المتاجر</div></div><div class="jnt154-actions"><button class="btn soft" id="jnt154Refresh">تحديث</button><button class="btn primary" id="jnt154Export">تصدير كل النتائج CSV / Excel</button></div></div><div class="jnt154-note">'+esc(d.completenessNotice||'عرض كشوف J&T المستوردة؛ لا توجد مزامنة لجميع بوالص الحساب حتى الآن.')+' التصدير لا يعتبر المبالغ المحصلة نقدًا إلا إذا ظهرت في عمود تحصيل فعلي موثق.</div>'+summaryHtml(d)+'<div class="card"><div class="jnt154-tools"><label>رقم البوليصة أو الأوردر<input class="input" id="jnt154Q" value="'+esc(S.filters.q)+'" placeholder="ابحث برقم البوليصة"></label><label>الحالة<select class="select" id="jnt154Status">'+options+'</select></label><label>المرسل<select class="select" id="jnt154Sender">'+senders+'</select></label><label>من تاريخ<input class="input" type="date" id="jnt154From" value="'+esc(S.filters.from)+'"></label><label>إلى تاريخ<input class="input" type="date" id="jnt154To" value="'+esc(S.filters.to)+'"></label><button class="btn primary" id="jnt154Apply">تطبيق</button><button class="btn soft" id="jnt154Reset">مسح الفلاتر</button></div></div><div class="jnt154-table-wrap"><table class="jnt154-table"><thead><tr><th>رقم البوليصة</th><th>تاريخ الشحن</th><th>الحالة</th><th>المرسل</th><th>طلب العميل</th><th>المحافظة</th><th>COD مطلوب</th><th>COD محصل</th><th>رسوم الشحن</th><th>داخل كن أونلاين</th><th>سبب المرتجع</th></tr></thead><tbody>'+(rows||'<tr><td class="jnt154-empty" colspan="11">لا توجد شحنات مستوردة تطابق الفلاتر.</td></tr>')+'</tbody></table></div><div class="jnt154-foot"><span>عرض '+esc(S.offset+1)+' — '+esc(Math.min(S.offset+S.limit,Number(d.total||0)))+' من '+esc(d.total)+'</span><div class="jnt154-actions"><button class="btn soft" id="jnt154Prev" '+(S.offset===0?'disabled':'')+'>السابق</button><button class="btn soft" id="jnt154Next" '+(S.offset+S.limit>=d.total?'disabled':'')+'>التالي</button></div></div><details class="jnt154-import"><summary>استيراد كشف كامل من J&T (CSV / XLSX) — بدون تغيير الأوردرات</summary><p class="meta">يدعم Waybill وWaybill status وSender name وCOD amount وReference delivery fees، وكذلك الأعمدة العربية. الاستيراد يحدث التقرير فقط ولا يعدّل حالة أي أوردر.</p><div class="jnt154-actions"><input type="file" class="input" id="jnt154File" accept=".csv,.xlsx,.xls,.txt"><button class="btn primary" id="jnt154Import">استيراد التقرير</button><span class="jnt154-progress" id="jnt154Progress"></span></div></details></section>';
    $('#jnt154Refresh').onclick=()=>load();
    $('#jnt154Apply').onclick=()=>{for(const [key,id] of [['q','Q'],['status','Status'],['sender','Sender'],['from','From'],['to','To']])S.filters[key]=$('#jnt154'+id).value.trim();S.offset=0;load();};
    $('#jnt154Reset').onclick=()=>{S.filters={q:'',status:'',sender:'',from:'',to:''};S.offset=0;load();};
    $('#jnt154Prev').onclick=()=>{S.offset=Math.max(0,S.offset-S.limit);load();};
    $('#jnt154Next').onclick=()=>{S.offset+=S.limit;load();};
    $('#jnt154Export').onclick=exportCsv;
    $('#jnt154Import').onclick=importFile;
  }
  async function load(){
    if(S.loading)return;S.loading=true;
    try{S.data=await api(qs());render();}catch(e){if(isActive()&&root())root().innerHTML='<div class="card"><h2>تعذر تحميل شحنات J&T</h2><p>'+esc(e.message)+'</p><button class="btn" onclick="window.KunAdminJntShipmentsV154.refresh()">إعادة المحاولة</button></div>';}
    finally{S.loading=false;}
  }
  function open(){
    if(S.me?.role!=='admin')return;
    document.querySelectorAll('.nav button[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===VIEW));
    if(root())root().innerHTML='<div class="card">جارٍ قراءة كشوف J&T...</div>';
    S.offset=0;load();
  }
  const csvValue=v=>{
    let str=String(v??'');
    // Prevent spreadsheet formula injection in downloaded carrier data.
    if(/^[\s]*[=+\-@\t\r]/.test(str))str="'"+str;
    return '"'+str.replace(/"/g,'""')+'"';
  };
  async function exportCsv(){
    const el=$('#jnt154Export');if(el)el.disabled=true;
    try{
      const header=['Waybill','Account','Shipment Date','Status','Carrier Status','Sender','Client Order No.','Province','COD Amount','Collected Amount','Shipping Fee','Kun Linked','Return Reason'];
      const records=[header],step=300;
      for(let offset=0;;offset+=step){
        const data=await api(qs(offset,step));
        for(const r of data.items||[])records.push([r.awb,r.account,r.shipmentDate,r.status,r.rawStatus,r.sender,r.orderRef,r.receiverProvince,r.codAmount,r.collectedAmount,r.shippingFee,r.linkedToKun?'Yes':'No',r.returnReason]);
        if(el)el.textContent='تصدير '+fmt(Math.min(offset+step,data.total))+' من '+fmt(data.total);
        if(offset+step>=data.total||!(data.items||[]).length)break;
      }
      const blob=new Blob(['\ufeff'+records.map(row=>row.map(csvValue).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});
      const link=document.createElement('a'),url=URL.createObjectURL(blob);link.href=url;link.download='JNT-Shipments-'+new Date().toISOString().slice(0,10)+'.csv';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
    }catch(e){window.showToast?.(e.message);}finally{if(el){el.disabled=false;el.textContent='تصدير كل النتائج CSV / Excel';}}
  }
  function mapRow(row,mapping,file){
    const v=key=>{const h=mapping[key];return h?row[h]:'';};
    const date=input=>{
      if(typeof input==='number'&&input>20000&&input<80000)return new Date((input-25569)*86400000).toISOString().slice(0,10);
      const s=String(input??'').trim();
      if(/^\d{4}-\d{2}-\d{2}/.test(s))return s.slice(0,10);
      if(/^\d{1,2}\/\d{1,2}\/\d{4}/.test(s)){const [day,mon,year]=s.split('/');return year+'-'+mon.padStart(2,'0')+'-'+day.padStart(2,'0');}
      return '';
    };
    return {awb:v('awb'),rawStatus:v('status'),orderRef:v('orderRef'),sender:v('sender'),account:v('account'),shipmentDate:date(v('shipmentDate')),lastEventAt:String(v('lastEventAt')||''),receiverProvince:v('receiverProvince'),codAmount:v('codAmount'),collectedAmount:v('collectedAmount'),shippingFee:v('shippingFee'),returnReason:v('returnReason'),sourceFile:file};
  }
  async function importFile(){
    const el=$('#jnt154File'),file=el?.files?.[0],progress=$('#jnt154Progress'),btn=$('#jnt154Import');
    if(!file)return window.showToast?.('اختر كشف J&T أولًا');
    if(file.size>20000000)return window.showToast?.('الملف كبير جدًا، قسمه إلى كشوف أصغر من 20MB');
    if(!/\.(xlsx|xls|csv|txt)$/i.test(file.name))return window.showToast?.('صيغة الملف غير مدعومة');
    btn.disabled=true;
    try{
      const parser=window.KunShippingSheetV59?.parseFile;
      if(typeof parser!=='function')throw new Error('قارئ كشوف Excel غير جاهز في السيستم');
      progress.textContent='جارٍ قراءة كشف J&T...';
      const matrix=await parser(file);
      if(!Array.isArray(matrix)||matrix.length<2)throw new Error('الملف لا يحتوي على بيانات');
      const headers=(matrix[0]||[]).map(String);
      const map={};
      for(const [field,aliases] of Object.entries(FIELD_ALIASES)){
        const ix=headers.findIndex(h=>aliases.some(alias=>norm(h)===norm(alias)));
        if(ix>=0)map[field]=headers[ix];
      }
      if(!map.awb||!map.status)throw new Error('لازم يحتوي الكشف على عمودي Waybill وWaybill status');
      const rows=matrix.slice(1).map(cells=>Object.fromEntries(headers.map((h,i)=>[h,cells?.[i]??'']))).map(row=>mapRow(row,map,file.name)).filter(row=>String(row.awb||'').trim());
      if(!rows.length)throw new Error('لم يتم العثور على بوالص داخل الشيت');
      if(!confirm('استيراد '+rows.length+' شحنة من كشف J&T؟ سيتم تحديث تقرير الإدارة فقط، بدون تعديل أوردرات كن أونلاين.'))return;
      let done=0,bad=0;
      for(let i=0;i<rows.length;i+=200){
        const batch=await api(PATH,{method:'POST',body:JSON.stringify({rows:rows.slice(i,i+200)})});
        done+=batch.processed;bad+=batch.rejected;
        progress.textContent='تم استيراد '+fmt(done)+' من '+fmt(rows.length)+'؛ صفوف غير صالحة: '+fmt(bad);
      }
      await load();window.showToast?.('تم تحديث تقرير J&T: '+done+' شحنة');
    }catch(e){progress.textContent=e.message;window.showToast?.(e.message);}finally{btn.disabled=false;}
  }
  function start(){
    fetch('/api/me',{credentials:'include'}).then(r=>r.ok?r.json():null).then(me=>{
      if(me?.role!=='admin')return;S.me=me;style();
      const nav=$('.nav');if(!nav)return;
      if(!nav.querySelector('[data-view="'+VIEW+'"]')){
        const button=document.createElement('button');button.type='button';button.dataset.view=VIEW;button.className='nav-subitem';button.textContent='شحنات J&T';
        const anchor=nav.querySelector('[data-view="subscriptions"]')||nav.querySelector('[data-view="admin-clients"]');
        if(anchor)anchor.after(button);else nav.appendChild(button);
        button.addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation();open();},true);
      }
      const original=window.setView;
      if(typeof original==='function'){
        window.setView=function(v){if(v===VIEW)return open();return original.apply(this,arguments);};
      }
      window.KunSidebarGroupsV90?.sync?.();
      if(window.location.hash==='#'+VIEW)open();
    }).catch(()=>{});
  }
  window.KunAdminJntShipmentsV154={refresh:load,open};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
