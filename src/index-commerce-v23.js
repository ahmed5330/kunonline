import commerceV22 from './index-commerce-v22.js';

const RECOVERY_HASH='cc840f4bfa12e9afeb51f5b26357538023de9b16c760dfa45b41e5b913ed6d52';
const PBKDF2_ITERATIONS=100000;
const json=(d,s=200,h={})=>new Response(JSON.stringify(d),{status:s,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...h}});
const toB64=bytes=>btoa(String.fromCharCode(...bytes));
async function sha256Hex(value){const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(value||'')));return [...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join('');}
async function hashPassword(password){const salt=crypto.getRandomValues(new Uint8Array(16));const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:PBKDF2_ITERATIONS,hash:'SHA-256'},key,256);return `pbkdf2$${PBKDF2_ITERATIONS}$${toB64(salt)}$${toB64(new Uint8Array(bits))}`;}

async function recoverPreviewAdmin(request,env){
  if(env.APP_ENV!=='preview')return json({error:'المسار متاح على Preview فقط'},404);
  const used=await env.DB.prepare("SELECT email FROM login_attempts WHERE email='__preview_admin_recovery_used__'").first();
  if(used)return json({error:'تم استخدام استعادة الأدمن مرة بالفعل. احذف recovery marker يدويًا من Preview D1 فقط إذا احتجت إعادة العملية.'},410);
  const body=await request.json().catch(()=>({}));
  const code=String(body.recoveryCode||'').trim();
  const email=String(body.email||'').trim().toLowerCase();
  const password=String(body.password||'');
  if(await sha256Hex(code)!==RECOVERY_HASH)return json({error:'كود الاستعادة غير صحيح'},403);
  if(!email.includes('@'))return json({error:'اكتب إيميل صحيح'},400);
  if(password.length<10)return json({error:'كلمة المرور لازم تكون 10 حروف على الأقل'},400);
  const collision=await env.DB.prepare('SELECT id,role FROM users WHERE email=?').bind(email).first();
  if(collision&&collision.role!=='admin')return json({error:'الإيميل مستخدم لحساب غير أدمن. استخدم إيميل مختلف.'},409);
  const passwordHash=await hashPassword(password),now=new Date().toISOString();
  const existing=collision&&collision.role==='admin'?collision:await env.DB.prepare("SELECT id FROM users WHERE role='admin' ORDER BY created_at LIMIT 1").first();
  await env.DB.prepare("UPDATE users SET status='disabled' WHERE role='admin'").run();
  let uid;
  if(existing){uid=existing.id;await env.DB.prepare("UPDATE users SET email=?,name='الإدارة',password=?,role='admin',client_id=NULL,status='active',last_login=NULL WHERE id=?").bind(email,passwordHash,uid).run();}
  else{uid=crypto.randomUUID();await env.DB.prepare('INSERT INTO users (id,email,name,password,role,client_id,status,created_at,last_login) VALUES (?,?,?,?,?,?,?,?,NULL)').bind(uid,email,'الإدارة',passwordHash,'admin',null,'active',now).run();}
  await env.DB.prepare('DELETE FROM login_attempts WHERE email=?').bind(email).run();
  await env.DB.prepare("INSERT OR REPLACE INTO login_attempts (email,fails,locked_until) VALUES ('__preview_admin_recovery_used__',0,?)").bind(now).run();
  try{const row=await env.DB.prepare('SELECT json FROM state WHERE id=1').first();if(row?.json){const s=JSON.parse(row.json);s.agency=s.agency||{};s.agency.adminEmail=email;await env.DB.prepare('UPDATE state SET json=?,updated_at=? WHERE id=1').bind(JSON.stringify(s),now).run();}}catch{}
  return json({ok:true,email,message:'تم تجهيز أدمن Preview. سجّل الدخول من الصفحة الرئيسية.'},200);
}

async function fetchV23(request,env,ctx){const u=new URL(request.url);if(u.pathname==='/api/preview-admin-recovery'&&request.method.toUpperCase()==='POST')return recoverPreviewAdmin(request,env);return commerceV22.fetch(request,env,ctx);}
export default {fetch:fetchV23,scheduled(controller,env,ctx){return commerceV22.scheduled?.(controller,env,ctx);}};
