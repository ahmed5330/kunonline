/* Kun Online v92 — visual shortcut board for the most-used Commerce OS areas. */
(function(){
  'use strict';
  if(window.KunShortcutBoardV92)return;

  const GROUPS=[
    {
      id:'daily',title:'التشغيل اليومي',subtitle:'أسرع وصول للطلبات والعملاء والمتابعة',
      items:[
        ['orders','الطلبات','إدارة ومتابعة كل الطلبات','receipt','blue'],
        ['customer-service','خدمة العملاء','التأكيد والمكالمات ومحاولات التواصل','headset','cyan'],
        ['post-shipping','ما بعد الشحن','متابعة الشحن والتسليم والتحصيل','truck','teal'],
        ['returns-exchanges','المرتجعات والاستبدالات','إدارة المرتجعات والاستبدالات','return','rose'],
        ['customers','العملاء CRM','ملف العميل وتاريخه وطلباته','users','violet'],
        ['inbox','صندوق الرسائل','الوصول السريع للتواصل والرسائل','message','indigo']
      ]
    },
    {
      id:'stock',title:'المنتجات والمخزون والشحن',subtitle:'إدارة المنتج من المخزون حتى شركة الشحن',
      items:[
        ['products','المنتجات','الكتالوج والأسعار والمتغيرات','box','amber'],
        ['inventory','المخزون','الكميات والدفعات والتنبيهات','warehouse','emerald'],
        ['shipping','الشحن','إدارة شركات الشحن والبوالص','package','sky'],
        ['cod','تسويات COD','التحصيل ومطابقة مستحقات الشحن','cash','green'],
        ['suppliers','الموردون','بيانات الموردين والتعاملات','supplier','orange'],
        ['procurement','المشتريات','أوامر الشراء والتوريد','cart','yellow']
      ]
    },
    {
      id:'growth',title:'التسويق والمالية',subtitle:'متابعة النمو والإعلانات والربحية من مكان واحد',
      items:[
        ['marketing','أداء الإعلانات','نظرة عامة على التسويق والأداء','megaphone','pink'],
        ['campaigns','الحملات الإعلانية','تحليل الحملات والمجموعات والإعلانات','target','red'],
        ['finance','المالية','الإيرادات والمصروفات والحركة المالية','calculator','slate'],
        ['profit','تحليل الربحية','صافي الربح والهوامش والتكاليف','trend','lime'],
        ['analytics','التحليلات والتقارير','مؤشرات الأداء والتقارير','chart','purple'],
        ['wallet','المحفظة','الرصيد والحركات والخصومات','wallet','fuchsia']
      ]
    },
    {
      id:'management',title:'الإدارة والذكاء',subtitle:'إدارة المتاجر والفريق والتكاملات والأتمتة',
      items:[
        ['stores','المتاجر والفروع','التبديل وإدارة المتاجر والفروع','store','blue'],
        ['integrations','مركز التكاملات','Easy Orders وJ&T وMeta وباقي الربط','plug','cyan'],
        ['access','الفريق والصلاحيات','الموظفون والأدوار والصلاحيات','shield','violet'],
        ['ops','مركز التشغيل','المهام والعمليات وحالة التنفيذ','gear','orange'],
        ['automation','الأتمتة','تشغيل الإجراءات والـWorkflows تلقائيًا','bolt','amber'],
        ['ai','kun AI','الذكاء والمساعدات والتحليل','spark','indigo']
      ]
    }
  ];

  const ICONS={
    receipt:'<path d="M6 3h12v18l-2.5-1.5L13 21l-2.5-1.5L8 21l-2-1.2V3Z"/><path d="M9 8h6M9 12h6M9 16h4"/>',
    headset:'<path d="M4 13v-1a8 8 0 0 1 16 0v1"/><path d="M4 13h3v6H5a2 2 0 0 1-2-2v-2a2 2 0 0 1 1-2ZM20 13h-3v6h2a2 2 0 0 0 2-2v-2a2 2 0 0 0-1-2Z"/><path d="M17 19c0 1.1-1.8 2-4 2"/>',
    truck:'<path d="M3 6h11v10H3z"/><path d="M14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',
    return:'<path d="M9 7H5v-4"/><path d="M5 7a8 8 0 1 1-1 9"/><path d="m5 7 4-4"/>',
    users:'<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2"/><circle cx="17" cy="9" r="2"/><path d="M16 14a5 5 0 0 1 5 5v1"/>',
    message:'<path d="M4 5h16v11H9l-5 4V5Z"/><path d="M8 9h8M8 12h5"/>',
    box:'<path d="m12 3 9 4.5-9 4.5-9-4.5L12 3Z"/><path d="M3 7.5V17l9 4 9-4V7.5M12 12v9"/>',
    warehouse:'<path d="M3 10 12 4l9 6v10H3V10Z"/><path d="M7 20v-6h10v6M7 10h2M11 10h2M15 10h2"/>',
    package:'<path d="M4 7 12 3l8 4v10l-8 4-8-4V7Z"/><path d="m4 7 8 4 8-4M12 11v10M8 5l8 4"/>',
    cash:'<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M7 9H5v2M17 15h2v-2"/>',
    supplier:'<path d="M4 20V8l8-5 8 5v12"/><path d="M8 20v-7h8v7M9 9h6"/>',
    cart:'<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M3 4h2l2.4 10.2a2 2 0 0 0 2 1.6h7.8a2 2 0 0 0 2-1.6L21 8H7"/>',
    megaphone:'<path d="m4 13 12-5v8L4 11v2Z"/><path d="M7 13v6h4l1-4M18 9c2 1 2 5 0 6"/>',
    target:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/><path d="m14 10 6-6"/>',
    calculator:'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 11h1M12 11h1M16 11h1M8 15h1M12 15h1M16 15h1M8 18h1M12 18h5"/>',
    trend:'<path d="M4 17 10 11l4 4 6-8"/><path d="M15 7h5v5"/>',
    chart:'<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    wallet:'<path d="M4 6h14a2 2 0 0 1 2 2v11H4a2 2 0 0 1-2-2V6a3 3 0 0 1 3-3h12"/><path d="M16 11h5v4h-5a2 2 0 1 1 0-4Z"/>',
    store:'<path d="M4 9v11h16V9"/><path d="M3 9 5 4h14l2 5"/><path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0M9 20v-6h6v6"/>',
    plug:'<path d="M8 3v5M16 3v5M6 8h12v2a6 6 0 0 1-6 6v5"/><path d="M9 21h6"/>',
    shield:'<path d="M12 3 20 6v5c0 5-3.4 8.5-8 10-4.6-1.5-8-5-8-10V6l8-3Z"/><path d="m9 12 2 2 4-5"/>',
    gear:'<circle cx="12" cy="12" r="3"/><path d="M19 13.5v-3l-2-.7-.8-1.9.9-1.9-2.1-2.1-1.9.9-1.9-.8L10.5 2h-3l-.7 2-1.9.8-1.9-.9L.9 6l.9 1.9-.8 1.9-2 .7v3l2 .7.8 1.9-.9 1.9L3 20.1l1.9-.9 1.9.8.7 2h3l.7-2 1.9-.8 1.9.9 2.1-2.1-.9-1.9.8-1.9 2-.7Z" transform="translate(2 -1) scale(.83)"/>',
    bolt:'<path d="m13 2-8 12h7l-1 8 8-12h-7l1-8Z"/>',
    spark:'<path d="m12 3 1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3Z"/><path d="m19 14 .8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14ZM5 14l.7 1.8L7.5 16.5l-1.8.7L5 19l-.7-1.8-1.8-.7 1.8-.7L5 14Z"/>'
  };

  const routeButton=view=>document.querySelector(`.nav button[data-view="${CSS.escape(view)}"]`);
  const isRouteAvailable=view=>{const button=routeButton(view);return Boolean(button&&!button.hidden&&button.style.display!=='none'&&button.getAttribute('aria-hidden')!=='true');};
  const active=()=>Boolean(document.querySelector('[data-kun-shortcuts-nav].active'));
  const root=()=>document.getElementById('root');
  const svg=name=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]||ICONS.box}</svg>`;

  function style(){
    if(document.getElementById('kunShortcutBoardV92Style'))return;
    const node=document.createElement('style');node.id='kunShortcutBoardV92Style';node.textContent=`
      .kun92-shortcuts-nav{position:relative}.kun92-shortcuts-nav::after{content:'⚡';font-size:12px;margin-inline-start:7px;opacity:.72}
      .kun92-shortcut-page{display:grid;gap:22px;direction:rtl}.kun92-shortcut-hero{display:flex;align-items:center;gap:14px;padding:4px 2px 0}.kun92-shortcut-hero-icon{width:52px;height:52px;border-radius:17px;display:grid;place-items:center;background:linear-gradient(135deg,#eff6ff,#eef2ff);color:#2563eb;border:1px solid #dbeafe;box-shadow:0 8px 24px rgba(37,99,235,.08);flex:none}.kun92-shortcut-hero-icon svg{width:27px;height:27px}.kun92-shortcut-title{font-size:26px;font-weight:800;line-height:1.2;color:var(--text,#0f172a)}.kun92-shortcut-sub{margin-top:5px;font-size:13px;color:var(--muted,#64748b)}
      .kun92-shortcut-section{display:grid;gap:11px}.kun92-shortcut-section-head{display:flex;align-items:end;justify-content:space-between;gap:10px}.kun92-shortcut-section-title{font-size:16px;font-weight:800;color:var(--text,#0f172a)}.kun92-shortcut-section-sub{font-size:11px;color:var(--muted,#64748b);margin-top:2px}.kun92-shortcut-count{font-size:10px;font-weight:800;padding:4px 8px;border-radius:999px;background:#f8fafc;border:1px solid #e2e8f0;color:#64748b;white-space:nowrap}
      .kun92-shortcut-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:11px}.kun92-shortcut-card{appearance:none;border:1px solid var(--kun92-border,#dbeafe);background:linear-gradient(145deg,var(--kun92-bg,#eff6ff),#fff 78%);border-radius:18px;min-height:146px;padding:15px;text-align:right;font:inherit;color:inherit;display:flex;flex-direction:column;gap:10px;cursor:pointer;position:relative;overflow:hidden;transition:transform .16s ease,box-shadow .16s ease,border-color .16s ease}.kun92-shortcut-card::before{content:'';position:absolute;width:82px;height:82px;border-radius:50%;background:var(--kun92-accent,#2563eb);opacity:.045;left:-22px;bottom:-24px}.kun92-shortcut-card:hover{transform:translateY(-2px);border-color:color-mix(in srgb,var(--kun92-accent,#2563eb) 42%,#fff);box-shadow:0 12px 30px rgba(15,23,42,.09)}.kun92-shortcut-card:focus-visible{outline:3px solid color-mix(in srgb,var(--kun92-accent,#2563eb) 28%,transparent);outline-offset:2px}.kun92-shortcut-icon{width:43px;height:43px;border-radius:13px;display:grid;place-items:center;background:#fff;color:var(--kun92-accent,#2563eb);box-shadow:0 5px 14px rgba(15,23,42,.07);border:1px solid rgba(255,255,255,.8)}.kun92-shortcut-icon svg{width:23px;height:23px}.kun92-shortcut-name{font-size:14px;font-weight:800;line-height:1.35;color:#0f172a}.kun92-shortcut-desc{font-size:10.5px;line-height:1.55;color:#64748b;flex:1}.kun92-shortcut-open{display:flex;align-items:center;gap:5px;font-size:10px;font-weight:800;color:var(--kun92-accent,#2563eb)}.kun92-shortcut-open span{font-size:15px;line-height:1;transition:transform .16s ease}.kun92-shortcut-card:hover .kun92-shortcut-open span{transform:translateX(-2px)}
      .kun92-tone-blue{--kun92-bg:#eff6ff;--kun92-border:#dbeafe;--kun92-accent:#2563eb}.kun92-tone-cyan{--kun92-bg:#ecfeff;--kun92-border:#cffafe;--kun92-accent:#0891b2}.kun92-tone-teal{--kun92-bg:#f0fdfa;--kun92-border:#ccfbf1;--kun92-accent:#0f766e}.kun92-tone-rose{--kun92-bg:#fff1f2;--kun92-border:#ffe4e6;--kun92-accent:#e11d48}.kun92-tone-violet{--kun92-bg:#f5f3ff;--kun92-border:#ede9fe;--kun92-accent:#7c3aed}.kun92-tone-indigo{--kun92-bg:#eef2ff;--kun92-border:#e0e7ff;--kun92-accent:#4f46e5}.kun92-tone-amber{--kun92-bg:#fffbeb;--kun92-border:#fef3c7;--kun92-accent:#d97706}.kun92-tone-emerald{--kun92-bg:#ecfdf5;--kun92-border:#d1fae5;--kun92-accent:#059669}.kun92-tone-sky{--kun92-bg:#f0f9ff;--kun92-border:#e0f2fe;--kun92-accent:#0284c7}.kun92-tone-green{--kun92-bg:#f0fdf4;--kun92-border:#dcfce7;--kun92-accent:#16a34a}.kun92-tone-orange{--kun92-bg:#fff7ed;--kun92-border:#ffedd5;--kun92-accent:#ea580c}.kun92-tone-yellow{--kun92-bg:#fefce8;--kun92-border:#fef9c3;--kun92-accent:#ca8a04}.kun92-tone-pink{--kun92-bg:#fdf2f8;--kun92-border:#fce7f3;--kun92-accent:#db2777}.kun92-tone-red{--kun92-bg:#fef2f2;--kun92-border:#fee2e2;--kun92-accent:#dc2626}.kun92-tone-slate{--kun92-bg:#f8fafc;--kun92-border:#e2e8f0;--kun92-accent:#475569}.kun92-tone-lime{--kun92-bg:#f7fee7;--kun92-border:#ecfccb;--kun92-accent:#65a30d}.kun92-tone-purple{--kun92-bg:#faf5ff;--kun92-border:#f3e8ff;--kun92-accent:#9333ea}.kun92-tone-fuchsia{--kun92-bg:#fdf4ff;--kun92-border:#fae8ff;--kun92-accent:#c026d3}
      .kun92-shortcut-empty{padding:25px;border:1px dashed #cbd5e1;border-radius:16px;text-align:center;color:#64748b;background:#f8fafc}
      @media(max-width:1280px){.kun92-shortcut-grid{grid-template-columns:repeat(4,minmax(0,1fr))}}@media(max-width:900px){.kun92-shortcut-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.kun92-shortcut-title{font-size:23px}}@media(max-width:680px){.kun92-shortcut-page{gap:18px}.kun92-shortcut-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.kun92-shortcut-card{min-height:137px;padding:13px;border-radius:16px}.kun92-shortcut-desc{font-size:10px}.kun92-shortcut-hero{align-items:flex-start}.kun92-shortcut-hero-icon{width:46px;height:46px;border-radius:14px}.kun92-shortcut-title{font-size:21px}.kun92-shortcut-section-head{align-items:flex-start}}@media(max-width:390px){.kun92-shortcut-grid{grid-template-columns:1fr}.kun92-shortcut-card{min-height:126px}}
    `;document.head.appendChild(node);
  }

  function ensureNavButton(){
    const nav=document.querySelector('.nav');if(!nav)return null;
    let button=nav.querySelector('[data-kun-shortcuts-nav]');
    if(!button){button=document.createElement('button');button.type='button';button.className='nav-standalone kun92-shortcuts-nav';button.dataset.kunShortcutsNav='1';button.textContent='لوحة الاختصارات';button.setAttribute('aria-label','لوحة الاختصارات');}
    const dashboard=nav.querySelector('button[data-view="dashboard"]');
    if(dashboard&&dashboard.nextElementSibling!==button)dashboard.after(button);else if(!button.isConnected)nav.prepend(button);
    return button;
  }

  function closeMobileNav(){const side=document.querySelector('.side');if(side?.classList.contains('mobile-open'))side.classList.remove('mobile-open');window.KunMobileUXV88?.syncNavLock?.();}

  function card(item){
    const [route,name,description,icon,tone]=item;
    return `<button type="button" class="kun92-shortcut-card kun92-tone-${tone}" data-kun-shortcut-route="${route}" aria-label="فتح ${name}"><span class="kun92-shortcut-icon">${svg(icon)}</span><span class="kun92-shortcut-name">${name}</span><span class="kun92-shortcut-desc">${description}</span><span class="kun92-shortcut-open">فتح القسم <span aria-hidden="true">←</span></span></button>`;
  }

  function render(){
    style();const host=root(),navButton=ensureNavButton();if(!host||!navButton)return false;
    document.querySelectorAll('.nav button.active').forEach(button=>button.classList.remove('active'));
    document.querySelectorAll('.nav-group.has-active').forEach(group=>group.classList.remove('has-active'));
    navButton.classList.add('active');
    const groups=GROUPS.map(group=>({...group,items:group.items.filter(item=>isRouteAvailable(item[0]))})).filter(group=>group.items.length);
    const total=groups.reduce((sum,group)=>sum+group.items.length,0);
    host.innerHTML=`<div class="kun92-shortcut-page" data-kun-shortcut-board="1"><div class="kun92-shortcut-hero"><div class="kun92-shortcut-hero-icon">${svg('bolt')}</div><div><div class="kun92-shortcut-title">لوحة الاختصارات</div><div class="kun92-shortcut-sub">أهم خصائص كن أونلاين في مكان واحد — افتح القسم المطلوب مباشرة بدون البحث داخل القوائم.</div></div></div>${groups.length?groups.map(group=>`<section class="kun92-shortcut-section" data-kun-shortcut-group="${group.id}"><div class="kun92-shortcut-section-head"><div><div class="kun92-shortcut-section-title">${group.title}</div><div class="kun92-shortcut-section-sub">${group.subtitle}</div></div><span class="kun92-shortcut-count">${group.items.length} اختصار</span></div><div class="kun92-shortcut-grid">${group.items.map(card).join('')}</div></section>`).join(''):'<div class="kun92-shortcut-empty">لا توجد أقسام متاحة ضمن صلاحيات الحساب الحالي.</div>'}</div>`;
    host.querySelectorAll('[data-kun-shortcut-route]').forEach(button=>button.addEventListener('click',()=>openRoute(button.dataset.kunShortcutRoute)));
    closeMobileNav();
    document.documentElement.dataset.kunShortcutBoard='v92-ready';
    window.dispatchEvent(new CustomEvent('kun:shortcut-board-opened',{detail:{count:total}}));
    return true;
  }

  function openRoute(route){
    const button=routeButton(String(route||''));
    if(!button||button.hidden||button.style.display==='none'||button.getAttribute('aria-hidden')==='true'){window.showToast?.('القسم غير متاح ضمن صلاحيات حسابك');return false;}
    ensureNavButton()?.classList.remove('active');
    button.click();closeMobileNav();return true;
  }

  function installRenderGuard(){
    const upstream=window.render;
    if(typeof upstream!=='function'||upstream.__kunShortcutBoardGuard)return false;
    const wrapped=function(...args){if(active()&&root()?.querySelector('[data-kun-shortcut-board]'))return;return upstream.apply(this,args);};
    Object.defineProperty(wrapped,'__kunShortcutBoardGuard',{value:true});
    Object.defineProperty(wrapped,'__kunShortcutBoardUpstream',{value:upstream});
    window.render=wrapped;return true;
  }

  function boot(){
    style();ensureNavButton();installRenderGuard();
    document.addEventListener('click',event=>{
      const shortcut=event.target.closest?.('[data-kun-shortcuts-nav]');
      if(shortcut){event.preventDefault();event.stopImmediatePropagation();render();return;}
      const route=event.target.closest?.('.nav button[data-view]');
      if(route)ensureNavButton()?.classList.remove('active');
    },true);
    const nav=document.querySelector('.nav');
    if(nav){let queued=false;const sync=()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;const before=ensureNavButton();if(active()&&before&&root()?.querySelector('[data-kun-shortcut-board]'))render();});};const observer=new MutationObserver(records=>{if(records.some(record=>record.type==='childList'||record.target?.matches?.('button[data-view]')))sync();});observer.observe(nav,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','style','aria-hidden']});}
    setTimeout(()=>{ensureNavButton();installRenderGuard();},400);
  }

  window.KunShortcutBoardV92={version:'92.0',groups:GROUPS,render,openRoute,ensureNavButton,installRenderGuard};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
