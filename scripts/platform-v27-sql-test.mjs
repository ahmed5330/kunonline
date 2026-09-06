import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {ensureWalletAccount,migrateLegacyBilling,walletSnapshot,billOrder,requestTopup,approveTopup,adminCreditWallet,sanitizeLegacyStateBilling} from '../src/wallet-billing.js';
import {setTenantModules,effectiveOrderFee} from '../src/feature-entitlements.js';
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
const env={DB:new D1(db)},client='C1',store='S1',ts=new Date().toISOString(),day=ts.slice(0,10);
await env.DB.prepare('INSERT INTO state(id,json,updated_at) VALUES (1,?,?)').bind(JSON.stringify({clients:[{id:client,name:'QA',walletBalance:20,walletFeePerOrder:3}]}),ts).run();
await env.DB.prepare("INSERT INTO orders(id,client_id,store_id,date,created_at) VALUES ('OLD',?,?,?,?)").bind(client,store,day,ts).run();
await ensureWalletAccount(env,client);let w=await walletSnapshot(env,client);must(w.balance===20&&w.billingVersion==='legacy','Legacy wallet import failed');
await migrateLegacyBilling(env,client,'qa-admin');w=await walletSnapshot(env,client);must(w.billingVersion==='v27','v27 migration failed');
const old=await billOrder(env,'OLD');must(old.skipped==='pre_v27_order','Historical order must never be billed retroactively');
await setTenantModules(env,client,{ai:{enabled:true,feeDelta:1},orders:{enabled:true,feeDelta:0}},'qa-admin');must(await effectiveOrderFee(env,client)===4,'Effective module-based fee should be 4');
await env.DB.prepare("INSERT INTO orders(id,client_id,store_id,date,created_at) VALUES ('NEW',?,?,?,?)").bind(client,store,day,new Date(Date.now()+1000).toISOString()).run();
let charged=await billOrder(env,'NEW');must(charged.status==='charged'&&charged.fee===4,'New order charge failed');must((await walletSnapshot(env,client)).balance===16,'Wallet balance after charge must be 16');
charged=await billOrder(env,'NEW');must((await walletSnapshot(env,client)).balance===16,'Duplicate billing changed balance');
const count=await env.DB.prepare("SELECT COUNT(*) n FROM wallet_log WHERE idempotency_key='order:NEW'").first();must(Number(count.n)===1,'Order ledger must be idempotent');
const proof='data:image/jpeg;base64,AA==';const top=await requestTopup(env,client,{amount:10,senderPhone:'01000000000',proofDataUrl:proof},'qa-owner');await approveTopup(env,top.id,'qa-admin','ok');must((await walletSnapshot(env,client)).balance===26,'Topup did not credit exactly once');
let duplicate=false;try{await approveTopup(env,top.id,'qa-admin','again')}catch(e){duplicate=e.code==='TOPUP_NOT_PENDING'}must(duplicate,'Second topup approval must be rejected');
await adminCreditWallet(env,client,4,'qa-admin','legacy admin endpoint compatibility');must((await walletSnapshot(env,client)).balance===30,'Admin direct credit must update v27 ledger');
let unsafe={clients:[{id:client,walletBalance:999,walletFeePerOrder:5}]};unsafe=await sanitizeLegacyStateBilling(env,unsafe);must(unsafe.clients[0].walletBalance===30&&unsafe.clients[0].walletFeePerOrder===0,'Legacy state write must not re-enable double charging');
await env.DB.prepare('UPDATE wallet_accounts SET balance=1,credit_limit=0 WHERE client_id=?').bind(client).run();
await env.DB.prepare("INSERT INTO orders(id,client_id,store_id,date,created_at) VALUES ('LOW',?,?,?,?)").bind(client,store,day,new Date(Date.now()+2000).toISOString()).run();
const low=await billOrder(env,'LOW');must(low.status==='pending_insufficient','Insufficient balance must be pending, not negative');must((await walletSnapshot(env,client)).balance===1,'Failed charge must rollback balance');

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
