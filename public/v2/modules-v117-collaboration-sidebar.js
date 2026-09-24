/* Kun Online v117.1 — keep Team Collaboration visible as a first-class sidebar route on grouped/mobile navigation. */
(function(){
  'use strict';
  const VERSION='117.1';
  const CHAT_ICON='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16v11H9l-5 4V5Z"/><path d="M8 9h8M8 12h5"/></svg>';
  let observer=null;

  function normalize(button){
    if(!button)return false;
    const badge=button.querySelector('.kc-nav-badge');
    const unread=badge?.hidden?0:Number(badge?.textContent||0);
    button.classList.remove('nav-subitem');
    button.classList.add('nav-standalone','nav-collaboration');
    button.removeAttribute('data-nav-parent');
    button.dataset.navDecorated='v99';
    button.style.setProperty('--nav-accent','#4da3ff');
    button.innerHTML=`<span class="nav-item-icon" aria-hidden="true">${CHAT_ICON}</span><span class="nav-item-label">تواصل الفريق</span><span class="kc-nav-badge" ${unread?'':'hidden'}>${unread||0}</span>`;
    return true;
  }

  function place(){
    const nav=document.querySelector('.nav');
    const button=nav?.querySelector('button[data-view="collaboration"]');
    if(!nav||!button)return false;
    normalize(button);
    const shortcuts=nav.querySelector('[data-kun-shortcuts-nav]');
    const dashboard=nav.querySelector(':scope > button[data-view="dashboard"]');
    const firstGroup=nav.querySelector(':scope > .nav-group');
    if(button.parentElement!==nav){
      if(shortcuts?.parentElement===nav)shortcuts.insertAdjacentElement('afterend',button);
      else if(dashboard?.parentElement===nav)dashboard.insertAdjacentElement('afterend',button);
      else nav.insertBefore(button,firstGroup||null);
    }else if(shortcuts?.parentElement===nav&&shortcuts.nextElementSibling!==button){
      shortcuts.insertAdjacentElement('afterend',button);
    }else if(!shortcuts&&dashboard?.parentElement===nav&&dashboard.nextElementSibling!==button){
      dashboard.insertAdjacentElement('afterend',button);
    }
    document.documentElement.dataset.collaborationSidebar='ready';
    document.documentElement.dataset.collaborationSidebarVersion=VERSION;
    window.KunSidebarGroupsV90?.sync?.();
    return true;
  }

  function boot(){
    if(place())return;
    const nav=document.querySelector('.nav');
    if(nav&&typeof MutationObserver==='function'){
      observer=new MutationObserver(()=>{if(place()){observer?.disconnect();observer=null;}});
      observer.observe(nav,{childList:true,subtree:true});
    }
    [80,250,650,1400,2600].forEach(ms=>setTimeout(()=>{if(place()&&observer){observer.disconnect();observer=null;}},ms));
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
  window.KunCollaborationSidebarV117={version:VERSION,place};
})();
