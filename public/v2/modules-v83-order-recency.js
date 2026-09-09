/* Kun Online v83.1 — keep recently modified operational orders at the top without extra board API reads. */
(function(){
  const activity=new Map(),nativeFetch=window.fetch.bind(window);let queued=false,wrapped=false;
  const clean=value=>String(value??'').trim();
  const ms=value=>{if(!value)return 0;const time=new Date(value).getTime();return Number.isFinite(time)?time:0;};
  function orderActivity(order={}){
    const history=Array.isArray(order.history)?order.history:[],contact=Array.isArray(order.contactLog)?order.contactLog:Array.isArray(order.contact_log)?order.contact_log:[],times=[order.updatedAt,order.updated_at,order.modifiedAt,order.modified_at,order.collectedAt,order.collected_at,history.at(-1)?.at,contact.at(-1)?.at,order.date,order.createdAt,order.created_at].map(ms);
    return Math.max(0,...times);
  }
  function remember(data){if(!Array.isArray(data?.orders))return;for(const order of data.orders){const id=clean(order?.id);if(id)activity.set(id,orderActivity(order));}queueSort();}
  const orderIdFromCard=card=>clean(card?.dataset?.csOrder||card?.dataset?.v47Order||card?.dataset?.v56Order);
  function sortContainer(container){if(!container)return;const current=[...container.children].filter(el=>el.matches?.('[data-cs-order],[data-v47-order],[data-v56-order]'));if(current.length<2)return;const original=new Map(current.map((card,index)=>[card,index])),sorted=[...current].sort((a,b)=>(activity.get(orderIdFromCard(b))||0)-(activity.get(orderIdFromCard(a))||0)||(original.get(a)-original.get(b)));if(sorted.every((card,index)=>card===current[index]))return;for(const card of sorted)container.appendChild(card);}
  function sortAll(){queued=false;document.querySelectorAll('#root .cs-list,#root .cs-deferred-grid,#root .ps-list,#root .rx-list').forEach(sortContainer);wrapCustomerService();}
  function queueSort(){if(queued)return;queued=true;queueMicrotask(sortAll);}
  function touch(orderId){const id=clean(orderId);if(!id)return;activity.set(id,Date.now());queueSort();}
  function idFromWritePath(path){const patterns=[/^\/api\/customer-service\/orders\/([^/]+)\/(?:notes|awb|contact|whatsapp-log|state|edit)(?:\?|$)/,/^\/api\/post-shipping\/orders\/([^/]+)\/(?:delivered|collecting|collect|shipping-sheet-retry)(?:\?|$)/,/^\/api\/returns-exchanges\/orders\/([^/]+)\/reason(?:\?|$)/,/^\/api\/jt\/shipments\/([^/]+)(?:\?|$)/];for(const pattern of patterns){const match=path.match(pattern);if(match)return decodeURIComponent(match[1]);}return '';}
  function requestMeta(input,init={}){try{const url=new URL(typeof input==='string'?input:input?.url||'',location.origin),method=clean(init?.method||input?.method||'GET').toUpperCase()||'GET';return {url,method};}catch{return {url:null,method:'GET'};}}
  window.fetch=async function(input,init){const meta=requestMeta(input,init),response=await nativeFetch(input,init);try{if(response.ok&&meta.url){const path=meta.url.pathname;if(meta.method==='GET'&&['/api/customer-service','/api/post-shipping','/api/returns-exchanges'].includes(path))response.clone().json().then(remember).catch(()=>{});else if(meta.method!=='GET'){const id=idFromWritePath(path);if(id)touch(id);}}}catch{}return response;};
  function wrapCustomerService(){if(wrapped)return;const api=window.KunCustomerServiceV31;if(!api||typeof api.patchOrder!=='function')return;const original=api.patchOrder.bind(api);api.patchOrder=(orderId,patch={})=>{const result=original(orderId,patch);if(result!==false)touch(orderId);return result;};wrapped=true;}
  function boot(){wrapCustomerService();new MutationObserver(()=>queueSort()).observe(document.getElementById('root')||document.body,{childList:true,subtree:true});window.addEventListener('kun:order-workflow-updated',event=>touch(event?.detail?.orderId));window.addEventListener('kun:collection-recorded',event=>touch(event?.detail?.orderId));queueSort();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
  window.KunOrderRecencyV83={touch,sort:sortAll,activityFor:orderActivity,version:'83.1'};
})();
