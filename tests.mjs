/* اختبارات نظام كن أونلاين — الدخول، العزل، الويبهوك، التتبع */
import worker from './konline-system/src/index.js';

let stateRow=null; const orders=new Map(), users=new Map(), attempts=new Map();
const stmt=(sql)=>({
  args:[], bind(...a){this.args=a;return this;},
  async first(){
    if(sql.includes('FROM state')) return stateRow?{json:stateRow}:null;
    if(sql.includes("COUNT(*) AS n FROM users WHERE role")) return {n:[...users.values()].filter(u=>u.role==='admin').length};
    if(sql.includes('COUNT(*) AS n FROM users')) return {n:users.size};
    if(sql.includes('FROM users WHERE email = ?')) return [...users.values()].find(u=>u.email===this.args[0])||null;
    if(sql.includes('FROM users WHERE client_id = ?')) return [...users.values()].find(u=>u.client_id===this.args[0])||null;
    if(sql.includes('FROM users WHERE id = ?')) return users.get(this.args[0])||null;
    if(sql.includes('FROM login_attempts')) return attempts.get(this.args[0])||null;
    if(sql.includes('SELECT state, awb FROM orders')) return orders.get(this.args[0])||null;
    return null;
  },
  async run(){
    if(sql.includes('INSERT INTO state')) stateRow=this.args[0];
    else if(sql.includes('INSERT INTO users')){const[id,email,password,role,client_id,status,created_at]=this.args;
      users.set(id,{id,email,password,role,client_id,status,created_at,last_login:null});}
    else if(sql.startsWith('UPDATE users SET email')){const u=users.get(this.args[5]);
      if(u)Object.assign(u,{email:this.args[0],password:this.args[1],role:this.args[2],client_id:this.args[3],status:this.args[4]});}
    else if(sql.includes('UPDATE users SET password')){const u=users.get(this.args[1]);if(u)u.password=this.args[0];}
    else if(sql.includes('UPDATE users SET last_login')){const u=users.get(this.args[1]);if(u)u.last_login=this.args[0];}
    else if(sql.includes('DELETE FROM users')) users.delete(this.args[0]);
    else if(sql.includes('INSERT INTO login_attempts')) attempts.set(this.args[0],{email:this.args[0],fails:this.args[1],locked_until:this.args[2]});
    else if(sql.includes('DELETE FROM login_attempts')) attempts.delete(this.args[0]);
    else if(sql.includes('INSERT INTO orders')){const a=this.args;
      orders.set(a[0],{id:a[0],client_id:a[1],date:a[2],name:a[3],phone:a[4],gov:a[5],address:a[6],
        product:a[7],qty:a[8],total:a[9],source:a[10],note:a[11],awb:a[12],state:a[13],checkpoint:a[14]});}
    else if(sql.startsWith('UPDATE orders SET state = ?, awb = ?')){const o=orders.get(this.args[3]);
      if(o){o.state=this.args[0];o.awb=this.args[1];}}
    else if(sql.includes('WHERE awb = ?')){for(const o of orders.values()) if(o.awb===this.args[2]) o.state=this.args[0];}
    else if(sql.includes('UPDATE orders SET state = ?, checkpoint = ? WHERE id')){const o=orders.get(this.args[2]);if(o)o.state=this.args[0];}
    else if(sql.includes('DELETE FROM orders')) orders.delete(this.args[0]);
    return {};
  },
  async all(){
    if(sql.includes('FROM users')) return {results:[...users.values()]};
    let list=[...orders.values()];
    if(sql.includes('WHERE client_id = ?')) list=list.filter(o=>o.client_id===this.args[0]);
    if(sql.includes('NOT IN')) list=list.filter(o=>o.awb&&!['delivered','returned','cancelled'].includes(o.state));
    return {results:list};
  }
});
const env={DB:{prepare:s=>stmt(s)},ASSETS:{fetch:async()=>new Response('<html>dashboard</html>')},
  SESSION_SECRET:'test-secret',EASYORDERS_WEBHOOK_SECRET:'eo-secret'};
