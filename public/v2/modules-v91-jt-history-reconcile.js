/* Kun Online v91 — one-click reconciliation of previous J&T shipments with Kun orders. */
(function(){
  'use strict';
  if(window.KunJtHistoryReconcileV91)return;
  const notify=message=>window.showToast?.(message)||console.log(message);
  const root=()=>document.getElementById('root');
  let running=false;

  async function api(body){
    const response=await fetch('/api/jt/history/reconcile',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),data=await response.json().catch(()=>({}));
    if(!response.ok)throw Object.assign(new Error(data.error||`HTTP ${response.status}`),{status:response.status,code:data.code});
    return data;
  }

  function statusNode(){return document.getElementById('jtHistoryReconcileStatus');}
  function setStatus(text){const node=statusNode();if(node)node.textContent=text||'';}
  function totals(){return {scanned:0,matched:0,updated:0,unchanged:0,movedToShipped:0,enriched:0,notFound:0,conflicts:0,total:0,batches:0};}
  function add(total,batch){for(const key of ['scanned','matched','updated','unchanged','movedToShipped','enriched','notFound'])total[key]+=Number(batch?.[key]||0);total.conflicts+=Array.isArray(batch?.conflicts)?batch.conflicts.length:0;total.total=Math.max(total.total,Number(batch?.total||0));total.batches++;}

  async function run(button){
    if(running)return;
    running=true;button.disabled=true;const original=button.textContent,total=totals();
    try{
      const clientId=await (window.kunClientId?.()||Promise.resolve(''));
      if(!clientId)throw new Error('تعذر تحديد حساب المتجر');
      let cursor=0,guard=0;
      setStatus('جارٍ مطابقة الأوردرات السابقة مع J&T...');
      while(guard++<250){
        button.textContent=`مطابقة J&T... ${total.scanned}`;
        const batch=await api({clientId,cursor,limit:50});add(total,batch);
        setStatus(`تم فحص ${total.scanned} من ${total.total||'…'} — تم العثور على ${total.matched} شحنة J&T`);
        if(batch.done||batch.cursor===null||batch.cursor===undefined)break;
        const next=Number(batch.cursor);if(!Number.isFinite(next)||next<=cursor)throw new Error('توقفت المزامنة لأن مؤشر الدفعة لم يتقدم');cursor=next;
      }
      if(guard>=250)throw new Error('عدد الدفعات أكبر من الحد الآمن. أعد تشغيل الاستيراد لإكمال الباقي.');
      const message=`اكتملت مطابقة J&T: ${total.matched} شحنة مطابقة، ${total.movedToShipped} أوردر نُقل إلى جاري الشحن، ${total.enriched} أوردر تم استكمال بياناته${total.conflicts?`، ${total.conflicts} تعارض يحتاج مراجعة`:''}.`;
      setStatus(message);notify(message);
      window.dispatchEvent(new CustomEvent('kun:jt-history-reconciled',{detail:total}));
      await Promise.resolve(window.KunPostShippingV47?.render?.()).catch(()=>{});
    }catch(error){setStatus(`تعذر استيراد سجل J&T: ${error.message}`);notify(error.message);}
    finally{running=false;button.disabled=false;button.textContent=original;decorate();}
  }

  function decorate(){
    const page=root()?.querySelector('.ps-page');if(!page)return;
    const head=page.querySelector('.page-head');if(!head||document.getElementById('jtHistoryReconcileBtn'))return;
    const button=document.createElement('button');button.type='button';button.className='btn soft';button.id='jtHistoryReconcileBtn';button.textContent='استيراد شحنات J&T السابقة';button.title='يطابق كل أوردرات Kun Online الحالية مع شحناتها السابقة على J&T باستخدام رقم الأوردر المرجعي، بدون إنشاء شحنات جديدة.';button.addEventListener('click',()=>run(button));
    const reload=head.querySelector('#v47Reload');if(reload)head.insertBefore(button,reload);else head.appendChild(button);
    const status=document.createElement('div');status.id='jtHistoryReconcileStatus';status.className='meta';status.style.gridColumn='1 / -1';status.style.marginTop='-5px';status.textContent='';head.insertAdjacentElement('afterend',status);
  }

  function boot(){
    decorate();
    const observer=new MutationObserver(()=>decorate());
    const target=root();if(target)observer.observe(target,{childList:true,subtree:true});
    document.addEventListener('click',event=>{if(event.target.closest?.('.nav button[data-view="post-shipping"]'))setTimeout(decorate,0);});
  }

  window.KunJtHistoryReconcileV91={run,decorate,version:'91.0'};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
