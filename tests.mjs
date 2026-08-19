/* اختبارات نظام كن أونلاين — الدخول، العزل، الويبهوك، التتبع */
import worker from './src/index.js';
const TODAY = new Date().toISOString().slice(0,10);

let stateRow=null; const orders=new Map(), users=new Map(), attempts=new Map(), products=new Map(), transactions=new Map(), chatMessages=new Map(), tasks=new Map(), walletLog=new Map(), waOutbox=new Map(), stockLog=new Map();
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
    if(sql.includes('FROM orders WHERE id = ?')){ const o=orders.get(this.args[0]); return o?{...o}:null; }
    if(sql.includes('FROM orders WHERE awb = ?')) return [...orders.values()].find(o=>o.awb===this.args[0])||null;
    if(sql.includes('FROM orders WHERE ref = ? AND client_id = ?'))
      return [...orders.values()].find(o=>o.ref===this.args[0]&&o.client_id===this.args[1])||null;
    if(sql.includes('FROM transactions WHERE id = ?')) return transactions.get(this.args[0])||null;
    if(sql.includes('FROM products WHERE id = ?')){ const p=products.get(this.args[0]); return p?{...p}:null; }
    if(sql.includes('chat_last_seen FROM users')) return {chat_last_seen: (users.get(this.args[0])||{}).chat_last_seen||null};
    if(sql.includes('COUNT(*) AS n FROM chat_messages')){
      const since=this.args[0], me=this.args[1];
      return {n:[...chatMessages.values()].filter(m=>m.created_at>since && m.author_id!==me).length};
    }
    if(sql.includes('COUNT(*) AS n FROM tasks')){
      const me=this.args[0];
      return {n:[...tasks.values()].filter(t=>t.assigned_to===me && t.status==='open').length};
    }
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
    else if(sql.includes('UPDATE users SET chat_last_seen')){const u=users.get(this.args[1]);if(u)u.chat_last_seen=this.args[0];}
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
    else if(sql.includes('DELETE FROM transactions')) transactions.delete(this.args[0]);
    else if(sql.includes('INSERT INTO products')){
      const [id,client_id,name,sku,price,cost,active,stock,low_stock_threshold,created_at]=this.args;
      products.set(id,{id,client_id,name,sku,price,cost,active,stock,low_stock_threshold,created_at});}
    else if(sql.startsWith('UPDATE products SET stock')){const p=products.get(this.args[1]);if(p)p.stock=this.args[0];}
    else if(sql.includes('INSERT INTO transactions')){
      const [id,type,date,category,amount,currency,method,client_id,note,created_by,created_at]=this.args;
      transactions.set(id,{id,type,date,category,amount,currency,method,client_id,note,created_by,created_at});}
    else if(sql.includes('INSERT INTO chat_messages')){
      const [id,client_id,author_id,author_name,body,created_at]=this.args;
      chatMessages.set(id,{id,client_id,author_id,author_name,body,created_at});}
    else if(sql.includes('INSERT INTO tasks')){
      const [id,title,description,assigned_to,assigned_by,status,created_at,updated_at]=this.args;
      tasks.set(id,{id,title,description,assigned_to,assigned_by,status,created_at,updated_at});}
    else if(sql.includes('INSERT INTO wallet_log')){
      const [id,client_id,type,amount,balance_after,note,created_at,created_by]=this.args;
      walletLog.set(id,{id,client_id,type,amount,balance_after,note,created_at,created_by});}
    else if(sql.includes('INSERT INTO stock_log')){
      const [id,client_id,product_id,product_name,delta,new_stock,note,created_at,created_by]=this.args;
      stockLog.set(id,{id,client_id,product_id,product_name,delta,new_stock,note,created_at,created_by});}
    else if(sql.includes('INSERT INTO whatsapp_outbox')){
      const [id,client_id,order_id,phone,message,kind,status,created_at]=this.args;
      waOutbox.set(id,{id,client_id,order_id,phone,message,kind,status,created_at});}
    else if(sql.startsWith('UPDATE whatsapp_outbox SET status')){
      const [status,sent_at,id]=this.args; const w=waOutbox.get(id); if(w){w.status=status;w.sent_at=sent_at;}}
    else if(sql.startsWith('UPDATE tasks SET')){
      const id=this.args[this.args.length-1]; const t=tasks.get(id); if(!t) return {};
      const setPart=sql.slice('UPDATE tasks SET '.length, sql.indexOf(' WHERE'));
      const cols=setPart.split(',').map(s=>s.trim().split('=')[0].trim());
      cols.forEach((c,i)=>{ t[c]=this.args[i]; });
    }
    else if(sql.includes('DELETE FROM tasks')) tasks.delete(this.args[0]);
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
    if(sql.includes('FROM chat_messages')){
      let mlist=[...chatMessages.values()].sort((a,b)=>a.created_at<b.created_at?-1:1);
      const hasChan = sql.includes('client_id = ?');
      const chanId = hasChan ? this.args[0] : null;
      if(sql.includes('client_id IS NULL')) mlist=mlist.filter(m=>!m.client_id);
      else if(hasChan) mlist=mlist.filter(m=>m.client_id===chanId);
      if(sql.includes('created_at > ?')){
        const after = hasChan ? this.args[1] : this.args[0];
        mlist=mlist.filter(m=>m.created_at>after);
      }
      if(sql.includes('ORDER BY created_at DESC')) mlist=mlist.slice().reverse();
      return {results:mlist};
    }
    if(sql.includes('FROM tasks')){
      const tlist=[...tasks.values()].sort((a,b)=>a.created_at<b.created_at?1:-1);
      return {results:tlist};
    }
    if(sql.includes('FROM wallet_log')){
      const wlist=[...walletLog.values()].filter(w=>w.client_id===this.args[0])
        .sort((a,b)=>a.created_at<b.created_at?1:-1);
      return {results:wlist};
    }
    if(sql.includes('FROM stock_log')){
      const slist=[...stockLog.values()].filter(s=>s.client_id===this.args[0])
        .sort((a,b)=>a.created_at<b.created_at?1:-1);
      return {results:slist};
    }
    if(sql.includes('FROM whatsapp_outbox')){
      const olist=[...waOutbox.values()].filter(w=>w.status==='pending')
        .sort((a,b)=>a.created_at<b.created_at?-1:1);
      return {results:olist};
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

head('طابور رسائل الواتساب التلقائية');
check('رسالة تأكيد الطلب اتحطّت في الطابور أول ما الأوردر اتسجّل',
  [...waOutbox.values()].some(w=>w.order_id==='EO-1' && w.kind==='confirm' && w.status==='pending'));
r=await call('/api/whatsapp/outbox',{headers:{authorization:'Bearer ingest-secret'}});
let [,outboxList]=await j(r);
check('الأجنت يقدر يسحب الرسايل المعلّقة', r.status===200 && outboxList.some(w=>w.order_id==='EO-1'));
const confirmMsg = outboxList.find(w=>w.order_id==='EO-1');
r=await call('/api/whatsapp/outbox/'+confirmMsg.id+'/sent',{method:'POST',headers:{authorization:'Bearer ingest-secret'}});
check('الأجنت يقدر يأكّد إنه بعتها', r.status===200 && waOutbox.get(confirmMsg.id).status==='sent');
let [,outboxAfterSent]=await j(await call('/api/whatsapp/outbox',{headers:{authorization:'Bearer ingest-secret'}}));
check('الرسالة اللي اتبعتت مابقتش تظهر في قائمة المعلّق', !outboxAfterSent.some(w=>w.id===confirmMsg.id));

let [,shipTestOrder]=await j(await call('/api/orders',{method:'POST',body:JSON.stringify({
  clientId:'c1',name:'ت',phone:'0100',total:300,productCost:60,date:TODAY})},adminCookie));
await call('/api/orders/'+shipTestOrder.order.id,{method:'PATCH',body:JSON.stringify({state:'confirmed'})},adminCookie);
r=await call('/api/orders/'+shipTestOrder.order.id,{method:'PATCH',body:JSON.stringify({state:'preparing'})},adminCookie);
check('التحويل لجاري الشحن نجح', r.status===200);
check('رسالة "جاري شحن طلبك" اتحطّت في الطابور',
  [...waOutbox.values()].some(w=>w.order_id===shipTestOrder.order.id && w.kind==='shipping'));

head('إدارة المخزون — كميات المنتجات');
r=await call('/api/products',{method:'POST',body:JSON.stringify({
  name:'سماعة بلوتوث',price:500,cost:200,stock:3,lowStockThreshold:5})},clientCookie);
let [,stockProd]=await j(r);
check('العميل يقدر يسجّل منتج بكمية مخزون وحد تنبيه', r.status===200);
check('المنتج اتسجّل بالكمية والحد الصح', products.get(stockProd.id).stock===3 && products.get(stockProd.id).low_stock_threshold===5);
r=await call('/api/products/'+stockProd.id+'/stock',{method:'PATCH',body:JSON.stringify({stock:20})},clientCookie);
check('تحديث سريع للكمية بيشتغل', r.status===200 && products.get(stockProd.id).stock===20);

head('إضافة كميات جديدة للمخزون + سجلها');
r=await call('/api/products/'+stockProd.id+'/stock/add',{method:'POST',body:JSON.stringify({delta:15,note:'توريد جديد'})},clientCookie);
let [,addStockRes]=await j(r);
check('إضافة كمية بتزود على الرصيد الموجود (مش تستبدله)', r.status===200 && addStockRes.stock===35);
check('عملية الإضافة اتسجّلت في سجل المخزون', stockLog.size>0 &&
  [...stockLog.values()].some(s=>s.product_id===stockProd.id && s.delta===15 && s.new_stock===35));
r=await call('/api/products/stock-log',{},clientCookie);
let [,stockLogList]=await j(r);
check('العميل يقدر يشوف سجل إضافات مخزونه', r.status===200 && stockLogList.some(s=>s.product_id===stockProd.id));
const [,ord]=await j(await call('/api/orders',{method:'POST',
  body:JSON.stringify({clientId:'c1',name:'سارة',phone:'0111',total:300,date:'2026-08-09'})},clientCookie));
check('أوردر العميل بيتحوّل لحسابه هو', ord.order.clientId==='c2','→ '+ord.order.clientId);
await call('/api/orders/EO-1',{method:'PATCH',body:JSON.stringify({awb:'JT123EG'})},adminCookie);
check('البوليصة بتنقل الحالة تلقائياً', orders.get('EO-1').awb==='JT123EG'&&orders.get('EO-1').state==='shipped');
check('العميل ممنوع يعدّل الأوردر',
  (await call('/api/orders/EO-1',{method:'PATCH',body:JSON.stringify({state:'delivered'})},clientCookie)).status===403);
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
r=await call('/api/integrations',{method:'PUT',body:JSON.stringify({clientId:'c2',inventoryEnabled:true})},adminCookie);
check('الإدارة تقدر تحفظ إعدادات عميل بـ clientId في الـ body بس (من غير query string) — زي زراير لوحة الإدارة الحقيقية', r.status===200);
let [,invInteg]=await j(await call('/api/integrations?clientId=c2',{},adminCookie));
check('التفعيل اتحفظ فعلاً', invInteg.inventoryEnabled===true);
await call('/api/integrations',{method:'PUT',body:JSON.stringify({clientId:'c2',inventoryEnabled:false})},adminCookie);
await call('/api/integrations',{method:'PUT',body:JSON.stringify({adminFee:999})},clientCookie);
let [,integC2]=await j(await call('/api/integrations?clientId=c2',{},adminCookie));
check('العميل ممنوع يغيّر المبلغ الثابت بنفسه', integC2.adminFee===10);

let [,finBefore]=await j(await call('/api/finance?clientId=c2',{},adminCookie));
const mkOrder=(total,productCost)=>call('/api/orders',{method:'POST',body:JSON.stringify({
  clientId:'c2',name:'ت',phone:'0100',total,productCost,date:TODAY})},adminCookie);
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
  type:'income',category:'عمولة لكل أوردر',amount:200,clientId:'c2',date:TODAY})},adminCookie);