const call=(p,o={},c)=>worker.fetch(new Request('https://app.kun-online.com'+p,
  {...o,headers:{'Content-Type':'application/json',...(c?{Cookie:c}:{}),...(o.headers||{})}}),env);
const j=async r=>[r.status,await r.json().catch(()=>null)];
const ck=r=>(r.headers.get('Set-Cookie')||'').split(';')[0];
let pass=0,fail=0; const check=(n,c,x='')=>{c?pass++:fail++;console.log((c?'  PASS':'  FAIL')+' — '+n,x);};
const head=t=>console.log('\n'+t);

head('أول تشغيل وتسجيل الدخول');
let [,me]=await j(await call('/api/me'));
check('النظام بيطلب التظبيط أول مرة', me.needsSetup===true);
check('كلمة مرور قصيرة مرفوضة',
  (await call('/api/setup',{method:'POST',body:JSON.stringify({email:'a@b.com',password:'123'})})).status===400);
let r=await call('/api/setup',{method:'POST',body:JSON.stringify({email:'Ahmed@Kun-Online.com',password:'MyStr0ngPass'})});
const adminCookie=ck(r);
check('إنشاء حساب الإدارة', r.status===200);
check('الإيميل بحروف صغيرة', [...users.values()][0].email==='ahmed@kun-online.com');
check('كلمة المرور مشفّرة PBKDF2', /^pbkdf2\$100000\$/.test([...users.values()][0].password)
  && !JSON.stringify([...users.values()]).includes('MyStr0ngPass'));
check('التظبيط مرة واحدة بس',
  (await call('/api/setup',{method:'POST',body:JSON.stringify({email:'x@y.com',password:'Another123'})})).status===403);
check('كلمة مرور غلط مرفوضة',
  (await call('/api/login',{method:'POST',body:JSON.stringify({email:'ahmed@kun-online.com',password:'nope12345'})})).status===401);
check('دخول صح', (await call('/api/login',{method:'POST',body:JSON.stringify({email:'ahmed@kun-online.com',password:'MyStr0ngPass'})})).status===200);

head('حسابات العملاء');
const state={agency:{name:'كن أونلاين',adminEmail:'ahmed@kun-online.com'},
  clients:[{id:'c1',name:'عميل أ',email:'a@x.com',status:'active',currency:'EGP',market:'مصر',storeId:'store-A',password:'يجب-حذفها'},
           {id:'c2',name:'عميل ب',email:'b@x.com',status:'active',currency:'EGP',market:'مصر'}],
  entries:[{id:'e1',clientId:'c1',date:'2026-08-01'},{id:'e2',clientId:'c2',date:'2026-08-01'}],
  funding:[{id:'f1',clientId:'c1',amount:1000,type:'deposit'}]};
check('الإدارة بتحفظ الإعدادات',(await call('/api/state',{method:'PUT',body:JSON.stringify(state)},adminCookie)).status===200);
check('كلمة المرور اتشالت من الإعدادات', !JSON.parse(stateRow).clients[0].password);
check('حساب جديد بلا كلمة مرور مرفوض',
  (await call('/api/users',{method:'POST',body:JSON.stringify({email:'b@x.com',clientId:'c2'})},adminCookie)).status===400);
check('إنشاء حساب العميل',
  (await call('/api/users',{method:'POST',body:JSON.stringify({email:'b@x.com',clientId:'c2',role:'client',password:'ClientPass99'})},adminCookie)).status===200);
check('إيميل الإدارة ما ينفعش يتحوّل لحساب عميل',
  (await call('/api/users',{method:'POST',body:JSON.stringify({email:'ahmed@kun-online.com',clientId:'c1',password:'Hack123456'})},adminCookie)).status===409);
r=await call('/api/login',{method:'POST',body:JSON.stringify({email:'b@x.com',password:'ClientPass99'})});
const clientCookie=ck(r);
check('دخول العميل', r.status===200);

