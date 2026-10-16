/*
 * Kun Online public website reviews, isolated from client transactions.
 * New reviews enter pending moderation and never publish automatically.
 */
const PUBLIC_ORIGINS = new Set(['https://kun-online.com','https://www.kun-online.com']);
const APP_ORIGIN = 'https://app.kun-online.com';
const MAX_UPLOAD = 150000;
const json = (value,status=200,extra={})=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra}});
const clean = (value,max)=>String(value??'').trim().slice(0,max);
let schemaReady=false;
async function ensureSchema(db) {
  if(schemaReady)return;
  if(!db?.prepare)throw Object.assign(new Error('Database unavailable'),{status:503});
  await db.prepare("CREATE TABLE IF NOT EXISTS site_reviews (id TEXT PRIMARY KEY, category TEXT NOT NULL CHECK(category IN ('services','consultations')), rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5), author TEXT NOT NULL, body TEXT NOT NULL, photo_jpeg TEXT, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','hidden')), created_at TEXT NOT NULL, reviewed_at TEXT, reviewed_by TEXT)").run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_site_reviews_status_created ON site_reviews(status,created_at DESC)').run();
  await db.prepare('CREATE TABLE IF NOT EXISTS site_review_rate (fingerprint TEXT PRIMARY KEY, hits INTEGER NOT NULL DEFAULT 0, day TEXT NOT NULL)').run();
  schemaReady=true;
}
async function hashedIp(request,secret) {
  const ip=clean(request.headers.get('cf-connecting-ip')||'unknown',110);
  const day=new Date().toISOString().slice(0,10);
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const bytes=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(day+':'+ip)));
  return {day,fingerprint:[...bytes].map(x=>x.toString(16).padStart(2,'0')).join('')};
}
function view(row) {
  return {id:row.id,category:row.category,rating:row.rating,name:row.author,text:row.body,photo:row.photo_jpeg||null,status:row.status,createdAt:row.created_at};
}
function validPhoto(value) {
  if(value===null||value===undefined||value==='')return true;
  if(typeof value!=='string'||value.length>120000||!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(value))return false;
  try{
    const bytes=atob(value.slice('data:image/jpeg;base64,'.length,'data:image/jpeg;base64,'.length+16));
    return bytes.charCodeAt(0)===0xff&&bytes.charCodeAt(1)===0xd8&&bytes.charCodeAt(2)===0xff;
  }catch{return false;}
}
async function adminUser(request,authorize) {
  if(typeof authorize!=='function')return null;
  const user=await authorize(request);
  return user?.role==='admin'&&user?.uid?user:null;
}
export async function handlePublicSiteReviews(request,env,{authorizeAdmin}={}){
  const url=new URL(request.url);
  if(url.pathname!=='/api/public-reviews'&&!/^\/api\/public-reviews\/[a-f0-9-]{36}$/.test(url.pathname))return null;
  const origin=request.headers.get('Origin');
  const cors=PUBLIC_ORIGINS.has(origin)?{'Access-Control-Allow-Origin':origin,'Vary':'Origin'}:{};
  const respond=(data,status=200)=>json(data,status,cors);
  if(request.method==='OPTIONS'){
    if(!PUBLIC_ORIGINS.has(origin))return respond({error:'Origin not allowed'},403);
    return new Response(null,{status:204,headers:{...cors,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Access-Control-Max-Age':'600'}});
  }
  const collection=url.pathname==='/api/public-reviews';
  if(collection&&request.method==='POST'){
    if(!PUBLIC_ORIGINS.has(origin))return respond({error:'Origin not allowed'},403);
    if(!/^application\/json\b/i.test(request.headers.get('Content-Type')||''))return respond({error:'JSON required'},415);
    if(Number(request.headers.get('Content-Length')||0)>MAX_UPLOAD)return respond({error:'الملف كبير للغاية'},413);
    const raw=await request.text();
    if(raw.length>MAX_UPLOAD)return respond({error:'الطلب أكبر من المسموح'},413);
    let body;try{body=JSON.parse(raw);}catch{return respond({error:'بيانات الطلب غير صحيحة'},400);}
    if(body.website) return respond({ok:true,pending:true},202); // honeypot: silently discard
    const name=clean(body.name,70),comment=clean(body.text,900),rating=Number(body.rating),category=body.category;
    if(name.length<2||comment.length<15||!Number.isInteger(rating)||rating<1||rating>5||!['services','consultations'].includes(category)||body.consent!==true||!validPhoto(body.photo))return respond({error:'راجع الاسم والتقييم والنص والموافقة والصورة'},400);
    if(!env.SESSION_SECRET)return respond({error:'خدمة التقييمات غير مهيأة مؤقتًا'},503);
    try{
      await ensureSchema(env.DB);
      const {fingerprint,day}=await hashedIp(request,env.SESSION_SECRET);
      await env.DB.prepare('INSERT OR IGNORE INTO site_review_rate (fingerprint,hits,day) VALUES (?,0,?)').bind(fingerprint,day).run();
      const rate=await env.DB.prepare('UPDATE site_review_rate SET hits=hits+1 WHERE fingerprint=? AND hits<3').bind(fingerprint).run();
      if(!rate?.meta?.changes)return respond({error:'تم بلوغ الحد اليومي لإرسال التقييمات، جرب لاحقًا'},429);
      await env.DB.prepare("INSERT INTO site_reviews (id,category,rating,author,body,photo_jpeg,status,created_at) VALUES (?,?,?,?,?,?,'pending',?)")
        .bind(crypto.randomUUID(),category,rating,name,comment,body.photo||null,new Date().toISOString()).run();
      return respond({ok:true,pending:true,message:'تم استلام تقييمك وسيظهر بعد مراجعته'},202);
    }catch(error){
      console.error('public review submission failed',error?.name||'Error');
      return respond({error:'تعذر حفظ التقييم الآن، حاول لاحقًا'},503);
    }
  }
  if(collection&&request.method==='GET'&&url.searchParams.get('admin')!=='1'){
    try{
      await ensureSchema(env.DB);
      const category=url.searchParams.get('category');
      let query="SELECT id,category,rating,author,body,photo_jpeg,status,created_at FROM site_reviews WHERE status='approved'";
      const args=[];
      if(['services','consultations'].includes(category)){query+=' AND category=?';args.push(category);}
      query+=' ORDER BY created_at DESC LIMIT 30';
      const result=await env.DB.prepare(query).bind(...args).all();
      return respond({ok:true,reviews:(result.results||[]).map(view)});
    }catch{return respond({ok:false,reviews:[],error:'التقييمات غير متاحة مؤقتًا'},503);}
  }
  // Moderation never accepts cross-site writes, and requires live admin session.
  if(origin&&origin!==APP_ORIGIN)return respond({error:'غير مسموح'},403);
  if(['PATCH','DELETE'].includes(request.method)&&origin!==APP_ORIGIN)return respond({error:'غير مسموح'},403);
  const me=await adminUser(request,authorizeAdmin).catch(()=>null);
  if(!me)return respond({error:'يتطلب حساب مدير كن أونلاين'},403);
  try{
    await ensureSchema(env.DB);
    if(collection&&request.method==='GET'){
      const result=await env.DB.prepare('SELECT id,category,rating,author,body,photo_jpeg,status,created_at FROM site_reviews ORDER BY created_at DESC LIMIT 100').all();
      return respond({ok:true,reviews:(result.results||[]).map(view)});
    }
    if(!collection&&request.method==='PATCH'){
      if(!/^application\/json\b/i.test(request.headers.get('Content-Type')||''))return respond({error:'JSON required'},415);
      const raw=await request.text();if(raw.length>200)return respond({error:'Invalid request'},413);
      let payload;try{payload=JSON.parse(raw)}catch{return respond({error:'Invalid JSON'},400)}
      if(!['approved','hidden'].includes(payload.status))return respond({error:'Invalid status'},400);
      const id=url.pathname.split('/').pop();
      const updated=await env.DB.prepare('UPDATE site_reviews SET status=?,reviewed_at=?,reviewed_by=? WHERE id=?')
        .bind(payload.status,new Date().toISOString(),clean(me.uid,80),id).run();
      return respond({ok:true,changed:Boolean(updated.meta?.changes)});
    }
    if(!collection&&request.method==='DELETE'){
      const id=url.pathname.split('/').pop();
      const deleted=await env.DB.prepare('DELETE FROM site_reviews WHERE id=?').bind(id).run();
      return respond({ok:true,deleted:Boolean(deleted.meta?.changes)});
    }
    return respond({error:'Method not allowed'},405);
  }catch(error){
    console.error('site reviews admin failure',error?.name||'Error');
    return respond({error:'تعذر إتمام العملية'},503);
  }
}
