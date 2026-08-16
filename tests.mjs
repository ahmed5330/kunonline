/* اختبارات نظام كن أونلاين — الدخول، العزل، الويبهوك، التتبع */
import worker from './src/index.js';

let stateRow=null; const orders=new Map(), users=new Map(), attempts=new Map(), products=new Map(), transactions=new Map();
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
    if(sql.includes('FROM orders WHERE id = ?')) return orders.get(this.args[0])||null;
    if(sql.includes('FROM orders WHERE awb = ?')) return [...orders.values()].find(o=>o.awb===this.args[0])||null;
    if(sql.includes('FROM orders WHERE ref = ? AND client_id = ?'))
      return [...orders.values()].find(o=>o.ref===this.args[0]&&o.client_id===this.args[1])||null;
    return null;
  },
  async run(){
    if(sql.includes('INSERT INTO state')) stateRow=this.args[0];
    else if(sql.includes('INSERT INTO users')){const[id,email,name,password,role,client_id,status,created_at]=this.args;
      users.set(id,{id,email,name,password,role,client_id,status,created_at,last_login:null});}
    else if(sql.startsWith('UPDATE users SET email')){const u=users.get(this.args[6]);
      if(u)Object.assign(u,{email:this.args[0],name:this.args[1],password:this.args[2],role:this.args[3],client_id:this.args[4],status:this.args[5]});}
    else if(sql.includes('UPDATE users SET password')){const u=users.get(this.args[1]);if(u)u.password=this.args[0];}
    else if(sql.includes('UPDATE users SET last_login')){const u=users.get(this.args[1]);if(u)u.last_login=this.args[0];}
    else if(sql.includes('DELETE FROM users')) users.delete(this.args[0]);
    else if(sql.includes('INSERT INTO login_attempts')) attempts.set(this.args[0],{email:this.args[0],fails:this.args[1],locked_until:this.args[2]});
    else if(sql.includes('DELETE FROM login_attempts')) attempts.delete(this.args[0]);
    else if(sql.includes('INSERT INTO orders')){
      const [id,client_id,ref,date,name,phone,gov,address,product,product_id,unit_price,qty,total,
        product_cost,shipping_cost,other_cost,source,note,awb,state,checkpoint,signed_at,collected_at,
        contact_log,history,created_at]=this.args;
      orders.set(id,{id,client_id,ref,date,name,phone,gov,address,product,product_id,unit_price,qty,total,
        product_cost,shipping_cost,other_cost,source,note,awb,state,checkpoint,signed_at,collected_at,
        contact_log,history,created_at});}
    else if(sql.startsWith('UPDATE orders SET state = ?, awb = ?')){const o=orders.get(this.args[8]);
      if(o){o.state=this.args[0];o.awb=this.args[1];o.checkpoint=this.args[2];
        o.shipping_cost=this.args[3];o.other_cost=this.args[4];o.signed_at=this.args[5];
        o.collected_at=this.args[6];o.history=this.args[7];}}
    else if(sql.startsWith('UPDATE orders SET contact_log = ?, history = ?')){const o=orders.get(this.args[2]);
      if(o){ o.contact_log=this.args[0]; o.history=this.args[1]; }}
    else if(sql.startsWith('UPDATE orders SET history = ?')){const o=orders.get(this.args[1]);
      if(o) o.history=this.args[0];}
    else if(sql.includes('WHERE awb = ?')){for(const o of orders.values()) if(o.awb===this.args[2]) o.state=this.args[0];}
    else if(sql.includes('UPDATE orders SET state = ?, checkpoint = ? WHERE id')){const o=orders.get(this.args[2]);if(o)o.state=this.args[0];}
    else if(sql.includes('DELETE FROM orders')) orders.delete(this.args[0]);
    else if(sql.includes('INSERT INTO products')){
      const [id,client_id,name,sku,price,cost,active,created_at]=this.args;
      products.set(id,{id,client_id,name,sku,price,cost,active,created_at});}
    else if(sql.includes('INSERT INTO transactions')){
      const [id,type,date,category,amount,currency,method,client_id,note,created_by,created_at]=this.args;
      transactions.set(id,{id,type,date,category,amount,currency,method,client_id,note,created_by,created_at});}
    return {};
  },
  async all(){
    if(sql.includes('FROM users')) return {results:[...users.values()]};
    if(sql.includes('FROM products')){
      let plist=[...products.values()];
      if(sql.includes('WHERE client_id = ?')) plist=plist.filter(p=>p.client_id===this.args[0]);
      return {results:plist};
    }
    if(sql.includes('FROM transactions')){
      let tlist=[...transactions.values()];
      if(sql.includes('WHERE client_id = ?')) tlist=tlist.filter(t=>t.client_id===this.args[0]);
      return {results:tlist};
    }
    let list=[...orders.values()];
    if(sql.includes('WHERE client_id = ?')) list=list.filter(o=>o.client_id===this.args[0]);
    if(sql.includes('NOT IN')) list=list.filter(o=>o.awb&&!['delivered','returned','cancelled'].includes(o.state));
    return {results:list};
  }
});
const env={DB:{prepare:s=>stmt(s)},ASSETS:{fetch:async()=>new Response('<html>dashboard</html>')},
  SESSION_SECRET:'test-secret',EASYORDERS_WEBHOOK_SECRET:'eo-secret',
  INGEST_TOKEN:'ingest-secret',TOKEN_ENC_KEY:'test-encryption-key-32-chars-long'};
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
check('منتج إيزي أوردرز اتسجّل تلقائي في كتالوج المتجر',
  [...products.values()].some(p=>p.client_id==='c1' && p.name==='ترينج'));
