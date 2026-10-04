import {ensureWalletAccount,mirrorLegacyBalance,configureWallet,now,rid,round2} from './wallet-core.js';
import {effectiveOrderFee} from './feature-entitlements.js';

const text=v=>String(v??'').trim();
const num=v=>Number(v)||0;
const clampMoney=v=>Math.max(0,round2(v));
const isoDate=/^\d{4}-\d{2}-\d{2}$/;

function cairoYmd(date=new Date()){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
  const get=t=>parts.find(x=>x.type===t)?.value||'';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
function addDays(date,days){
  const d=new Date(`${date}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+Number(days||0));return d.toISOString().slice(0,10);
}
function monthBounds(date=cairoYmd()){
  const [y,m]=date.split('-').map(Number),from=`${y}-${String(m).padStart(2,'0')}-01`;
  const end=new Date(Date.UTC(y,m,0,12));return {key:`${y}-${String(m).padStart(2,'0')}`,from,to:end.toISOString().slice(0,10)};
}
function trialActive(row,today=cairoYmd()){
  return Boolean(row&&row.status==='trialing'&&isoDate.test(text(row.period_end))&&today<row.period_end);
}
function daysBetween(from,to){
  if(!isoDate.test(text(from))||!isoDate.test(text(to)))return 0;
  return Math.max(0,Math.ceil((new Date(`${to}T12:00:00Z`)-new Date(`${from}T12:00:00Z`))/86400000));
}

export async function latestSubscription(env,clientId){
  try{
    return await env.DB.prepare('SELECT * FROM subscriptions WHERE client_id=? ORDER BY created_at DESC LIMIT 1').bind(clientId).first();
  }catch(error){
    if(/no such table:\s*subscriptions/i.test(String(error?.message||error)))return null;
    throw error;
  }
}

async function ensureSubscriptionRow(env,clientId,{monthlyMinimum=0,currency='EGP'}={}){
  let row=await latestSubscription(env,clientId);if(row)return row;
  const tenant=await env.DB.prepare('SELECT plan,currency FROM tenant_settings WHERE client_id=?').bind(clientId).first();
  const ts=now(),id=rid('SUB');
  await env.DB.prepare(`INSERT INTO subscriptions
    (id,client_id,plan,status,billing_cycle,amount,currency,period_start,period_end,provider,external_id,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(id,clientId,text(tenant?.plan)||'starter','active','monthly',clampMoney(monthlyMinimum),text(tenant?.currency)||currency||'EGP',null,null,'kun_wallet',null,ts,ts).run();
  return latestSubscription(env,clientId);
}

async function monthlyChargeLog(env,clientId,key){
  return env.DB.prepare('SELECT id,amount,balance_after,created_at FROM wallet_log WHERE client_id=? AND idempotency_key=? LIMIT 1').bind(clientId,key).first();
}

async function chargeMonthlyMinimum(env,clientId,row,account,{today=cairoYmd()}={}){
  const minimum=clampMoney(row?.amount),bounds=monthBounds(today),key=`subscription-minimum:${clientId}:${bounds.key}`;
  let existing=await monthlyChargeLog(env,clientId,key);
  if(existing)return {charged:true,amount:minimum,key,bounds,log:existing,balance:round2(account.balance),alreadyCharged:true};
  if(minimum<=0)return {charged:true,amount:0,key,bounds,balance:round2(account.balance),zeroMinimum:true};
  if(num(account.balance)<minimum)return {charged:false,amount:minimum,key,bounds,balance:round2(account.balance),code:'MONTHLY_MINIMUM_INSUFFICIENT'};
  const ts=now(),logId=rid('WLG');
  try{
    await env.DB.batch([
      env.DB.prepare('UPDATE wallet_accounts SET balance=ROUND(balance-?,2),updated_at=? WHERE client_id=?').bind(minimum,ts,clientId),
      env.DB.prepare(`INSERT INTO wallet_log
        (id,client_id,store_id,type,amount,balance_after,note,created_at,created_by,reference_type,reference_id,idempotency_key,metadata_json)
        SELECT ?,?,NULL,'deduct',?,balance,?,?,?,?,?,?,? FROM wallet_accounts WHERE client_id=?`)
        .bind(logId,clientId,minimum,`الحد الأدنى الشهري — ${bounds.key}`,ts,'system','subscription_month',bounds.key,key,JSON.stringify({monthlyMinimum:minimum,month:bounds.key}),clientId),
      env.DB.prepare('UPDATE subscriptions SET period_start=?,period_end=?,updated_at=? WHERE id=?').bind(bounds.from,bounds.to,ts,row.id)
    ]);
  }catch(error){
    if(/idx_wallet_log_idempotency|UNIQUE constraint failed/i.test(String(error?.message||error))){
      existing=await monthlyChargeLog(env,clientId,key);
      const current=await env.DB.prepare('SELECT balance FROM wallet_accounts WHERE client_id=?').bind(clientId).first();
      return {charged:true,amount:minimum,key,bounds,log:existing,balance:round2(current?.balance),alreadyCharged:true};
    }
    throw error;
  }
  const updated=await env.DB.prepare('SELECT balance FROM wallet_accounts WHERE client_id=?').bind(clientId).first();
  await mirrorLegacyBalance(env,clientId,updated?.balance||0);
  return {charged:true,amount:minimum,key,bounds,balance:round2(updated?.balance),log:{id:logId}};
}

export async function subscriptionAccess(env,clientId,{applyMonthly=true}={}){
  const today=cairoYmd(),account=await ensureWalletAccount(env,clientId);
  let subscription=await latestSubscription(env,clientId);
  if(!subscription){
    const orderFee=await effectiveOrderFee(env,clientId),balance=round2(account.balance);
    const walletPaused=text(account.status)!=='active',emptyBalance=balance<=0;
    const locked=walletPaused||emptyBalance;
    const reason=walletPaused?'wallet_paused':emptyBalance?'balance_empty':null;
    return {
      clientId,managed:false,locked,reason,balance,currency:account.currency||'EGP',
      monthlyMinimum:0,orderFee,trialActive:false,trialEndsAt:null,subscriptionStatus:'unmanaged',
      monthlyCharged:true,monthlyDue:0
    };
  }
  if(subscription.status==='trialing'&&!trialActive(subscription,today)){
    const ts=now();await env.DB.prepare("UPDATE subscriptions SET status='active',updated_at=? WHERE id=? AND status='trialing'").bind(ts,subscription.id).run();
    subscription={...subscription,status:'active',updated_at:ts};
  }
  const inTrial=trialActive(subscription,today);
  const monthlyMinimum=clampMoney(subscription.amount),orderFee=inTrial?0:clampMoney(account.base_order_fee);
  let monthly={charged:true,amount:0,balance:round2(account.balance),bounds:monthBounds(today)};
  if(!inTrial&&subscription.status==='active'&&applyMonthly){
    monthly=await chargeMonthlyMinimum(env,clientId,subscription,account,{today});
  }else if(!inTrial&&subscription.status==='active'){
    const bounds=monthBounds(today),key=`subscription-minimum:${clientId}:${bounds.key}`,existing=monthlyMinimum>0?await monthlyChargeLog(env,clientId,key):{id:'zero'};
    monthly={charged:Boolean(existing)||monthlyMinimum<=0,amount:monthlyMinimum,balance:round2(account.balance),bounds,key,alreadyCharged:Boolean(existing)};
  }
  const fresh=await env.DB.prepare('SELECT balance,status,currency FROM wallet_accounts WHERE client_id=?').bind(clientId).first()||account;
  const subscriptionPaused=['paused','cancelled','suspended'].includes(text(subscription.status));
  const insufficientMonthly=!inTrial&&subscription.status==='active'&&monthlyMinimum>0&&!monthly.charged&&num(fresh.balance)<monthlyMinimum;
  const emptyBalance=!inTrial&&round2(fresh.balance)<=0;
  const walletPaused=text(fresh.status)!=='active';
  const locked=subscriptionPaused||walletPaused||insufficientMonthly||emptyBalance;
  const reason=subscriptionPaused?'subscription_paused':walletPaused?'wallet_paused':insufficientMonthly?'monthly_minimum_due':emptyBalance?'balance_empty':null;
  return {
    clientId,managed:true,locked,reason,balance:round2(fresh.balance),currency:fresh.currency||subscription.currency||'EGP',
    monthlyMinimum,monthlyCharged:monthly.charged,monthlyDue:monthly.charged?0:monthlyMinimum,
    orderFee,trialActive:inTrial,trialStartsAt:subscription.period_start||null,trialEndsAt:inTrial?subscription.period_end:null,
    trialDaysRemaining:inTrial?daysBetween(today,subscription.period_end):0,subscriptionStatus:subscription.status,
    billingCycle:subscription.billing_cycle||'monthly',periodStart:subscription.period_start||monthly.bounds?.from||null,periodEnd:subscription.period_end||monthly.bounds?.to||null
  };
}

export async function isFreeTrialActive(env,clientId){
  const row=await latestSubscription(env,clientId);return trialActive(row);
}

export async function subscriptionOrderFee(env,clientId){
  if(await isFreeTrialActive(env,clientId))return 0;
  const subscription=await latestSubscription(env,clientId);
  if(subscription){
    const account=await ensureWalletAccount(env,clientId);
    return clampMoney(account.base_order_fee);
  }
  return effectiveOrderFee(env,clientId);
}

export async function configureSubscription(env,clientId,body={},actor='admin'){
  const account=await ensureWalletAccount(env,clientId),current=await latestSubscription(env,clientId);
  const monthlyMinimum=clampMoney(body.monthlyMinimum??body.amount??current?.amount??0),baseOrderFee=clampMoney(body.baseOrderFee??account.base_order_fee??0);
  let row=current||await ensureSubscriptionRow(env,clientId,{monthlyMinimum});
  const ts=now(),status=['active','paused','suspended'].includes(text(body.status))?text(body.status):row.status;
  await env.DB.prepare('UPDATE subscriptions SET amount=?,status=?,billing_cycle=\'monthly\',provider=\'kun_wallet\',updated_at=? WHERE id=?')
    .bind(monthlyMinimum,status,ts,row.id).run();
  await configureWallet(env,clientId,{baseOrderFee,creditLimit:0,status:status==='active'||status==='trialing'?'active':'paused'},actor);
  if(body.startFreeTrial===true){
    const start=cairoYmd(),end=addDays(start,30);
    await env.DB.prepare("UPDATE subscriptions SET status='trialing',period_start=?,period_end=?,updated_at=? WHERE id=?").bind(start,end,ts,row.id).run();
    await env.DB.prepare("UPDATE wallet_accounts SET status='active',credit_limit=0,updated_at=? WHERE client_id=?").bind(ts,clientId).run();
  }else if(body.endFreeTrial===true){
    await env.DB.prepare("UPDATE subscriptions SET status='active',period_end=?,updated_at=? WHERE id=?").bind(cairoYmd(),ts,row.id).run();
    await env.DB.prepare("UPDATE wallet_accounts SET status='active',credit_limit=0,updated_at=? WHERE client_id=?").bind(ts,clientId).run();
  }
  return subscriptionAccess(env,clientId,{applyMonthly:body.endFreeTrial===true||body.applyMonthly===true});
}

export async function startFreeTrial(env,clientId,{days=30,actor='admin'}={}){
  const row=await ensureSubscriptionRow(env,clientId),start=cairoYmd(),end=addDays(start,Math.max(1,Math.min(90,Number(days)||30))),ts=now();
  await env.DB.batch([
    env.DB.prepare("UPDATE subscriptions SET status='trialing',period_start=?,period_end=?,provider='kun_wallet',updated_at=? WHERE id=?").bind(start,end,ts,row.id),
    env.DB.prepare("UPDATE wallet_accounts SET status='active',credit_limit=0,updated_at=? WHERE client_id=?").bind(ts,clientId),
    env.DB.prepare('INSERT INTO audit_log (id,client_id,actor_email,action,entity_type,entity_id,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?)')
      .bind(rid('AUD'),clientId,actor,'subscription.trial.start','subscription',row.id,JSON.stringify({start,end,days:Number(days)||30}),ts)
  ]);
  return subscriptionAccess(env,clientId,{applyMonthly:false});
}

export async function endFreeTrial(env,clientId,{actor='admin'}={}){
  const row=await ensureSubscriptionRow(env,clientId),ts=now(),end=cairoYmd();
  await env.DB.batch([
    env.DB.prepare("UPDATE subscriptions SET status='active',period_end=?,updated_at=? WHERE id=?").bind(end,ts,row.id),
    env.DB.prepare("UPDATE wallet_accounts SET status='active',credit_limit=0,updated_at=? WHERE client_id=?").bind(ts,clientId),
    env.DB.prepare('INSERT INTO audit_log (id,client_id,actor_email,action,entity_type,entity_id,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?)')
      .bind(rid('AUD'),clientId,actor,'subscription.trial.end','subscription',row.id,JSON.stringify({end}),ts)
  ]);
  return subscriptionAccess(env,clientId,{applyMonthly:true});
}

export async function reconcileSubscriptionAfterTopup(env,clientId){
  return subscriptionAccess(env,clientId,{applyMonthly:true});
}

export async function reconcileMonthlySubscriptions(env,{limit=500}={}){
  const {results=[]}=await env.DB.prepare("SELECT DISTINCT client_id FROM subscriptions WHERE status IN ('active','trialing') ORDER BY client_id LIMIT ?").bind(Math.max(1,Math.min(2000,Number(limit)||500))).all();
  const outcomes=[];
  for(const row of results){
    try{outcomes.push(await subscriptionAccess(env,row.client_id,{applyMonthly:true}));}
    catch(error){outcomes.push({clientId:row.client_id,error:String(error?.message||error)});}
  }
  return outcomes;
}

export async function listSubscriptionsAdmin(env,{limit=500}={}){
  const capped=Math.max(1,Math.min(2000,Number(limit)||500)),today=cairoYmd(),bounds=monthBounds(today);
  const {results=[]}=await env.DB.prepare(`
    WITH client_ids AS (
      SELECT client_id FROM tenant_settings
      UNION SELECT client_id FROM wallet_accounts
      UNION SELECT client_id FROM subscriptions
      UNION SELECT client_id FROM users WHERE client_id IS NOT NULL
    ),
    latest_sub AS (
      SELECT * FROM (
        SELECT s.*,ROW_NUMBER() OVER (PARTITION BY client_id ORDER BY created_at DESC,id DESC) rn
        FROM subscriptions s
      ) WHERE rn=1
    ),
    owner AS (
      SELECT client_id,name,email FROM (
        SELECT u.client_id,u.name,u.email,ROW_NUMBER() OVER (PARTITION BY client_id ORDER BY created_at,id) rn
        FROM users u WHERE role='client'
      ) WHERE rn=1
    ),
    pending AS (
      SELECT client_id,COUNT(*) n,COALESCE(SUM(amount),0) amount
      FROM wallet_topup_requests WHERE status='pending' GROUP BY client_id
    ),
    module_fees AS (
      SELECT client_id,COALESCE(SUM(CASE WHEN enabled=1 AND per_order_fee_delta>0 THEN per_order_fee_delta ELSE 0 END),0) delta
      FROM tenant_modules GROUP BY client_id
    ),
    monthly_paid AS (
      SELECT client_id,1 paid FROM wallet_log
      WHERE reference_type='subscription_month' AND reference_id=?
      GROUP BY client_id
    )
    SELECT ids.client_id,
      t.display_name,t.plan tenant_plan,t.status tenant_status,t.currency tenant_currency,
      o.name owner_name,o.email owner_email,
      s.id sub_id,s.plan sub_plan,s.status sub_status,s.billing_cycle sub_cycle,s.amount sub_amount,
      s.currency sub_currency,s.period_start sub_period_start,s.period_end sub_period_end,
      w.balance wallet_balance,w.currency wallet_currency,w.base_order_fee,w.status wallet_status,
      COALESCE(p.n,0) pending_n,COALESCE(p.amount,0) pending_amount,
      COALESCE(mf.delta,0) module_delta,COALESCE(mp.paid,0) monthly_paid
    FROM client_ids ids
    LEFT JOIN tenant_settings t ON t.client_id=ids.client_id
    LEFT JOIN owner o ON o.client_id=ids.client_id
    LEFT JOIN latest_sub s ON s.client_id=ids.client_id
    LEFT JOIN wallet_accounts w ON w.client_id=ids.client_id
    LEFT JOIN pending p ON p.client_id=ids.client_id
    LEFT JOIN module_fees mf ON mf.client_id=ids.client_id
    LEFT JOIN monthly_paid mp ON mp.client_id=ids.client_id
    ORDER BY ids.client_id
    LIMIT ?
  `).bind(bounds.key,capped).all();

  let legacyMap=new Map();
  if(results.some(row=>row.wallet_balance===null||row.wallet_balance===undefined)){
    const legacy=await env.DB.prepare('SELECT json FROM state WHERE id=1').first();
    try{
      const parsed=JSON.parse(legacy?.json||'{}');
      legacyMap=new Map((parsed.clients||[]).map(item=>[String(item.id),item]));
    }catch{}
  }

  return results.map(row=>{
    const clientId=text(row.client_id),legacy=legacyMap.get(clientId)||{};
    const hasWallet=row.wallet_balance!==null&&row.wallet_balance!==undefined;
    const balance=round2(hasWallet?row.wallet_balance:legacy.walletBalance||0);
    const baseOrderFee=clampMoney(hasWallet?row.base_order_fee:(Number(legacy.walletFeePerOrder)||2));
    const configuredFee=round2(baseOrderFee+clampMoney(row.module_delta));
    const walletStatus=text(hasWallet?row.wallet_status:'active')||'active';
    const managed=Boolean(row.sub_id);
    if(!managed){
      const emptyBalance=balance<=0,walletPaused=walletStatus!=='active';
      const locked=walletPaused||emptyBalance;
      const reason=walletPaused?'wallet_paused':emptyBalance?'balance_empty':null;
      return {
        clientId,name:row.display_name||row.owner_name||clientId,ownerName:row.owner_name||'',ownerEmail:row.owner_email||'',
        tenantStatus:row.tenant_status||'active',plan:row.tenant_plan||'legacy',
        pendingTopups:Number(row.pending_n)||0,pendingTopupAmount:round2(row.pending_amount),
        managed:false,locked,reason,balance,currency:row.wallet_currency||row.tenant_currency||'EGP',
        monthlyMinimum:0,baseOrderFee,orderFee:configuredFee,trialActive:false,trialEndsAt:null,subscriptionStatus:'unmanaged',
        monthlyCharged:true,monthlyDue:0
      };
    }

    let subscriptionStatus=text(row.sub_status)||'active';
    const trialRow={status:subscriptionStatus,period_end:row.sub_period_end};
    const inTrial=trialActive(trialRow,today);
    if(subscriptionStatus==='trialing'&&!inTrial)subscriptionStatus='active';
    const monthlyMinimum=clampMoney(row.sub_amount),orderFee=inTrial?0:configuredFee;
    const monthlyCharged=inTrial||subscriptionStatus!=='active'||monthlyMinimum<=0||Boolean(Number(row.monthly_paid));
    const subscriptionPaused=['paused','cancelled','suspended'].includes(subscriptionStatus);
    const insufficientMonthly=!inTrial&&subscriptionStatus==='active'&&monthlyMinimum>0&&!monthlyCharged&&balance<monthlyMinimum;
    const emptyBalance=!inTrial&&balance<=0;
    const walletPaused=walletStatus!=='active';
    const locked=subscriptionPaused||walletPaused||insufficientMonthly||emptyBalance;
    const reason=subscriptionPaused?'subscription_paused':walletPaused?'wallet_paused':insufficientMonthly?'monthly_minimum_due':emptyBalance?'balance_empty':null;
    return {
      clientId,name:row.display_name||row.owner_name||clientId,ownerName:row.owner_name||'',ownerEmail:row.owner_email||'',
      tenantStatus:row.tenant_status||'active',plan:row.tenant_plan||row.sub_plan||'legacy',
      pendingTopups:Number(row.pending_n)||0,pendingTopupAmount:round2(row.pending_amount),
      managed:true,locked,reason,balance,currency:row.wallet_currency||row.sub_currency||row.tenant_currency||'EGP',
      monthlyMinimum,monthlyCharged,monthlyDue:monthlyCharged?0:monthlyMinimum,
      baseOrderFee,orderFee:inTrial?0:baseOrderFee,moduleOrderFeeDelta:round2(row.module_delta),trialActive:inTrial,trialStartsAt:row.sub_period_start||null,trialEndsAt:inTrial?row.sub_period_end:null,
      trialDaysRemaining:inTrial?daysBetween(today,row.sub_period_end):0,subscriptionStatus,
      billingCycle:row.sub_cycle||'monthly',periodStart:row.sub_period_start||bounds.from,periodEnd:row.sub_period_end||bounds.to
    };
  });
}

export const __subscriptionInternals={cairoYmd,addDays,monthBounds,trialActive,daysBetween};
