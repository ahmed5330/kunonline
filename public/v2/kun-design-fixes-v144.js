/* Kun Online v144 mobile header: retain original controls and their event handlers. */
(function(){
 'use strict';
 if(window.KunHeaderFixV144)return;
 const records=new Map();
 let pending=false;
 function init(){
  const top=document.querySelector('.top'),side=document.querySelector('.side');
  if(!top||!side)return;
  let box=side.querySelector('#kun144MobileTools');
  if(!box){
   box=document.createElement('section');box.id='kun144MobileTools';box.className='kun144-mobile-tools';
   box.setAttribute('aria-label','أدوات الحساب والمظهر');
   const heading=document.createElement('div');heading.className='kun144-mobile-tools-heading';heading.textContent='الحساب والمظهر';box.appendChild(heading);
   side.appendChild(box);
  }
  function mobile(){return matchMedia('(max-width:820px)').matches;}
  function relevant(node){
   return node?.id==='androidDownload'||node?.id==='themeSwitcher'||node?.id==='v28SessionBox'||node?.matches?.('button[aria-label="مركز المساعدة"]');
  }
  function update(){
   pending=false;
   if(mobile()){
    Array.from(top.children).filter(relevant).forEach(function(node){
     if(records.has(node))return;
     const placeholder=document.createComment('kun v144 header control');
     node.before(placeholder);records.set(node,placeholder);box.appendChild(node);
    });
   }else{
    for(const [node,placeholder] of records){
     if(placeholder.parentNode)placeholder.replaceWith(node);
     else top.appendChild(node);
     records.delete(node);
    }
   }
  }
  function schedule(){
   if(pending)return;
   pending=true;
   requestAnimationFrame(update);
  }
  const watch=new MutationObserver(function(records){
   if(records.some(function(record){return record.type==='childList';}))schedule();
  });
  watch.observe(top,{childList:true});
  window.addEventListener('resize',schedule,{passive:true});
  const fabWatch=new MutationObserver(function(){
   const fab=document.getElementById('kunCollabFab');
   if(fab && !fab.getAttribute('aria-label'))fab.setAttribute('aria-label','فتح محادثات فريق العمل');
  });
  fabWatch.observe(document.body,{childList:true,subtree:false});
  window.KunHeaderFixV144={version:'144.0',sync:schedule};
  schedule();
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();