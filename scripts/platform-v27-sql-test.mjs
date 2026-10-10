import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {ensureWalletAccount,migrateLegacyBilling,walletSnapshot,billOrder,reconcileUnbilledOrders,requestTopup,approveTopup,adminCreditWallet,sanitizeLegacyStateBilling} from '../src/wallet-billing.js';
import {setTenantModules,effectiveOrderFee} from '../src/feature-entitlements.js';
import {configureSubscription,subscriptionAccess,startFreeTrial,endFreeTrial} from '../src/subscription-billing.js';
import {walletPaymentDiagnostics} from '../src/wallet-payment-diagnostics.js';
import {saveAttribution,campaignPerformance} from '../src/marketing-intelligence.js';
import {addOrderNote,logContact,timeline} from '../src/order-events.js';
import {createAdDraft,generateAdDraft,requestAdAction} from '../src/ad-studio.js';

const must=(ok,msg)=>{if(!ok)throw new Error(msg)};
const normalize=v=>{if(v===undefined)throw new TypeError('D1_TYPE_ERROR: Type undefined not supported; use null instead');return v};
class Stmt{constructor(db,sql){this.db=db;this.sql=sql;this.args=[]}bind(...a){this.args=a.map(normalize);return this}p(){return this.db.prepare(this.sql)}async first(){return this.p().get(...this.args)||null}async all(){return {results:this.p().all(...this.args)}}async run(){const r=this.p().run(...this.args);return {success:true,meta:{changes:Number(r.changes||0)}}}}
class D1{constructor(db){this.db=db}prepare(sql){return new Stmt(this.db,sql)}async batch(ss){const out=[];this.db.exec('BEGIN');try{for(const s of ss)out.push(await s.run());this.db.exec('COMMIT');return out}catch(e){this.db.exec('ROLLBACK');throw e}}}
const db=new DatabaseSync(':memory:');
db.exec(`
CREATE TABLE state(id INTEGER PRIMARY KEY,json TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE tenant_settings(client_id TEXT PRIMARY KEY,display_name TEXT,plan TEXT,status TEXT DEFAULT 'active',currency TEXT DEFAULT 'EGP');
CREATE TABLE subscriptions(id TEXT PRIMARY KEY,client_id TEXT NOT NULL,plan TEXT NOT NULL DEFAULT 'trial',status TEXT NOT NULL DEFAULT 'trialing',billing_cycle TEXT DEFAULT 'monthly',amount REAL DEFAULT 0,currency TEXT DEFAULT 'EGP',period_start TEXT,period_end TEXT,provider TEXT,external_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE orders(id TEXT PRIMARY KEY,client_id TEXT NOT NULL,store_id TEXT,date TEXT,created_at TEXT,name TEXT DEFAULT '',phone TEXT DEFAULT '',address TEXT DEFAULT '',gov TEXT DEFAULT '',product TEXT DEFAULT '',state TEXT DEFAULT 'pending',total REAL DEFAULT 0,customer_id TEXT,awb TEXT,source TEXT,history TEXT DEFAULT '[]',contact_log TEXT DEFAULT '[]');
CREATE TABLE products(id TEXT PRIMARY KEY,client_id TEXT NOT NULL,store_id TEXT,name TEXT,price REAL DEFAULT 0,cost REAL DEFAULT 0,category TEXT,sku TEXT,stock INTEGER DEFAULT 0,low_stock_threshold INTEGER DEFAULT 5,active INTEGER DEFAULT 1);
CREATE TABLE transactions(id TEXT PRIMARY KEY,client_id TEXT,store_id TEXT,type TEXT,date TEXT,amount REAL DEFAULT 0);
CREATE TABLE wallet_log(id TEXT PRIMARY KEY,client_id TEXT NOT NULL,store_id TEXT,type TEXT NOT NULL,amount REAL NOT NULL,balance_after REAL,note TEXT,created_at TEXT,created_by TEXT);
CREATE TABLE marketing_campaigns(id TEXT PRIMARY KEY,client_id TEXT NOT NULL,store_id TEXT,platform TEXT NOT NULL,external_campaign_id TEXT,name TEXT NOT NULL,objective TEXT,status TEXT,currency TEXT,budget REAL DEFAULT 0,created_at TEXT,updated_at TEXT);
CREATE TABLE campaign_daily_metrics(client_id TEXT NOT NULL,store_id TEXT,campaign_id TEXT NOT NULL,metric_date TEXT NOT NULL,spend REAL DEFAULT 0,impressions INTEGER DEFAULT 0,clicks INTEGER DEFAULT 0,conversions INTEGER DEFAULT 0,revenue REAL DEFAULT 0,orders_count INTEGER DEFAULT 0,updated_at TEXT,PRIMARY KEY(client_id,campaign_id,metric_date));
CREATE TABLE audit_log(id TEXT PRIMARY KEY,client_id TEXT,store_id TEXT,actor_user_id TEXT,actor_email TEXT,action TEXT NOT NULL,entity_type TEXT,entity_id TEXT,before_json TEXT,after_json TEXT,metadata_json TEXT,created_at TEXT NOT NULL);
CREATE TABLE whatsapp_outbox(id TEXT PRIMARY KEY,client_id TEXT NOT NULL,store_id TEXT,order_id TEXT,phone TEXT,message TEXT,kind TEXT,status TEXT,created_at TEXT,sent_at TEXT);
CREATE TABLE approval_requests(id TEXT PRIMARY KEY,client_id TEXT NOT NULL,store_id TEXT,source TEXT,source_id TEXT,action_type TEXT,risk TEXT,payload_json TEXT,status TEXT,requested_by TEXT,requested_at TEXT,reviewed_by TEXT,reviewed_at TEXT,review_note TEXT,idempotency_key TEXT);
CREATE TABLE ai_insight_snapshots(id TEXT PRIMARY KEY,client_id TEXT NOT NULL,store_id TEXT,insight_type TEXT NOT NULL,severity TEXT DEFAULT 'info',title TEXT NOT NULL,rationale TEXT,metric_json TEXT DEFAULT '{}',suggested_action_type TEXT,suggested_payload_json TEXT DEFAULT '{}',status TEXT DEFAULT 'active',generated_at TEXT NOT NULL,dismissed_at TEXT,dismissed_by TEXT);
CREATE INDEX idx_ai_insights_client ON ai_insight_snapshots(client_id,status,generated_at);
CREATE INDEX idx_ai_insights_store ON ai_insight_snapshots(client_id,store_id,status);
`);
db.exec(await readFile(new URL('../migrations/0014_platform_control_wallet_marketing.sql',import.meta.url),'utf8'));
const env={DB:new D1(db)},client='C1',store='S1',ts=new Date().toISOString(),day=ts.slice(0,10),yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10);
await env.DB.prepare('INSERT INTO state(id,json,updated_at) VALUES (1,?,?)').bind(JSON.stringify({clients:[{id:client,name:'QA',walletBalance:20,walletFeePerOrder:3}]}),ts).run();
await env.DB.prepare("INSERT INTO orders(id,client_id,store_id,date,created_at) VALUES ('OLD',?,?,?,?)").bind(client,store,day,ts).run();
await ensureWalletAccount(env,client);let w=await walletSnapshot(env,client);must(w.balance===20&&w.billingVersion==='legacy','Legacy wallet import failed');
await migrateLegacyBilling(env,client,'qa-admin');w=await walletSnapshot(env,client);must(w.billingVersion==='v27','v27 migration failed');
const old=await billOrder(env,'OLD');must(old.status==='waived'&&old.skipped==='pre_billing_date','Historical order must never be billed retroactively');
await env.DB.prepare("INSERT INTO orders(id,client_id,store_id,date,created_at) VALUES ('LATE-OLD',?,?,?,?)").bind(client,store,yesterday,new Date(Date.now()+500).toISOString()).run();
const lateOld=await billOrder(env,'LATE-OLD');must(lateOld.status==='waived'&&lateOld.skipped==='pre_billing_date','Late-synced historical order must be waived even when its rowid is newer than billing_start_rowid');
must((await walletSnapshot(env,client)).balance===20,'Late-synced historical order must not reduce wallet balance');
await setTenantModules(env,client,{ai:{enabled:true,feeDelta:1},orders:{enabled:true,feeDelta:0}},'qa-admin');must(await effectiveOrderFee(env,client)===4,'Effective module-based fee should be 4');
await env.DB.prepare("INSERT INTO orders(id,client_id,store_id,date,created_at) VALUES ('NEW',?,?,?,?)").bind(client,store,day,new Date(Date.now()+1000).toISOString()).run();
let charged=await billOrder(env,'NEW');must(charged.status==='charged'&&charged.fee===4,'New order charge failed');must((await walletSnapshot(env,client)).balance===16,'Wallet balance after charge must be 16');
charged=await billOrder(env,'NEW');must((await walletSnapshot(env,client)).balance===16,'Duplicate billing changed balance');
const count=await env.DB.prepare("SELECT COUNT(*) n FROM wallet_log WHERE idempotency_key='order:NEW'").first();must(Number(count.n)===1,'Order ledger must be idempotent');
const proof='data:image/jpeg;base64,AA==';const top=await requestTopup(env,client,{amount:10,senderPhone:'01000000000',proofDataUrl:proof},'qa-owner');const firstApproval=await approveTopup(env,top.id,'qa-admin','ok');must(firstApproval.creditedAmount===10&&(await walletSnapshot(env,client)).balance===26,'Topup did not credit exactly once');
const duplicate=await approveTopup(env,top.id,'qa-admin','again');must(duplicate.alreadyApproved===true&&(await walletSnapshot(env,client)).balance===26,'Repeated approval must be idempotent and must not double-credit');
await adminCreditWallet(env,client,4,'qa-admin','legacy admin endpoint compatibility');must((await walletSnapshot(env,client)).balance===30,'Admin direct credit must update v27 ledger');
let unsafe={clients:[{id:client,walletBalance:999,walletFeePerOrder:5}]};unsafe=await sanitizeLegacyStateBilling(env,unsafe);must(unsafe.clients[0].walletBalance===30&&unsafe.clients[0].walletFeePerOrder===0,'Legacy state write must not re-enable double charging');
await env.DB.prepare('UPDATE wallet_accounts SET balance=1,credit_limit=0 WHERE client_id=?').bind(client).run();
await env.DB.prepare("INSERT INTO orders(id,client_id,store_id,date,created_at) VALUES ('LOW',?,?,?,?)").bind(client,store,day,new Date(Date.now()+2000).toISOString()).run();
const low=await billOrder(env,'LOW');must(low.status==='pending_insufficient'&&low.fee===4,'New order must remain pending if full fee is unavailable');must((await walletSnapshot(env,client)).balance===1,'Order fees must never force the wallet negative');
await env.DB.prepare("INSERT INTO orders(id,client_id,store_id,date,created_at) VALUES ('WAITING',?,?,?,?)").bind(client,store,day,new Date(Date.now()+3000).toISOString()).run();
const waiting=await billOrder(env,'WAITING');must(waiting.status==='pending_insufficient','Orders arriving after exhaustion must remain pending until the next topup');
await env.DB.prepare("INSERT INTO orders(id,client_id,store_id,date,created_at) VALUES ('WAITING-2',?,?,?,?)").bind(client,store,day,new Date(Date.now()+3200).toISOString()).run();
const stillPending=await billOrder(env,'WAITING-2');must(stillPending.status==='pending_insufficient','Second historical pending order must be recorded without debit');
const recovery=await requestTopup(env,client,{amount:20,senderPhone:'01000000000',proofDataUrl:proof},'qa-owner');
const recoveryApproved=await approveTopup(env,recovery.id,'qa-admin','recover',{creditAmount:25});
must(recoveryApproved.requestedAmount===20&&recoveryApproved.creditedAmount===25,'Admin must be able to override the amount credited for a transfer');
must(recoveryApproved.balanceAfterCredit===26&&recoveryApproved.balance===26,'Approval must add the admin-confirmed credit automatically');
const pendingAfterApproval=await env.DB.prepare("SELECT status FROM order_billing WHERE order_id='WAITING'").first();must(pendingAfterApproval.status==='pending_insufficient','Approval must not silently consume the new credit against old pending orders');
const implicitRetry=await billOrder(env,'WAITING');
must(implicitRetry.code==='BACKLOG_REQUIRES_REVIEW','Webhook retries must never silently charge pending debts after topup');
const recoveredOrder=await billOrder(env,'WAITING',{allowBacklogCharge:true});
must(recoveredOrder.status==='charged'&&(await walletSnapshot(env,client)).balance===22,'An explicitly reviewed debt can be billed when funded');
// A scheduled/bulk reconciliation must NEVER replay pending fees or old unbilled
// orders after a recovery topup. Only genuinely new orders may be auto-billed.
await env.DB.prepare("INSERT INTO orders(id,client_id,store_id,date,created_at) VALUES ('HISTORIC-UNBILLED',?,?,?,?)")
  .bind(client,store,day,new Date(Date.now()-600000).toISOString()).run();
