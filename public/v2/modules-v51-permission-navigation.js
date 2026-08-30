/* Kun Online v51 — permission-aware navigation and route guard. */
(function(){
  const OWNER_ROLES=new Set(['admin','client']);
  const VIEW_RULES=Object.freeze({
    dashboard:['analytics.read'],
    intelligence:['ai.read'],
    onboarding:['owner'],
    readiness:['owner'],
    stores:['owner'],
    'store-access':['owner'],
    pos:['pos.read'],
    orders:['orders.read'],
    'customer-service':['support.read'],
    'post-shipping':['shipping.read'],
    customers:['customers.read'],
    inbox:['inbox.read'],
    products:['products.read'],
    inventory:['inventory.read'],
    suppliers:['procurement.read'],
    procurement:['procurement.read'],
    'supplier-finance':['finance.read','procurement.read'],
    shipping:['shipping.read'],
    cod:['cod.read'],
    campaigns:['campaigns.read'],
    marketing:['ads.read'],
    'ad-studio':['ads.write'],
    finance:['finance.read'],
    profit:['profit.read'],
    analytics:['analytics.read'],
    automation:['automation.read'],
    ai:['ai.read'],
    integrations:['integrations.read'],
    access:['owner'],
    approvals:['owner'],
    ops:['owner'],
    audit:['audit.read'],
    wallet:['wallet.read'],
    'admin-clients':['admin'],
    control:['owner'],
    settings:['owner']
  });
  let snapshot=null,ready=false,allowed=new Set(),redirecting=false;
  const text=v=>String(v??'').trim();
  const permissions=()=>Array.isArray(snapshot?.permissions)?snapshot.permissions:[];
  function match(rule,target){
    rule=text(rule);target=text(target);
    if(rule==='*')return true;
    if(!rule||!target)return false;
    const [resource,action]=target.split('.');
    return rule===target||rule===`${resource}.*`||(rule.endsWith('.*')&&rule.slice(0,-2)===resource&&Boolean(action));
  }
  function has(target){return permissions().some(rule=>match(rule,target));}
  function allowedView(view,data=snapshot){
    view=text(view);if(!view||!data?.role)return false;
    if(view==='admin-clients')return data.role==='admin';
    if(OWNER_ROLES.has(data.role))return true;
    const rules=VIEW_RULES[view];if(!rules?.length)return false;
    if(rules.includes('owner')||rules.includes('admin'))return false;
    return rules.some(target=>(Array.isArray(data.permissions)?data.permissions:[]).some(rule=>match(rule,target)));
  }
  function visibleButtons(){return [...document.querySelectorAll('.nav button[data-view]')].filter(b=>!b.hidden&&b.style.display!=='none');}
  function firstAllowedButton(){return visibleButtons()[0]||null;}
  function currentView(){return document.querySelector('.nav button.active[data-view]')?.dataset.view||'';}
  function notify(){window.showToast?.('القسم غير متاح ضمن صلاحيات حسابك');}
  function goFirstAllowed(){
    if(redirecting)return;const current=currentView();if(current&&allowed.has(current))return;
    const first=firstAllowedButton();if(!first)return;
    redirecting=true;setTimeout(()=>{try{first.click();}finally{redirecting=false;}},0);
  }
  function apply(){
    if(!snapshot?.role)return;
    allowed=new Set();
    document.querySelectorAll('.nav button[data-view]').forEach(button=>{
      const view=button.dataset.view||'',ok=allowedView(view,snapshot);
      button.hidden=!ok;button.style.display=ok?'':'none';button.setAttribute('aria-hidden',ok?'false':'true');button.tabIndex=ok?0:-1;
      if(ok)allowed.add(view);else button.classList.remove('active');
    });
    const quick=document.getElementById('quickBtn');
    if(quick&&!OWNER_ROLES.has(snapshot.role)){
      const writable=['orders.write','customers.write','products.write','inventory.write','procurement.write','campaigns.write','ads.write','finance.write','automation.write'].some(has);
      quick.hidden=!writable;quick.style.display=writable?'':'none';
    }
    document.documentElement.dataset.permissionNavigation='ready';
    goFirstAllowed();
  }
  async function loadAccess(){
    try{
      const response=await fetch('/api/navigation-access',{credentials:'include',cache:'no-store'}),data=await response.json().catch(()=>({}));
      if(!response.ok||!data?.role)throw new Error(data?.error||`HTTP ${response.status}`);
      snapshot=data;ready=true;apply();return data;
    }catch(error){
      console.warn('Permission navigation unavailable',error);return null;
    }
  }
  function targetView(element){return text(element?.dataset?.view||element?.dataset?.go);}
  document.addEventListener('click',event=>{
    if(!ready)return;
    const target=event.target.closest?.('.nav button[data-view],[data-go]');if(!target)return;
    const view=targetView(target);if(!view||allowed.has(view))return;
    event.preventDefault();event.stopImmediatePropagation();notify();goFirstAllowed();
  },true);
  const nav=document.querySelector('.nav');
  if(nav)new MutationObserver(()=>{if(ready){apply();const active=currentView();if(active&&!allowed.has(active))goFirstAllowed();}}).observe(nav,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
  const originalSetView=typeof window.setView==='function'?window.setView:null;
  if(originalSetView)window.setView=function(view){if(!ready||allowed.has(String(view)))return originalSetView(view);notify();goFirstAllowed();};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',loadAccess,{once:true});else loadAccess();
  window.KunPermissionNavigationV51={load:loadAccess,apply,allowedView,match,get snapshot(){return snapshot;},get allowed(){return [...allowed];},rules:VIEW_RULES,version:'51.0'};
})();