head('عزل بيانات العملاء');
check('من غير جلسة ممنوع', (await call('/api/state')).status===401);
check('كوكي مزوّرة مرفوضة', (await call('/api/state',{},'ko_session=fake.sig')).status===401);
const [,cs]=await j(await call('/api/state',{},clientCookie));
check('العميل شايف نفسه بس', cs.clients.length===1&&cs.clients[0].id==='c2');
check('مش شايف بيانات غيره', cs.entries.every(e=>e.clientId==='c2')&&cs.funding.length===0);
check('العميل ممنوع يعدّل الإعدادات',
  (await call('/api/state',{method:'PUT',body:JSON.stringify(state)},clientCookie)).status===403);
check('العميل ممنوع يشوف الحسابات', (await call('/api/users',{},clientCookie)).status===403);

head('الأوردرات والويبهوك');
check('ويبهوك بـ secret غلط مرفوض',
  (await call('/webhooks/easyorders',{method:'POST',headers:{secret:'nope'},body:JSON.stringify({id:'o1'})})).status===401);
await call('/webhooks/easyorders',{method:'POST',headers:{secret:'eo-secret'},body:JSON.stringify({
  id:'EO-1',store_id:'store-A',created_at:'2026-08-09T10:00:00+02:00',total_cost:750,status:'pending',
  full_name:'محمود',phone:'0100',government:'أسيوط',cart_items:[{quantity:1,product:{name:'ترينج'}}]})});
check('الويبهوك سجّل الأوردر لصاحب المتجر', orders.get('EO-1')?.client_id==='c1', '→ '+orders.get('EO-1')?.gov);
const [,ord]=await j(await call('/api/orders',{method:'POST',
  body:JSON.stringify({clientId:'c1',name:'سارة',phone:'0111',total:300,date:'2026-08-09'})},clientCookie));
check('أوردر العميل بيتحوّل لحسابه هو', ord.order.clientId==='c2','→ '+ord.order.clientId);
await call('/api/orders/EO-1',{method:'PATCH',body:JSON.stringify({awb:'JT123EG'})},adminCookie);
check('البوليصة بتنقل الحالة تلقائياً', orders.get('EO-1').awb==='JT123EG'&&orders.get('EO-1').state==='in_transit');
check('العميل ممنوع يعدّل الأوردر',
  (await call('/api/orders/EO-1',{method:'PATCH',body:JSON.stringify({state:'delivered'})},clientCookie)).status===404);
await call('/webhooks/tracking',{method:'POST',body:JSON.stringify({trackNo:'JT123EG',latestEvent:'تم التسليم للعميل'})});
check('تتبع J&T حدّث الحالة', orders.get('EO-1').state==='delivered');

head('كلمات المرور والقفل');
check('تغيير كلمة المرور بالقديمة الغلط مرفوض',
  (await call('/api/change-password',{method:'POST',body:JSON.stringify({current:'wrong1234',next:'NewPass1234'})},clientCookie)).status===401);
check('العميل غيّر كلمة مروره',
  (await call('/api/change-password',{method:'POST',body:JSON.stringify({current:'ClientPass99',next:'NewPass1234'})},clientCookie)).status===200);
check('القديمة بقت مرفوضة',
  (await call('/api/login',{method:'POST',body:JSON.stringify({email:'b@x.com',password:'ClientPass99'})})).status===401);
for(let i=0;i<5;i++) await call('/api/login',{method:'POST',body:JSON.stringify({email:'b@x.com',password:'bad'+i+'xxxx'})});
check('قفل مؤقت بعد ٥ محاولات فاشلة',
  (await call('/api/login',{method:'POST',body:JSON.stringify({email:'b@x.com',password:'NewPass1234'})})).status===429);
const adminId=[...users.values()].find(u=>u.role==='admin').id;
check('ما ينفعش تمسح آخر حساب إدارة',
  (await call('/api/users/'+adminId,{method:'DELETE'},adminCookie)).status===400);

console.log(`\n${pass} نجحوا · ${fail} فشلوا`);
process.exit(fail?1:0);