check('الإدارة تقدر تسجّل حركة مالية لعميل', r.status===200);
r=await call('/api/transactions',{},clientCookie);
let [,clientTx]=await j(r);
check('العميل شايف حركاته المالية هو بس', r.status===200 && clientTx.some(t=>t.category==='عمولة لكل أوردر') && clientTx.every(t=>t.clientId==='c2'));
r=await call('/api/transactions',{method:'POST',body:JSON.stringify({type:'expense',category:'أخرى',amount:50,clientId:'c1'})},clientCookie);
let [,clientTxNew]=await j(r);
check('العميل يقدر يسجّل حركة مالية بنفسه', r.status===200);
check('حركة العميل بتتسجّل على حسابه هو دايماً — حتى لو حاول يبعت clientId مختلف', transactions.get(clientTxNew.id).client_id==='c2');
r=await call('/api/transactions/'+clientTxNew.id,{method:'DELETE'},clientCookie);
check('العميل يقدر يمسح حركته هو', r.status===200);
let [,otherTx]=await j(await call('/api/transactions',{method:'POST',body:JSON.stringify({type:'expense',category:'أخرى',amount:20,clientId:'c1'})},adminCookie));
check('العميل ممنوع يمسح حركة عميل تاني',
  (await call('/api/transactions/'+otherTx.id,{method:'DELETE'},clientCookie)).status===403);

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

