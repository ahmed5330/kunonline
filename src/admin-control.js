import {MODULES,getTenantFeatures,setTenantModules} from './feature-entitlements.js';
import {walletSnapshot,configureWallet,migrateLegacyBilling} from './wallet-billing.js';

const now=()=>new Date().toISOString();
const rid=p=>`${p}-${crypto.randomUUID().slice(0,10).toUpperCase()}`;
const n=v=>Number(v)||0;
const r2=v=>Math.round(n(v)*100)/100;

const PBKDF2_ITERATIONS=100000;
const toB64=bytes=>btoa(String.fromCharCode(...bytes));
async function hashPassword(password){
  const salt=crypto.getRandomValues(new Uint8Array(16));
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:PBKDF2_ITERATIONS,hash:'SHA-256'},key,256);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toB64(salt)}$${toB64(new Uint8Array(bits))}`;
}
const clean=v=>String(v??'').trim();
const normalizeEmail=v=>clean(v).toLowerCase();
const clamp=(v,min,max)=>Math.min(max,Math.max(min,Number(v)||min));
const allowedPlans=new Set(['trial','starter','growth','pro','enterprise']);

async function legacyStateRow(env){
  const row=await env.DB.prepare('SELECT json,updated_at FROM state WHERE id=1').first();
  if(!row?.json)return {row:null,state:{agency:{name:'كن أونلاين',adminEmail:''},clients:[],entries:[],funding:[]}};
  try{return {row,state:JSON.parse(row.json)}}catch{return {row,state:{agency:{name:'كن أونلاين',adminEmail:''},clients:[],entries:[],funding:[]}}}
}
async function updateLegacyClient(env,clientId,mutator){
  for(let attempt=0;attempt<4;attempt++){
    const {row,state}=await legacyStateRow(env);state.clients=Array.isArray(state.clients)?state.clients:[];
    let client=state.clients.find(x=>String(x.id)===String(clientId));
    if(!client){client={id:clientId};state.clients.push(client)}
    mutator(client,state);const ts=now();
    if(row){
      const result=await env.DB.prepare('UPDATE state SET json=?,updated_at=? WHERE id=1 AND updated_at=?').bind(JSON.stringify(state),ts,row.updated_at||'').run();
      if(Number(result?.meta?.changes||0)>0)return true;
    }else{
      try{await env.DB.prepare('INSERT INTO state (id,json,updated_at) VALUES (1,?,?)').bind(JSON.stringify(state),ts).run();return true}catch{}
    }
  }
  throw Object.assign(new Error('تعذر مزامنة ملف العميل، حاول مرة أخرى'),{status:409,code:'CLIENT_STATE_CONFLICT'});
}


export function requireAdmin(me){if(me?.role!=='admin')throw Object.assign(new Error('المسار متاح لإدارة Kun Online فقط'),{status:403,code:'ADMIN_ONLY'});}

async function stateClients(env){
  const row=await env.DB.prepare('SELECT json FROM state WHERE id=1').first();if(!row?.json)return [];
  try{return JSON.parse(row.json)?.clients||[]}catch{return []}
}

export async function listAdminClients(env){
  const legacy=await stateClients(env),legacyMap=new Map(legacy.map(c=>[String(c.id),c]));
  const {results:ids=[]}=await env.DB.prepare(`SELECT client_id FROM tenant_settings UNION SELECT client_id FROM users WHERE client_id IS NOT NULL UNION SELECT client_id FROM stores UNION SELECT client_id FROM orders`).all();
  const all=new Set(ids.map(x=>String(x.client_id)).filter(Boolean));for(const c of legacy)if(c?.id)all.add(String(c.id));
  const rows=[];
  for(const clientId of all){
    const [orders,team,stores,wallet,modules,integrations,owner]=await Promise.all([
      env.DB.prepare(`SELECT COUNT(*) orders,COALESCE(SUM(total),0) gm,MAX(COALESCE(created_at,date)) last_order_at FROM orders WHERE client_id=?`).bind(clientId).first(),
      env.DB.prepare(`SELECT COUNT(*) n FROM users WHERE client_id=? AND status='active'`).bind(clientId).first(),
      env.DB.prepare(`SELECT COUNT(*) n FROM stores WHERE client_id=? AND status='active'`).bind(clientId).first(),
      env.DB.prepare(`SELECT balance,billing_version,status FROM wallet_accounts WHERE client_id=?`).bind(clientId).first(),
      env.DB.prepare(`SELECT SUM(CASE WHEN enabled=1 THEN 1 ELSE 0 END) enabled,COUNT(*) configured FROM tenant_modules WHERE client_id=?`).bind(clientId).first(),
      env.DB.prepare(`SELECT COUNT(*) total,SUM(CASE WHEN status='connected' THEN 1 ELSE 0 END) connected FROM store_connections WHERE client_id=?`).bind(clientId).first(),
      env.DB.prepare(`SELECT id,name,email,status FROM users WHERE client_id=? AND role='client' ORDER BY created_at LIMIT 1`).bind(clientId).first()
    ]);
    const l=legacyMap.get(clientId)||{},tenant=await env.DB.prepare('SELECT display_name,plan,status FROM tenant_settings WHERE client_id=?').bind(clientId).first();
    rows.push({clientId,name:tenant?.display_name||l.name||clientId,status:tenant?.status||l.status||'active',plan:tenant?.plan||'legacy',orders:n(orders?.orders),gmv:r2(orders?.gm),lastOrderAt:orders?.last_order_at||null,teamMembers:n(team?.n),stores:n(stores?.n),walletBalance:r2(wallet?.balance??l.walletBalance),billingVersion:wallet?.billing_version||'legacy',walletStatus:wallet?.status||'unknown',enabledModules:n(modules?.enabled),moduleConfigPresent:n(modules?.configured)>0,integrations:n(integrations?.total),connectedIntegrations:n(integrations?.connected),ownerId:owner?.id||null,ownerName:owner?.name||l.ownerName||'',ownerEmail:owner?.email||l.ownerEmail||'',phone:l.phone||''});
  }
  rows.sort((a,b)=>String(b.lastOrderAt||'').localeCompare(String(a.lastOrderAt||'')));
  return rows;
}

export async function clientOverview(env,clientId){
  const clients=await listAdminClients(env),base=clients.find(x=>String(x.clientId)===String(clientId));if(!base)throw Object.assign(new Error('العميل غير موجود'),{status:404});
  const [orders,inventory,topups,notes,features,wallet]=await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) total,SUM(CASE WHEN state='pending' THEN 1 ELSE 0 END) pending,SUM(CASE WHEN state='cancelled' THEN 1 ELSE 0 END) cancelled,SUM(CASE WHEN state='returned' THEN 1 ELSE 0 END) returned,SUM(CASE WHEN state IN ('signed','collected') THEN 1 ELSE 0 END) delivered,COALESCE(SUM(CASE WHEN state IN ('signed','collected') THEN total ELSE 0 END),0) delivered_revenue FROM orders WHERE client_id=?`).bind(clientId).first(),
    env.DB.prepare(`SELECT COUNT(*) products,SUM(CASE WHEN stock<=low_stock_threshold THEN 1 ELSE 0 END) low_stock,SUM(CASE WHEN stock<=0 THEN 1 ELSE 0 END) out_of_stock FROM products WHERE client_id=? AND active=1`).bind(clientId).first(),
    env.DB.prepare("SELECT COUNT(*) n,COALESCE(SUM(amount),0) amount FROM wallet_topup_requests WHERE client_id=? AND status='pending'").bind(clientId).first(),
    env.DB.prepare("SELECT * FROM platform_client_notes WHERE client_id=? AND status='open' ORDER BY updated_at DESC LIMIT 30").bind(clientId).all(),
    getTenantFeatures(env,clientId),walletSnapshot(env,clientId)
  ]);
  const total=n(orders?.total),challenges=[];
  if(n(orders?.pending)>0)challenges.push({type:'operations',severity:'warning',text:`${n(orders.pending)} طلب Pending يحتاج متابعة`});
  if(total>=10&&n(orders?.cancelled)/total>0.2)challenges.push({type:'orders',severity:'danger',text:`نسبة الإلغاء ${r2(n(orders.cancelled)/total*100)}%`});
  if(n(inventory?.low_stock)>0)challenges.push({type:'inventory',severity:'warning',text:`${n(inventory.low_stock)} منتج مخزونه منخفض`});
  if(n(topups?.n)>0)challenges.push({type:'wallet',severity:'info',text:`${n(topups.n)} طلب شحن رصيد بانتظار المراجعة`});
  if(wallet.balance<=0&&wallet.billingVersion==='v27')challenges.push({type:'wallet',severity:'danger',text:'الرصيد غير كافٍ للخصومات الجديدة'});
  return {...base,orders:{total,pending:n(orders?.pending),cancelled:n(orders?.cancelled),returned:n(orders?.returned),delivered:n(orders?.delivered),deliveredRevenue:r2(orders?.delivered_revenue)},inventory:{products:n(inventory?.products),lowStock:n(inventory?.low_stock),outOfStock:n(inventory?.out_of_stock)},wallet,features,challenges,notes:notes?.results||[]};
}