const [,ord]=await j(await call('/api/orders',{method:'POST',
  body:JSON.stringify({clientId:'c1',name:'سارة',phone:'0111',total:300,date:'2026-08-09'})},clientCookie));
check('أوردر العميل بيتحوّل لحسابه هو', ord.order.clientId==='c2','→ '+ord.order.clientId);
await call('/api/orders/EO-1',{method:'PATCH',body:JSON.stringify({awb:'JT123EG'})},adminCookie);
check('البوليصة بتنقل الحالة تلقائياً', orders.get('EO-1').awb==='JT123EG'&&orders.get('EO-1').state==='shipped');
check('العميل ممنوع يعدّل الأوردر',
  (await call('/api/orders/EO-1',{method:'PATCH',body:JSON.stringify({state:'delivered'})},clientCookie)).status===404);
await call('/webhooks/tracking',{method:'POST',body:JSON.stringify({trackNo:'JT123EG',latestEvent:'تم التسليم للعميل'})});
check('تتبع J&T حدّث الحالة', orders.get('EO-1').state==='signed');

head('التوكن والـ API + ضريبة الـ 14%');
check('العميل يقدر يقرا التكاملات بتاعته',
  (await call('/api/integrations',{},clientCookie)).status===200);
r=await call('/api/integrations',{method:'PUT',body:JSON.stringify({
  metaAdAccountId:'act_999', metaToken:'EAAB_SECRET_TOKEN_1234', taxEnabled:true, taxRate:14
})},clientCookie);
check('العميل حفظ توكن ميتا وفعّل الضريبة', r.status===200);
let [,integ]=await j(await call('/api/integrations',{},clientCookie));
check('التوكن ما بيرجعش كامل — آخر ٤ حروف بس', integ.metaTokenSet===true && integ.metaTokenTail==='••••1234');
check('التوكن الخام مش موجود في الرد خالص', !JSON.stringify(integ).includes('EAAB_SECRET_TOKEN_1234'));
check('التوكن الخام مش متخزّن نص عادي في state', !stateRow.includes('EAAB_SECRET_TOKEN_1234') && stateRow.includes('enc$'));
r=await call('/api/integrations',{method:'PUT',body:JSON.stringify({metaAdAccountId:'act_999_updated'})},clientCookie);
let [,integ2]=await j(await call('/api/integrations',{},clientCookie));
check('تعديل حقل من غير ما يمسح التوكن المحفوظ', integ2.metaAdAccountId==='act_999_updated' && integ2.metaTokenSet===true);
check('العميل التاني ممنوع يشوف تكاملات عميل غيره',
  (await call('/api/integrations?clientId=c1',{},clientCookie)).status===403);
check('الإدارة تقدر تشوف تكاملات أي عميل', (await call('/api/integrations?clientId=c1',{},adminCookie)).status===200);