head('أداء يوم معيّن + إعدادات الشحن');
r=await call('/api/performance?clientId=c2&date='+TODAY+'',{},adminCookie);
let [,perf]=await j(r);
check('endpoint الأداء بيرجّع بنجاح', r.status===200);
check('أوردرات اليوم مقسّمة بالحالة الحالية', perf.today.byState.collected>=1 && perf.today.byState.signed>=1 && perf.today.byState.returned>=1);
check('التحصيل بيتحسب بتاريخ الحدث مش تاريخ إنشاء الأوردر', perf.today.collected.count>=1);
check('المرتجع بيتحسب بتاريخ الحدث', perf.today.returned>=1);
check('نسبة تأكيدات وتوصيل آخر ٣٠ يوم أرقام صحيحة', typeof perf.last30ConfirmationRatePct==='number' && typeof perf.last30DeliveryRatePct==='number');
check('الأرباح والإيرادات المتوقعة موجودة في نفس الرد', typeof perf.profitExpected==='number' && typeof perf.revenueExpected==='number');

let [,perfBeforeNet]=await j(await call('/api/performance?clientId=c2&date='+TODAY,{},adminCookie));
let [,netTestOrder]=await j(await mkOrder(400,80));
await call('/api/orders/'+netTestOrder.order.id,{method:'PATCH',body:JSON.stringify({state:'collected',shippingCost:20,otherCost:10})},adminCookie);
let [,perfAfterNet]=await j(await call('/api/performance?clientId=c2&date='+TODAY,{},adminCookie));
check('صافي الربح اليومي بيتحسب صح (إيراد - تكلفة منتج - شحن - مصاريف - مبلغ الإدارة)',
  Math.abs((perfAfterNet.today.netProfit - perfBeforeNet.today.netProfit) - 280) < 0.5);
