/* Kun Online v150: real-data dashboard branding layer.
   UI-only. Never intercepts fetch, updates metrics, or bypasses original permissions. */
(function(){
  'use strict';
  if(window.KunDashboardBrandV150)return;
  const ACTIONS=[
    {view:'orders',label:'الطلبات',symbol:'▤'},
    {view:'printing',label:'الطباعة',symbol:'▣'},
    {view:'inventory',label:'المخزون',symbol:'⬡'},
    {view:'campaigns',label:'الحملات',symbol:'◈'}
  ];
  const $=(selector,root=document)=>root?.querySelector?.(selector)||null;
  const original=view=>$('.side .nav button[data-view="'+view+'"]');
  const permitted=view=>{
    const node=original(view);
    if(!node||node.hidden||node.disabled||node.getAttribute('aria-hidden')==='true'||node.style.display==='none')return false;
    for(let parent=node.parentElement;parent&&parent.classList?.contains('side')===false;parent=parent.parentElement){
      if(parent.hidden||parent.getAttribute?.('aria-hidden')==='true'||parent.style?.display==='none')return false;
    }
    return true;
  };
  const onDashboard=()=>!!$('.side .nav button[data-view="dashboard"].active')&&!!$('#root .v33-dashboard');
  function clickView(view){
    if(!permitted(view))return;
    const shell=window.KunDesignShellV143;
    if(typeof shell?.navigate==='function')shell.navigate(view);
    else original(view)?.click();
  }
  function syncActions(root){
    const group=$('.kun150-hero-actions',root);
    if(!group)return;
    group.replaceChildren();
    ACTIONS.forEach(item=>{
      if(!permitted(item.view))return;
      const button=document.createElement('button');
      button.type='button';
      button.className='kun150-action';
      button.setAttribute('aria-label','فتح '+item.label);
      button.dataset.kun150View=item.view;
      const icon=document.createElement('span');icon.className='kun150-action-symbol';icon.setAttribute('aria-hidden','true');icon.textContent=item.symbol;
      const name=document.createElement('span');name.textContent=item.label;
      button.append(icon,name);
      button.addEventListener('click',()=>clickView(item.view));
      group.appendChild(button);
    });
    const tools=group.closest('.kun150-hero-tools');
    if(tools)tools.hidden=group.children.length===0;
  }
  function decorate(){
    if(!onDashboard())return;
    const root=$('#root'),dashboard=$('.v33-dashboard',root);
    // Never enhance a loading skeleton: wait until live dashboard data has rendered.
    if(!$('#root [data-dashboard-finance-top="126"]'))return;
    const hero=$('.dash-hero',dashboard),side=$('.dash-hero-side',hero),heading=$('.dash-hero > div:first-child',dashboard);
    if(!hero||!heading)return;
    hero.classList.add('kun150-branded-hero');
    if(side&&!$('.kun150-hero-logo',side)){
      const logo=document.createElement('img');
      logo.src='/logo.png';
      logo.alt='شعار كن أونلاين';
      logo.className='kun150-hero-logo';
      logo.loading='eager';
      logo.width=86;logo.height=86;
      side.insertBefore(logo,side.firstChild);
    }
    const eyebrow=$('.dash-eyebrow',heading);
    if(eyebrow&&eyebrow.textContent!=='نظرة شاملة على أداء متجرك')eyebrow.textContent='نظرة شاملة على أداء متجرك';
    if(!$('.kun150-hero-tools',heading)){
      const tools=document.createElement('div');tools.className='kun150-hero-tools';
      const copy=document.createElement('span');copy.className='kun150-hero-status';
      copy.textContent='مؤشرات حسب المتجر والفترة المحددين';
      const actions=document.createElement('div');actions.className='kun150-hero-actions';
      actions.setAttribute('aria-label','اختصارات الأقسام المسموح بها');
      tools.append(copy,actions);
      heading.appendChild(tools);
    }
    const actions=$('.kun150-hero-actions',heading);
    const signature=ACTIONS.filter(a=>permitted(a.view)).map(a=>a.view).join('|');
    if(actions?.dataset.signature!==signature){syncActions(heading);actions.dataset.signature=signature;}
  }
  let timer=0;
  function schedule(){
    clearTimeout(timer);
    timer=setTimeout(decorate,120);
  }
  function start(){
    if(!$('#root'))return;
    const root=$('#root');
    const watch=new MutationObserver(records=>{
      if(records.some(r=>r.type==='childList' && [...r.addedNodes].some(n=>n.nodeType===1 && (n.matches?.('.v33-dashboard,.dash-hero,.dash-f126')||n.querySelector?.('.v33-dashboard,.dash-hero,[data-dashboard-finance-top]')))))schedule();
    });
    watch.observe(root,{childList:true,subtree:true});
    const nav=$('.side .nav');
    if(nav){
      new MutationObserver(schedule).observe(nav,{subtree:true,attributes:true,attributeFilter:['hidden','disabled','style','aria-hidden','class']});
    }
    document.addEventListener('click',event=>{
      if(event.target.closest('.kun143-primary-button,.kun143-dock-button,.side .nav button[data-view],.dash-range-btn'))schedule();
    },{passive:true});
    window.KunDashboardBrandV150={version:'150.0',sync:schedule};
    schedule();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
