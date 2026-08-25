/* اختبارات نظام كن أونلاين — الدخول، العزل، الويبهوك، التتبع */
import worker from './src/index.js';
const TODAY = new Date().toISOString().slice(0,10);

let stateRow=null; const orders=new Map(), users=new Map(), attempts=new Map(), products=new Map(), transactions=new Map(), chatMessages=new Map(), tasks=new Map(), walletLog=new Map(), waOutbox=new Map(), stockLog=new Map(), suppliers=new Map(), customers=new Map(), coupons=new Map(), variants=new Map();
const stmt=(sql)=>({
  args:[], bind(...a){this.args=a;return this;},
  async first(){
    if(sql.includes('FROM state')) return stateRow?{json:stateRow}:null;
    if(sql.includes("COUNT(*) AS n FROM users WHERE role")) return {n:[...users.values()].filter(u=>u.role==='admin').length};
    if(sql.includes('COUNT(*) AS n FROM users')) return {n:users.size};
    if(sql.includes('FROM users WHERE email = ?')) return [...users.values()].find(u=>u.email===this.args[0])||null;
    if(sql.includes("FROM users WHERE client_id = ? AND role = 'client'")) return [...users.values()].find(u=>u.client_id===this.args[0]&&u.role==='client')||null;
    if(sql.includes('FROM users WHERE client_id = ?')) return [...users.values()].find(u=>u.client_id===this.args[0])||null;
    if(sql.includes('FROM users WHERE id = ?')) return users.get(this.args[0])||null;
    if(sql.includes('FROM login_attempts')) return attempts.get(this.args[0])||null;
    if(sql.includes('FROM orders WHERE id = ?')){ const o=orders.get(this.args[0]); return o?{...o}:null; }
    if(sql.includes('FROM orders WHERE awb = ?')) return [...orders.values()].find(o=>o.awb===this.args[0])||null;
    if(sql.includes('FROM customers WHERE client_id = ? AND phone = ?'))
      return [...customers.values()].find(c=>c.client_id===this.args[0]&&c.phone===this.args[1])||null;
    if(sql.includes('SELECT name, note, tags FROM customers WHERE id = ?')){
      const c=customers.get(this.args[0]); return c?{name:c.name,note:c.note,tags:c.tags}:null;
    }
    if(sql.includes('FROM product_variants WHERE id = ?')){ const v=variants.get(this.args[0]); return v?{...v}:null; }
    if(sql.includes('FROM customers WHERE id = ?')){ const c=customers.get(this.args[0]); return c?{...c}:null; }
    if(sql.includes('FROM coupons WHERE client_id = ? AND code = ?'))
      return [...coupons.values()].find(c=>c.client_id===this.args[0]&&c.code===this.args[1])||null;
    if(sql.includes('FROM coupons WHERE id = ?')){ const c=coupons.get(this.args[0]); return c?{...c}:null; }
    if(sql.includes('FROM orders WHERE ref = ? AND client_id = ?'))
      return [...orders.values()].find(o=>o.ref===this.args[0]&&o.client_id===this.args[1])||null;
    if(sql.includes('FROM transactions WHERE id = ?')) return transactions.get(this.args[0])||null;
    if(sql.includes('FROM products WHERE id = ?')){ const p=products.get(this.args[0]); return p?{...p}:null; }
    if(sql.includes('FROM suppliers WHERE id = ?')){ const s=suppliers.get(this.args[0]); return s?{...s}:null; }
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
      const [id,client_id,ref,customer_id,date,name,phone,gov,address,product,product_id,variant_id,product_note,unit_price,qty,total,
        discount_amount,coupon_code,product_cost,shipping_cost,other_cost,source,note,awb,state,checkpoint,signed_at,collected_at,defer_until,
        refund_amount,return_type,restocked,contact_log,history,created_at]=this.args;
      orders.set(id,{id,client_id,ref,customer_id,date,name,phone,gov,address,product,product_id,variant_id,product_note,unit_price,qty,total,
        discount_amount,coupon_code,product_cost,shipping_cost,other_cost,source,note,awb,state,checkpoint,signed_at,collected_at,defer_until,
        refund_amount,return_type,restocked,contact_log,history,created_at});}
    else if(sql.includes('UPDATE orders SET state = ?, awb = ?')){
      const [state,awb,checkpoint,shipping_cost,other_cost,signed_at,collected_at,defer_until,
        refund_amount,return_type,restocked,history,id]=this.args;
      const o=orders.get(id);
      if(o){o.state=state;o.awb=awb;o.checkpoint=checkpoint;
        o.shipping_cost=shipping_cost;o.other_cost=other_cost;o.signed_at=signed_at;
        o.collected_at=collected_at;o.defer_until=defer_until;
        o.refund_amount=refund_amount;o.return_type=return_type;o.restocked=restocked;o.history=history;}}
    else if(sql.startsWith('UPDATE orders SET state = ?, checkpoint = ?, history = ?')){
      const [state,checkpoint,history,id]=this.args; const o=orders.get(id);
      if(o){o.state=state;o.checkpoint=checkpoint;o.history=history;}}
    else if(sql.startsWith('UPDATE orders SET contact_log = ?, history = ?')){const o=orders.get(this.args[2]);
      if(o){ o.contact_log=this.args[0]; o.history=this.args[1]; }}
    else if(sql.startsWith('UPDATE orders SET history = ?')){const o=orders.get(this.args[1]);
      if(o) o.history=this.args[0];}
    else if(sql.includes('WHERE awb = ?')){for(const o of orders.values()) if(o.awb===this.args[2]) o.state=this.args[0];}
    else if(sql.includes('UPDATE orders SET state = ?, checkpoint = ? WHERE id')){const o=orders.get(this.args[2]);if(o)o.state=this.args[0];}
    else if(sql.includes('DELETE FROM orders')) orders.delete(this.args[0]);
    else if(sql.includes('DELETE FROM transactions')) transactions.delete(this.args[0]);
    else if(sql.includes('INSERT INTO products')){
      const [id,client_id,name,sku,category,price,cost,active,stock,low_stock_threshold,created_at]=this.args;
      products.set(id,{id,client_id,name,sku,category,price,cost,active,stock,low_stock_threshold,created_at});}
    else if(sql.startsWith('UPDATE products SET stock = ?, low_stock_threshold = ?')){
      const [stock,low_stock_threshold,id]=this.args; const p=products.get(id);
      if(p){p.stock=stock;p.low_stock_threshold=low_stock_threshold;}}
    else if(sql.startsWith('UPDATE products SET stock')){const p=products.get(this.args[1]);if(p)p.stock=this.args[0];}
    else if(sql.startsWith('UPDATE products SET price')){const [price,id]=this.args; const p=products.get(id); if(p)p.price=price;}
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
      const [id,client_id,product_id,variant_id,product_name,delta,new_stock,note,supplier_id,supplier_name,created_at,created_by]=this.args;
      stockLog.set(id,{id,client_id,product_id,variant_id,product_name,delta,new_stock,note,supplier_id,supplier_name,created_at,created_by});}
    else if(sql.includes('INSERT INTO product_variants')){
      const [id,product_id,client_id,name,sku,stock,price,active,created_at]=this.args;
      variants.set(id,{id,product_id,client_id,name,sku,stock,price,active,created_at});}
    else if(sql.startsWith('UPDATE product_variants SET stock')){
      const p=variants.get(this.args[1]); if(p) p.stock=this.args[0];}
    else if(sql.startsWith('DELETE FROM product_variants WHERE product_id')){
      for(const [k,v] of [...variants.entries()]) if(v.product_id===this.args[0]) variants.delete(k);}
    else if(sql.startsWith('DELETE FROM product_variants WHERE id')) variants.delete(this.args[0]);
    else if(sql.includes('DELETE FROM product_variants')) variants.clear();
    else if(sql.includes('INSERT INTO suppliers')){
      const [id,client_id,name,phone,note,active,created_at]=this.args;
      suppliers.set(id,{id,client_id,name,phone,note,active,created_at});}
    else if(sql.includes('DELETE FROM suppliers')) suppliers.delete(this.args[0]);
    else if(sql.includes('INSERT INTO customers')){
      const [id,client_id,name,phone,gov,address,tags,note,created_at]=this.args;
      customers.set(id,{id,client_id,name,phone,gov,address,tags,note,created_at});}
    else if(sql.startsWith('UPDATE customers SET name = ?, gov = ?, address = ?')){
      const [name,gov,address,id]=this.args; const c=customers.get(id);
      if(c){c.name=name;c.gov=gov;c.address=address;}}
    else if(sql.startsWith('UPDATE customers SET name = ?, note = ?, tags = ?')){
      const [name,note,tags,id]=this.args; const c=customers.get(id);
      if(c){c.name=name;c.note=note;c.tags=tags;}}
    else if(sql.includes('DELETE FROM customers')) customers.clear();
    else if(sql.includes('INSERT INTO coupons')){
      const [id,client_id,code,type,value,active,expires_at,note,created_at]=this.args;
      const dup=[...coupons.values()].find(c=>c.client_id===client_id && c.code===code && c.id!==id);
      if(dup) throw new Error('UNIQUE constraint failed: coupons.client_id, coupons.code');
      coupons.set(id,{id,client_id,code,type,value,active,expires_at,note,created_at});}
    else if(sql.includes('DELETE FROM coupons')) sql.includes('WHERE id') ? coupons.delete(this.args[0]) : coupons.clear();
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
    if(sql.includes('FROM users')){
      let ulist=[...users.values()];
      if(sql.includes('WHERE client_id = ?')) ulist=ulist.filter(u=>u.client_id===this.args[0]);
      return {results:ulist};
    }
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
    if(sql.includes('FROM suppliers')){
      const slist=[...suppliers.values()].filter(s=>s.client_id===this.args[0])
        .sort((a,b)=>a.name.localeCompare(b.name,'ar'));
      return {results:slist};
    }
    if(sql.includes('FROM coupons')){
      const clist=[...coupons.values()].filter(c=>c.client_id===this.args[0])
        .sort((a,b)=>a.created_at<b.created_at?1:-1);
      return {results:clist};
    }
    if(sql.includes('FROM product_variants')){
      if(sql.includes('WHERE product_id = ?')){
        const vlist=[...variants.values()].filter(v=>v.product_id===this.args[0])
          .sort((a,b)=>a.name.localeCompare(b.name,'ar'));
        return {results:vlist};
      }
      return {results:[...variants.values()]};
    }
    if(sql.includes('LEFT JOIN orders o ON o.customer_id = c.id')){
      const clientId=this.args[0];
      const clist=[...customers.values()].filter(c=>c.client_id===clientId);
      const rows=clist.map(c=>{
        const os=[...orders.values()].filter(o=>o.customer_id===c.id);
        const total_orders=os.length;
        const total_spent=os.filter(o=>!['cancelled','returned'].includes(o.state))
          .reduce((s,o)=>s+(Number(o.total)||0),0);
        const last_order_date=os.length ? os.map(o=>o.date).sort().slice(-1)[0] : null;
        return {id:c.id,name:c.name,phone:c.phone,gov:c.gov,address:c.address,tags:c.tags,note:c.note,
          created_at:c.created_at,total_orders,total_spent,last_order_date};
      }).sort((a,b)=>b.total_spent-a.total_spent);
      return {results:rows};
    }
    if(sql.includes('FROM whatsapp_outbox')){
      const olist=[...waOutbox.values()].filter(w=>w.status==='pending')
        .sort((a,b)=>a.created_at<b.created_at?-1:1);
      return {results:olist};
    }
    let list=[...orders.values()];
    if(sql.includes("state = 'deferred' AND defer_until")){
      const cutoff=this.args[0];
      return {results:list.filter(o=>o.state==='deferred' && o.defer_until && o.defer_until<=cutoff)};
    }
    if(sql.includes('WHERE customer_id = ?')) list=list.filter(o=>o.customer_id===this.args[0])
      .sort((a,b)=>a.date<b.date?1:-1);
    else if(sql.includes('WHERE client_id = ?')) list=list.filter(o=>o.client_id===this.args[0]);
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

head('أعضاء الفريق المرتبطون بمتجر');
r=await call('/api/users',{method:'POST',body:JSON.stringify({
  email:'viewer.c1@x.com',name:'مشاهد متجر أ',role:'viewer',clientId:'c1',password:'ViewerPass99'
})},adminCookie);
check('إنشاء عضو مشاهدة مرتبط بالحساب',r.status===200);
const viewerLogin=await call('/api/login',{method:'POST',body:JSON.stringify({email:'viewer.c1@x.com',password:'ViewerPass99'})});
const viewerCookie=ck(viewerLogin);
const [,viewerMe]=await j(await call('/api/me',{},viewerCookie));
check('جلسة عضو الفريق تحتفظ بالدور والحساب',viewerMe.role==='viewer'&&viewerMe.clientId==='c1');
const [,scopedTeam]=await j(await call('/api/users?clientId=c1',{},adminCookie));
check('قائمة الفريق مفلترة بالحساب',scopedTeam.length===1&&scopedTeam[0].email==='viewer.c1@x.com'&&scopedTeam[0].name==='مشاهد متجر أ');
const [,viewerState]=await j(await call('/api/state',{},viewerCookie));
check('عضو الفريق يرى حسابه فقط',viewerState.clients.length===1&&viewerState.clients[0].id==='c1');
check('عضو الفريق لا يستطيع تبديل clientId يدويًا',(await call('/api/products?clientId=c2',{},viewerCookie)).status===403);
check('دور المشاهدة ممنوع من كتابة المنتجات',(await call('/api/products',{method:'POST',body:JSON.stringify({clientId:'c1',name:'ممنوع'})},viewerCookie)).status===403);
r=await call('/api/users',{method:'POST',body:JSON.stringify({
  email:'support.c1@x.com',name:'دعم متجر أ',role:'support',clientId:'c1',password:'SupportC1Pass99'
})},adminCookie);
check('إنشاء خدمة عملاء مرتبطة بالحساب',r.status===200);
const supportC1Cookie=ck(await call('/api/login',{method:'POST',body:JSON.stringify({email:'support.c1@x.com',password:'SupportC1Pass99'})}));
r=await call('/api/users',{method:'POST',body:JSON.stringify({
  email:'ops.c1@x.com',name:'تشغيل متجر أ',role:'ops',clientId:'c1',password:'OpsC1Pass99'
})},adminCookie);
check('إنشاء تشغيل مرتبط بالحساب',r.status===200);
const opsC1Cookie=ck(await call('/api/login',{method:'POST',body:JSON.stringify({email:'ops.c1@x.com',password:'OpsC1Pass99'})}));
let [,rbacProduct]=await j(await call('/api/products',{method:'POST',body:JSON.stringify({clientId:'c1',name:'QA RBAC Product',sku:'QA-RBAC'})},adminCookie));
check('خدمة العملاء ممنوعة من إنشاء منتج',(await call('/api/products',{method:'POST',body:JSON.stringify({clientId:'c1',name:'ممنوع'})},supportC1Cookie)).status===403);
check('خدمة العملاء ممنوعة من حذف منتج بالـID',(await call('/api/products/'+rbacProduct.id,{method:'DELETE'},supportC1Cookie)).status===403);
check('المشاهد ممنوع من حذف منتج بالـID',(await call('/api/products/'+rbacProduct.id,{method:'DELETE'},viewerCookie)).status===403);
check('التشغيل يستطيع إدارة الكتالوج داخل حسابه',(await call('/api/products/'+rbacProduct.id,{method:'DELETE'},opsC1Cookie)).status===200);
check('خدمة العملاء تستطيع قراءة CRM لحسابها',(await call('/api/customers?clientId=c1',{},supportC1Cookie)).status===200);
check('خدمة العملاء ممنوعة من الموردين',(await call('/api/suppliers?clientId=c1',{},supportC1Cookie)).status===403);
check('خدمة العملاء ممنوعة من إنشاء كوبون',(await call('/api/coupons',{method:'POST',body:JSON.stringify({clientId:'c1',code:'NOPE',value:10})},supportC1Cookie)).status===403);
const [,teamOrderA]=await j(await call('/api/orders',{method:'POST',body:JSON.stringify({clientId:'c1',name:'متجر أ',phone:'0100',total:100,date:TODAY})},adminCookie));
const [,teamOrderB]=await j(await call('/api/orders',{method:'POST',body:JSON.stringify({clientId:'c2',name:'متجر ب',phone:'0100',total:100,date:TODAY})},adminCookie));
check('خدمة العملاء تعدّل طلب حسابها',(await call('/api/orders/'+teamOrderA.order.id,{method:'PATCH',body:JSON.stringify({state:'confirmed'})},supportC1Cookie)).status===200);
check('خدمة العملاء ممنوعة من تعديل طلب حساب آخر بالـID',(await call('/api/orders/'+teamOrderB.order.id,{method:'PATCH',body:JSON.stringify({state:'confirmed'})},supportC1Cookie)).status===403);
check('خدمة العملاء ممنوعة من التواصل على طلب حساب آخر بالـID',(await call('/api/orders/'+teamOrderB.order.id+'/contact',{method:'POST'},supportC1Cookie)).status===403);
await call('/api/orders/'+teamOrderA.order.id,{method:'DELETE'},adminCookie);
await call('/api/orders/'+teamOrderB.order.id,{method:'DELETE'},adminCookie);

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

head('التصنيفات ومتغيرات المنتج (لون/مقاس)');
r=await call('/api/products',{method:'POST',body:JSON.stringify({
  name:'قميص كاجوال',price:300,cost:120,stock:0,category:'قمصان'})},clientCookie);
let [,shirtProd]=await j(r);
check('المنتج بيتسجل بتصنيف صحيح', products.get(shirtProd.id).category==='قمصان');

check('اسم المتغير مطلوب',
  (await call('/api/products/'+shirtProd.id+'/variants',{method:'POST',body:JSON.stringify({stock:5})},clientCookie)).status===400);
r=await call('/api/products/'+shirtProd.id+'/variants',{method:'POST',body:JSON.stringify({
  name:'أحمر — L', sku:'SHIRT-RED-L', stock:10})},clientCookie);
let [,varRed]=await j(r);
check('إضافة متغير أول (أحمر L)', r.status===200);
r=await call('/api/products/'+shirtProd.id+'/variants',{method:'POST',body:JSON.stringify({
  name:'أزرق — M', stock:4, price:280})},clientCookie);
let [,varBlue]=await j(r);
check('إضافة متغير تاني بسعر خاص (أزرق M)', r.status===200);

r=await call('/api/products/'+shirtProd.id+'/variants',{},clientCookie);
let [,varList]=await j(r);
check('قائمة متغيرات المنتج فيها الاتنين', varList.length===2);
check('السعر الخاص محفوظ صح للمتغير الأزرق', varList.find(v=>v.id===varBlue.id).price===280);
check('المتغير الأحمر من غير سعر خاص (يستخدم سعر المنتج)', varList.find(v=>v.id===varRed.id).price==null);

r=await call('/api/variants/'+varRed.id+'/stock/add',{method:'POST',body:JSON.stringify({delta:5,note:'توريد'})},clientCookie);
let [,varStockRes]=await j(r);
check('إضافة كمية لمتغير محدد بتزود عليه مش على المنتج الأب', r.status===200 && varStockRes.stock===15);
check('المنتج الأب ما اتأثرش', products.get(shirtProd.id).stock===0);
check('حركة المخزون اتسجّلت مربوطة بالمتغير الصح',
  [...stockLog.values()].some(s=>s.variant_id===varRed.id && s.delta===5));

let [,varOrder]=await j(await call('/api/orders',{method:'POST',body:JSON.stringify({
  name:'عميل متغير', phone:'01066677788', productId:shirtProd.id, variantId:varRed.id,
  qty:2, total:600, date:'2026-08-20'})},clientCookie));
check('الأوردر اتسجل مربوط بالمتغير الصح', orders.get(varOrder.order.id).variant_id===varRed.id);

r=await call('/api/orders/'+varOrder.order.id,{method:'PATCH',body:JSON.stringify({state:'returned'})},adminCookie);
check('مرتجع على أوردر فيه متغير بينجح', r.status===200);
r=await call('/api/products/'+shirtProd.id+'/variants',{},clientCookie);
let [,varListAfterReturn]=await j(r);
check('الكمية رجعت للمتغير الصح (مش للمنتج الأب)',
  varListAfterReturn.find(v=>v.id===varRed.id).stock===17 && products.get(shirtProd.id).stock===0);

r=await call('/api/variants/'+varBlue.id,{method:'DELETE'},clientCookie);
check('العميل يقدر يحذف متغير', r.status===200 && !variants.has(varBlue.id));
r=await call('/api/products/'+shirtProd.id,{method:'DELETE'},clientCookie);
check('حذف المنتج بيمسح متغيراته كمان', r.status===200 && !variants.has(varRed.id));

head('إضافة كميات جديدة للمخزون + سجلها');
r=await call('/api/products/'+stockProd.id+'/stock/add',{method:'POST',body:JSON.stringify({delta:15,note:'توريد جديد'})},clientCookie);
let [,addStockRes]=await j(r);
check('إضافة كمية بتزود على الرصيد الموجود (مش تستبدله)', r.status===200 && addStockRes.stock===35);
check('عملية الإضافة اتسجّلت في سجل المخزون', stockLog.size>0 &&
  [...stockLog.values()].some(s=>s.product_id===stockProd.id && s.delta===15 && s.new_stock===35));
r=await call('/api/products/stock-log',{},clientCookie);
let [,stockLogList]=await j(r);
check('العميل يقدر يشوف سجل إضافات مخزونه', r.status===200 && stockLogList.some(s=>s.product_id===stockProd.id));

head('الموردين');
check('اسم المورد مطلوب',
  (await call('/api/suppliers',{method:'POST',body:JSON.stringify({phone:'01000000'})},clientCookie)).status===400);
r=await call('/api/suppliers',{method:'POST',body:JSON.stringify({name:'مصنع الأقمشة',phone:'01055500000'})},clientCookie);
let [,supRes]=await j(r);
check('العميل يقدر يضيف مورد', r.status===200);
r=await call('/api/suppliers',{},clientCookie);
let [,supList]=await j(r);
check('المورد ظاهر في قائمة العميل', supList.some(s=>s.id===supRes.id && s.name==='مصنع الأقمشة'));

r=await call('/api/products/'+stockProd.id+'/stock/add',
  {method:'POST',body:JSON.stringify({delta:10,note:'توريد من المصنع',supplierId:supRes.id})},clientCookie);
let [,addWithSup]=await j(r);
check('التوريد بمورد بيزوّد الرصيد صح', r.status===200 && addWithSup.stock===45);
check('حركة المخزون اتسجّلت باسم المورد',
  [...stockLog.values()].some(s=>s.product_id===stockProd.id && s.delta===10 && s.supplier_name==='مصنع الأقمشة'));

/* مورد عميل تاني (c1) اتضاف عن طريق الإدارة — التحقق إن العميل c2 ميقدرش يربطه بمخزونه */
r=await call('/api/suppliers',{method:'POST',body:JSON.stringify({clientId:'c1',name:'مورد عميل تاني'})},adminCookie);
let [,otherSup]=await j(r);
check('الإدارة تقدر تضيف مورد لعميل محدد', r.status===200);
r=await call('/api/products/'+stockProd.id+'/stock/add',
  {method:'POST',body:JSON.stringify({delta:5,supplierId:otherSup.id})},clientCookie);
let [,crossRes]=await j(r);
check('مورد عميل تاني اتجاهل بصمت ومفيش ربط خاطئ', r.status===200 && crossRes.stock===50 &&
  [...stockLog.values()].some(s=>s.product_id===stockProd.id && s.delta===5 && !s.supplier_id));
check('العميل مش شايف موردين العميل التاني',
  !supList.some(s=>s.id===otherSup.id));

r=await call('/api/suppliers/'+supRes.id,{method:'DELETE'},clientCookie);
check('العميل يقدر يحذف مورده', r.status===200 && !suppliers.has(supRes.id));

head('كوبونات الخصم');
check('كوبون بقيمة صفر مرفوض',
  (await call('/api/coupons',{method:'POST',body:JSON.stringify({code:'ZERO',type:'fixed',value:0})},clientCookie)).status===400);
check('كوبون نسبة أكتر من ١٠٠٪ مرفوض',
  (await call('/api/coupons',{method:'POST',body:JSON.stringify({code:'BIG',type:'percent',value:150})},clientCookie)).status===400);
r=await call('/api/coupons',{method:'POST',body:JSON.stringify({code:'save50',type:'fixed',value:50})},clientCookie);
let [,cpnFixed]=await j(r);
check('العميل يقدر يضيف كوبون قيمة ثابتة', r.status===200);
r=await call('/api/coupons',{},clientCookie);
let [,cpnList]=await j(r);
check('الكود اتخزن بحروف كبيرة (توحيد المطابقة)', cpnList.some(c=>c.id===cpnFixed.id && c.code==='SAVE50'));

r=await call('/api/coupons',{method:'POST',body:JSON.stringify({code:'SAVE50',type:'percent',value:10})},clientCookie);
check('كوبون بنفس الكود لنفس المتجر مرفوض (تكرار)', r.status===409);

r=await call('/api/coupons',{method:'POST',body:JSON.stringify({code:'PCT10',type:'percent',value:10})},clientCookie);
let [,cpnPct]=await j(r);
check('العميل يقدر يضيف كوبون نسبة', r.status===200);

let [,ordBadCoupon]=await j(await call('/api/orders',{method:'POST',body:JSON.stringify({
  name:'تجربة كوبون غلط', phone:'01055501234', total:200, date:'2026-08-19', couponCode:'NOTREAL'})},clientCookie));
check('كود كوبون مش موجود بيترفض إنشاء الأوردر', ordBadCoupon.error!=null);

let [,ordFixedCoupon]=await j(await call('/api/orders',{method:'POST',body:JSON.stringify({
  name:'عميل كوبون ثابت', phone:'01055501234', total:200, date:'2026-08-19', couponCode:'save50'})},clientCookie));
check('كوبون ثابت بيتطبّق ويحسب الخصم صح', orders.get(ordFixedCoupon.order.id).discount_amount===50);
check('كود الكوبون بيتسجل بحروف كبيرة مع الأوردر', orders.get(ordFixedCoupon.order.id).coupon_code==='SAVE50');

let [,ordPctCoupon]=await j(await call('/api/orders',{method:'POST',body:JSON.stringify({
  name:'عميل كوبون نسبة', phone:'01055501234', total:300, date:'2026-08-19', couponCode:'PCT10'})},clientCookie));
check('كوبون نسبة بيتحسب من الإجمالي (١٠٪ من ٣٠٠ = ٣٠)', orders.get(ordPctCoupon.order.id).discount_amount===30);

let [,ordManualDiscount]=await j(await call('/api/orders',{method:'POST',body:JSON.stringify({
  name:'خصم يدوي بلا كوبون', phone:'01055501234', total:150, discountAmount:20, date:'2026-08-19'})},clientCookie));
check('خصم يدوي من غير كوبون بيتسجل عادي', orders.get(ordManualDiscount.order.id).discount_amount===20);

check('عميل ب (c2) ممنوع يشوف كوبونات عميل تاني', (await call('/api/coupons?clientId=c1',{},clientCookie)).status===403);
r=await call('/api/coupons/'+cpnPct.id,{method:'DELETE'},clientCookie);
check('العميل يقدر يحذف كوبون بتاعه', r.status===200 && !coupons.has(cpnPct.id));

head('العملاء (Customer 360) — ربط تلقائي حسب رقم التليفون');
let [,custOrder1]=await j(await call('/api/orders',{method:'POST',body:JSON.stringify({
  name:'هدير محمد', phone:'01099988877', gov:'أسيوط', total:400, date:'2026-08-10'})},clientCookie));
check('أوردر بتليفون صحيح بيتربط بعميل تلقائي', !!custOrder1.order.customerId, custOrder1.order.customerId);
const custId = custOrder1.order.customerId;
check('العميل اتسجّل بنفس رقم التليفون', customers.get(custId).phone==='01099988877');

let [,custOrder2]=await j(await call('/api/orders',{method:'POST',body:JSON.stringify({
  name:'هدير م.', phone:'01099988877', total:250, date:'2026-08-15'})},clientCookie));
check('أوردر تاني بنفس الرقم بيترجّع لنفس العميل (مش عميل جديد)', custOrder2.order.customerId===custId);

let [,custOrderOther]=await j(await call('/api/orders',{method:'POST',body:JSON.stringify({
  name:'سيف الدين', phone:'01122233344', total:100, date:'2026-08-16'})},clientCookie));
check('عميل تاني برقم مختلف بيتسجّل بملف مستقل', custOrderOther.order.customerId!==custId);

let [,custOrderBadPhone]=await j(await call('/api/orders',{method:'POST',body:JSON.stringify({
  name:'رقم غلط', phone:'0100', total:50, date:'2026-08-17'})},clientCookie));
check('رقم تليفون مش صحيح — الأوردر بيتسجّل من غير ربط عميل (من غير ما يفشل)',
  custOrderBadPhone.order.customerId==null);

r=await call('/api/customers',{},clientCookie);
let [,custList]=await j(r);
const heidi = custList.find(c=>c.id===custId);
check('العميل يشوف قائمة عملاؤه', r.status===200);
check('إجمالي عدد الأوردرات محسوب صح', heidi && heidi.totalOrders===2, JSON.stringify(heidi));
check('إجمالي المصروف = مجموع الأوردرين (400+250)', heidi && heidi.totalSpent===650);
check('آخر أوردر بتاريخ الأحدث', heidi && heidi.lastOrderDate==='2026-08-15');

r=await call('/api/customers/'+custId,{},clientCookie);
let [,custDetail]=await j(r);
check('تفاصيل العميل فيها كل أوردراته', r.status===200 && custDetail.orders.length===2);

r=await call('/api/customers/'+custId,{method:'PATCH',body:JSON.stringify({
  name:'هدير محمد (VIP)', tags:['VIP','بتشتري كتير'], note:'بتفضل تدفع كاش عند الاستلام'})},clientCookie);
check('العميل يقدر يعدّل بيانات ملف عميله (اسم/تاجات/ملاحظة)', r.status===200);
check('التعديل اتحفظ فعلاً', customers.get(custId).name==='هدير محمد (VIP)');

check('عميل ب (c2) ممنوع يشوف عملاء عميل تاني بالـ clientId',
  (await call('/api/customers?clientId=c1',{},clientCookie)).status===403);
check('الإدارة تقدر تشوف عملاء أي متجر', (await call('/api/customers?clientId=c1',{},adminCookie)).status===200);
r=await call('/api/users',{method:'POST',body:JSON.stringify({email:'a@x.com',clientId:'c1',role:'client',password:'ClientAPass9'})},adminCookie);
check('اتعمل حساب لعميل c1 عشان اختبار العزل', r.status===200);
r=await call('/api/login',{method:'POST',body:JSON.stringify({email:'a@x.com',password:'ClientAPass9'})});
const clientACookie=ck(r);
check('دخول عميل c1', r.status===200);
check('عميل c1 ممنوع يفتح ملف عميل تابع لـ c2', (await call('/api/customers/'+custId,{},clientACookie)).status===403);
check('عميل c1 ممنوع يعدّل ملف عميل تابع لـ c2',
  (await call('/api/customers/'+custId,{method:'PATCH',body:JSON.stringify({name:'اختراق'})},clientACookie)).status===403);
check('clientId مختلف في جسم الطلب مرفوض بدل تجاهله بصمت',(await call('/api/orders',{method:'POST',
  body:JSON.stringify({clientId:'c1',name:'سارة',phone:'0111',total:300,date:'2026-08-09'})},clientCookie)).status===403);
const [,ord]=await j(await call('/api/orders',{method:'POST',
  body:JSON.stringify({name:'سارة',phone:'0111',total:300,date:'2026-08-09'})},clientCookie));
check('أوردر العميل بدون clientId بيتحوّل لحسابه هو', ord.order.clientId==='c2','→ '+ord.order.clientId);
await call('/api/orders/EO-1',{method:'PATCH',body:JSON.stringify({awb:'JT123EG'})},adminCookie);
check('البوليصة بتنقل الحالة تلقائياً', orders.get('EO-1').awb==='JT123EG'&&orders.get('EO-1').state==='shipped');
check('العميل ممنوع يعدّل الأوردر',
  (await call('/api/orders/EO-1',{method:'PATCH',body:JSON.stringify({state:'delivered'})},clientCookie)).status===403);
await call('/webhooks/tracking',{method:'POST',body:JSON.stringify({trackNo:'JT123EG',latestEvent:'تم التسليم للعميل'})});
check('تتبع J&T حدّث الحالة', orders.get('EO-1').state==='signed');

head('المرتجعات — رجوع المخزون تلقائي + نوع المرتجع + قيمة الاسترداد');
const stockBeforeReturn = products.get(stockProd.id).stock;
let [,retOrder]=await j(await call('/api/orders',{method:'POST',body:JSON.stringify({
  name:'عميل هيرجع الأوردر', phone:'01033322211', productId:stockProd.id, qty:3, total:900, date:'2026-08-18'
})},clientCookie));
const retId = retOrder.order.id;

r=await call('/api/orders/'+retId,{method:'PATCH',body:JSON.stringify({state:'returned',returnType:'nonsense'})},adminCookie);
check('نوع مرتجع غير معروف مرفوض', r.status===400);

r=await call('/api/orders/'+retId,{method:'PATCH',body:JSON.stringify({state:'returned',returnType:'partial'})},adminCookie);
let [,partialErr]=await j(r);
check('مرتجع جزئي من غير قيمة استرداد مرفوض', r.status===400);
check('الرد بيوضح إنه محتاج قيمة استرداد', partialErr.needRefundAmount===true);

r=await call('/api/orders/'+retId,{method:'PATCH',body:JSON.stringify({state:'returned'})},adminCookie);
let [,retRes]=await j(r);
check('مرتجع كامل (من غير تحديد نوع) بيتسجل بنجاح', r.status===200);
check('نوع المرتجع الافتراضي = كامل', retRes.returnType==='full');
check('قيمة الاسترداد الافتراضية = إجمالي الأوردر', retRes.refundAmount===900);
check('المخزون رجع بالكمية (٣ قطع)', products.get(stockProd.id).stock===stockBeforeReturn+3);
check('الأوردر اتعلّم إنه اترجّع مخزونه', orders.get(retId).restocked===1);
check('حركة المخزون اتسجّلت باسم الأوردر',
  [...stockLog.values()].some(s=>s.product_id===stockProd.id && s.delta===3 && s.note.includes(retId)));

r=await call('/api/orders/'+retId,{method:'PATCH',body:JSON.stringify({state:'returned',returnType:'partial',refundAmount:400})},adminCookie);
check('تعديل بيانات مرتجع موجود (نوع/قيمة) من غير إعادة إضافة للمخزون تاني', r.status===200);
check('المخزون ما اتزودش تاني (لسه نفس القيمة)', products.get(stockProd.id).stock===stockBeforeReturn+3);
check('قيمة الاسترداد اتحدّثت للجزئي الجديد', orders.get(retId).refund_amount===400);
check('نوع المرتجع اتحدّث لجزئي', orders.get(retId).return_type==='partial');

r=await call('/api/orders/'+retId,{method:'PATCH',body:JSON.stringify({state:'confirmed'})},adminCookie);
check('تصحيح غلطة: رجّعنا الأوردر من مرتجع لحالة تانية', r.status===200);
check('المخزون اتخصم تاني (رجع لأصله قبل المرتجع)', products.get(stockProd.id).stock===stockBeforeReturn);
check('علامة restocked اتصفّرت', orders.get(retId).restocked===0);
check('قيمة الاسترداد ونوع المرتجع اتمسحوا بعد التصحيح',
  orders.get(retId).refund_amount==null && orders.get(retId).return_type==null);

let [,exchOrder]=await j(await call('/api/orders',{method:'POST',body:JSON.stringify({
  name:'عميل استبدال', phone:'01044455566', productId:stockProd.id, qty:1, total:300, date:'2026-08-19'
})},clientCookie));
r=await call('/api/orders/'+exchOrder.order.id,{method:'PATCH',body:JSON.stringify({state:'returned',returnType:'exchange'})},adminCookie);
let [,exchRes]=await j(r);
check('استبدال بيتسجل كنوع مرتجع صحيح', r.status===200 && exchRes.returnType==='exchange');
check('المخزون رجع بقطعة الاستبدال', products.get(stockProd.id).stock===stockBeforeReturn+1);

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
check('الحركة المالية بـ clientId مختلف مرفوضة',(await call('/api/transactions',{method:'POST',body:JSON.stringify({type:'expense',category:'أخرى',amount:50,clientId:'c1'})},clientCookie)).status===403);
r=await call('/api/transactions',{method:'POST',body:JSON.stringify({type:'expense',category:'أخرى',amount:50})},clientCookie);
let [,clientTxNew]=await j(r);
check('العميل يقدر يسجّل حركة مالية بنفسه', r.status===200);
check('حركة العميل بتتسجّل على حسابه هو دايماً', transactions.get(clientTxNew.id).client_id==='c2');
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

head('صلاحية حذف الأوردر — مدير مقابل خدمة عملاء');
r=await call('/api/users',{method:'POST',body:JSON.stringify({
  email:'support@x.com', role:'support', password:'SupportPass1', name:'خدمة عملاء'})},adminCookie);
check('اتعمل حساب خدمة عملاء', r.status===200);
const supportLogin=await call('/api/login',{method:'POST',body:JSON.stringify({email:'support@x.com',password:'SupportPass1'})});
const supportCookie=ck(supportLogin);
let [,delTestOrder]=await j(await call('/api/orders',{method:'POST',body:JSON.stringify({
  clientId:'c1',name:'أوردر للحذف',phone:'0100',total:100,date:TODAY})},adminCookie));
r=await call('/api/orders/'+delTestOrder.order.id,{method:'DELETE'},supportCookie);
check('خدمة العملاء ممنوعة تحذف أوردر — الصلاحية دي للمدير بس', r.status===403);
check('الأوردر لسه موجود', orders.has(delTestOrder.order.id));
r=await call('/api/orders/'+delTestOrder.order.id,{method:'DELETE'},adminCookie);
check('المدير يقدر يحذف الأوردر', r.status===200);
check('الأوردر اتشال فعلاً', !orders.has(delTestOrder.order.id));

head('تأجيل الأوردر ورجوعه التلقائي');
let [,deferOrder]=await j(await call('/api/orders',{method:'POST',body:JSON.stringify({
  clientId:'c1',name:'مؤجل',phone:'0100',total:150,date:TODAY,productNote:'أحمر — مقاس L'})},adminCookie));
check('ملاحظة المنتج (لون/مقاس) اتسجّلت مع الأوردر', orders.get(deferOrder.order.id).product_note==='أحمر — مقاس L');
r=await call('/api/orders/'+deferOrder.order.id,{method:'PATCH',body:JSON.stringify({state:'deferred'})},adminCookie);
check('التأجيل من غير تاريخ مرفوض', r.status===400);
const futureDate='2099-01-01';
r=await call('/api/orders/'+deferOrder.order.id,{method:'PATCH',body:JSON.stringify({state:'deferred',deferUntil:futureDate})},adminCookie);
check('التأجيل بتاريخ صحيح بينجح', r.status===200 && orders.get(deferOrder.order.id).state==='deferred');
check('تاريخ الرجوع اتسجّل', orders.get(deferOrder.order.id).defer_until===futureDate);
let [,stillDeferred]=await j(await call('/api/state',{},adminCookie));
check('الأوردر لسه مؤجل — معاده لسه ما وصلش', stillDeferred.orders.find(o=>o.id===deferOrder.order.id).state==='deferred');
orders.get(deferOrder.order.id).defer_until='2020-01-01';   /* نحاكي إن معاده فات */
let [,returnedState]=await j(await call('/api/state',{},adminCookie));
const returnedOrder=returnedState.orders.find(o=>o.id===deferOrder.order.id);
check('رجع تلقائي لـ"جاري التأكيد" لما معاده وصل', returnedOrder.state==='pending');
check('تاريخ التأجيل القديم فضل محفوظ كعلامة إنه رجع من تأجيل', returnedOrder.deferUntil==='2020-01-01');

console.log(`\n${pass} نجحوا · ${fail} فشلوا`);
process.exit(fail?1:0);