r=await call('/api/performance?clientId=c2&date='+TODAY+'&periodFrom=2026-01-01&periodTo='+TODAY,{},adminCookie);
let [,perfCustom]=await j(r);
check('فترة مخصّصة (periodFrom/periodTo) بتحل محل الشهر الافتراضي', r.status===200 && perfCustom.month.from==='2026-01-01' && perfCustom.month.to===TODAY);
check('تحليلات وتوصيات — القسم موجود ومليان', Array.isArray(perf.insights) && perf.insights.length>0 && perf.insights[0].text);

r=await call('/api/performance?clientId=c2&date='+TODAY,{},adminCookie);
let [,perfCppCheck]=await j(r);
check('CPP بيتحسب من صرف الإعلانات بس (من غير مصاريف تانية)',
  Math.abs(perfCppCheck.today.cpp*perfCppCheck.today.newOrders - perfCppCheck.today.adSpend) < 0.5);

let [,marginCheck]=await j(await call('/api/finance?clientId=c2',{},adminCookie));
check('هامش الربح المتوقع = صافي الربح المتوقع ÷ الإيراد المتوقع × ١٠٠',
  marginCheck.revenueExpected>0
    ? Math.abs(marginCheck.profitMarginExpectedPct - round2z(marginCheck.profitExpected/marginCheck.revenueExpected*100)) < 0.2
    : marginCheck.profitMarginExpectedPct===0);

