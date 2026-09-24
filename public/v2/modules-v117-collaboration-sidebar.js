/* Kun Online v117.3 — make Team Collaboration a first-class top-level sidebar route on every viewport. */
(function(){
  'use strict';
  const VERSION='117.3';
  const CHAT_ICON='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16v11H9l-5 4V5Z"/><path d="M8 9h8M8 12h5"/></svg>';

  function createButton(nav){
    const button=document.createElement('button');
    button.type='button';
    button.dataset.view='collaboration';
    button.className='nav-standalone nav-collaboration';
    button.style.setProperty('--nav-accent','#4da3ff');
    button.innerHTML=`<span class="nav-item-icon" aria-hidden="true">${CHAT_ICON}</span><span class="nav-item-label">تواصل الفريق</span><span class="kc-nav-badge" hidden>0</span>`;
    const shortcuts=nav.querySelector('[data-kun-shortcuts-nav]');
    const dashboard=nav.querySelector(':scope > button[data-view="dashboard"]');
    const firstGroup=nav.querySelector(':scope > .nav-group');
    if(shortcuts?.parentElement===nav)shortcuts.insertAdjacentElement('afterend',button);
    else if(dashboard?.parentElement===nav)dashboard.insertAdjacentElement('afterend',button);
    else nav.insertBefore(button,firstGroup||nav.firstElementChild||null);
    return button;
  }

  function syncPermission(button){
    const permission=window.KunPermissionNavigationV51;
    if(!permission?.snapshot?.role||typeof permission.allowedView!=='function')return;
    const ok=Boolean(permission.allowedView('collaboration',permission.snapshot));
    button.hidden=!ok;
    button.style.display=ok?'':'none';
    button.setAttribute('aria-hidden',ok?'false':'true');
    button.tabIndex=ok?0:-1;
  }

  function normalize(button){
    const badge=button.querySelector('.kc-nav-badge');
    const unread=badge?.hidden?0:Number(badge?.textContent||0);
    button.classList.remove('nav-subitem');
    button.classList.add('nav-standalone','nav-collaboration');
    button.removeAttribute('data-nav-parent');
    button.dataset.navDecorated='v99';
    button.dataset.collaborationStandalone=VERSION;
    button.style.setProperty('--nav-accent','#4da3ff');
    button.innerHTML=`<span class="nav-item-icon" aria-hidden="true">${CHAT_ICON}</span><span class="nav-item-label">تواصل الفريق</span><span class="kc-nav-badge" ${unread?'':'hidden'}>${unread||0}</span>`;
    syncPermission(button);
  }

  function place(){
    const nav=document.querySelector('.nav');
    if(!nav)return false;
    let button=nav.querySelector('button[data-view="collaboration"]');
    if(!button)button=createButton(nav);
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
    return true;
  }

  function boot(){
    if(place())return;
    let attempts=0;
    const retry=()=>{if(place()||++attempts>=30)return;setTimeout(retry,100);};
    setTimeout(retry,0);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
  window.KunCollaborationSidebarV117={version:VERSION,place};
})();
