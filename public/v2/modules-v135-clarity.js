/* Kun Online v135 — Microsoft Clarity setup + aggregate behavior insights.
 * Reads only tenant-scoped APIs. Never puts the Clarity export token into HTML.
 */
(function(){
  'use strict';
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]));
  const txt=v=>String(v??'').trim();
  const number=v=>Number(v||0).toLocaleString('ar-EG',{maximumFractionDigits:2});
  const money=v=>Number(v||0).toLocaleString('ar-EG',{maximumFractionDigits:2});
  const root=()=>document.getElementById('root');
  const toast=s=>window.showToast?window.showToast(s):alert(s);
  const ID='kun-clarity-135';
  let screen='integrations';
  async function scope(){
    const clientId=txt(await (window.kunClientId?.()||Promise.resolve('')));
    const storeId=txt(await (window.kunStoreId?.()||Promise.resolve('')));
    return {clientId,storeId};
  }
  async function api(route,options={}){
    const s=await scope();
    if(!s.clientId)throw new Error('حدّد حساب العميل أولًا');
    if(!s.storeId)throw new Error('اختار المتجر المطلوب من أعلى الشاشة، لا يمكن ربط Clarity بكل المتاجر دفعة واحدة');
    const u=new URL(route,location.origin);
    u.searchParams.set('clientId',s.clientId);
    u.searchParams.set('storeId',s.storeId);
    const response=await fetch(u.pathname+u.search,{credentials:'include',headers:{'Content-Type':'application/json'},...options});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||'HTTP '+response.status);
    return data;
  }
  function styling(){
    if(document.getElementById('cl135-style'))return;
    const style=document.createElement('style');style.id='cl135-style';
    style.textContent='.cl135{border:1px solid #dad7ed;border-radius:18px;background:var(--surface,#fff);padding:22px;margin:18px 0;box-shadow:0 8px 26px rgba(80,55,135,.06)}'+
      '.cl135-header{display:flex;gap:14px;align-items:center;flex-wrap:wrap}.cl135-mark{display:grid;place-items:center;width:52px;height:52px;flex:none;border-radius:15px;color:white;background:linear-gradient(135deg,#5c2fa7,#bd53b7);font-size:27px;font-weight:900}'+
      '.cl135-title{font-size:20px;font-weight:900;color:var(--ink,#111827)}.cl135-sub{font-size:12px;color:var(--ink-2,#6b7280);margin-top:3px;line-height:1.9}.cl135-status{margin-inline-start:auto;background:#f4f0fc;color:#6634a4;border-radius:40px;padding:7px 12px;font-size:12px;font-weight:800}'+
      '.cl135-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-top:16px}.cl135 label{display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:800}.cl135 input,.cl135 textarea{width:100%;border:1px solid #d9d7e3;border-radius:10px;padding:10px;min-height:42px;background:var(--surface,#fff);color:var(--ink,#111)}.cl135 textarea{min-height:75px;resize:vertical;direction:ltr;text-align:left}'+
      '.cl135-actions{display:flex;flex-wrap:wrap;gap:9px;margin-top:16px}.cl135 .cl135-btn{border:1px solid #d4cee7;background:var(--surface,#fff);color:var(--ink,#333);padding:10px 16px;border-radius:10px;font-size:12px;font-weight:900;cursor:pointer}.cl135 .cl135-main{background:#6c3cb4;border-color:#6c3cb4;color:#fff}.cl135 .cl135-warn{border-color:#d39191;color:#ab2020}.cl135-btn:disabled{opacity:.6;cursor:wait}'+
      '.cl135-note{background:rgba(108,60,180,.055);border-radius:12px;padding:12px;font-size:12px;line-height:1.95;margin-top:16px}.cl135-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin:18px 0}.cl135-kpi{padding:18px;border:1px solid var(--line,#dedede);border-radius:13px;background:var(--surface,#fff)}.cl135-kpi strong{display:block;font-size:23px;margin:6px 0}.cl135-kpi span{font-size:12px;color:var(--ink-2,#777)}'+
      '.cl135-table{width:100%;border-collapse:collapse;text-align:right;font-size:12px;min-width:560px}.cl135-table th,.cl135-table td{padding:11px;border-bottom:1px solid var(--line,#eee);vertical-align:top}.cl135-table th{background:rgba(108,60,180,.075)}.cl135-tablewrap{overflow:auto;margin-top:12px}.cl135-section{margin-top:16px}.cl135-section h3{font-size:16px;margin:0 0 12px}.cl135-bar{height:7px;background:#eae5f3;border-radius:10px;overflow:hidden;margin-top:5px}.cl135-bar span{height:100%;background:#8850cc;display:block}.cl135-small{font-size:11px;color:var(--ink-2,#666);line-height:1.8}.cl135-error{color:#af2020;margin-top:12px;font-size:12px}';
    document.head.appendChild(style);
  }
  function statusName(d){
    if(!d?.configured)return 'غير متصل';
    if(d.status==='connected')return 'API متصل';
    if(d.status==='error')return 'التحقق فشل';
    return d.hasApiToken?'معدّ — يحتاج تحقق':'تتبع فقط';
  }
  function cardMarkup(){
    return '<div class="cl135" id="'+ID+'">'+
      '<div class="cl135-header"><div class="cl135-mark" aria-hidden="true">◈</div><div><div class="cl135-title">Microsoft Clarity</div><div class="cl135-sub">سلوك العملاء · التسجيلات والخرائط الحرارية في Clarity · تحليل الحملات داخل كن أونلاين</div></div><span class="cl135-status" id="cl135-status">تحميل...</span></div>'+
      '<div class="cl135-grid"><label>Project ID أو كود التثبيت كاملًا<textarea id="cl135-project" placeholder="Project ID أو الصق كود Clarity كاملًا" aria-label="Clarity Project ID"></textarea></label>'+
      '<label>Data Export API Token (اختياري للتتبع، مطلوب للتحليلات)<input id="cl135-token" type="password" autocomplete="new-password" placeholder="اتركه فارغًا للاحتفاظ بالتوكن المشفر"></label></div>'+
      '<div class="cl135-actions"><button class="cl135-btn cl135-main" id="cl135-save">حفظ وربط</button><button class="cl135-btn" id="cl135-sync">اختبار API ومزامنة</button><button class="cl135-btn" id="cl135-report">عرض تحليلات الإعلانات</button><button class="cl135-btn" id="cl135-copy">نسخ كود التثبيت</button><a class="cl135-btn" href="https://clarity.microsoft.com/" target="_blank" rel="noopener noreferrer" style="text-decoration:none">فتح لوحة Clarity ↗</a><button class="cl135-btn cl135-warn" id="cl135-remove">فصل التكامل</button></div>'+
      '<div class="cl135-note" id="cl135-note">لازم تثبّت كود Clarity داخل المتجر نفسه (مثل Easy Orders) وفق الإمكانيات المتاحة فيه، مش داخل لوحة كن أونلاين. API Token بيتخزن مشفرًا على الخادم ومش بيظهر بعد حفظه. راعي موافقة الزائر وسياسة الخصوصية قبل تشغيل التتبع.</div>'+
      '<div class="cl135-small" id="cl135-info" aria-live="polite" style="margin-top:10px"></div></div>';
  }
  async function loadCard(card){
    try{
      const d=await api('/api/clarity/status');
      if(!card.isConnected)return;
      card.querySelector('#cl135-status').textContent=statusName(d);
      card.querySelector('#cl135-project').value=d.projectId||'';
      card.querySelector('#cl135-info').textContent=(d.lastSyncAt?'آخر مزامنة: '+new Date(d.lastSyncAt).toLocaleString('ar-EG')+' · ':'')+
        (d.hasApiToken?'API Token محفوظ ومشفر. ':'')+'استهلاك API اليوم: '+d.quotaUsedToday+' من '+d.quotaBudget+' طلبات متاحة للنظام.';
      if(d.lastError)card.querySelector('#cl135-info').textContent+=' آخر خطأ: '+d.lastError;
    }catch(e){if(card.isConnected){card.querySelector('#cl135-status').textContent='غير جاهز';card.querySelector('#cl135-info').textContent=e.message;}}
  }
  function sourceSnippet(projectId){
    const id=txt(projectId).match(/^[a-zA-Z0-9_-]{5,40}$/);
    if(!id)throw new Error('احفظ Project ID الصحيح قبل نسخ الكود');
    return '<script type="text/javascript">\n(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y)})(window,document,"clarity","script","'+id[0]+'");\n</script>';
  }
  async function copySnippet(card){
    const d=await api('/api/clarity/status');
    const snippet=sourceSnippet(d.projectId);
    try{await navigator.clipboard.writeText(snippet);toast('تم نسخ كود Clarity. ثبّته في صفحات المتجر الفعلية بعد ضبط موافقة الزائر.');}
    catch{card.querySelector('#cl135-note').textContent=snippet;}
  }
  function setupButtons(card){
    const busy=(button,yes,label)=>{button.disabled=yes;if(label)button.textContent=label;};
    card.querySelector('#cl135-save').onclick=async function(){
      const b=this,original=b.textContent;busy(b,true,'جاري الحفظ...');
      try{
        const raw=card.querySelector('#cl135-project').value;
        const apiToken=card.querySelector('#cl135-token').value;
        await api('/api/clarity/connect',{method:'POST',body:JSON.stringify({projectId:raw,apiToken})});
        card.querySelector('#cl135-token').value='';
        toast('تم حفظ المشروع والتوكن بصورة آمنة. تتبع الزوار يحتاج تثبيت الكود بالمتجر.');
        await loadCard(card);
        if(apiToken){try{await api('/api/clarity/sync',{method:'POST',body:'{}'});toast('تم التحقق من Clarity وسحب أول تحليلات');await loadCard(card);}catch(e){toast('الربط محفوظ، لكن مزامنة API تعذرت: '+e.message);}}
      }catch(e){toast(e.message);}finally{busy(b,false,original);}
    };
    card.querySelector('#cl135-sync').onclick=async function(){
      const b=this,original=b.textContent;busy(b,true,'جاري اختبار API...');
      try{const d=await api('/api/clarity/sync',{method:'POST',body:'{}'});toast(d.skipped?'التحليلات حديثة بالفعل، تم استخدام النسخة المحفوظة':'نجح اختبار API ومزامنة Clarity');await loadCard(card);}
      catch(e){toast(e.message);await loadCard(card);}finally{busy(b,false,original);}
    };
    card.querySelector('#cl135-report').onclick=()=>renderReport();
    card.querySelector('#cl135-copy').onclick=()=>copySnippet(card).catch(e=>toast(e.message));
    card.querySelector('#cl135-remove').onclick=async()=>{
      if(!confirm('فصل Clarity وحذف التحليلات المحفوظة لهذا المتجر فقط؟ كود التتبع المثبت خارجيًا يجب حذفه من المتجر بصورة مستقلة.'))return;
      try{await api('/api/clarity/disconnect',{method:'DELETE'});toast('تم فصل Clarity من كن أونلاين. احذف كود التتبع من المتجر لو عايز توقف جمع البيانات.');await loadCard(card);}catch(e){toast(e.message);}
    };
  }
  function insertCard(){
    if(screen==='report')return;
    const groups=document.querySelector('#intGroups');
    if(!groups||document.getElementById(ID))return;
    styling();
    const wrap=document.createElement('div');wrap.innerHTML=cardMarkup();
    const card=wrap.firstElementChild;
    groups.parentNode.insertBefore(card,groups);
    setupButtons(card);loadCard(card);
  }
  const normalize=s=>txt(s).replace(/\s+/g,' ').toLowerCase();
  function table(rows,headers){
    return '<div class="cl135-tablewrap"><table class="cl135-table"><thead><tr>'+headers.map(s=>'<th>'+esc(s)+'</th>').join('')+
    '</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>';
  }
  function trafficSection(title,rows){
    const max=Math.max(1,...rows.map(x=>x.sessions));
    const items=rows.slice(0,15).map(r=>'<tr><td>'+esc(r.name)+'</td><td>'+number(r.sessions)+'<div class="cl135-bar"><span style="width:'+Math.max(1,Math.round(r.sessions/max*100))+'%"></span></div></td><td>'+number(r.botSessions)+'</td></tr>');
    return '<div class="cl135 cl135-section"><h3>'+esc(title)+'</h3>'+table(items.length?items:['<tr><td colspan="3">لا توجد بيانات مصنّفة حتى الآن.</td></tr>'],['التقسيم','الجلسات','جلسات البوت'])+'</div>';
  }
  function campaignGrid(clarityRows,metaData){
    const meta=Array.isArray(metaData?.campaigns)?metaData.campaigns:[];
    const byName=new Map(clarityRows.filter(r=>normalize(r.name)!=='غير محدد').map(r=>[normalize(r.name),r]));
    const seen=new Set();
    const list=meta.map(m=>{
      const key=normalize(m.name||m.campaignName);
      seen.add(key);
      const c=byName.get(key);
      return {name:m.name||m.campaignName||'حملة بدون اسم',sessions:c?.sessions??null,spend:m.spend,metaOrders:m.platformPurchases,realOrders:m.realOrders,delivered:m.deliveredOrders,matched:!!c};
    });
    for(const c of clarityRows){
      const key=normalize(c.name);
      if(seen.has(key))continue;
      list.push({name:c.name,sessions:c.sessions,spend:null,metaOrders:null,realOrders:null,delivered:null,matched:false});
    }
    list.sort((a,b)=>(Number(b.spend)||0)-(Number(a.spend)||0));
    const cells=list.slice(0,50).map(x=>'<tr><td><b>'+esc(x.name)+'</b></td><td>'+esc(x.sessions===null?'—':number(x.sessions))+'</td><td>'+esc(x.spend==null?'—':money(x.spend))+'</td><td>'+esc(x.metaOrders==null?'—':number(x.metaOrders))+'</td><td>'+esc(x.realOrders==null?'—':number(x.realOrders))+'</td><td>'+esc(x.delivered==null?'—':number(x.delivered))+'</td><td>'+ (x.matched?'اسم الحملة مطابق':'غير مطابق / غير موجود')+'</td></tr>');
    return '<div class="cl135 cl135-section"><h3>مقارنة Meta Ads × Clarity × طلبات كن أونلاين</h3>'+
      '<div class="cl135-small">المطابقة بالاسم الدقيق فقط مع UTM Campaign؛ نوافذ Clarity (آخر 24 ساعة) وMeta (أيام تقويمية) مختلفة. الطلبات طبقًا لتقرير Meta/كن أونلاين ولا تعني إسناد طلب إلى جلسة Clarity. لا تُحسب ROAS من جلسات Clarity.</div>'+
      table(cells.length?cells:['<tr><td colspan="7">لا توجد بيانات قابلة للمقارنة بعد.</td></tr>'],['الحملة','جلسات Clarity','إنفاق Meta','Meta Purchases','طلبات النظام','تم التسليم','المطابقة'])+'</div>';
  }
  function recommendations(info,meta){
    const rows=info?.latest?.campaigns||[];
    const metaRows=meta?.campaigns||[];
    const names=new Set(metaRows.map(x=>normalize(x.name||x.campaignName)));
    const missing=rows.filter(x=>x.name!=='غير محدد'&&!names.has(normalize(x.name)));
    const hints=[];
    if(!info.latest)hints.push('فعّل التتبع على صفحات المتجر الفعلي، وأضف Data Export API Token ثم نفّذ أول مزامنة.');
    if(!metaRows.length)hints.push('اربط Meta Ads من مركز التكاملات لعرض الصرف والطلبات بجانب سلوك الزوار.');
    if(missing.length)hints.push('يوجد '+missing.length+' اسم حملة ظاهر في Clarity وغير مطابق لأسماء حملات Meta. راجع UTM Campaign واسم الحملة.');
    if(rows.some(x=>x.name==='غير محدد'))hints.push('بعض الجلسات بلا UTM Campaign واضح؛ استخدم utm_source وutm_medium وutm_campaign في روابط الإعلانات.');
    hints.push('افتح تسجيلات الجلسات والخرائط الحرارية من Clarity لتشخيص النقرات غير الفعالة والتوقف عند صفحة إتمام الطلب؛ واجهة التصدير لا تنقل التسجيلات.');
    return '<div class="cl135 cl135-section"><h3>توصيات عملية لتحسين الإعلانات والمتجر</h3>'+hints.map(x=>'<div class="cl135-note">• '+esc(x)+'</div>').join('')+'</div>';
  }
  async function metaPerformance(){
    try{
      const s=await scope(),to=new Date(),from=new Date(Date.now()-86400000);
      const q=new URLSearchParams({clientId:s.clientId,storeId:s.storeId,from:from.toISOString().slice(0,10),to:to.toISOString().slice(0,10)});
      const response=await fetch('/api/integrations/meta-ads/performance?'+q.toString(),{credentials:'include'});
      if(!response.ok)return {campaigns:[],error:'Meta Ads غير متصل أو لا تملك صلاحية عرضه'};
      return await response.json();
    }catch(e){return {campaigns:[],error:e.message};}
  }
  async function renderReport(){
    screen='report';styling();
    const el=root();
    if(!el)return;
    el.innerHTML='<div class="cl135"><h2>Microsoft Clarity — تحليل سلوك زوار الإعلانات</h2><p>جاري تحميل البيانات المتاحة لهذا المتجر...</p></div>';
    try{
      const [info,meta]=await Promise.all([api('/api/clarity/insights'),metaPerformance()]);
      if(screen!=='report')return;
      const latest=info.latest,st=info.status;
      const campaigns=latest?.campaigns||[],devices=latest?.devices||[],sources=latest?.sources||[];
      const sessions=devices.reduce((n,r)=>n+r.sessions,0);
      const bot=devices.reduce((n,r)=>n+r.botSessions,0);
      const totalCampaign=campaigns.reduce((n,r)=>n+r.sessions,0);
      el.innerHTML='<div class="page-head"><div><div class="title">◈ Microsoft Clarity</div><div class="sub">سلوك الزوار مع سياق الحملات الإعلانية · '+esc(latest?new Date(latest.syncedAt).toLocaleString('ar-EG'):'لا توجد مزامنة بعد')+'</div></div><div class="spacer"></div><button class="btn soft" id="cl135-back">العودة للتكاملات</button><button class="btn primary" id="cl135-refresh">مزامنة الآن</button></div>'+
      '<div class="cl135-kpis"><div class="cl135-kpi"><span>جلسات آخر 24 ساعة من Clarity</span><strong>'+number(sessions||totalCampaign)+'</strong></div><div class="cl135-kpi"><span>جلسات البوت</span><strong>'+number(bot)+'</strong></div><div class="cl135-kpi"><span>الحملات التي ظهر اسمها</span><strong>'+number(campaigns.filter(x=>x.name!=='غير محدد').length)+'</strong></div><div class="cl135-kpi"><span>حالة API</span><strong style="font-size:15px">'+esc(statusName(st))+'</strong></div></div>'+
      (!latest?'<div class="cl135 cl135-error">لم تُجلب بيانات بعد؛ ثبّت التتبع على المتجر واحفظ API Token في التكاملات، ثم اختبر الاتصال.</div>':'')+
      (meta.error?'<div class="cl135-small">Meta: '+esc(meta.error)+'</div>':'')+
      campaignGrid(campaigns,meta)+trafficSection('مصادر الزيارات',sources)+trafficSection('أجهزة العملاء',devices)+
      '<div class="cl135 cl135-section"><h3>تاريخ عينات التحليلات</h3><div class="cl135-small">'+esc(info.historyNote||'')+'</div>'+
      table((info.history||[]).slice(0,15).map(h=>'<tr><td>'+esc(new Date(h.syncedAt).toLocaleString('ar-EG'))+'</td><td>'+number(h.campaignSessions)+'</td></tr>'),['وقت سحب عينة 24 ساعة','الجلسات في العينة'])+'</div>'+
      recommendations(info,meta)+
      '<div class="cl135 cl135-section"><h3>التسجيلات والخرائط الحرارية</h3><p class="cl135-small">لعرض Session Recordings وHeatmaps افتح مشروعك داخل Microsoft Clarity. Data Export API يوفّر ملخصات مجمعة فقط، وليس ملفات فيديو أو خرائط حرارية كاملة.</p><a href="https://clarity.microsoft.com/" target="_blank" rel="noopener noreferrer" class="cl135-btn cl135-main" style="display:inline-block;text-decoration:none;margin-top:12px">فتح Microsoft Clarity ↗</a></div>';
      el.querySelector('#cl135-back').onclick=()=>{
        screen='integrations';document.querySelector('.nav button[data-view="integrations"]')?.click();
      };
      el.querySelector('#cl135-refresh').onclick=async function(){
        this.disabled=true;
        try{const d=await api('/api/clarity/sync',{method:'POST',body:'{}'});toast(d.skipped?'النسخة المحفوظة ما زالت حديثة':'تمت المزامنة');await renderReport();}
        catch(e){toast(e.message);this.disabled=false;}
      };
    }catch(e){
      el.innerHTML='<div class="cl135"><h2>تعذر عرض Clarity</h2><p class="cl135-error">'+esc(e.message)+'</p><button class="cl135-btn" id="cl135-go-back">العودة للتكاملات</button></div>';
      el.querySelector('#cl135-go-back').onclick=()=>{screen='integrations';document.querySelector('.nav button[data-view="integrations"]')?.click();};
    }
  }
  function hook(){
    styling();
    new MutationObserver(()=>{if(screen!=='report')insertCard();}).observe(root(),{childList:true,subtree:false});
    document.addEventListener('click',e=>{const nav=e.target.closest('.nav button[data-view]');if(nav){screen='integrations';setTimeout(insertCard,150);}});
    document.getElementById('storeBtn')?.addEventListener('change',()=>{const card=document.getElementById(ID);if(card)loadCard(card);});
    setTimeout(insertCard,200);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',hook);else hook();
  window.KunClarityV135={renderReport,version:'135.0'};
})();
