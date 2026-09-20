import app from './index-production-mobile-update.js';

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const cleanError=error=>String(error?.message||error||'unknown').replace(/[^\w\s.:()'"\-]/g,' ').slice(0,240);

async function loginDiagnostic(request,env){
  const url=new URL(request.url);
  if(url.pathname!=='/__internal/login-schema-diagnostic'||request.method!=='GET')return null;
  const supplied=String(request.headers.get('X-Kun-Diagnostic-Token')||'');
  const expected=String(env.LOGIN_DIAGNOSTIC_TOKEN||'');
  if(!expected||supplied!==expected)return json({ok:false,error:'not_found'},404);

  const base={
    ok:true,
    readOnly:true,
    dbBindingPresent:!!env.DB,
    sessionSecretSet:!!env.SESSION_SECRET,
    appEnv:String(env.APP_ENV||'')
  };

  if(!env.DB)return json({...base,dbReady:false,stage:'binding',dbError:'DB binding missing'});

  try{
    const rows=(await env.DB.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name IN ('users','login_attempts') ORDER BY name").all()).results||[];
    const tables=rows.map(row=>String(row.name||''));
    const sqlByTable=Object.fromEntries(rows.map(row=>[String(row.name||''),String(row.sql||'')]));
    const requiredUsers=['id','email','password','role','client_id','status','last_login'];
    const requiredAttempts=['email','fails','locked_until'];
    const usersSql=sqlByTable.users||'';
    const attemptsSql=sqlByTable.login_attempts||'';
    const missingUsers=requiredUsers.filter(name=>!new RegExp(`\\b${name}\\b`,'i').test(usersSql));
    const missingAttempts=requiredAttempts.filter(name=>!new RegExp(`\\b${name}\\b`,'i').test(attemptsSql));
    const counts={};
    if(tables.includes('users'))counts.users=Number((await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first())?.n||0);
    if(tables.includes('login_attempts'))counts.loginAttempts=Number((await env.DB.prepare('SELECT COUNT(*) AS n FROM login_attempts').first())?.n||0);
    return json({
      ...base,
      dbReady:true,
      stage:'complete',
      tables,
      counts,
      missingUsers,
      missingAttempts,
      loginSchemaReady:tables.includes('users')&&tables.includes('login_attempts')&&missingUsers.length===0&&missingAttempts.length===0
    });
  }catch(error){
    return json({...base,dbReady:false,stage:'query',dbError:cleanError(error)});
  }
}

export default {
  async fetch(request,env,ctx){
    const diagnostic=await loginDiagnostic(request,env);
    if(diagnostic)return diagnostic;
    return app.fetch(request,env,ctx);
  },
  scheduled(event,env,ctx){return app.scheduled?.(event,env,ctx);}
};