const ledgerBeforeSweep=await walletSnapshot(env,client);
const sweep=await reconcileUnbilledOrders(env,{clientId:client,limit:300});
must(!sweep.some(row=>['WAITING-2','HISTORIC-UNBILLED'].includes(row.orderId)),
  'Scheduled reconciliation must not consume approved credit on previously exhausted debt or historical unbilled orders');
must((await walletSnapshot(env,client)).balance===ledgerBeforeSweep.balance,
  'A scheduled sweep after topup must not debit any historical backlog');
const historicalWebhook=await billOrder(env,'HISTORIC-UNBILLED');
must(historicalWebhook.code==='PRE_TOPUP_BACKLOG_REVIEW','Historical webhook import must not debit wallet after a recovery topup');
must((await walletSnapshot(env,client)).balance===22,'Historical webhook update must not consume freshly approved balance');
const waiting2=await env.DB.prepare("SELECT status FROM order_billing WHERE order_id='WAITING-2'").first();
must(waiting2.status==='pending_insufficient','Historical insufficient item must remain reviewable, never silently deleted');
await env.DB.prepare("INSERT INTO orders(id,client_id,store_id,date,created_at) VALUES ('POST-RECOVERY-NEW',?,?,?,?)")
  .bind(client,store,day,new Date(Date.now()+60000).toISOString()).run();