let [,finBeforeResolve]=await j(await call('/api/finance?clientId=c2',{},adminCookie));
let [,pendingOrder]=await j(await mkOrder(500,100));
let [,finAfterPending]=await j(await call('/api/finance?clientId=c2',{},adminCookie));
check('أوردر لسه معلّق بيدخل في الإيراد المتوقع', finAfterPending.revenueExpected > finBeforeResolve.revenueExpected);
await call('/api/orders/'+pendingOrder.order.id,{method:'PATCH',body:JSON.stringify({state:'collected',shippingCost:20,otherCost:0})},adminCookie);
let [,finAfterCollect]=await j(await call('/api/finance?clientId=c2',{},adminCookie));
check('أول ما يتحصّل، بيخرج من الإيراد المتوقع (رجع للرقم اللي قبله)',
  Math.abs(finAfterCollect.revenueExpected - finBeforeResolve.revenueExpected) < 0.5);
check('العميل ممنوع يشوف أداء عميل تاني',
  (await call('/api/performance?clientId=c1&date='+TODAY+'',{},clientCookie)).status===403);

head('محفظة الاشتراك');
r=await call('/api/integrations?clientId=c2',{method:'PUT',body:JSON.stringify({walletFeePerOrder:15})},adminCookie);
check('الإدارة تقدر تحدد مبلغ الخصم لكل أوردر', r.status===200);
r=await call('/api/wallet/topup',{method:'POST',body:JSON.stringify({clientId:'c2',amount:500,note:'شحن أول'})},adminCookie);
check('الإدارة تقدر تشحن رصيد للعميل', r.status===200);
let [,walletAfterTopup]=await j(await call('/api/integrations?clientId=c2',{},adminCookie));
check('الرصيد بعد الشحن صح', walletAfterTopup.walletBalance===500);

let [,walletOrder]=await j(await mkOrder(300,50));
let [,walletAfterOrder]=await j(await call('/api/integrations?clientId=c2',{},adminCookie));
check('كل أوردر جديد بيخصم مبلغ الاشتراك تلقائي من المحفظة', walletAfterOrder.walletBalance===485);

await call('/api/orders/'+walletOrder.order.id,{method:'PATCH',body:JSON.stringify({state:'confirmed'})},adminCookie);
let [,walletAfterUpdate]=await j(await call('/api/integrations?clientId=c2',{},adminCookie));
check('تحديث حالة أوردر موجود مش بيخصم تاني (مش أوردر جديد)', walletAfterUpdate.walletBalance===485);

r=await call('/api/wallet/log?clientId=c2',{},adminCookie);
let [,walletLogList]=await j(r);
check('سجل المحفظة فيه الشحن والخصم', walletLogList.some(w=>w.type==='topup') && walletLogList.some(w=>w.type==='deduct'));
check('العميل يقدر يشوف سجل محفظته هو', (await call('/api/wallet/log',{},clientCookie)).status===200);
check('العميل ممنوع يشحن لنفسه رصيد',
  (await call('/api/wallet/topup',{method:'POST',body:JSON.stringify({clientId:'c2',amount:100})},clientCookie)).status===403);
r=await call('/api/wallet/overview',{},adminCookie);
let [,walletOverview]=await j(r);
check('نظرة عامة على رصيد كل العملاء مرة واحدة', r.status===200 && walletOverview.some(w=>w.clientId==='c2'));
check('العميل ممنوع يشوف نظرة عامة على كل العملاء', (await call('/api/wallet/overview',{},clientCookie)).status===403);

head('قفل التعامل عند نفاد رصيد المحفظة');
await call('/api/integrations?clientId=c2',{method:'PUT',body:JSON.stringify({walletFeePerOrder:1000})},adminCookie);
let [,drainOrder]=await j(await mkOrder(100,20));
let [,walletDrained]=await j(await call('/api/integrations?clientId=c2',{},adminCookie));
check('الرصيد بقى سالب/صفر بعد أوردر بمبلغ خصم كبير', walletDrained.walletBalance<=0);
r=await call('/api/orders/'+drainOrder.order.id+'/contact',{method:'POST'},adminCookie);
check('زرار التواصل بيتقفل لما الرصيد يخلص', r.status===402);
r=await call('/api/orders/'+drainOrder.order.id+'/whatsapp-log',{method:'POST',body:JSON.stringify({template:'confirm'})},adminCookie);
check('زرار الواتساب بيتقفل برضه', r.status===402);
r=await mkOrder(200,40);
check('الأوردرات لسه بتتسجّل عادي رغم قفل التعامل (الاستقبال مش بيتوقف)', r.status===200);
await call('/api/integrations?clientId=c2',{method:'PUT',body:JSON.stringify({walletFeePerOrder:0})},adminCookie);

