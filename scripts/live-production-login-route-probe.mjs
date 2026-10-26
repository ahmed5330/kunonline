// Read-only public production login-route diagnostic. Does not use credentials,
// create sessions, or touch real account attempts.
const base='https://app.kun-online.com';
const cases=[
  {name:'html',path:'/v2/?auth_probe=20261010',method:'GET',expect:[200]},
  {name:'anonymous-me',path:'/api/me?auth_probe=20261010',method:'GET',expect:[200]},
  {name:'login-validation',path:'/api/login',method:'POST',body:'{}',expect:[400]}
];
let failures=0;
for(const c of cases){
  const t=Date.now();
  try{
    const ctrl=new AbortController();
    const timer=setTimeout(()=>ctrl.abort(),20000);
    let r;
    try{r=await fetch(base+c.path,{method:c.method,headers:{'Content-Type':'application/json','Cache-Control':'no-cache'},body:c.body,redirect:'manual',signal:ctrl.signal});}
    finally{clearTimeout(timer)}
    const contentType=r.headers.get('content-type')||'';
    const payload=(await r.text()).slice(0,400);
    let code='';
    if(contentType.includes('json')){try{const j=JSON.parse(payload);code=String(j.code||j.error||j.role||'').slice(0,80)}catch{}}
    const ok=c.expect.includes(r.status);
    console.log(JSON.stringify({name:c.name,status:r.status,expected:c.expect,ok,ms:Date.now()-t,contentType,code,location:r.headers.get('location')?.slice(0,70)||null}));
    if(!ok)failures++;
  }catch(error){failures++;console.log(JSON.stringify({name:c.name,ok:false,error:String(error?.name||'FetchError'),message:String(error?.message||'').slice(0,110)}))}
}
if(failures){console.error('Production public login-route probe FAIL:',failures,'checks');process.exitCode=1}else console.log('Production public login-route probe PASS');