const newOrders=await reconcileUnbilledOrders(env,{clientId:client,limit:300});
must(newOrders.some(o=>o.orderId==='POST-RECOVERY-NEW'&&o.status==='charged'),
  'Legitimate newly created orders after payment must still be billed automatically');
must((await walletSnapshot(env,client)).balance===18,
  'Only the new per-order fee must have been deducted');
const creditsOnPreviouslyLimitedWallet=await walletSnapshot(env,client);
await env.DB.prepare('UPDATE wallet_accounts SET balance=1,credit_limit=100 WHERE client_id=?').bind(client).run();
await env.DB.prepare("INSERT INTO orders(id,client_id,store_id,date,created_at) VALUES ('LIMITED-CREDIT',?,?,?,?)")
  .bind(client,store,day,new Date(Date.now()+70000).toISOString()).run();
const creditProtected=await billOrder(env,'LIMITED-CREDIT');
must(creditProtected.status==='pending_insufficient'&&(await walletSnapshot(env,client)).balance===1,
  'Legacy credit limits may cover monthly debt but must not overdraw on order fees');
await env.DB.prepare('UPDATE wallet_accounts SET balance=1,credit_limit=100 WHERE client_id=?').bind(client).run();
await env.DB.prepare("INSERT INTO orders(id,client_id,store_id,date,created_at) VALUES ('CONCURRENT-A',?,?,?,?)")
  .bind(client,store,day,new Date(Date.now()+71000).toISOString()).run();
