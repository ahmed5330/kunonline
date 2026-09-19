/* Kun Online v99 — icon-led, color-coded, collapsible sidebar navigation. */
(function(){
  'use strict';

  const STORAGE_KEY='kun.sidebar.open-group.v99';
  const ICONS={
    dashboard:'<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
    sales:'<path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h5M8 16h3"/>',
    users:'<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2"/><circle cx="17" cy="9" r="2"/><path d="M16 14a5 5 0 0 1 5 5v1"/>',
    headset:'<path d="M4 13v-1a8 8 0 0 1 16 0v1"/><path d="M4 13h3v6H5a2 2 0 0 1-2-2v-2a2 2 0 0 1 1-2ZM20 13h-3v6h2a2 2 0 0 0 2-2v-2a2 2 0 0 0-1-2Z"/>',
    message:'<path d="M4 5h16v11H9l-5 4V5Z"/><path d="M8 9h8M8 12h5"/>',
    return:'<path d="M9 7H5V3"/><path d="M5 7a8 8 0 1 1-1 9"/><path d="m5 7 4-4"/>',
    box:'<path d="m12 3 9 4.5-9 4.5-9-4.5L12 3Z"/><path d="M3 7.5V17l9 4 9-4V7.5M12 12v9"/>',
    warehouse:'<path d="M3 10 12 4l9 6v10H3V10Z"/><path d="M7 20v-6h10v6"/>',
    supplier:'<path d="M4 20V8l8-5 8 5v12"/><path d="M8 20v-7h8v7M9 9h6"/>',
    cart:'<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M3 4h2l2.4 10.2a2 2 0 0 0 2 1.6h7.8a2 2 0 0 0 2-1.6L21 8H7"/>',
    truck:'<path d="M3 6h11v10H3z"/><path d="M14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',
    cash:'<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M7 9H5v2M17 15h2v-2"/>',
    growth:'<path d="M4 17 10 11l4 4 6-8"/><path d="M15 7h5v5"/>',
    megaphone:'<path d="m4 13 12-5v8L4 11v2Z"/><path d="M7 13v6h4l1-4M18 9c2 1 2 5 0 6"/>',
    target:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/><path d="m14 10 6-6"/>',
    chart:'<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    finance:'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 11h1M12 11h1M16 11h1M8 15h1M12 15h1M16 15h1M8 18h1M12 18h5"/>',
    wallet:'<path d="M4 6h14a2 2 0 0 1 2 2v11H4a2 2 0 0 1-2-2V6a3 3 0 0 1 3-3h12"/><path d="M16 11h5v4h-5a2 2 0 1 1 0-4Z"/>',
    spark:'<path d="m12 3 1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3Z"/><path d="m19 14 .8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14Z"/>',
    bolt:'<path d="m13 2-8 12h7l-1 8 8-12h-7l1-8Z"/>',
    store:'<path d="M4 9v11h16V9"/><path d="M3 9 5 4h14l2 5"/><path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0M9 20v-6h6v6"/>',
    pos:'<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M7 7h10v5H7zM8 16h2M14 16h2"/>',
    gear:'<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9 7 7M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"/>',
    plug:'<path d="M8 3v5M16 3v5M6 8h12v2a6 6 0 0 1-6 6v5"/><path d="M9 21h6"/>',
    shield:'<path d="M12 3 20 6v5c0 5-3.4 8.5-8 10-4.6-1.5-8-5-8-10V6l8-3Z"/><path d="m9 12 2 2 4-5"/>',
    audit:'<path d="M7 3h10v4H7z"/><path d="M5 5H4v16h16V5h-1M8 12h8M8 16h5"/>',
    settings:'<circle cx="12" cy="12" r="3"/><path d="M19 13.5v-3l-2-.7-.8-1.9.9-1.9-2.1-2.1-1.9.9-1.9-.8L10.5 2h-3l-.7 2-1.9.8-1.9-.9L.9 6l.9 1.9-.8 1.9-2 .7v3l2 .7.8 1.9-.9 1.9L3 20.1l1.9-.9 1.9.8.7 2h3l.7-2 1.9-.8 1.9.9 2.1-2.1-.9-1.9.8-1.9 2-.7Z" transform="translate(2 -1) scale(.83)"/>',
    grid:'<rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/>'
  };

  const GROUPS=[
    {id:'sales',label:'المبيعات والعملاء',icon:'sales',accent:'#ff7a59',items:[
      ['orders','الطلبات','sales'],['customer-service','خدمة العملاء','headset'],['customers','إدارة العملاء CRM','users'],['inbox','صندوق الرسائل','message'],['post-shipping','ما بعد الشحن','truck'],['returns-exchanges','المرتجعات والاستبدالات','return']
    ]},
    {id:'stock',label:'المنتجات والتوريد',icon:'box',accent:'#2fcf8f',items:[
      ['products','المنتجات','box'],['inventory','المخزون','warehouse'],['suppliers','الموردون','supplier'],['procurement','المشتريات','cart'],['supplier-finance','حسابات الموردين','finance']
    ]},
    {id:'logistics',label:'الشحن والتحصيل',icon:'truck',accent:'#8b7cf6',items:[
      ['shipping','الشحن','truck'],['cod','تسويات COD','cash']
    ]},
    {id:'growth',label:'التسويق والنمو',icon:'growth',accent:'#f6ad3c',items:[
      ['marketing','أداء الإعلانات','megaphone'],['campaigns','الحملات الإعلانية','target'],['ad-studio','AI Ad Studio','spark'],['analytics','التحليلات والتقارير','chart']
    ]},
    {id:'finance',label:'المالية والربحية',icon:'finance',accent:'#20b8b0',items:[
      ['finance','المالية والربحية','finance'],['accounting','الحسابات والحركات','cash'],['ecommerce-calculator','حاسبة التجارة الإلكترونية','finance'],['profit','تحليل الربحية','growth'],['wallet','المحفظة','wallet']
    ]},
    {id:'ai',label:'الذكاء والأتمتة',icon:'spark',accent:'#4da3ff',items:[
      ['intelligence','مركز الذكاء','spark'],['ai','kun AI','spark'],['automation','الأتمتة','bolt']
    ]},
    {id:'operations',label:'التشغيل والمتاجر',icon:'store',accent:'#38c7d9',items:[
      ['stores','المتاجر والفروع','store'],['store-access','صلاحيات الفروع','shield'],['pos','نقطة البيع POS','pos'],['onboarding','بدء الاستخدام','grid'],['readiness','جاهزية النظام','audit'],['ops','مركز التشغيل','gear']
    ]},
    {id:'system',label:'الإدارة والنظام',icon:'settings',accent:'#a8b4c7',items:[
      ['integrations','مركز التكاملات','plug'],['access','الفريق والصلاحيات','users'],['approvals','مركز الموافقات','shield'],['audit','سجل النشاط','audit'],['control','الحساب والتكاملات','settings'],['settings','الإعدادات','settings'],['admin-clients','Kun Admin','shield']
    ]}
  ];
  const ROUTE_META=new Map(GROUPS.flatMap(group=>group.items.map(([view,label,icon])=>[view,{label,icon,group:group.id,accent:group.accent}])));

  const svg=name=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]||ICONS.grid}</svg>`;
  const isRouteVisible=button=>button&&!button.hidden&&button.style.display!=='none';
  const routeMarkup=(label,icon)=>`<span class="nav-item-icon" aria-hidden="true">${svg(icon)}</span><span class="nav-item-label">${label}</span>`;

  function decorateRoute(button,meta){
    if(!button||button.dataset.navDecorated==='v99')return;
    const view=button.dataset.view||'';
    const info=meta||ROUTE_META.get(view)||{label:button.textContent.trim()||view,icon:'grid'};
    button.innerHTML=routeMarkup(info.label,info.icon);
    button.dataset.navDecorated='v99';
    if(info.accent)button.style.setProperty('--nav-accent',info.accent);
  }

  function createGroup(def,buttons){
    const available=def.items.filter(([view])=>buttons.has(view));
    if(!available.length)return null;
    const group=document.createElement('div');
    group.className='nav-group';
    group.dataset.navGroup=def.id;
    group.style.setProperty('--group-accent',def.accent);

    const toggle=document.createElement('button');
    toggle.type='button';
    toggle.className='nav-group-toggle';
    toggle.setAttribute('aria-expanded','false');
    toggle.setAttribute('aria-controls',`nav-group-${def.id}`);
    toggle.innerHTML=`<span class="nav-group-main"><span class="nav-group-icon" aria-hidden="true">${svg(def.icon)}</span><span class="nav-group-label">${def.label}</span></span><span class="nav-group-chevron" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 6 6 6-6 6"/></svg></span>`;

    const items=document.createElement('div');
    items.className='nav-group-items';
    items.id=`nav-group-${def.id}`;

    available.forEach(([view,label,icon])=>{
      const button=buttons.get(view);
      decorateRoute(button,{label,icon,group:def.id,accent:def.accent});
      button.classList.add('nav-subitem');
      button.dataset.navParent=def.id;
      items.appendChild(button);
      buttons.delete(view);
    });

    toggle.addEventListener('click',event=>{
      event.preventDefault();event.stopPropagation();
      setOpen(group,!group.classList.contains('is-open'),true);
    });
    items.addEventListener('click',event=>{
      const route=event.target.closest('button[data-view]');if(!route)return;
      setOpen(group,true,true);setTimeout(syncActive,0);
    },true);
    group.append(toggle,items);return group;
  }

  function setOpen(group,open,exclusive){
    const nav=group?.closest('.nav');if(!group||!nav)return;
    if(open&&exclusive){nav.querySelectorAll('.nav-group.is-open').forEach(other=>{if(other!==group){other.classList.remove('is-open');other.querySelector(':scope > .nav-group-toggle')?.setAttribute('aria-expanded','false');}});}
    group.classList.toggle('is-open',Boolean(open));
    group.querySelector(':scope > .nav-group-toggle')?.setAttribute('aria-expanded',open?'true':'false');
    try{if(open)localStorage.setItem(STORAGE_KEY,group.dataset.navGroup||'');else if(localStorage.getItem(STORAGE_KEY)===group.dataset.navGroup)localStorage.removeItem(STORAGE_KEY);}catch(_){ }
  }

  function adoptLateRoutes(nav){
    nav.querySelectorAll('button[data-view]').forEach(button=>{
      const view=button.dataset.view||'',meta=ROUTE_META.get(view);
      decorateRoute(button,meta);
      if(!meta||button.closest('.nav-group'))return;
      const target=nav.querySelector(`.nav-group[data-nav-group="${CSS.escape(meta.group)}"] .nav-group-items`);
      if(target){button.classList.add('nav-subitem');button.dataset.navParent=meta.group;target.appendChild(button);}
    });
    const shortcuts=nav.querySelector('[data-kun-shortcuts-nav]');
    if(shortcuts&&!shortcuts.dataset.navDecorated){shortcuts.dataset.navDecorated='v99';shortcuts.style.setProperty('--nav-accent','#f6c453');shortcuts.classList.add('nav-special-shortcut');}
  }

  function syncVisibility(){
    const nav=document.querySelector('.nav.kun-nav-grouped');if(!nav)return;
    adoptLateRoutes(nav);
    nav.querySelectorAll('.nav-group').forEach(group=>{const routes=[...group.querySelectorAll('.nav-group-items>button[data-view]')],hasVisible=routes.some(isRouteVisible);group.hidden=!hasVisible;if(!hasVisible)setOpen(group,false,false);});
  }

  function syncActive(){
    const nav=document.querySelector('.nav.kun-nav-grouped');if(!nav)return;
    const active=nav.querySelector('button[data-view].active');
    nav.querySelectorAll('.nav-group').forEach(group=>group.classList.remove('has-active'));
    if(!active)return;const group=active.closest('.nav-group');if(group){group.classList.add('has-active');setOpen(group,true,true);}
  }

  function init(){
    const nav=document.querySelector('.nav');if(!nav||nav.dataset.groupedNavigation==='v99')return;
    const original=[...nav.querySelectorAll(':scope > button[data-view]')];if(!original.length)return;
    const buttons=new Map(original.map(button=>[button.dataset.view,button])),fragment=document.createDocumentFragment();
    const dashboard=buttons.get('dashboard');
    if(dashboard){dashboard.classList.add('nav-standalone','nav-dashboard');decorateRoute(dashboard,{label:'الداشبورد',icon:'dashboard',accent:'#4da3ff'});fragment.appendChild(dashboard);buttons.delete('dashboard');}
    GROUPS.forEach(def=>{const group=createGroup(def,buttons);if(group)fragment.appendChild(group);});
    if(buttons.size){const fallback={id:'other',label:'أقسام أخرى',icon:'grid',accent:'#94a3b8',items:[...buttons.keys()].map(view=>[view,buttons.get(view)?.textContent?.trim()||view,'grid'])};const group=createGroup(fallback,buttons);if(group)fragment.appendChild(group);}
    nav.replaceChildren(fragment);nav.classList.add('kun-nav-grouped');nav.dataset.groupedNavigation='v99';

    let queued=false;const queueSync=()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;syncVisibility();syncActive();});};
    const observer=new MutationObserver(records=>{if(records.some(record=>record.type==='childList'||record.target?.matches?.('button[data-view]')))queueSync();});
    observer.observe(nav,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','style','class','aria-hidden']});
    nav.addEventListener('click',event=>{if(event.target.closest('button[data-view]'))setTimeout(queueSync,0);});
    syncVisibility();const current=nav.querySelector('button[data-view].active');
    if(current)syncActive();else{try{const saved=localStorage.getItem(STORAGE_KEY),group=saved?nav.querySelector(`.nav-group[data-nav-group="${CSS.escape(saved)}"]`):null;if(group&&!group.hidden)setOpen(group,true,true);}catch(_){ }}
    window.KunSidebarGroupsV90={groups:GROUPS,sync:queueSync,open:id=>{const group=nav.querySelector(`.nav-group[data-nav-group="${CSS.escape(String(id||''))}"]`);if(group)setOpen(group,true,true);},version:'99.0'};
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
