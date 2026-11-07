/**
 * Public email signup / activation, independent of admin-created accounts.
 * Activation creates tenant + wallet + subscription + owner in one D1 transaction.
 * Never email reusable passwords. No account is usable before code verification.
 * Disabled unless explicitly configured. No production migrations are auto-applied.
 */
const PATHS=new Set(['/api/auth/signup','/api/auth/activate']);
const json=(payload,status=200)=>new Response(JSON.stringify(payload),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const clean=(v,max=120)=>String(v??'').trim().slice(0,max);
const encoded=new TextEncoder();
const generic={ok:true,message:'لو الإيميل صالح ومتاح، هتوصلك رسالة فيها كود التفعيل. راجع البريد الوارد والرسائل غير المرغوبة.'};
const isEmail=v=>v.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
function cairoDay(date=new Date()){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
  const get=k=>parts.find(p=>p.type===k)?.value||'';
  return get('year')+'-'+get('month')+'-'+get('day');
}
function plusDays(ymd,days){
  const d=new Date(ymd+'T12:00:00Z');
  d.setUTCDate(d.getUTCDate()+days);
  return d.toISOString().slice(0,10);
}
async function digest(secret,message){
  const key=await crypto.subtle.importKey('raw',encoded.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC',key,encoded.encode(message)))].map(v=>v.toString(16).padStart(2,'0')).join('');
}
function safeEqual(a,b){
  if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;
  let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;
}
function code8(){
  // Rejection sampling avoids modulo bias while using cryptographic randomness.
  const max=Math.floor(0x100000000/100000000)*100000000;
  let n;do{n=crypto.getRandomValues(new Uint32Array(1))[0];}while(n>=max);
  return String(n%100000000).padStart(8,'0');
}
async function passwordHash(password){
  const salt=crypto.getRandomValues(new Uint8Array(16));
  const key=await crypto.subtle.importKey('raw',encoded.encode(password),'PBKDF2',false,['deriveBits']);
  const output=new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations:100000},key,256));
  const b64=buf=>btoa(String.fromCharCode(...buf));
  // Must match src/index.js password verifier format exactly.
  return 'pbkdf2$100000$'+b64(salt)+'$'+b64(output);
}
function configured(env){
  return env?.SELF_SIGNUP_ENABLED==='true'&&env?.DB&&
    String(env.SIGNUP_TOKEN_SECRET||'').length>=32&&
    Boolean(env.RESEND_API_KEY)&&Boolean(env.SIGNUP_EMAIL_FROM);
}
async function readBody(request){
  const raw=await request.text();
  if(raw.length>8192)throw Object.assign(new Error('حجم الطلب كبير'),{status:413});
  try{return JSON.parse(raw);}catch{throw Object.assign(new Error('بيانات غير صحيحة'),{status:400});}
}
async function throttle(env,kind,value,limit,seconds){
  const hash=await digest(env.SIGNUP_TOKEN_SECRET,kind+':'+value);
  const bucket=kind+':'+hash;
  const ts=new Date().toISOString();
  const reset=new Date(Date.now()-seconds*1000).toISOString();
  await env.DB.prepare("INSERT INTO signup_throttle (bucket,window_start,hits) VALUES (?,?,1) ON CONFLICT(bucket) DO UPDATE SET hits=CASE WHEN window_start<? THEN 1 ELSE hits+1 END,window_start=CASE WHEN window_start<? THEN excluded.window_start ELSE window_start END")
    .bind(bucket,ts,reset,reset).run();
  const row=await env.DB.prepare('SELECT hits FROM signup_throttle WHERE bucket=?').bind(bucket).first();
  return Number(row?.hits||0)<=limit;
}
async function sendCode(env,email,code,storeName){
  const friendly=storeName.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const response=await fetch('https://api.resend.com/emails',{
    method:'POST',
    headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json'},
    body:JSON.stringify({
      from:env.SIGNUP_EMAIL_FROM,to:[email],
      subject:'كود تفعيل حسابك في كن أونلاين',
      text:'أهلًا بيك في كن أونلاين!\nكود التفعيل: '+code+'\nالكود صالح لمدة 10 دقائق ولمرة واحدة فقط.\nلو ما طلبتش التسجيل، تجاهل الرسالة.',
      html:'<div dir="rtl" style="font-family:Arial,sans-serif;max-width:540px;margin:auto;color:#0f172a"><h2>أهلًا بيك في كن أونلاين</h2><p>تفعيل حساب '+friendly+'</p><p>كود التفعيل بتاعك:</p><p style="font-size:32px;letter-spacing:5px;font-weight:bold;direction:ltr;text-align:center">'+code+'</p><p>صالح لمدة 10 دقائق ومرة واحدة فقط.</p><p>لو ما طلبتش التسجيل، تجاهل الرسالة.</p></div>'
    })
  });
  if(!response.ok)throw new Error('MAIL_PROVIDER_REJECTED');
}
async function signup(request,env){
  const b=await readBody(request);
  const email=clean(b?.email,254).toLowerCase(),name=clean(b?.name),storeName=clean(b?.storeName);
  if(!isEmail(email)||name.length<2||storeName.length<2)return json({error:'اكتب اسمك واسم متجرك وإيميل صحيح.'},400);
  const ip=clean(request.headers.get('cf-connecting-ip')||'',100)||'unknown:'+email;
  if(!await throttle(env,'signup-ip',ip,20,3600))return json({error:'محاولات كثيرة من نفس الاتصال. حاول لاحقًا.'},429);
  if(!await throttle(env,'signup-email',email,4,86400))return json(generic,202);
  // Never overwrite existing accounts or disclose whether a user exists.
  const [user,claim]=await Promise.all([
    env.DB.prepare('SELECT id FROM users WHERE email=?').bind(email).first(),
    env.DB.prepare('SELECT email FROM signup_trial_claims WHERE email=?').bind(email).first()
  ]);
  if(user||claim)return json(generic,202);
  const now=new Date().toISOString(),before=new Date(Date.now()-90*1000).toISOString();
  const code=code8(),codeDigest=await digest(env.SIGNUP_TOKEN_SECRET,email+':'+code);
  const expire=new Date(Date.now()+10*60*1000).toISOString();
  const result=await env.DB.prepare(
    'INSERT INTO signup_pending (email,full_name,store_name,code_digest,expires_at,sent_at,attempts,created_at,updated_at) VALUES (?,?,?,?,?,?,0,?,?) '+
    'ON CONFLICT(email) DO UPDATE SET full_name=excluded.full_name,store_name=excluded.store_name,code_digest=excluded.code_digest,expires_at=excluded.expires_at,sent_at=excluded.sent_at,attempts=0,updated_at=excluded.updated_at '+
    'WHERE signup_pending.sent_at<?'
  ).bind(email,name,storeName,codeDigest,expire,now,now,now,before).run();
  if(Number(result?.meta?.changes||0)===0)return json(generic,202);
  try{await sendCode(env,email,code,storeName);}
  catch{
    // Do not leave an undelivered token consuming the user's retry window.
    await env.DB.prepare('DELETE FROM signup_pending WHERE email=? AND code_digest=?').bind(email,codeDigest).run().catch(()=>{});
    return json({error:'تعذر إرسال رسالة التفعيل حاليًا. حاول تاني بعد شوية.'},503);
  }
  return json(generic,202);
}
async function activate(request,env){
  const b=await readBody(request),email=clean(b?.email,254).toLowerCase();
  const code=String(b?.code||'').trim(),password=String(b?.password||'');
  if(!isEmail(email)||!/^[0-9]{8}$/.test(code)||password.length<12||password.length>128){
    return json({error:'تأكد من الإيميل وكود التفعيل (8 أرقام) وكلمة مرور من 12 حرف على الأقل.'},400);
  }
  const ip=clean(request.headers.get('cf-connecting-ip')||'',100)||'unknown:'+email;
  if(!await throttle(env,'activate-ip',ip,60,3600))return json({error:'محاولات كثيرة. حاول لاحقًا.'},429);
  const now=new Date().toISOString();
  const updated=await env.DB.prepare('UPDATE signup_pending SET attempts=attempts+1,updated_at=? WHERE email=? AND expires_at>? AND attempts<5')
    .bind(now,email,now).run();
  if(Number(updated?.meta?.changes||0)!==1)return json({error:'الكود غير صحيح أو انتهت صلاحيته. اطلب كود جديد.'},400);
  const pending=await env.DB.prepare('SELECT * FROM signup_pending WHERE email=?').bind(email).first();
  const codeDigest=await digest(env.SIGNUP_TOKEN_SECRET,email+':'+code);
  if(!pending||!safeEqual(pending.code_digest,codeDigest))return json({error:'الكود غير صحيح أو انتهت صلاحيته.'},400);
  const existing=await env.DB.prepare('SELECT id FROM users WHERE email=?').bind(email).first();
  if(existing)return json({error:'الحساب موجود بالفعل. سجّل الدخول.'},409);
  const claim=await env.DB.prepare('SELECT email FROM signup_trial_claims WHERE email=?').bind(email).first();
  if(claim)return json({error:'تم استخدام التجربة المجانية لهذا البريد من قبل.'},409);
  const clientId='SELF-'+crypto.randomUUID(),uid=crypto.randomUUID(),subscriptionId='SUB-'+crypto.randomUUID();
  const started=cairoDay(),ends=plusDays(started,30),hashed=await passwordHash(password);
  try{
    // D1 batch is transactional: no half-created users, wallets or subscriptions.
    await env.DB.batch([
      env.DB.prepare('INSERT INTO signup_trial_claims (email,client_id,activated_at) VALUES (?,?,?)').bind(email,clientId,now),
      env.DB.prepare("INSERT INTO tenant_settings (client_id,display_name,timezone,currency,locale,plan,status,created_at,updated_at) VALUES (?,?,'Africa/Cairo','EGP','ar-EG','trial','active',?,?)")
        .bind(clientId,pending.store_name,now,now),
      env.DB.prepare("INSERT INTO wallet_accounts (client_id,balance,currency,base_order_fee,min_order_fee,max_order_fee,credit_limit,billing_version,billing_start_rowid,status,updated_at) VALUES (?,0,'EGP',2,0,0,0,'v27',0,'active',?)")
        .bind(clientId,now),
      env.DB.prepare("INSERT INTO subscriptions (id,client_id,plan,status,billing_cycle,amount,currency,period_start,period_end,provider,created_at,updated_at) VALUES (?,?,'trial','trialing','monthly',0,'EGP',?,?,'self_signup',?,?)")
        .bind(subscriptionId,clientId,started,ends,now,now),
      env.DB.prepare("INSERT INTO users (id,email,name,password,role,client_id,status,created_at) VALUES (?,?,?,?,'client',?,'active',?)")
        .bind(uid,email,pending.full_name,hashed,clientId,now),
      env.DB.prepare('DELETE FROM signup_pending WHERE email=? AND code_digest=?').bind(email,codeDigest)
    ]);
  }catch(error){
    if(/UNIQUE constraint failed|constraint failed/i.test(String(error?.message||error)))return json({error:'الحساب تم تفعيله بالفعل. جرّب تسجيل الدخول.'},409);
    throw error;
  }
  return json({ok:true,message:'اتفعّل حسابك وبدأت تجربتك المجانية لمدة 30 يومًا.',trialEndsAt:ends},201);
}
export async function handleSelfSignup(request,env){
  const url=new URL(request.url),path=url.pathname;
  if(!PATHS.has(path))return null;
  if(request.method!=='POST')return json({error:'الطريقة غير مسموحة'},405);
  const origin=request.headers.get('origin');
  if(origin){let ok=false;try{ok=new URL(origin).origin===url.origin;}catch{}if(!ok)return json({error:'مصدر الطلب غير مسموح'},403);}
  if(!configured(env))return json({error:'التسجيل الجديد غير متاح حاليًا. تواصل مع الدعم.'},503);
  try{
    return path==='/api/auth/signup'?await signup(request,env):await activate(request,env);
  }catch(error){
    if(error?.status)return json({error:error.message},error.status);
    console.error('Self signup failure:',String(error?.message||error).slice(0,90));
    return json({error:'حصل خطأ أثناء التسجيل. حاول مرة تانية.'},500);
  }
}
export const __signupInternals={isEmail,cairoDay,plusDays,safeEqual,code8,passwordHash,digest};
