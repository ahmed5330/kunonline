/* Payment safety regression. Fixture-only; never reads or writes production D1. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {subscriptionAccess} from '../src/subscription-billing.js';
import {handleSubscriptionControl} from '../src/subscription-control.js';
import {mirrorLegacyBalance} from '../src/wallet-account.js';

function readEnv({balance=333,monthlyMinimum=511,walletStatus='active',subscriptionStatus='active',periodEnd='2099-12-31'}={}){
 const wallet={client_id:'billing-qa',balance,status:walletStatus,currency:'EGP',billing_version:'v27',base_order_fee:3,credit_limit:1000};
 const subscription={id:'SUB-QA',client_id:'billing-qa',amount:monthlyMinimum,status:subscriptionStatus,period_end:periodEnd,period_start:'2026-10-01',billing_cycle:'monthly',currency:'EGP',created_at:'2026-01-01T00:00:00Z'};
 const calls={reads:[],writes:[]};
 const env={DB:{prepare(sql){return {bind(...values){return {
 async first(){
  calls.reads.push({sql,values});
  if(sql.includes('SELECT * FROM wallet_accounts'))return wallet;
  if(sql.includes('SELECT * FROM subscriptions'))return subscription;
  if(sql.includes("SELECT created_at FROM audit_log"))return {created_at:'2026-01-01T00:00:00.000Z'};
  if(sql.includes('SELECT id,amount,balance_after,created_at FROM wallet_log'))return null;
  if(sql.includes('SELECT balance,status,currency FROM wallet_accounts'))return wallet;
  throw Error('Unexpected SQL read: '+sql);
 },
 async all(){calls.reads.push({sql,values});return {results:[]};},
 async run(){calls.writes.push({sql,values});throw Error('Read-only path attempted to write: '+sql);}
 };}};},async batch(){calls.writes.push({sql:'BATCH'});throw Error('Read-only access tried to bill');}}};
 return {env,wallet,subscription,calls};
}
const funded=readEnv();
for(let i=0;i<5;i++){
 const a=await subscriptionAccess(funded.env,'billing-qa');
 assert.equal(a.locked,false);
 assert.equal(a.balance,333);
 assert.equal(a.monthlyDue,511,'unbilled minimum must be disclosed, not silently debited in access GET');
 assert.equal(a.monthlyCharged,false);
}
assert.equal(funded.wallet.balance,333);
assert.equal(funded.calls.writes.length,0,'polling must never post ledger changes');
const next=readEnv({balance:-178});
const exhausted=await subscriptionAccess(next.env,'billing-qa');
assert.equal(exhausted.reason,'balance_empty');
const manualPause=readEnv({balance:1000,walletStatus:'paused'});
const paused=await subscriptionAccess(manualPause.env,'billing-qa');
assert.equal(paused.locked,true);
assert.equal(paused.reason,'wallet_paused','credit cannot silently override admin pause');
const endedTrial=readEnv({balance:0,subscriptionStatus:'trialing',periodEnd:'2020-01-01'});
const expired=await subscriptionAccess(endedTrial.env,'billing-qa');
assert.equal(expired.trialActive,false);
assert.equal(expired.subscriptionStatus,'active');
assert.equal(endedTrial.subscription.status,'trialing','read must not mutate trial status');
assert.equal(endedTrial.calls.writes.length,0,'expired trial read cannot charge or update subscriptions');
const delegate={fetch:async(req)=>Response.json({role:'client',clientId:'billing-qa'})};
async function route({database,path,method='GET'}){
 return handleSubscriptionControl({request:new Request('https://kun.example'+path,{method,headers:{cookie:'fixture'},...(method==='GET'?{}:{body:'{}'})}),env:database,ctx:{},delegate});
}
for(const path of ['/api/subscription/access','/api/dashboard','/api/wallet']){
 const result=await route({database:funded.env,path});
 if(path==='/api/subscription/access')assert.equal(result.status,200);
 else assert.equal(result,null);
}
assert.equal(funded.calls.writes.length,0,'HTTP access checks cannot charge the wallet');
assert.equal(await route({database:manualPause.env,path:'/api/wallet'}),null,'paused customer must be able to open wallet');
assert.equal((await route({database:manualPause.env,path:'/api/wallet/topups'})).status,200,'paused customer should be allowed to check topups');
const blocked=await route({database:manualPause.env,path:'/api/orders',method:'POST'});
assert.equal(blocked.status,402);
assert.equal((await blocked.json()).code,'SUBSCRIPTION_ACCESS_PAUSED');
assert.equal(manualPause.calls.writes.length,0);

const stateRow={updated_at:'2026-10-13T17:00:00Z',json:JSON.stringify({clients:[{id:'billing-qa',walletBalance:-178,walletFeePerOrder:2}]})};
let stored=null,reads=0;
const mirrorEnv={DB:{prepare(sql){
 return {bind(...values){return {
 async first(){
  if(sql.startsWith('SELECT json,updated_at FROM state'))return stateRow;
  if(sql.startsWith('SELECT balance,billing_version FROM wallet_accounts')){reads++;return {balance:333,billing_version:'v27'};}
  throw Error('Unexpected mirror SQL '+sql);
 },
 async run(){
  if(!sql.startsWith('UPDATE state'))throw Error('Unexpected mirror write '+sql);
  stored=JSON.parse(values[0]);return {meta:{changes:1}};
 }
 };}};
}}};
await mirrorLegacyBalance(mirrorEnv,'billing-qa',-178,{disableLegacyFee:true});
assert.equal(reads,1);
assert.equal(stored.clients[0].walletBalance,333,'stale async mirror must use the current authoritative balance');
assert.equal(stored.clients[0].walletFeePerOrder,0);
const billing=fs.readFileSync('src/subscription-billing.js','utf8');
const control=fs.readFileSync('src/subscription-control.js','utf8');
const ui=fs.readFileSync('public/v2/modules-v127-subscriptions.js','utf8');
assert.ok(billing.includes("explicitStatus=['active','paused','suspended']"),'fee edits must preserve wallet pause');
assert.ok(billing.includes("const walletStatus=explicitStatus?"),'wallet status changes require explicit action');
assert.ok(control.includes('subscriptionAccess(env,clientId,{applyMonthly:false})'),'all ordinary API access checks must be readonly');
assert.ok(ui.includes('data-sub127-monthly-due'),'monthly due must be disclosed to client');
assert.ok(ui.includes('Number(client?.monthlyDue)>0'),'admin approval must disclose due monthly fee');
assert.ok(ui.includes("if(target==='wallet'&&state.me?.role==='client')"),'wallet must remain accessible while blocked');
assert.ok(!ui.includes("if(target==='wallet'&&state.me?.role==='client'&&!state.locked)"),'old lock guard may not block topup page');
console.log('Payment/access regression: PASS — zero side effects for GET, monthly due visible, manual pauses preserved, stale mirror prevented, wallet reachable.');
