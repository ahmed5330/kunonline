/* Kun Online v51.15 — permission-aware navigation + deterministic delegated routing. */
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
    printing:['orders.read','shipping.read','support.read'],
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
    accounting:['finance.read'],
    'ecommerce-calculator':['finance.read'],
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
  function ensureFinanceCalculatorRoute(){
    const nav=document.querySelector('.nav');if(!nav)return null;
    let button=nav.querySelector('button[data-view="ecommerce-calculator"]');
    if(button)return button;
    button=document.createElement('button');button.type='button';button.dataset.view='ecommerce-calculator';button.textContent='حاسبة التجارة الإلكترونية';button.dataset.kunDynamicRoute='1';button.onclick=()=>routeNow('ecommerce-calculator');
    const accounting=nav.querySelector('button[data-view="accounting"]'),finance=nav.querySelector('button[data-view="finance"]');
    if(accounting)accounting.after(button);else if(finance)finance.after(button);else nav.appendChild(button);
    return button;
  }
  function visibleButtons(){return [...document.querySelectorAll('.nav button[data-view]')].filter(b=>!b.hidden&&b.style.display!=='none');}
  function firstAllowedButton(){return visibleButtons()[0]||null;}
  function currentView(){return document.querySelector('.nav button.active[data-view]')?.dataset.view||'';}
  function notify(){window.showToast?.('القسم غير متاح ضمن صلاحيات حسابك');}
  function showNoAccess(){const root=document.getElementById('root');if(root)root.innerHTML='<div class="card empty"><h2>لا توجد أقسام متاحة لهذا الحساب</h2><p>راجع صلاحيات عضو الفريق من حساب المالك.</p></div>';}
  function goFirstAllowed(){if(redirecting)return;const current=currentView();if(current&&allowed.has(current))return;const first=firstAllowedButton();if(!first){showNoAccess();return;}redirecting=true;setTimeout(()=>{try{first.click();}finally{redirecting=false;}},0);}
  function apply(){
    if(!snapshot?.role)return;
    ensureFinanceCalculatorRoute();
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
    window.KunSidebarGroupsV90?.sync?.();
    window.KunEcommerceCalculatorShortcutV93?.sync?.();
    window.KunFinanceCommandCenterV96?.mergeNavigation?.();
    goFirstAllowed();
  }
  async function loadAccess(force=false){
    try{
      if(force)window.KunPerformanceCore?.invalidate?.('/api/navigation-access');
      const response=await fetch('/api/navigation-access',{credentials:'include'}),data=await response.json().catch(()=>({}));
      if(!response.ok||!data?.role)throw new Error(data.error||`HTTP ${response.status}`);
      snapshot=data;ready=true;apply();return data;
    }catch(error){console.warn('Permission navigation unavailable',error);return null;}
  }
  function targetView(element){return text(element?.dataset?.view||element?.dataset?.go);}
  function routeNow(next){
    next=text(next);if(!next||!allowed.has(next))return false;
    const fn=typeof window.setView==='function'?window.setView:null;
    if(typeof fn!=='function')return false;
    fn(next);
    if(next==='ecommerce-calculator')setTimeout(()=>window.KunEcommerceCalculatorV94?.render?.(),0);
    window.KunSidebarGroupsV90?.sync?.();
    return true;
  }
  let routeSequence=0;
  document.addEventListener('click',event=>{
    if(!ready)return;
    const target=event.target.closest?.('.nav button[data-view],[data-go]');if(!target)return;
    const next=targetView(target);if(!next)return;
    if(!allowed.has(next)){
      event.preventDefault();event.stopImmediatePropagation();notify();goFirstAllowed();return;
    }
    const beforeView=currentView(),root=document.getElementById('root'),beforeHtml=root?.innerHTML||'',sequence=++routeSequence;
    setTimeout(()=>{
      if(sequence!==routeSequence||!ready||!allowed.has(next))return;
      const now=currentView(),sameRoot=Boolean(root&&root.innerHTML===beforeHtml);
      if(now!==next||(beforeView!==next&&sameRoot))routeNow(next);
      if(next==='ecommerce-calculator')setTimeout(()=>window.KunEcommerceCalculatorV94?.render?.(),0);
    },0);
  },true);
  const originalSetView=typeof window.setView==='function'?window.setView:null;
  if(originalSetView)window.setView=function(view){if(!ready||allowed.has(String(view)))return originalSetView(view);notify();goFirstAllowed();};
  function appendScript(src,marker,onload){
    if(typeof document==='undefined'||typeof document.createElement!=='function'||!document.body?.appendChild)return false;
    if(document.querySelector?.(`script[${marker}]`))return false;
    const script=document.createElement('script');script.src=src;script.async=false;script.setAttribute(marker,'1');if(onload)script.onload=onload;document.body.appendChild(script);return true;
  }
  function loadFinanceTools(){
    ensureFinanceCalculatorRoute();
    if(!window.KunEcommerceCalculatorV94)appendScript('/v2/modules-v94-ecommerce-calculator.js?v=96.2','data-kun-v96-ecommerce-calculator',()=>{if(ready)apply();});
    if(!window.KunEcommerceCalculatorShortcutV93)appendScript('/v2/modules-v93-ecommerce-calculator-shortcut.js?v=93.0','data-kun-v93-ecommerce-shortcut',()=>window.KunEcommerceCalculatorShortcutV93?.sync?.());
    if(!window.KunFinanceCommandCenterV96)appendScript('/v2/modules-v96-finance-command-center.js?v=96.0','data-kun-v96-finance',()=>{window.KunFinanceCommandCenterV96?.mergeNavigation?.();if(ready)apply();});
    if(!window.KunAccountingNavigationGuardV103)appendScript('/v2/modules-v103-accounting-navigation-guard.js?v=103.1','data-kun-accounting-navigation-guard',()=>{if(currentView()==='accounting')window.KunAccountingNavigationGuardV103?.retry?.();});
  }
  loadFinanceTools();
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',loadAccess,{once:true});else loadAccess();
  window.KunPermissionNavigationV51={load:()=>loadAccess(true),apply,allowedView,match,loadFinanceTools,loadEcommerceCalculator:loadFinanceTools,get snapshot(){return snapshot;},get allowed(){return [...allowed];},rules:VIEW_RULES,version:'51.15'};
})();