await env.DB.prepare("INSERT INTO orders(id,client_id,store_id,date,created_at) VALUES ('CONCURRENT-B',?,?,?,?)")
  .bind(client,store,day,new Date(Date.now()+72000).toISOString()).run();
const concurrent=await Promise.all([billOrder(env,'CONCURRENT-A'),billOrder(env,'CONCURRENT-B')]);
must(concurrent.every(row=>row.status==='pending_insufficient')&&(await walletSnapshot(env,client)).balance===1,
  'Parallel new orders cannot overdraw a wallet whose available funds are below one order fee');
// Restore unrelated billing fixture to its pre-limit balance, all in test-only SQLite.
await env.DB.prepare('UPDATE wallet_accounts SET balance=?,credit_limit=100 WHERE client_id=?')
  .bind(creditsOnPreviouslyLimitedWallet.balance,client).run();


// Managed subscriptions use one authoritative ledger: the monthly minimum is posted
// exactly once even when it crosses below zero. A paid subscription pauses
// protected operations until a positive wallet credit restores access.
const c3='C3',s3='S3';
await env.DB.prepare("INSERT INTO wallet_accounts(client_id,balance,currency,base_order_fee,min_order_fee,max_order_fee,credit_limit,billing_version,billing_start_rowid,status,updated_at) VALUES (?,13,'EGP',2,0,0,0,'legacy',NULL,'active',?)").bind(c3,ts).run();
await env.DB.prepare("INSERT INTO orders(id,client_id,store_id,date,created_at) VALUES ('C3-OLD',?,?,?,?)").bind(c3,s3,day,new Date(Date.now()+4000).toISOString()).run();
const c3Access=await configureSubscription(env,c3,{monthlyMinimum:20,baseOrderFee:5,status:'active'},'qa-admin');
const c3Wallet=await walletSnapshot(env,c3);
must(c3Wallet.billingVersion==='v27','Managed subscription must migrate legacy wallet to v27');
must(c3Wallet.balance===-7,'Monthly minimum must be posted to the ledger even when it crosses below zero');
must(c3Access.locked===true&&c3Access.reason==='balance_empty'&&c3Access.balanceEmpty===true&&c3Access.monthlyCharged===true,'Posted negative balance must lock paid operations and remain visible until topup');
const c3Old=await billOrder(env,'C3-OLD');must(c3Old.status==='waived'&&c3Old.skipped==='pre_billing_date','Subscription activation must never back-bill historical orders');
const c3MonthlyCount=await env.DB.prepare("SELECT COUNT(*) n FROM wallet_log WHERE client_id=? AND reference_type='subscription_month'").bind(c3).first();
await subscriptionAccess(env,c3,{applyMonthly:true});
const c3MonthlyCountAgain=await env.DB.prepare("SELECT COUNT(*) n FROM wallet_log WHERE client_id=? AND reference_type='subscription_month'").bind(c3).first();
must(Number(c3MonthlyCount.n)===1&&Number(c3MonthlyCountAgain.n)===1,'Monthly minimum must be idempotent and charged once per month');
// Admin must remain able to manage paid subscriptions and trials despite
// debt already posted by the monthly minimum.
const c3Paused=await configureSubscription(env,c3,{monthlyMinimum:20,baseOrderFee:6,status:'paused'},'qa-admin');
must(c3Paused.locked&&c3Paused.reason==='subscription_paused','Admin must be able to pause a subscription while wallet debt is posted');
const c3Resumed=await configureSubscription(env,c3,{monthlyMinimum:20,baseOrderFee:5,status:'active'},'qa-admin');
must(c3Resumed.locked&&c3Resumed.reason==='balance_empty','Resuming a paid subscription with negative balance must retain the balance lock');
const c3Trial=await startFreeTrial(env,c3,{days:30,actor:'qa-admin'});
must(c3Trial.trialActive&&!c3Trial.locked&&c3Trial.balance===-7,'Admin may start an explicit free trial without clearing debt');
const c3TrialEnded=await endFreeTrial(env,c3,{actor:'qa-admin'});
must(!c3TrialEnded.trialActive&&c3TrialEnded.locked&&c3TrialEnded.reason==='balance_empty','Ending trial must restore paid-wallet lock while debt remains');
const c3DebtWallet=await env.DB.prepare('SELECT balance,credit_limit FROM wallet_accounts WHERE client_id=?').bind(c3).first();
must(c3DebtWallet.balance===-7&&c3DebtWallet.credit_limit>=7,'Admin updates must preserve both wallet debt and valid credit floor');
const c3ChargeCount=await env.DB.prepare("SELECT COUNT(*) n FROM wallet_log WHERE client_id=? AND reference_type='subscription_month'").bind(c3).first();
must(Number(c3ChargeCount.n)===1,'Admin config/trial transitions must not charge the monthly minimum twice');
const c3Top=await requestTopup(env,c3,{amount:500,senderPhone:'01000000000',proofDataUrl:proof},'qa-owner');
const c3Approved=await approveTopup(env,c3Top.id,'qa-admin','single-ledger recovery');
must(c3Approved.balance===493&&c3Approved.access?.locked===false&&c3Approved.access?.balanceEmpty===false,'500 topup after a -7 monthly balance must finish at 493 and clear the empty-balance state');
const brokenTopup=await requestTopup(env,c3,{amount:10,senderPhone:'01000000000',proofDataUrl:proof},'qa-owner');
await env.DB.prepare("UPDATE wallet_topup_requests SET status='approved' WHERE id=?").bind(brokenTopup.id).run();
let integrityCaught=false;try{await approveTopup(env,brokenTopup.id,'qa-admin','integrity check')}catch(error){integrityCaught=error?.code==='TOPUP_APPROVAL_INTEGRITY'}
must(integrityCaught,'Approved topup without a matching ledger credit must fail integrity validation instead of pretending money was added');

