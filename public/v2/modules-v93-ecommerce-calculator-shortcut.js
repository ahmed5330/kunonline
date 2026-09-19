/* Kun Online v93 — expose the e-commerce calculator inside Shortcut Board. */
(function(){
  'use strict';
  if(window.KunEcommerceCalculatorShortcutV93)return;
  const VIEW='ecommerce-calculator';
  const routeButton=()=>document.querySelector(`.nav button[data-view="${VIEW}"]`);
  const allowed=()=>{const b=routeButton();return Boolean(b&&!b.hidden&&b.style.display!=='none'&&b.getAttribute('aria-hidden')!=='true');};
  function findGrowthGrid(){
    const page=document.querySelector('.kun92-shortcut-page');if(!page)return null;
    const section=[...page.querySelectorAll('.kun92-shortcut-section')].find(x=>x.querySelector('.kun92-shortcut-section-title')?.textContent.trim()==='التسويق والمالية');
    return section?.querySelector('.kun92-shortcut-grid')||null;
  }
  function sync(){
    const existing=document.querySelector('[data-kun93-shortcut-calculator]'),grid=findGrowthGrid();
    if(!grid||!allowed()){existing?.remove();return false;}
    if(existing&&existing.parentElement===grid)return true;
    existing?.remove();
    const card=document.createElement('button');card.type='button';card.className='kun92-shortcut-card kun92-tone-cyan';card.dataset.kun93ShortcutCalculator='1';card.innerHTML=`<span class="kun92-shortcut-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h2M14 11h2M8 15h2M14 15h2M8 18h8"/><path d="m9 14 6-6"/></svg></span><span class="kun92-shortcut-name">حاسبة التجارة الإلكترونية</span><span class="kun92-shortcut-desc">الربحية، CPP، التأكيد، الاستلام، المرتجعات ونقطة التعادل</span><span class="kun92-shortcut-open">فتح القسم <span>←</span></span>`;
    card.addEventListener('click',()=>routeButton()?.click());
    grid.appendChild(card);return true;
  }
  let queued=false;const schedule=()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;sync();});};
  function boot(){sync();new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','style','aria-hidden','class']});document.addEventListener('click',e=>{if(e.target.closest?.('[data-kun-shortcuts-nav],.nav button[data-view]'))setTimeout(sync,0);},true);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
  window.KunEcommerceCalculatorShortcutV93={version:'93.0',sync};
})();