const [,st1]=await j(await call('/api/state',{},adminCookie));
st1.entries.push({id:'e-tax1',clientId:'c2',date:'2026-08-10',adSpend:1000,revenue:0});
await call('/api/state',{method:'PUT',body:JSON.stringify(st1)},adminCookie);
const [,scoped]=await j(await call('/api/state',{},clientCookie));
const taxedEntry = scoped.entries.find(e=>e.id==='e-tax1');
check('الضريبة 14% بتتضاف على الصرف المعروض للعميل', taxedEntry && taxedEntry.adSpend===1140 && taxedEntry.adSpendNet===1000);
const [,adminScoped]=await j(await call('/api/state',{},adminCookie));
const rawEntry = adminScoped.entries.find(e=>e.id==='e-tax1');
check('الإدارة شايفة الرقم الخام من غير ضريبة', rawEntry && rawEntry.adSpend===1000);

head('ربط الواتساب — جروبات متعددة');
r=await call('/api/wa-groups',{method:'POST',body:JSON.stringify({label:'جروب استلام الطلبات'})},clientCookie);
let [,g1]=await j(r);
check('العميل يقدر يطلب ربط جروب (Pending)', r.status===200 && g1.entry.status==='pending' && !g1.entry.groupId);
const groupId=g1.entry.id;
r=await call('/api/wa-groups/'+groupId,{method:'PATCH',body:JSON.stringify({groupId:'120363...@g.us'})},adminCookie);
let [,g2]=await j(r);
check('الإدارة تقدر تكمل الربط بـ Group ID حقيقي', r.status===200 && g2.entry.status==='linked');
check('العميل ممنوع يحط Group ID بنفسه',
  (await call('/api/wa-groups/xx',{method:'PATCH',body:JSON.stringify({groupId:'x'})},clientCookie)).status===404
  || (await call('/api/wa-groups/'+groupId,{method:'PATCH',body:JSON.stringify({groupId:'hack'})},clientCookie)).status===403);
r=await call('/api/wa-groups',{headers:{authorization:'Bearer ingest-secret'}});
let [,ingestGroups]=await j(r);
check('الأجنت (ingest) بيقرا خريطة الجروبات المربوطة', ingestGroups.groups && ingestGroups.groups['120363...@g.us']==='c2');


head('الربح والخسارة + إيداعات فيسبوك');
const round2z = n => Math.round(n*100)/100;
r=await call('/api/integrations?clientId=c2',{method:'PUT',body:JSON.stringify({adminFee:10})},adminCookie);
check('الإدارة حطت مبلغ ثابت 10ج لكل أوردر لـ c2', r.status===200);
await call('/api/integrations',{method:'PUT',body:JSON.stringify({adminFee:999})},clientCookie);
let [,integC2]=await j(await call('/api/integrations?clientId=c2',{},adminCookie));
check('العميل ممنوع يغيّر المبلغ الثابت بنفسه', integC2.adminFee===10);

let [,finBefore]=await j(await call('/api/finance?clientId=c2',{},adminCookie));
const mkOrder=(total,productCost)=>call('/api/orders',{method:'POST',body:JSON.stringify({
  clientId:'c2',name:'ت',phone:'0100',total,productCost,date:'2026-08-16'})},adminCookie);
let [,o1]=await j(await mkOrder(500,100));
let [,o2]=await j(await mkOrder(400,80));
let [,o3]=await j(await mkOrder(300,60));
await call('/api/orders/'+o1.order.id,{method:'PATCH',body:JSON.stringify({state:'collected',shippingCost:30,otherCost:5})},adminCookie);
await call('/api/orders/'+o2.order.id,{method:'PATCH',body:JSON.stringify({state:'signed',shippingCost:25,otherCost:0})},adminCookie);
await call('/api/orders/'+o3.order.id,{method:'PATCH',body:JSON.stringify({state:'returned'})},adminCookie);
let [,finAfter]=await j(await call('/api/finance?clientId=c2',{},adminCookie));
check('أرباح محصّلة = الإيراد-تكلفة المنتج-الشحن-مصاريف-المبلغ الثابت',
  round2z(finAfter.profitCollected-finBefore.profitCollected)===355);
check('أرباح منتظرة (وصلت ولسه ما اتحصّلتش)',
  round2z(finAfter.profitPending-finBefore.profitPending)===285);
