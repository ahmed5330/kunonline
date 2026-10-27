// Reject ambiguous browser credentials before any application or gateway side effect.
function denied(status,code,error,extra={}){
  return new Response(JSON.stringify({ok:false,code,error}),{status,headers:{
    'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...extra
  }});
}
export function guardSessionRequest(request){
  const path=new URL(request.url).pathname;
  if(!path.startsWith('/api/'))return null;
  if(path==='/api/logout'&&request.method!=='POST')
    return denied(405,'METHOD_NOT_ALLOWED','استخدم POST لتسجيل الخروج.',{Allow:'POST'});
  // Login/setup issue new credentials rather than selecting an existing session.
  if(path==='/api/login'||path==='/api/setup')return null;
  const sessions=(request.headers.get('Cookie')||'').split(';').map(x=>x.trim())
    .filter(x=>x.startsWith('ko_session='));
  if(sessions.length>1)return denied(401,'AMBIGUOUS_SESSION_COOKIE','تعذر التحقق من الجلسة. سجّل الدخول مجددًا.');
  if(sessions.length===1){
    const value=sessions[0].slice('ko_session='.length);
    // The signer emits one base64url payload and one lowercase SHA-256 hex signature.
    if(!/^[A-Za-z0-9_-]+\.[a-f0-9]{64}$/.test(value))
      return denied(401,'INVALID_SESSION_COOKIE','تعذر التحقق من الجلسة. سجّل الدخول مجددًا.');
  }
  return null;
}