// Regression for the reported 500 EGP recharge / 333 EGP positive balance,
// then -178 EGP incident. The breakdown must reveal whether the subsequent
// 511 EGP came from a monthly subscription versus previously billed orders.
// This is an isolated *synthetic fixture*, NOT a claim about a real client's ledger.
const c4='C4';
await env.DB.prepare(`INSERT INTO wallet_accounts
  (client_id,balance,currency,base_order_fee,min_order_fee,max_order_fee,credit_limit,billing_version,billing_start_rowid,status,updated_at)
  VALUES (?,-167,'EGP',2,0,0,167,'v27',0,'active',?)`).bind(c4,ts).run();
const diagnosticTopup=await requestTopup(env,c4,{amount:500,senderPhone:'01000000000',proofDataUrl:proof},'qa-owner');
const diagnosticApproval=await approveTopup(env,diagnosticTopup.id,'qa-admin','audit fixture');
must(diagnosticApproval.balanceAfterCredit===333,'An approved 500 topup after -167 must show 333');
const diagnosticInitial=await walletPaymentDiagnostics(env,c4);
must(diagnosticInitial.lastApprovedCredit?.amount===500&&diagnosticInitial.sinceLastCredit?.debits===0,
  'Read-only diagnostic must identify the approved credit without inventing a debit');