export async function updateClientModules(env,clientId,body,actor){return setTenantModules(env,clientId,body.modules||body,actor?.email||actor?.uid||'admin');}
export async function updateClientBilling(env,clientId,body,actor){return configureWallet(env,clientId,body,actor?.email||actor?.uid||'admin');}
export async function migrateClientBilling(env,clientId,actor){return migrateLegacyBilling(env,clientId,actor?.email||actor?.uid||'admin');}


export async function createAdminClient(env,body={},actor={}){
  const businessName=clean(body.businessName||body.name),ownerName=clean(body.ownerName),email=normalizeEmail(body.email||body.ownerEmail),phone=clean(body.phone);
  const password=String(body.password||''),storeName=clean(body.storeName)||businessName;
  if(!businessName)throw Object.assign(new Error('اسم النشاط مطلوب'),{status:400,code:'BUSINESS_NAME_REQUIRED'});
  if(!ownerName)throw Object.assign(new Error('اسم صاحب الحساب مطلوب'),{status:400,code:'OWNER_NAME_REQUIRED'});
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw Object.assign(new Error('اكتب بريد إلكتروني صحيح'),{status:400,code:'EMAIL_INVALID'});
  if(password.length<8)throw Object.assign(new Error('كلمة المرور لازم تكون 8 حروف على الأقل'),{status:400,code:'PASSWORD_TOO_SHORT'});
  const existing=await env.DB.prepare('SELECT id FROM users WHERE email=?').bind(email).first();
  if(existing)throw Object.assign(new Error('البريد الإلكتروني مستخدم بالفعل'),{status:409,code:'EMAIL_EXISTS'});
  const clientId=rid('CLI'),storeId=rid('STR'),ownerId=crypto.randomUUID(),subscriptionId=rid('SUB'),ts=now();
  const plan=allowedPlans.has(String(body.plan||''))?String(body.plan):'trial',currency=clean(body.currency)||'EGP',timezone=clean(body.timezone)||'Africa/Cairo';
  const baseOrderFee=clamp(body.baseOrderFee??2,2,5),moduleInput=body.modules&&typeof body.modules==='object'?body.modules:{};
  const passwordHash=await hashPassword(password),actorName=actor?.email||actor?.uid||'admin';
  const statements=[
    env.DB.prepare('INSERT INTO tenant_settings (client_id,display_name,timezone,currency,locale,plan,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(clientId,businessName,timezone,currency,'ar-EG',plan,'active',ts,ts),
    env.DB.prepare('INSERT INTO subscriptions (id,client_id,plan,status,billing_cycle,amount,currency,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(subscriptionId,clientId,plan,plan==='trial'?'trialing':'active','monthly',0,currency,ts,ts),
    env.DB.prepare('INSERT INTO stores (id,client_id,name,code,currency,timezone,status,is_default,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(storeId,clientId,storeName,'MAIN',currency,timezone,'active',1,ts,ts),
    env.DB.prepare('INSERT INTO users (id,email,name,password,role,client_id,status,created_at,last_login) VALUES (?,?,?,?,?,?,?,?,NULL)').bind(ownerId,email,ownerName,passwordHash,'client',clientId,'active',ts),
    env.DB.prepare('INSERT INTO user_store_access (id,client_id,user_id,store_id,role,created_at) VALUES (?,?,?,?,?,?)').bind(rid('USA'),clientId,ownerId,storeId,'owner',ts),
    env.DB.prepare(`INSERT INTO wallet_accounts (client_id,balance,currency,base_order_fee,min_order_fee,max_order_fee,credit_limit,billing_version,billing_start_rowid,status,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(clientId,0,currency,baseOrderFee,2,5,0,'v27',0,'active',ts)
  ];
  for(const moduleKey of MODULES){
    const input=moduleInput[moduleKey],enabled=input===undefined?1:(typeof input==='object'?(input.enabled===false?0:1):(input?1:0));
    const feeDelta=typeof input==='object'?Math.max(0,Number(input.feeDelta)||0):0;
    statements.push(env.DB.prepare('INSERT INTO tenant_modules (client_id,module_key,enabled,per_order_fee_delta,config_json,configured_by,configured_at) VALUES (?,?,?,?,?,?,?)').bind(clientId,moduleKey,enabled,feeDelta,'{}',actorName,ts));
  }
  statements.push(env.DB.prepare('INSERT INTO audit_log (id,client_id,store_id,actor_user_id,actor_email,action,entity_type,entity_id,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(rid('AUD'),clientId,storeId,actor?.uid||null,actorName,'platform.client.create','tenant',clientId,JSON.stringify({businessName,ownerEmail:email,plan,storeId}),ts));
  await env.DB.batch(statements);
  try{
    await updateLegacyClient(env,clientId,c=>Object.assign(c,{id:clientId,name:businessName,status:'active',plan,phone,ownerName,ownerEmail:email,walletBalance:0,walletFeePerOrder:0,createdAt:ts}));
  }catch(error){
    // Relational tables remain source of truth. Surface a warning without exposing credentials.
    return {ok:true,clientId,storeId,ownerId,ownerEmail:email,warning:error.code||'LEGACY_STATE_SYNC_PENDING'};
  }
  return {ok:true,clientId,storeId,ownerId,ownerEmail:email,plan,status:'active'};
}

export async function updateClientStatus(env,clientId,body={},actor={}){
  const status=String(body.status||'');if(!['active','suspended'].includes(status))throw Object.assign(new Error('الحالة غير صحيحة'),{status:400,code:'STATUS_INVALID'});
  let exists=await env.DB.prepare('SELECT client_id FROM tenant_settings WHERE client_id=?').bind(clientId).first();
  if(!exists){const known=(await listAdminClients(env)).find(x=>String(x.clientId)===String(clientId));if(!known)throw Object.assign(new Error('العميل غير موجود'),{status:404});const ts0=now();await env.DB.prepare('INSERT INTO tenant_settings (client_id,display_name,timezone,currency,locale,plan,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(clientId,known.name||clientId,'Africa/Cairo','EGP','ar-EG',known.plan||'legacy',known.status||'active',ts0,ts0).run();exists={client_id:clientId};}
  const ts=now(),actorName=actor?.email||actor?.uid||'admin',walletStatus=status==='active'?'active':'paused';
  const userStatement=status==='active'?env.DB.prepare("UPDATE users SET status='active' WHERE client_id=? AND status='tenant_suspended'").bind(clientId):env.DB.prepare("UPDATE users SET status='tenant_suspended' WHERE client_id=? AND status='active'").bind(clientId);
  await env.DB.batch([
    env.DB.prepare('UPDATE tenant_settings SET status=?,updated_at=? WHERE client_id=?').bind(status,ts,clientId),
    userStatement,
    env.DB.prepare('UPDATE wallet_accounts SET status=?,updated_at=? WHERE client_id=?').bind(walletStatus,ts,clientId),
    env.DB.prepare('INSERT INTO audit_log (id,client_id,actor_user_id,actor_email,action,entity_type,entity_id,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(rid('AUD'),clientId,actor?.uid||null,actorName,'platform.client.status','tenant',clientId,JSON.stringify({status}),ts)
  ]);
  await updateLegacyClient(env,clientId,c=>{c.status=status;});
  return {ok:true,clientId,status};
}

export async function resetClientOwnerPassword(env,clientId,body={},actor={}){
  const password=String(body.password||'');if(password.length<8)throw Object.assign(new Error('كلمة المرور لازم تكون 8 حروف على الأقل'),{status:400,code:'PASSWORD_TOO_SHORT'});
  const owner=await env.DB.prepare("SELECT id,email FROM users WHERE client_id=? AND role='client' ORDER BY created_at LIMIT 1").bind(clientId).first();
  if(!owner)throw Object.assign(new Error('حساب مالك العميل غير موجود'),{status:404,code:'OWNER_NOT_FOUND'});
  const ts=now(),actorName=actor?.email||actor?.uid||'admin';
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET password=? WHERE id=?').bind(await hashPassword(password),owner.id),
    env.DB.prepare('DELETE FROM login_attempts WHERE email=?').bind(owner.email),
    env.DB.prepare('INSERT INTO audit_log (id,client_id,actor_user_id,actor_email,action,entity_type,entity_id,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(rid('AUD'),clientId,actor?.uid||null,actorName,'platform.client.password_reset','user',owner.id,JSON.stringify({email:owner.email}),ts)
  ]);
  return {ok:true,clientId,email:owner.email};
}

export async function addClientNote(env,clientId,body,actor){
  const text=String(body.body||'').trim();if(!text)throw Object.assign(new Error('نص الملاحظة مطلوب'),{status:400});
  const id=rid('PCN'),ts=now();await env.DB.prepare('INSERT INTO platform_client_notes (id,client_id,kind,title,body,status,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(id,clientId,String(body.kind||'note'),String(body.title||''),text,'open',actor?.email||actor?.uid||'',ts,ts).run();return {ok:true,id};
}
