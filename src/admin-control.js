import {getTenantFeatures,setTenantModules} from './feature-entitlements.js';
import {walletSnapshot,configureWallet,migrateLegacyBilling} from './wallet-billing.js';

const now=()=>new Date().toISOString();
const rid=p=>`${p}-${crypto.randomUUID().slice(0,10).toUpperCase()}`;
const n=v=>Number(v)||0;
const r2=v=>Math.round(n(v)*100)/100;

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
    const [orders,team,stores,wallet,modules,integrations]=await Promise.all([
      env.DB.prepare(`SELECT COUNT(*) orders,COALESCE(SUM(total),0) gm,MAX(COALESCE(created_at,date)) last_order_at FROM orders WHERE client_id=?`).bind(clientId).first(),
      env.DB.prepare(`SELECT COUNT(*) n FROM users WHERE client_id=? AND status='active'`).bind(clientId).first(),
      env.DB.prepare(`SELECT COUNT(*) n FROM stores WHERE client_id=? AND status='active'`).bind(clientId).first(),
      env.DB.prepare(`SELECT balance,billing_version,status FROM wallet_accounts WHERE client_id=?`).bind(clientId).first(),
      env.DB.prepare(`SELECT SUM(CASE WHEN enabled=1 THEN 1 ELSE 0 END) enabled,COUNT(*) configured FROM tenant_modules WHERE client_id=?`).bind(clientId).first(),
      env.DB.prepare(`SELECT COUNT(*) total,SUM(CASE WHEN status='connected' THEN 1 ELSE 0 END) connected FROM store_connections WHERE client_id=?`).bind(clientId).first()
    ]);
    const l=legacyMap.get(clientId)||{},tenant=await env.DB.prepare('SELECT display_name,plan,status FROM tenant_settings WHERE client_id=?').bind(clientId).first();
    rows.push({clientId,name:tenant?.display_name||l.name||clientId,status:tenant?.status||l.status||'active',plan:tenant?.plan||'legacy',orders:n(orders?.orders),gmv:r2(orders?.gm),lastOrderAt:orders?.last_order_at||null,teamMembers:n(team?.n),stores:n(stores?.n),walletBalance:r2(wallet?.balance??l.walletBalance),billingVersion:wallet?.billing_version||'legacy',walletStatus:wallet?.status||'unknown',enabledModules:n(modules?.enabled),moduleConfigPresent:n(modules?.configured)>0,integrations:n(integrations?.total),connectedIntegrations:n(integrations?.connected)});
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

export async function addClientNote(env,clientId,body,actor){
  const text=String(body.body||'').trim();if(!text)throw Object.assign(new Error('نص الملاحظة مطلوب'),{status:400});
  const id=rid('PCN'),ts=now();await env.DB.prepare('INSERT INTO platform_client_notes (id,client_id,kind,title,body,status,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(id,clientId,String(body.kind||'note'),String(body.title||''),text,'open',actor?.email||actor?.uid||'',ts,ts).run();return {ok:true,id};
}
