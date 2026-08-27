/* Kun Online v28 team navigation stabilizer.
   Keeps the v28 team/store-access renderer authoritative after legacy async renders. */
(function(){
  const team=window.KunTeamV28;
  if(!team?.renderTeam)return;

  let navigationToken=0;
  const TARGETS={access:'team','store-access':'stores'};

  function activeTarget(view){
    return !!document.querySelector(`.nav button.active[data-view="${view}"]`);
  }

  function schedule(view,mode){
    const token=++navigationToken;
    let attempts=0;
    let rendering=false;

    const ensure=async()=>{
      if(token!==navigationToken)return;
      if(!activeTarget(view))return;

      attempts++;
      if(!document.getElementById('v28AddMember')&&!rendering){
        rendering=true;
        try{await team.renderTeam(mode)}catch(error){
          window.showToast?.(error?.message||'تعذر تحميل الفريق والصلاحيات');
        }finally{rendering=false}
      }

      if(token===navigationToken&&activeTarget(view)&&attempts<18){
        setTimeout(ensure,300);
      }
    };

    /* Let the legacy renderer run first, then keep the v28 view authoritative
       through any late async load/render completion. */
    setTimeout(ensure,60);
  }

  document.addEventListener('click',event=>{
    const nav=event.target.closest?.('.nav button[data-view]');
    if(!nav)return;
    const mode=TARGETS[nav.dataset.view];
    if(mode)schedule(nav.dataset.view,mode);
    else navigationToken++;
  });

  /* Restore the correct renderer after reloads/state restorations where a team
     tab is already active before this overlay is evaluated. */
  for(const [view,mode] of Object.entries(TARGETS)){
    if(activeTarget(view)){schedule(view,mode);break}
  }

  document.documentElement.dataset.v28TeamNavigation='stable';
})();
