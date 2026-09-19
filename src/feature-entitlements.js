const now=()=>new Date().toISOString();

export const MODULES=[
  'dashboard','onboarding','stores','store-access','pos','orders','crm','inbox','catalog','inventory',
  'suppliers','procurement','supplier-finance','shipping','cod','campaigns','marketing','finance','profit',
  'analytics','automation','ai','integrations','team','approvals','operations','audit','wallet','ad-studio'
];

const PREFIX_MAP=[
  ['/api/pos','pos'],
  ['/api/orders','orders'],
  ['/api/wa-order','orders'],
  ['/api/customers','crm'],
  ['/api/inbox','inbox'],
  ['/api/products','catalog'],
  ['/api/variants','catalog'],
  ['/api/coupons','catalog'],
  ['/api/inventory','inventory'],
  ['/api/suppliers','suppliers'],
  ['/api/purchase-orders','procurement'],
  ['/api/procurement','procurement'],
  ['/api/shipping','shipping'],
  ['/api/cod-reconciliation','cod'],
  ['/api/campaigns','campaigns'],
  ['/api/marketing','marketing'],
  ['/api/finance','finance'],
  ['/api/profit-intelligence','profit'],
  ['/api/analytics','analytics'],
  ['/api/workflows','automation'],
  ['/api/ai/','ai'],
  ['/api/ai-actions','ai'],
  ['/api/integrations','integrations'],
  ['/api/store-connections','integrations'],
  ['/api/team','team'],
  ['/api/store-access','team'],
  ['/api/approvals','approvals'],
  ['/api/execution-jobs','operations'],
  ['/api/system-status','operations'],
  ['/api/audit-log','audit'],
  ['/api/wallet','wallet'],
  ['/api/ad-studio','ad-studio']
];

export function moduleForPath(pathname=''){
  for(const [prefix,key] of PREFIX_MAP){
    if(pathname===prefix||pathname.startsWith(prefix+'/')||pathname.startsWith(prefix))return key;
  }
  return null;
}

export async function getTenantFeatures(env,clientId){
  const {results=[]}=await env.DB.prepare(
    'SELECT module_key,enabled,per_order_fee_delta,config_json,configured_at FROM tenant_modules WHERE client_id=? ORDER BY module_key'
  ).bind(clientId).all();
  if(!results.length){
    return {configured:false,modules:Object.fromEntries(MODULES.map(k=>[k,{enabled:true,feeDelta:0,config:{}}]))};
  }
  const modules={};
  for(const key of MODULES)modules[key]={enabled:true,feeDelta:0,config:{}};
  for(const row of results){
    let config={};try{config=JSON.parse(row.config_json||'{}')}catch{}
    modules[row.module_key]={enabled:Number(row.enabled)!==0,feeDelta:Number(row.per_order_fee_delta)||0,config,configuredAt:row.configured_at||null};
  }
  return {configured:true,modules};
}

export async function assertFeatureEnabled(env,me,clientId,pathname){
  if(!clientId||me?.role==='admin')return null;
  const key=moduleForPath(pathname);if(!key)return null;
  const features=await getTenantFeatures(env,clientId);
  if(features.modules[key]?.enabled===false){
    throw Object.assign(new Error('القسم غير مفعّل لهذا الحساب'),{status:403,code:'FEATURE_DISABLED',module:key});
  }
  return key;
}

export async function setTenantModules(env,clientId,changes,actor='system'){
  if(!changes||typeof changes!=='object'||Array.isArray(changes))throw Object.assign(new Error('modules object required'),{status:400});
  const statements=[];const ts=now();
  for(const [moduleKey,value] of Object.entries(changes)){
    if(!MODULES.includes(moduleKey))throw Object.assign(new Error(`Unknown module: ${moduleKey}`),{status:400,code:'UNKNOWN_MODULE'});
    const v=value&&typeof value==='object'?value:{enabled:!!value};
    const enabled=v.enabled===undefined?1:(v.enabled?1:0);
    const delta=Math.max(0,Number(v.feeDelta??v.perOrderFeeDelta??0)||0);
    const config=JSON.stringify(v.config&&typeof v.config==='object'?v.config:{});
    statements.push(env.DB.prepare(`INSERT INTO tenant_modules
      (client_id,module_key,enabled,per_order_fee_delta,config_json,configured_by,configured_at)
      VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(client_id,module_key) DO UPDATE SET
      enabled=excluded.enabled,per_order_fee_delta=excluded.per_order_fee_delta,
      config_json=excluded.config_json,configured_by=excluded.configured_by,configured_at=excluded.configured_at`)
      .bind(clientId,moduleKey,enabled,delta,config,actor,ts));
  }
  if(statements.length)await env.DB.batch(statements);
  return getTenantFeatures(env,clientId);
}

export async function effectiveOrderFee(env,clientId){
  const account=await env.DB.prepare('SELECT base_order_fee FROM wallet_accounts WHERE client_id=?').bind(clientId).first();
  if(!account)return 0;
  const features=await getTenantFeatures(env,clientId);
  let fee=Math.max(0,Number(account.base_order_fee)||0);
  for(const item of Object.values(features.modules))if(item.enabled)fee+=Math.max(0,Number(item.feeDelta)||0);
  return Math.round(Math.max(0,fee)*100)/100;
}
