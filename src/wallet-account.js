export const now=()=>new Date().toISOString();
export const rid=p=>`${p}-${crypto.randomUUID().slice(0,10).toUpperCase()}`;
export const round2=v=>Math.round((Number(v)||0)*100)/100;

async function legacyClient(env,clientId){
  const row=await env.DB.prepare('SELECT json,updated_at FROM state WHERE id=1').first();
  if(!row?.json)return {row:null,state:null,client:null};
  try{
    const state=JSON.parse(row.json),client=(state.clients||[]).find(c=>String(c.id)===String(clientId))||null;
    return {row,state,client};
  }catch{return {row,state:null,client:null};}
}

export async function mirrorLegacyBalance(env,clientId,balance,{disableLegacyFee=false}={}){
  for(let attempt=0;attempt<3;attempt++){
    const {row,state,client}=await legacyClient(env,clientId);if(!state||!client)return true;
    client.walletBalance=round2(balance);if(disableLegacyFee)client.walletFeePerOrder=0;
    const ts=now(),result=await env.DB.prepare('UPDATE state SET json=?,updated_at=? WHERE id=1 AND updated_at=?').bind(JSON.stringify(state),ts,row?.updated_at||'').run();
    if(Number(result?.meta?.changes||0)>0)return true;
  }
  return false;
}

export async function ensureWalletAccount(env,clientId){
  let row=await env.DB.prepare('SELECT * FROM wallet_accounts WHERE client_id=?').bind(clientId).first();
  if(row)return row;
  const legacy=await legacyClient(env,clientId),balance=round2(legacy.client?.walletBalance||0),fee=Math.max(0,Number(legacy.client?.walletFeePerOrder)||0),ts=now();
  const preservedLegacyDebt=Math.max(0,round2(0-balance));
  await env.DB.prepare(`INSERT OR IGNORE INTO wallet_accounts
    (client_id,balance,currency,base_order_fee,min_order_fee,max_order_fee,credit_limit,billing_version,billing_start_rowid,status,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(clientId,balance,'EGP',fee||2,2,5,preservedLegacyDebt,'legacy',null,'active',ts).run();
  row=await env.DB.prepare('SELECT * FROM wallet_accounts WHERE client_id=?').bind(clientId).first();
  return row;
}

export async function migrateLegacyBilling(env,clientId,actor='admin'){
  const account=await ensureWalletAccount(env,clientId);const legacy=await legacyClient(env,clientId);
  const legacyFee=Math.max(0,Number(legacy.client?.walletFeePerOrder)||0);
  const base=legacyFee>0?Math.min(5,Math.max(2,legacyFee)):Math.min(5,Math.max(2,Number(account.base_order_fee)||2));
  const ts=now();
  const cutoff=await env.DB.prepare('SELECT COALESCE(MAX(rowid),0) n FROM orders WHERE client_id=?').bind(clientId).first();
  const requiredCredit=Math.max(Number(account.credit_limit)||0,Math.max(0,0-Number(account.balance||0)));
  await env.DB.prepare(`UPDATE wallet_accounts SET base_order_fee=?,min_order_fee=2,max_order_fee=5,credit_limit=?,billing_version='v27',billing_start_rowid=?,status='active',updated_at=? WHERE client_id=?`)
    .bind(base,requiredCredit,Number(cutoff?.n)||0,ts,clientId).run();
  await mirrorLegacyBalance(env,clientId,Number(account.balance)||0,{disableLegacyFee:true});
  await env.DB.prepare(`INSERT INTO audit_log (id,client_id,actor_email,action,entity_type,entity_id,metadata_json,created_at)
    VALUES (?,?,?,?,?,?,?,?)`).bind(rid('AUD'),clientId,actor,'wallet.billing.migrate','wallet_account',clientId,JSON.stringify({from:'legacy',to:'v27',legacyFee,baseOrderFee:base}),ts).run();
  return (await import('./wallet-read.js')).walletSnapshot(env,clientId);
}

export async function configureWallet(env,clientId,patch={},actor='admin'){
  await ensureWalletAccount(env,clientId);
  const current=await env.DB.prepare('SELECT * FROM wallet_accounts WHERE client_id=?').bind(clientId).first();
  const min=Math.max(0,Number(patch.minOrderFee??current.min_order_fee)||0);
  const max=Math.max(min,Number(patch.maxOrderFee??current.max_order_fee)||min);
  const base=Math.min(max,Math.max(min,Number(patch.baseOrderFee??current.base_order_fee)||min));
  const credit=Math.max(0,Number(patch.creditLimit??current.credit_limit)||0);
  const status=['active','paused'].includes(patch.status)?patch.status:current.status;
  await env.DB.prepare('UPDATE wallet_accounts SET base_order_fee=?,min_order_fee=?,max_order_fee=?,credit_limit=?,status=?,updated_at=? WHERE client_id=?')
    .bind(base,min,max,credit,status,now(),clientId).run();
  return (await import('./wallet-read.js')).walletSnapshot(env,clientId);
}