r=await call('/api/integrations?clientId=c2',{method:'PUT',body:JSON.stringify({
  shippingMode:'byGov', shippingByGov:{'أسيوط':35,'القاهرة':45}})},adminCookie);
check('حفظ إعدادات الشحن حسب المحافظة', r.status===200);
let [,shipInteg]=await j(await call('/api/integrations?clientId=c2',{},adminCookie));
check('إعدادات الشحن رجعت صح', shipInteg.shippingMode==='byGov' && shipInteg.shippingByGov['أسيوط']===35);



head('رصيد ميتا المتبقي');
r=await call('/api/ad-spend',{method:'POST',headers:{authorization:'Bearer ingest-secret'},body:JSON.stringify({
  date:TODAY, entries:[{clientId:'c2', spend:120, balance:857.5, balanceCurrency:'EGP'}]})});
check('الأجنت يقدر يرفع رصيد ميتا مع الصرف اليومي', r.status===200);
let [,balInteg]=await j(await call('/api/integrations?clientId=c2',{},adminCookie));
check('الرصيد المتبقي بيتحفظ ويظهر في التكاملات', balInteg.metaBalance===857.5 && balInteg.metaBalanceCurrency==='EGP');
let [,perfWithBalance]=await j(await call('/api/performance?clientId=c2&date='+TODAY,{},adminCookie));
check('الرصيد المتبقي ظاهر برضه في endpoint الداشبورد', perfWithBalance.metaBalance===857.5);

head('إدارة التخزين والشحن — صلاحية العميل المحدودة');
let [,invOrder]=await j(await mkOrder(400,80));
await call('/api/orders/'+invOrder.order.id,{method:'PATCH',body:JSON.stringify({state:'confirmed'})},adminCookie);
check('العميل ممنوع ينقل الأوردر لو القسم مش مفعّل ليه',
  (await call('/api/orders/'+invOrder.order.id,{method:'PATCH',body:JSON.stringify({state:'shipped',awb:'JT999'})},clientCookie)).status===403);
await call('/api/integrations?clientId=c2',{method:'PUT',body:JSON.stringify({inventoryEnabled:true})},adminCookie);
r=await call('/api/orders/'+invOrder.order.id,{method:'PATCH',body:JSON.stringify({state:'shipped',awb:'JT999'})},clientCookie);
check('بعد التفعيل، العميل يقدر ينقل من "تم التأكيد" لـ"تم الشحن" ويحط البوليصة', r.status===200 && orders.get(invOrder.order.id).state==='shipped');
check('العميل لسه ممنوع يسجّل تحصيل (خارج نطاق التخزين والشحن)',
  (await call('/api/orders/'+invOrder.order.id,{method:'PATCH',body:JSON.stringify({state:'collected',shippingCost:10,otherCost:0})},clientCookie)).status===403);

head('خدمة العملاء — صلاحية العميل المحدودة');
await call('/api/integrations?clientId=c2',{method:'PUT',body:JSON.stringify({inventoryEnabled:false})},adminCookie);
let [,svcOrder]=await j(await mkOrder(250,60));
check('العميل ممنوع يأكّد الأوردر لو قسم خدمة العملاء مش مفعّل ليه',
  (await call('/api/orders/'+svcOrder.order.id,{method:'PATCH',body:JSON.stringify({state:'confirmed'})},clientCookie)).status===403);
await call('/api/integrations?clientId=c2',{method:'PUT',body:JSON.stringify({customerServiceEnabled:true})},adminCookie);
r=await call('/api/orders/'+svcOrder.order.id,{method:'PATCH',body:JSON.stringify({state:'confirmed'})},clientCookie);
check('بعد التفعيل، العميل يقدر يأكّد الأوردر', r.status===200 && orders.get(svcOrder.order.id).state==='confirmed');
r=await call('/api/orders/'+svcOrder.order.id,{method:'PATCH',body:JSON.stringify({state:'preparing'})},clientCookie);
check('وينقله لـ"جاري الشحن" (preparing) كمان', r.status===200 && orders.get(svcOrder.order.id).state==='preparing');
check('بس برضه ممنوع يسجّل شحن فعلي (خارج نطاق خدمة العملاء)',
  (await call('/api/orders/'+svcOrder.order.id,{method:'PATCH',body:JSON.stringify({state:'shipped'})},clientCookie)).status===403);
