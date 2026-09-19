/* Kun Online v90 — consolidate related sidebar routes into expandable groups. */
(function(){
  'use strict';

  const STORAGE_KEY='kun.sidebar.open-group.v90';
  const GROUPS=[
    {
      id:'orders',label:'الطلبات وخدمة العملاء',
      items:[
        ['orders','الطلبات'],
        ['customer-service','خدمة العملاء'],
        ['post-shipping','ما بعد الشحن'],
        ['returns-exchanges','المرتجعات والاستبدالات']
      ]
    },
    {
      id:'customers',label:'العملاء والتواصل',
      items:[
        ['customers','إدارة العملاء CRM'],
        ['inbox','صندوق الرسائل']
      ]
    },
    {
      id:'catalog',label:'المنتجات والمخزون',
      items:[
        ['products','المنتجات'],
        ['inventory','المخزون']
      ]
    },
    {
      id:'procurement',label:'المشتريات والموردون',
      items:[
        ['suppliers','الموردون'],
        ['procurement','المشتريات'],
        ['supplier-finance','حسابات الموردين']
      ]
    },
    {
      id:'shipping',label:'الشحن والتحصيل',
      items:[
        ['shipping','الشحن'],
        ['cod','تسويات COD']
      ]
    },
    {
      id:'marketing',label:'التسويق',
      items:[
        ['marketing','نظرة عامة وأداء الإعلانات'],
        ['campaigns','الحملات الإعلانية'],
        ['ad-studio','AI Ad Studio']
      ]
    },
    {
      id:'finance',label:'المالية والتقارير',
      items:[
        ['finance','المالية'],
        ['profit','تحليل الربحية'],
        ['analytics','التحليلات والتقارير'],
        ['wallet','المحفظة']
      ]
    },
    {
      id:'ai',label:'الذكاء والأتمتة',
      items:[
        ['intelligence','مركز الذكاء'],
        ['ai','kun AI'],
        ['automation','الأتمتة']
      ]
    },
    {
      id:'operations',label:'المتاجر والتشغيل',
      items:[
        ['stores','المتاجر والفروع'],
        ['store-access','صلاحيات الفروع'],
        ['pos','نقطة البيع POS'],
        ['onboarding','بدء الاستخدام'],
        ['readiness','جاهزية النظام'],
        ['ops','مركز التشغيل']
      ]
    },
    {
      id:'system',label:'النظام والإدارة',
      items:[
        ['integrations','مركز التكاملات'],
        ['access','الفريق والصلاحيات'],
        ['approvals','مركز الموافقات'],
        ['audit','سجل النشاط'],
        ['control','الحساب والتكاملات'],
        ['settings','الإعدادات'],
        ['admin-clients','Kun Admin']
      ]
    }
  ];

  const isRouteVisible=button=>button&&!button.hidden&&button.style.display!=='none';

  function createGroup(def,buttons){
    const available=def.items.filter(([view])=>buttons.has(view));
    if(!available.length)return null;

    const group=document.createElement('div');
    group.className='nav-group';
    group.dataset.navGroup=def.id;

    const toggle=document.createElement('button');
    toggle.type='button';
    toggle.className='nav-group-toggle';
    toggle.setAttribute('aria-expanded','false');
    toggle.setAttribute('aria-controls',`nav-group-${def.id}`);
    toggle.innerHTML=`<span class="nav-group-label"></span><span class="nav-group-chevron" aria-hidden="true">‹</span>`;
    toggle.querySelector('.nav-group-label').textContent=def.label;

    const items=document.createElement('div');
    items.className='nav-group-items';
    items.id=`nav-group-${def.id}`;

    available.forEach(([view,label])=>{
      const button=buttons.get(view);
      button.textContent=label;
      button.classList.add('nav-subitem');
      button.dataset.navParent=def.id;
      items.appendChild(button);
      buttons.delete(view);
    });

    toggle.addEventListener('click',event=>{
      event.preventDefault();
      event.stopPropagation();
      setOpen(group,!group.classList.contains('is-open'),true);
    });

    items.addEventListener('click',event=>{
      const route=event.target.closest('button[data-view]');
      if(!route)return;
      setOpen(group,true,true);
      setTimeout(syncActive,0);
    },true);

    group.append(toggle,items);
    return group;
  }

  function setOpen(group,open,exclusive){
    const nav=group?.closest('.nav');
    if(!group||!nav)return;
    if(open&&exclusive){
      nav.querySelectorAll('.nav-group.is-open').forEach(other=>{
        if(other!==group){
          other.classList.remove('is-open');
          other.querySelector(':scope > .nav-group-toggle')?.setAttribute('aria-expanded','false');
        }
      });
    }
    group.classList.toggle('is-open',Boolean(open));
    group.querySelector(':scope > .nav-group-toggle')?.setAttribute('aria-expanded',open?'true':'false');
    try{
      if(open)localStorage.setItem(STORAGE_KEY,group.dataset.navGroup||'');
      else if(localStorage.getItem(STORAGE_KEY)===group.dataset.navGroup)localStorage.removeItem(STORAGE_KEY);
    }catch(_){ }
  }

  function syncVisibility(){
    const nav=document.querySelector('.nav.kun-nav-grouped');
    if(!nav)return;
    nav.querySelectorAll('.nav-group').forEach(group=>{
      const routes=[...group.querySelectorAll('.nav-group-items>button[data-view]')];
      const hasVisible=routes.some(isRouteVisible);
      group.hidden=!hasVisible;
      if(!hasVisible)setOpen(group,false,false);
    });
  }

  function syncActive(){
    const nav=document.querySelector('.nav.kun-nav-grouped');
    if(!nav)return;
    const active=nav.querySelector('button[data-view].active');
    nav.querySelectorAll('.nav-group').forEach(group=>group.classList.remove('has-active'));
    if(!active)return;
    const group=active.closest('.nav-group');
    if(group){
      group.classList.add('has-active');
      setOpen(group,true,true);
    }
  }

  function init(){
    const nav=document.querySelector('.nav');
    if(!nav||nav.dataset.groupedNavigation==='v90')return;

    const original=[...nav.querySelectorAll(':scope > button[data-view]')];
    if(!original.length)return;
    const buttons=new Map(original.map(button=>[button.dataset.view,button]));
    const fragment=document.createDocumentFragment();

    const dashboard=buttons.get('dashboard');
    if(dashboard){
      dashboard.classList.add('nav-standalone');
      dashboard.textContent='الداشبورد';
      fragment.appendChild(dashboard);
      buttons.delete('dashboard');
    }

    GROUPS.forEach(def=>{
      const group=createGroup(def,buttons);
      if(group)fragment.appendChild(group);
    });

    if(buttons.size){
      const fallback={id:'other',label:'أقسام أخرى',items:[...buttons.keys()].map(view=>[view,buttons.get(view)?.textContent?.trim()||view])};
      const group=createGroup(fallback,buttons);
      if(group)fragment.appendChild(group);
    }

    nav.replaceChildren(fragment);
    nav.classList.add('kun-nav-grouped');
    nav.dataset.groupedNavigation='v90';

    let queued=false;
    const queueSync=()=>{
      if(queued)return;
      queued=true;
      requestAnimationFrame(()=>{
        queued=false;
        syncVisibility();
        syncActive();
      });
    };

    const observer=new MutationObserver(records=>{
      if(records.some(record=>record.target?.matches?.('button[data-view]')))queueSync();
    });
    observer.observe(nav,{subtree:true,attributes:true,attributeFilter:['hidden','style','class']});

    nav.addEventListener('click',event=>{
      if(event.target.closest('button[data-view]'))setTimeout(queueSync,0);
    });

    syncVisibility();
    const active=nav.querySelector('button[data-view].active');
    if(active)syncActive();
    else{
      try{
        const saved=localStorage.getItem(STORAGE_KEY);
        if(saved){
          const group=nav.querySelector(`.nav-group[data-nav-group="${CSS.escape(saved)}"]`);
          if(group&&!group.hidden)setOpen(group,true,true);
        }
      }catch(_){ }
    }

    window.KunSidebarGroupsV90={
      groups:GROUPS,
      sync:queueSync,
      open:id=>{
        const group=nav.querySelector(`.nav-group[data-nav-group="${CSS.escape(String(id||''))}"]`);
        if(group)setOpen(group,true,true);
      },
      version:'90.0'
    };
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();
