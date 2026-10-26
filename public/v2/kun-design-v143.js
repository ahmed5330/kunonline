/* Kun Online v145: permission-aware top-level commerce navigation. Does not own data or mutate APIs. */
(function(){
  'use strict';
  if(window.KunDesignShellV143)return;
  const NAV=[
    ["dashboard","الرئيسية","<rect x=\"3\" y=\"3\" width=\"8\" height=\"8\" rx=\"2\"/><rect x=\"13\" y=\"3\" width=\"8\" height=\"8\" rx=\"2\"/><rect x=\"3\" y=\"13\" width=\"8\" height=\"8\" rx=\"2\"/><rect x=\"13\" y=\"13\" width=\"8\" height=\"8\" rx=\"2\"/>"],
    ["orders","الطلبات","<path d=\"M5 4h14v16H5z\"/><path d=\"M8 8h8M8 12h8M8 16h5\"/>"],
    ["customer-service","خدمة العملاء","<path d=\"M4 13v-1a8 8 0 0 1 16 0v1\"/><path d=\"M4 13h3v6H5a2 2 0 0 1-2-2v-2a2 2 0 0 1 1-2ZM20 13h-3v6h2a2 2 0 0 0 2-2v-2a2 2 0 0 0-1-2Z\"/>"],
    ["printing","الطباعة","<path d=\"M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2\"/><path d=\"M6 15h12v6H6zM18 12h.01\"/>"],
    ["shipping","الشحن","<rect x=\"3\" y=\"5\" width=\"12\" height=\"12\" rx=\"1\"/><path d=\"M15 9h4l3 3v5h-7M5 19h.01M17 19h.01\"/><circle cx=\"7\" cy=\"18\" r=\"2\"/><circle cx=\"18\" cy=\"18\" r=\"2\"/>"],
    ["returns-exchanges","المرتجعات والاستبدالات","<path d=\"M9 7H5V3\"/><path d=\"M5 7a8 8 0 1 1-1 9\"/><path d=\"m5 7 4-4\"/>"],
    ["products","المنتجات","<rect x=\"4\" y=\"3\" width=\"16\" height=\"18\" rx=\"2\"/><path d=\"M8 8h8M8 12h8M8 16h5\"/>"],
    ["inventory","المخزون","<path d=\"m12 3 9 5-9 5-9-5 9-5Z\"/><path d=\"M3 8v9l9 5 9-5V8M12 13v9\"/>"],
    ["campaigns","الحملات","<path d=\"M4 10h4l10-5v12L8 12H4v-2ZM8 12v7h3l1-5\"/><path d=\"M20 9c2 2 2 4 0 6\"/>"],
    ["finance","المالية","<path d=\"M4 19h16M6 15l4-5 4 3 4-7\"/><path d=\"M15 6h3v3\"/>"],
    ["accounting","الحسابات والحركات","<rect x=\"5\" y=\"3\" width=\"14\" height=\"18\" rx=\"2\"/><path d=\"M8 7h8M8 11h8M8 15h3\"/>"],
    ["wallet","المحفظة","<rect x=\"3\" y=\"5\" width=\"18\" height=\"15\" rx=\"3\"/><path d=\"M16 11h5v5h-5a2 2 0 0 1 0-5ZM5 5V3h13\"/>"],
    ["integrations","مركز التكاملات","<path d=\"M8 3v5M16 3v5M6 8h12v3a6 6 0 0 1-12 0V8ZM12 17v4\"/>"],
    ["settings","الإعدادات","<circle cx=\"12\" cy=\"12\" r=\"3\"/><path d=\"M12 2v3M12 19v3M4.9 4.9 7 7M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1\"/>"]
  ];
  const icons=Object.fromEntries(NAV.map(function(n){return [n[0],'<svg viewBox="0 0 24 24" aria-hidden="true">'+n[2]+'</svg>'];}));
  let primary,details,dock,shade,nav,side,queued=false;
  function origin(view){return nav && nav.querySelector('button[data-view="'+view+'"]');}
  function permitted(view){
    const item=origin(view);
    return !!item && !item.hidden && !item.disabled &&
      item.getAttribute('aria-hidden')!=='true' &&
      item.style.display!=='none' &&
      !(item.closest('.nav-group') && item.closest('.nav-group').hidden);
  }
  function activeView(){return nav && nav.querySelector('button[data-view].active')?.dataset.view || '';}
  const MAIN_GROUPS=[
    ['التشغيل اليومي',['dashboard','orders','customer-service','printing','shipping','returns-exchanges']],
    ['المنتجات والمخزون',['products','inventory']],
    ['التسويق والنمو',['campaigns']],
    ['الإدارة المالية',['finance','accounting','wallet']],
    ['إدارة النظام',['integrations','settings']]
  ];
  const MAIN_VIEWS=new Set(NAV.map(function(item){return item[0];}));
  function groupFor(view){
    if(MAIN_VIEWS.has(view))return view;
    if(['customers','inbox'].includes(view))return 'customer-service';
    if(['post-shipping','cod'].includes(view))return 'shipping';
    if(['suppliers','procurement','supplier-finance'].includes(view))return 'inventory';
    if(['marketing','ad-studio','analytics','intelligence','ai','automation'].includes(view))return 'campaigns';
    if(['profit','ecommerce-calculator'].includes(view))return 'finance';
    if(['access','approvals','ops','audit','control','admin-clients','stores','store-access','pos','onboarding','readiness'].includes(view))return 'settings';
    return view;
  }
  function sync(){
    const current=groupFor(activeView());
    // Permissions remain owned by the original navigation. These attributes only
    // prevent duplicate *visual links* in the secondary disclosure.
    nav.querySelectorAll('button[data-view]').forEach(function(link){
      if(MAIN_VIEWS.has(link.dataset.view)){if(link.dataset.kunPrimary!=='1')link.dataset.kunPrimary='1';}
      else if(link.hasAttribute('data-kun-primary'))link.removeAttribute('data-kun-primary');
    });
    document.querySelectorAll('.kun143-primary-button,.kun143-bottom button[data-kun-view]').forEach(function(button){
      const v=button.dataset.kunView;
      button.hidden=!permitted(v);
      if(v===current){button.setAttribute('aria-current','page');}else{button.removeAttribute('aria-current');}
    });
    primary.querySelectorAll('[data-kun-main-heading]').forEach(function(heading){
      let item=heading.nextElementSibling,visible=false;
      while(item && !item.hasAttribute('data-kun-main-heading')){
        if(item.matches('.kun143-primary-button')&&!item.hidden)visible=true;
        item=item.nextElementSibling;
      }
      heading.hidden=!visible;
    });
    nav.querySelectorAll('.nav-group').forEach(function(group){
      const hasSecondary=[...group.querySelectorAll('.nav-group-items > button[data-view]')].some(function(link){
        return link.dataset.kunPrimary!=='1'&&!link.hidden&&link.style.display!=='none'&&link.getAttribute('aria-hidden')!=='true';
      });
      group.classList.toggle('kun143-secondary-empty',!hasSecondary);
    });
    if(dock){const more=dock.querySelector('[data-kun-more]');if(more)more.setAttribute('aria-expanded',side?.classList.contains('mobile-open')?'true':'false');}
  }
  function schedule(){if(queued)return;queued=true;requestAnimationFrame(function(){queued=false;sync();});}
  function closeMenu(){
    side.classList.remove('mobile-open');
    document.body.classList.remove('kun143-menu-open');
    document.body.classList.remove('kun-mobile-nav-open');
    document.getElementById('mobileNavBack')?.classList.remove('show');
    document.getElementById('mobileMenuBtn')?.setAttribute('aria-expanded','false');
    schedule();
  }
  function openMenu(){
    side.classList.add('mobile-open');
    document.body.classList.add('kun143-menu-open','kun-mobile-nav-open');
    document.getElementById('mobileNavBack')?.classList.add('show');
    document.getElementById('mobileMenuBtn')?.setAttribute('aria-expanded','true');
    schedule();
  }
  function routeTo(view){
    if(!permitted(view))return;
    closeMenu();
    origin(view).click(); // use existing navigation/permission handlers
    schedule();
  }
  function button(view,label,cls){
    const el=document.createElement('button');
    el.type='button';
    el.className=cls;
    el.dataset.kunView=view;
    el.innerHTML=icons[view]+'<span>'+label+'</span>';
    el.setAttribute('aria-label',label);
    el.addEventListener('click',function(){routeTo(view);});
    return el;
  }
  function init(){
    if(document.getElementById('kun143PrimaryNav'))return;
    side=document.querySelector('.side');nav=side?.querySelector('.nav');if(!side||!nav)return;
    const brand=side.querySelector('.brand');
    if(brand){
      const img=document.createElement('img');img.src='/logo.png';img.alt='شعار كن أونلاين';img.className='kun143-brand-image';
      const labels=document.createElement('div');
      const b=document.createElement('strong');b.className='kun143-brand-name';b.textContent='كن أونلاين';
      const s=document.createElement('small');s.className='kun143-brand-sub';s.textContent='كل تفاصيل متجرك في مكان واحد';
      labels.append(b,s);brand.replaceChildren(img,labels);
    }
    primary=document.createElement('nav');primary.className='kun143-primary';primary.id='kun143PrimaryNav';primary.setAttribute('aria-label','الأقسام الأساسية');
    MAIN_GROUPS.forEach(function(group){
      const heading=document.createElement('div');
      heading.className='kun143-primary-label';heading.dataset.kunMainHeading='1';heading.textContent=group[0];
      primary.appendChild(heading);
      group[1].forEach(function(view){
        const item=NAV.find(function(n){return n[0]===view;});
        if(item)primary.appendChild(button(item[0],item[1],'kun143-primary-button'));
      });
    });
    details=document.createElement('details');details.className='kun143-secondary';details.id='kun143Secondary';
    const summary=document.createElement('summary');summary.textContent='الصفحات والعمليات الفرعية';
    details.appendChild(summary);details.appendChild(nav);
    if(brand){brand.after(primary);}else{side.prepend(primary);}
    primary.after(details);
    dock=document.createElement('nav');dock.className='kun143-bottom';dock.setAttribute('aria-label','التنقل السريع');
    [['dashboard','الرئيسية'],['orders','الطلبات'],['customer-service','خدمة العملاء'],['printing','الطباعة']].forEach(function(n){
      dock.appendChild(button(n[0],n[1],'kun143-dock-button'));
    });
    const more=document.createElement('button');more.type='button';more.dataset.kunMore='1';more.setAttribute('aria-label','المزيد من الأقسام');more.setAttribute('aria-expanded','false');
    more.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg><span>المزيد</span>';
    more.addEventListener('click',function(){side.classList.contains('mobile-open')?closeMenu():openMenu();});
    dock.appendChild(more);
    document.querySelector('.app')?.appendChild(dock);
    shade=document.createElement('div');shade.className='kun143-mobile-shade';shade.id='kun143MobileShade';
    shade.addEventListener('click',closeMenu);document.body.appendChild(shade);
    nav.addEventListener('click',function(e){if(e.target.closest('button[data-view]')){closeMenu();schedule();}},true);
    side.addEventListener('click',function(e){if(e.target.closest('.kun143-primary-button'))schedule();});
    const watch=new MutationObserver(function(records){
      if(records.some(function(r){return r.type==='childList'||(r.type==='attributes' && r.target.matches?.('button[data-view],.nav-group'));}))schedule();
    });
    watch.observe(nav,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','style','class','aria-hidden','disabled']});
    window.addEventListener('resize',function(){if(innerWidth>820)closeMenu();schedule();},{passive:true});
    document.addEventListener('keydown',function(e){if(e.key==='Escape'&&side.classList.contains('mobile-open'))closeMenu();});
    window.KunDesignShellV143={version:'145.0',sync:schedule,navigate:routeTo};
    sync();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