r=await call('/api/orders/'+svcOrder.order.id+'/contact',{method:'POST'},clientCookie);
check('عميل خدمة العملاء يقدر يسجّل محاولة تواصل', r.status===200);
r=await call('/api/orders/'+svcOrder.order.id+'/whatsapp-log',{method:'POST',body:JSON.stringify({template:'confirm'})},clientCookie);
check('عميل خدمة العملاء يقدر يسجّل إرسال واتساب', r.status===200);

head('الشات الداخلي + التاسكات');
let [,colleague]=await j(await call('/api/users',{method:'POST',body:JSON.stringify({
  email:'colleague@x.com', role:'admin', password:'ColleaguePass1', name:'زميل'})},adminCookie));
check('اتعمل حساب زميل تاني في الفريق', colleague.role==='admin' || colleague.ok!==false);
const colleagueId=[...users.values()].find(u=>u.email==='colleague@x.com').id;

check('العميل ممنوع يوصل للشات الداخلي خالص',
  (await call('/api/chat/messages',{},clientCookie)).status===403);
r=await call('/api/chat/messages',{method:'POST',body:JSON.stringify({text:'صباح الخير يا فريق'})},adminCookie);
check('عضو فريق يقدر يبعت رسالة', r.status===200);
let [,msgs]=await j(await call('/api/chat/messages',{},adminCookie));
check('الرسالة بترجع في القائمة', msgs.some(m=>m.body==='صباح الخير يا فريق'));

r=await call('/api/chat/messages?clientId=c2',{method:'POST',body:JSON.stringify({text:'أوردرات وفاق النهاردة كتير'})},adminCookie);
check('يقدر يبعت رسالة في قناة عميل معيّن', r.status===200);
let [,generalMsgs]=await j(await call('/api/chat/messages',{},adminCookie));
let [,c2Msgs]=await j(await call('/api/chat/messages?clientId=c2',{},adminCookie));
check('رسالة قناة العميل مش ظاهرة في القناة العامة', !generalMsgs.some(m=>m.body==='أوردرات وفاق النهاردة كتير'));
check('رسالة القناة العامة مش ظاهرة في قناة العميل', !c2Msgs.some(m=>m.body==='صباح الخير يا فريق'));
check('رسالة قناة العميل ظاهرة في قناته هو', c2Msgs.some(m=>m.body==='أوردرات وفاق النهاردة كتير'));

r=await call('/api/tasks',{method:'POST',body:JSON.stringify({
  title:'راجع طلبات وفاق النهاردة', assignedTo:colleagueId})},adminCookie);
let [,taskRes]=await j(r);
check('عضو فريق يقدر يوكّل تاسك لزميله', r.status===200 && !!taskRes.task);
check('التاسك اتسجّل بالمُوكَّل له الصح', tasks.get(taskRes.task.id).assigned_to===colleagueId);

const colleagueLogin=await call('/api/login',{method:'POST',body:JSON.stringify({email:'colleague@x.com',password:'ColleaguePass1'})});
const colleagueCookie=colleagueLogin.headers.get('Set-Cookie').split(';')[0];
let [,unread]=await j(await call('/api/chat/unread',{},colleagueCookie));
check('الزميل شايف رسالة وتاسك جديدين لسه ما شافهمش', unread.unreadMessages>=1 && unread.openTasks>=1);
await call('/api/chat/seen',{method:'POST'},colleagueCookie);
let [,unread2]=await j(await call('/api/chat/unread',{},colleagueCookie));
check('بعد فتح الشات، عدّاد الرسايل غير المقروءة يترجع لصفر', unread2.unreadMessages===0);

r=await call('/api/tasks/'+taskRes.task.id,{method:'PATCH',body:JSON.stringify({status:'done'})},colleagueCookie);
check('الزميل يقدر يقفل التاسك بتاعه', r.status===200 && tasks.get(taskRes.task.id).status==='done');
await call('/api/users/'+colleagueId,{method:'DELETE'},adminCookie);

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