check('عدّاد المرتجع اتزود واحد', finAfter.counts.returned-finBefore.counts.returned===1);
check('عدّاد المُسلَّم اتزود اتنين', finAfter.counts.delivered-finBefore.counts.delivered===2);
check('نسبة التسليم بتتحسب تلقائي من الحالات', finAfter.deliveryRatePct>0 && finAfter.deliveryRateMode==='auto');
r=await call('/api/integrations?clientId=c2',{method:'PUT',body:JSON.stringify({deliveryRateMode:'manual',deliveryRateManual:80})},adminCookie);
let [,finManual]=await j(await call('/api/finance?clientId=c2',{},adminCookie));
check('نسبة التسليم اليدوية بتتفعّل وتحل محل التلقائية', finManual.deliveryRatePct===80 && finManual.deliveryRateMode==='manual');

r=await call('/api/deposits',{method:'POST',body:JSON.stringify({amount:500,note:'إيداع تجريبي'})},clientCookie);
let [,dep1]=await j(r);
check('العميل يقدر يضيف إيداع فيسبوك بنفسه', r.status===200 && dep1.entry.amount===500);
r=await call('/api/deposits',{},clientCookie);
let [,depList]=await j(r);
check('العميل شايف إيداعاته', depList.some(d=>d.id===dep1.entry.id));
check('العميل التاني ممنوع يشوف إيداعات غيره',
  (await call('/api/deposits?clientId=c1',{},clientCookie)).status===403);
r=await call('/api/deposits/'+dep1.entry.id,{method:'DELETE'},clientCookie);
check('العميل يقدر يمسح إيداعه', r.status===200);

r=await call('/api/transactions',{method:'POST',body:JSON.stringify({
  type:'income',category:'عمولة لكل أوردر',amount:200,clientId:'c2',date:'2026-08-16'})},adminCookie);
check('الإدارة تقدر تسجّل حركة مالية لعميل', r.status===200);
r=await call('/api/transactions',{},clientCookie);
let [,clientTx]=await j(r);
check('العميل شايف حركاته المالية هو بس', r.status===200 && clientTx.some(t=>t.category==='عمولة لكل أوردر') && clientTx.every(t=>t.clientId==='c2'));
check('العميل ممنوع يسجّل حركة مالية بنفسه',
  (await call('/api/transactions',{method:'POST',body:JSON.stringify({type:'income',category:'x',amount:100})},clientCookie)).status===403);

head('كود الأوردر + الهيستوري + محاولات التواصل');
let [,newOrder]=await j(await mkOrder(200,50));
check('كود الأوردر بصيغة أول ٣ حروف + رقم ≥ 200', /^.{3}\d+$/u.test(newOrder.order.id) && +newOrder.order.id.match(/\d+$/)[0]>=200);
await call('/api/orders/'+newOrder.order.id,{method:'PATCH',body:JSON.stringify({state:'confirmed'})},adminCookie);
const storedHist = JSON.parse(orders.get(newOrder.order.id).history);
check('الهيستوري اتسجّل فيه التحول لحالة confirmed', storedHist.some(h=>h.state==='confirmed'));
check('الهيستوري فيه الحالة الأولى pending كمان', storedHist.some(h=>h.state==='pending'));

r=await call('/api/orders/'+newOrder.order.id+'/contact',{method:'POST'},adminCookie);
check('محاولة تواصل أولى تنجح', r.status===200);
await call('/api/orders/'+newOrder.order.id+'/contact',{method:'POST'},adminCookie);
r=await call('/api/orders/'+newOrder.order.id+'/contact',{method:'POST'},adminCookie);
check('محاولة تواصل تالتة في نفس اليوم تنجح', r.status===200);
r=await call('/api/orders/'+newOrder.order.id+'/contact',{method:'POST'},adminCookie);
let [,contactErr]=await j(r);
check('محاولة رابعة في نفس اليوم مرفوضة برسالة واضحة', r.status===429 && /تجاوزت/.test(contactErr.error));
const storedHist2 = JSON.parse(orders.get(newOrder.order.id).history);
check('محاولات التواصل الناجحة بتتسجّل في التاريخ', storedHist2.filter(h=>h.type==='contact').length===3);

r=await call('/api/orders/'+newOrder.order.id+'/whatsapp-log',{method:'POST',body:JSON.stringify({template:'confirm'})},adminCookie);
let [,waLogRes]=await j(r);
check('إرسال واتساب بيتسجّل في التاريخ', r.status===200 && waLogRes.history.some(h=>h.type==='whatsapp'&&h.template==='confirm'));


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
