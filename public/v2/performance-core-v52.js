/* Kun Online v52.1 — lightweight shared frontend performance primitives. */
(function(){
  if(window.KunPerformanceCore)return;
  const baseFetch=window.fetch.bind(window);
  const inflight=new Map(),cache=new Map();
  const now=()=>Date.now();
  function requestInfo(input,init={}){
    const raw=typeof input==='string'?input:input?.url||'';
    const method=String(init.method||(typeof input!=='string'&&input?.method)||'GET').toUpperCase();
    let url;try{url=new URL(raw,location.origin);}catch{return {method,url:null,key:''};}
    return {method,url,key:`${method}:${url.pathname}${url.search}`};
  }
  function ttl(path){
    if(path==='/api/me')return 15000;
    if(path==='/api/navigation-access')return 8000;
    if(path==='/api/tenant/features')return 5000;
    if(path==='/api/catalog/products')return 1200;
    if(path==='/api/team-role-catalog')return 15000;
    if(path==='/api/state')return 3000;
    if(path==='/api/customer-service')return 2000;
    if(path==='/api/post-shipping')return 2000;
    if(path==='/api/dashboard')return 2000;
    return 0;
  }
  function cached(key){const hit=cache.get(key);if(!hit)return null;if(hit.expires<=now()){cache.delete(key);return null;}return hit.response.clone();}
  // Login changes the first-party cookie. Never reuse or restore responses
  // fetched under the previous session, including an already-in-flight /me.
  let authEpoch=0;
  window.fetch=async function(input,init={}){
    const info=requestInfo(input,init);
    const headers=new Headers(init.headers||(typeof input!=='string'&&input?.headers)||undefined);
    const mode=init.cache||(typeof input!=='string'&&input?.cache)||'';
    const noCache=['no-store','reload','no-cache'].includes(mode)||
      /(?:no-cache|no-store)/i.test(headers.get('Cache-Control')||'')||
      /no-cache/i.test(headers.get('Pragma')||'');
    if(info.url?.origin===location.origin&&info.method!=='GET'&&
      ['/api/login','/api/logout'].includes(info.url.pathname)){
      ++authEpoch;cache.clear();inflight.clear();
      const response=await baseFetch(input,init);
      ++authEpoch;cache.clear();inflight.clear();
      return response;
    }
    const ms=info.url?.origin===location.origin&&info.method==='GET'&&!noCache?ttl(info.url.pathname):0;
    if(!ms)return baseFetch(input,init);
    const hit=cached(info.key);if(hit)return hit;
    if(inflight.has(info.key))return (await inflight.get(info.key)).clone();
    const epoch=authEpoch;
    const work=baseFetch(input,init).then(response=>{
      if(response.ok&&epoch===authEpoch&&!/(?:no-store|private)/i.test(response.headers.get('Cache-Control')||''))
        cache.set(info.key,{expires:now()+ms,response:response.clone()});
      return response;
    }).finally(()=>inflight.delete(info.key));
    inflight.set(info.key,work);
    return (await work).clone();
  };
  function invalidate(path=''){
    for(const key of cache.keys())if(!path||key.includes(`:${path}`))cache.delete(key);
  }
  function idle(fn,timeout=1200){
    if('requestIdleCallback' in window)return requestIdleCallback(fn,{timeout});
    return setTimeout(fn,Math.min(timeout,600));
  }
  const activeView=()=>document.querySelector('.nav button.active[data-view]')?.dataset.view||'';
  window.KunPerformanceCore={invalidate,idle,activeView,inflight,cache,version:'52.2'};
})();