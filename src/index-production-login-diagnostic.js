import app from './index-production-mobile-update.js';

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});

async function loginDiagnostic(request,env){
  const url=new URL(request.url);
  if(url.pathname!=='/__internal/login-schema-diagnostic'||request.method!=='GET')return null;
  const supplied=String(request.headers.get('X-Kun-Diagnostic-Token')||'');
  const expected=String(env.LOGIN_DIAGNOSTIC_TOKEN||'');
  if(!expected||supplied!==expected)return json({ok:false,error:'not_found'},404);

  const tableRows=(await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users','login_attempts') ORDER BY name").all()).results||[];
  const tables=tableRows.map(row=>String(row.name||''));
  const has=name=>tables.includes(name);
  const columnNames=async table=>{
    if(!has(table))return [];
    const rows=(await env.DB.prepare(`SELECT name FROM pragma_table_info('${table}') ORDER BY cid`).all()).results||[];
    return rows.map(row=>String(row.name||''));
  };

  const usersColumns=await columnNames('users');
  const attemptsColumns=await columnNames('login_attempts');
  const counts={};
  if(has('users'))counts.users=Number((await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first())?.n||0);
  if(has('login_attempts'))counts.loginAttempts=Number((await env.DB.prepare('SELECT COUNT(*) AS n FROM login_attempts').first())?.n||0);

  const requiredUsers=['id','email','password','role','client_id','status','last_login'];
  const requiredAttempts=['email','fails','locked_until'];
  const missingUsers=requiredUsers.filter(name=>!usersColumns.includes(name));
  const missingAttempts=requiredAttempts.filter(name=>!attemptsColumns.includes(name));

  return json({
    ok:true,
    readOnly:true,
    tables,
    usersColumns,
    attemptsColumns,
    counts,
    missingUsers,
    missingAttempts,
    loginSchemaReady:has('users')&&has('login_attempts')&&missingUsers.length===0&&missingAttempts.length===0
  });
}

export default {
  async fetch(request,env,ctx){
    const diagnostic=await loginDiagnostic(request,env);
    if(diagnostic)return diagnostic;
    return app.fetch(request,env,ctx);
  },
  scheduled(event,env,ctx){return app.scheduled?.(event,env,ctx);}
};
