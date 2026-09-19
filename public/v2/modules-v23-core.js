/* Kun Online v23 actions core */
(function(){
  const K=window.KunActionsV23=window.KunActionsV23||{};
  K.esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  K.notify=m=>window.showToast?window.showToast(m):alert(m);
  K.money=v=>Number(v||0).toLocaleString('ar-EG',{maximumFractionDigits:2});
  K.val=id=>document.getElementById(id)?.value?.trim?.()||'';
  K.root=()=>document.getElementById('root');
  K.clientId=async()=>window.kunClientId?await window.kunClientId():String(typeof activeClientId!=='undefined'?activeClientId:'');
  K.storeId=async()=>window.kunStoreId?await window.kunStoreId():String(document.getElementById('storeBtn')?.value||'');
  K.api=async(path,options={})=>{const r=await fetch(path,{credentials:'include',headers:{'Content-Type':'application/json',...(options.headers||{})},...options});const text=await r.text();let d={};try{d=JSON.parse(text)}catch{d={raw:text}}if(!r.ok){const e=new Error(d.error||`HTTP ${r.status}`);e.code=d.code;e.status=r.status;throw e}return d;};
  K.close=()=>{document.getElementById('drawer')?.classList.remove('open');document.getElementById('drawerBack')?.classList.remove('show')};
  K.drawer=(title,html)=>{const d=document.getElementById('drawer'),b=document.getElementById('drawerBack');if(!d||!b)return;d.innerHTML=`<div class="page-head"><div><div class="title">${K.esc(title)}</div></div><div class="spacer"></div><button class="btn soft" id="v23Close">إغلاق</button></div>${html}`;d.classList.add('open');b.classList.add('show');document.getElementById('v23Close').onclick=K.close;};
  K.scope=async()=>{const cid=await K.clientId();if(!cid)throw new Error('حدد العميل/المتجر أولًا');return {cid,sid:await K.storeId()};};
  K.refresh=async()=>{K.close();try{if(typeof load==='function')await load();else location.reload()}catch{location.reload()}};
  K.field=(label,id,type='text',extra='')=>`<label>${label}<input class="input" id="${id}" type="${type}" ${extra}></label>`;
  K.randomPassword=()=>`Kun!${crypto.getRandomValues(new Uint32Array(2)).join('A')}z9`;
  document.documentElement.dataset.v23Actions='loading';
})();
