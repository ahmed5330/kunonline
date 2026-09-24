/* Kun Online v117 — preserve the v2 #root container for collaboration rendering and browser QA. */
(function(){
  'use strict';
  document.addEventListener('click',event=>{
    const trigger=event.target?.closest?.('button[data-view="collaboration"]');
    if(!trigger)return;
    const root=document.getElementById('root');
    if(!root)return;
    let host=document.getElementById('content');
    if(host&&root.contains(host))return;
    host=document.createElement('div');
    host.id='content';
    host.className='kun-collaboration-root';
    root.replaceChildren(host);
  },true);
})();
