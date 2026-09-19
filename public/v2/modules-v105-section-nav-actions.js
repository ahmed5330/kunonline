/* Kun Online v105 — compact Back/Previous controls beside the section refresh action. */
(function(){
  'use strict';
  if(window.KunSectionNavActionsV105)return;

  const root=document.getElementById('root');
  if(!root)return;

  let seq=0,scheduled=false,syncing=false;
  const exactLabels=new Set(['رجوع','الرجوع','عودة','السابق','الخطوة السابقة','رجوع للقائمة','العودة للقائمة']);

  function ensureStyle(){
    if(document.getElementById('kunSectionNavActionsV105Style'))return;
    const style=document.createElement('style');
    style.id='kunSectionNavActionsV105Style';
    style.textContent=`
      .kun-section-nav-actions{display:inline-flex;align-items:center;gap:6px;margin-inline-start:18px;padding-inline-start:14px;border-inline-start:1px solid rgba(148,163,184,.32);flex:none}
      .kun-section-nav-mini{min-height:30px!important;height:30px!important;padding:4px 9px!important;font-size:12px!important;line-height:1!important;border-radius:8px!important;gap:4px!important;white-space:nowrap}
      .kun-section-nav-mini .kun-section-nav-icon{font-size:13px;line-height:1;opacity:.78}
      .kun-section-nav-origin{display:none!important}
      @media(max-width:640px){.kun-section-nav-actions{margin-inline-start:12px;padding-inline-start:10px;gap:5px}.kun-section-nav-mini{height:28px!important;min-height:28px!important;padding:3px 7px!important;font-size:11px!important}}
    `;
    document.head.appendChild(style);
  }

  function normalizedText(node){
    return String(node?.textContent||'').replace(/[←→↩↪⟵⟶‹›«»]/g,'').replace(/\s+/g,' ').trim();
  }

  function isNavOrigin(node){
    if(!node||node.dataset?.kunSectionNavProxy==='1'||node.closest?.('.kun-section-nav-actions'))return false;
    if(node.matches?.('[data-kun-section-reload],.kun-section-reload'))return false;
    const text=normalizedText(node);
    if(exactLabels.has(text))return true;
    const ident=`${node.id||''} ${node.className||''}`.toLowerCase();
    return /(^|[\s_-])(back|prev|previous)([\s_-]|$)/.test(ident);
  }

  function head(){
    const direct=[...root.children];
    for(const child of direct)if(child.matches?.('.page-head,.dash-hero'))return child;
    for(const child of direct){const nested=[...child.children].find(node=>node.matches?.('.page-head,.dash-hero'));if(nested)return nested;}
    return root.querySelector('.page-head,.dash-hero');
  }

  function reloadButton(container){
    if(!container)return null;
    return [...container.querySelectorAll('button')].find(button=>button.matches?.('[data-kun-section-reload],.kun-section-reload')||/reload|refresh/i.test(String(button.id||''))||['تحديث','إعادة تحميل','إعادة المحاولة'].includes(normalizedText(button)))||null;
  }

  function origins(){
    return [...root.querySelectorAll('button,a,[role="button"]')].filter(isNavOrigin).filter(node=>!node.closest?.('#drawer'));
  }

  function originId(node){
    if(!node.dataset.kunSectionNavOriginId)node.dataset.kunSectionNavOriginId=`kun-nav-origin-${++seq}`;
    return node.dataset.kunSectionNavOriginId;
  }

  function iconFor(text){return /سابق/.test(text)?'‹':'↩';}

  function proxyFor(node){
    const text=normalizedText(node)||'رجوع';
    const button=document.createElement('button');
    button.type='button';
    button.className='btn soft kun-section-nav-mini';
    button.dataset.kunSectionNavProxy='1';
    button.dataset.kunSectionNavOrigin=originId(node);
    button.title=text;
    button.setAttribute('aria-label',text);
    button.disabled=Boolean(node.disabled)||node.getAttribute('aria-disabled')==='true';
    button.innerHTML=`<span class="kun-section-nav-icon" aria-hidden="true">${iconFor(text)}</span><span>${text}</span>`;
    button.addEventListener('click',event=>{
      event.preventDefault();event.stopPropagation();
      if(node.isConnected&&!node.disabled)node.click();
    });
    return button;
  }

  function sync(){
    if(syncing)return;
    syncing=true;
    try{
      ensureStyle();
      window.KunSectionReloadV57?.ensure?.();
      const pageHead=head();
      if(!pageHead)return;
      const list=origins();
      let group=pageHead.querySelector(':scope > .kun-section-nav-actions');
      if(!list.length){group?.remove();return;}

      const signature=list.map(node=>`${originId(node)}:${normalizedText(node)}:${node.disabled?'1':'0'}`).join('|');
      list.forEach(node=>node.classList.add('kun-section-nav-origin'));
      if(group?.dataset.signature===signature)return;
      if(!group){group=document.createElement('div');group.className='kun-section-nav-actions';group.setAttribute('aria-label','التنقل داخل القسم');}
      group.dataset.signature=signature;
      group.replaceChildren(...list.map(proxyFor));

      const reload=reloadButton(pageHead);
      if(reload){
        if(group.previousElementSibling!==reload)reload.after(group);
      }else if(!group.isConnected){
        const spacer=[...pageHead.children].find(node=>node.classList?.contains('spacer'));
        if(spacer)spacer.after(group);else pageHead.appendChild(group);
      }
    }finally{syncing=false;}
  }

  function schedule(){
    if(scheduled)return;scheduled=true;
    setTimeout(()=>{scheduled=false;sync();},0);
  }

  const observer=new MutationObserver(schedule);
  observer.observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled','aria-disabled','class']});
  document.addEventListener('click',event=>{
    if(event.target.closest?.('.nav button[data-view],[data-go]'))setTimeout(schedule,0);
  },true);
  window.addEventListener('kun:section-reloaded',schedule);

  window.KunSectionNavActionsV105={sync,schedule,version:'105.0'};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',schedule,{once:true});else schedule();
  document.documentElement.dataset.sectionNavActions='v105-ready';
})();