const diagnosticMonthly=await configureSubscription(env,c4,{monthlyMinimum:511,baseOrderFee:2,status:'active'},'qa-admin');
must(diagnosticMonthly.balance===-178,'Explicit 511 monthly minimum can explain a later -178 ledger state');
const diagnosticAfter=await walletPaymentDiagnostics(env,c4);
must(diagnosticAfter.lastApprovedCredit?.balanceAfter===333&&diagnosticAfter.sinceLastCredit?.debits===511
  &&diagnosticAfter.sinceLastCredit?.debitBreakdown?.subscription===511
  &&diagnosticAfter.sinceLastCredit?.debitBreakdown?.orders===0
  &&diagnosticAfter.ledgerBalanceMismatch===0
  &&diagnosticAfter.sinceLastCredit?.drift===0
  &&diagnosticAfter.missingApprovedCredits===0,'Admin audit must accurately attribute a 511 debit to its ledger reference and verify balances');
await env.DB.prepare('UPDATE wallet_accounts SET balance=-177 WHERE client_id=?').bind(c4).run();
const mismatch=await walletPaymentDiagnostics(env,c4);
must(mismatch.ledgerBalanceMismatch===1&&mismatch.sinceLastCredit?.drift===1,
  'Diagnostic must flag an unlogged balance mutation instead of reporting everything as healthy');
await env.DB.prepare('UPDATE wallet_accounts SET balance=-178 WHERE client_id=?').bind(c4).run();

