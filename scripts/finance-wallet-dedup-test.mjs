import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {billOrder,reconcileUnbilledOrders} from '../src/wallet-orders.js';
import {walletSnapshot} from '../src/wallet-read.js';

const db=new DatabaseSync(':memory:');
db.exec(`
CREATE TABLE orders(id TEXT PRIMARY KEY,client_id TEXT,store_id TEXT,date TEXT,created_at TEXT);
CREATE TABLE order_duplicate_links(duplicate_order_id TEXT PRIMARY KEY,canonical_order_id TEXT);
CREATE TABLE order_billing(order_id TEXT PRIMARY KEY,client_id TEXT,status TEXT);
CREATE TABLE wallet_accounts(client_id TEXT PRIMARY KEY,balance REAL,currency TEXT,base_order_fee REAL,min_order_fee REAL,max_order_fee REAL,credit_limit REAL,billing_version TEXT,billing_start_rowid INTEGER,status TEXT);
CREATE TABLE wallet_topup_requests(id TEXT PRIMARY KEY,client_id TEXT,status TEXT,amount REAL);
CREATE TABLE wallet_log(id TEXT PRIMARY KEY,client_id TEXT,type TEXT,created_at TEXT);
`);
db.prepare('INSERT INTO orders VALUES(?,?,?,?,?)').run('CAN','client','store','2026-10-11','2026-10-11T01:00:00Z');
db.prepare('INSERT INTO orders VALUES(?,?,?,?,?)').run('DUP','client','store','2026-10-11','2026-10-11T01:01:00Z');
db.prepare('INSERT INTO order_duplicate_links VALUES(?,?)').run('DUP','CAN');
db.prepare('INSERT INTO order_billing VALUES(?,?,?)').run('CAN','client','charged');
db.prepare('INSERT INTO order_billing VALUES(?,?,?)').run('DUP','client','pending_insufficient');
db.prepare('INSERT INTO wallet_accounts VALUES(?,?,?,?,?,?,?,?,?,?)').run('client',100,'EGP',2,0,0,0,'legacy',0,'active');
class P{constructor(sql){this.sql=sql;this.args=[];}bind(...args){this.args=args;return this;}first(){return Promise.resolve(db.prepare(this.sql).get(...this.args)||null);}all(){return Promise.resolve({results:db.prepare(this.sql).all(...this.args)});}run(){return Promise.resolve(db.prepare(this.sql).run(...this.args));}}
const env={DB:{prepare:sql=>new P(sql)}};
const account=await walletSnapshot(env,'client');
assert.equal(account.balance,100);
assert.equal(account.unbilledOrders,0,'duplicate pending fee must not appear as genuine unpaid debt');
const duplicate=await billOrder(env,'DUP');
assert.equal(duplicate.skipped,'linked_duplicate_order','same order in a second import cannot trigger another wallet fee');
assert.equal(duplicate.canonicalOrderId,'CAN');
assert.equal(db.prepare("SELECT balance FROM wallet_accounts WHERE client_id='client'").get().balance,100,'duplicate billing must never mutate balance');
db.prepare("UPDATE wallet_accounts SET billing_version='v27' WHERE client_id='client'").run();
const reconciled=await reconcileUnbilledOrders(env,{clientId:'client'});
assert.equal(reconciled.length,0,'background wallet charge sweep must exclude linked duplicate even when it is unbilled');
console.log('Wallet duplicate billing SQL QA PASS: balance, charged vs pending, non-repeat sweep');
db.close();