// Real marketing metrics must count externally-entered/unattributed orders at account level.
const c2='C2',s2='S2';
await env.DB.prepare("INSERT INTO marketing_campaigns(id,client_id,store_id,platform,external_campaign_id,name,objective,status,currency,budget,created_at,updated_at) VALUES ('CAM1',?,?,'meta','EXT1','QA Meta','sales','active','EGP',100,?,?)").bind(c2,s2,ts,ts).run();
await env.DB.prepare("INSERT INTO campaign_daily_metrics(client_id,store_id,campaign_id,metric_date,spend,impressions,clicks,conversions,revenue,orders_count,updated_at) VALUES (?,?,'CAM1',?,100,1000,50,1,500,1,?)").bind(c2,s2,day,ts).run();
await env.DB.prepare("INSERT INTO orders(id,client_id,store_id,date,created_at,name,phone,state,total,customer_id,source) VALUES ('M1',?,?,?,?,'A','0101','signed',500,'CU1','website')").bind(c2,s2,day,ts).run();
await env.DB.prepare("INSERT INTO orders(id,client_id,store_id,date,created_at,name,phone,state,total,source) VALUES ('M2',?,?,?,?,'B','0102','pending',300,'whatsapp')").bind(c2,s2,day,ts).run();
await saveAttribution(env,{clientId:c2,storeId:s2,orderId:'M1',platform:'meta',campaignId:'CAM1',sourceKind:'website'});
const perf=await campaignPerformance(env,{clientId:c2,storeId:s2,from:day,to:day});must(perf.total.realOrders===2,'Account real orders must include external/unattributed orders');must(perf.total.attributedOrders===1&&perf.total.unattributedOrders===1,'Attribution gap must be visible');must(perf.total.realOrderCost===50,'Real order cost must use all Kun orders');must(perf.campaigns[0].ctr===5&&perf.campaigns[0].cpc===2,'CTR/CPC calculation failed');

// Order command center data: note, phone/WhatsApp contact and actor/timestamp timeline.
await addOrderNote(env,{clientId:c2,storeId:s2,orderId:'M2',body:{body:'QA internal note'},actor:{uid:'U1',email:'qa@example.test'}});
await logContact(env,{clientId:c2,storeId:s2,orderId:'M2',body:{channel:'whatsapp',message:'QA WhatsApp'},actor:{uid:'U1',email:'qa@example.test'}});
const tl=await timeline(env,{clientId:c2,storeId:s2,orderId:'M2'});must(tl.events.some(x=>x.type==='note_added')&&tl.events.some(x=>x.type==='contact_whatsapp'),'Order timeline missing note/contact events');const outbox=await env.DB.prepare("SELECT COUNT(*) n FROM whatsapp_outbox WHERE order_id='M2' AND status='pending'").first();must(Number(outbox.n)===1,'WhatsApp contact must queue exactly one message');

// Ad Studio must work without an AI key through rules, then gate spend-affecting actions behind approval.
const draft=await createAdDraft(env,{clientId:c2,storeId:s2,body:{name:'QA Product Campaign',offerText:'QA Offer',targetAudience:'QA Audience',productContext:{product:{name:'QA Product'},angles:['Problem','Value']}},actor:{uid:'U1',email:'qa@example.test'}});
const generated=await generateAdDraft(env,{clientId:c2,storeId:s2,draftId:draft.id,body:{platform:'meta'},actor:{uid:'U1',email:'qa@example.test'}});must(generated.count>=2&&generated.ai.used===false,'Ad Studio fallback generation failed');
const approval=await requestAdAction(env,{clientId:c2,storeId:s2,draftId:draft.id,body:{action:'publish_campaign',platform:'meta_ads'},actor:{uid:'U1',email:'qa@example.test'}});must(approval.status==='pending','Ad publish must require approval');const apr=await env.DB.prepare('SELECT store_id,action_type,status FROM approval_requests WHERE id=?').bind(approval.approvalId).first();must(apr.store_id===s2&&apr.action_type==='ads.publish_campaign'&&apr.status==='pending','Ad approval must remain store-scoped and sensitive');

console.log('v27 SQL checks passed: wallet safety, real attribution, order timeline/contact and approval-gated Ad Studio.');
