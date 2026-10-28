import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {handleDocumentSettings} from '../src/document-settings.js';
import {DOCUMENT_TEMPLATES,defaultDocumentSettings,normalizeDocumentSettings,selectDocumentProfile} from '../public/v2/document-print-model.js';
const db=new DatabaseSync(':memory:');
db.exec("CREATE TABLE stores(id TEXT,client_id TEXT,name TEXT,status TEXT); INSERT INTO stores VALUES('S1','C1','One','active'),('S2','C2','Two','active'); CREATE TABLE orders(id TEXT,client_id TEXT,store_id TEXT); INSERT INTO orders VALUES('O1','C1','S1'),('O2','C2','S2');");
function prepare(sql){let bindings=[];return {sql,get bindings(){return bindings;},bind(...b){bindings=b;return this;},async first(){return db.prepare(sql).get(...bindings)||null;},async all(){return {results:db.prepare(sql).all(...bindings)};},async run(){return {meta:{changes:Number(db.prepare(sql).run(...bindings).changes)}};}};}
const env={APP_ENV:'sandbox',DOCUMENT_SETTINGS_WRITE_ENABLED:'1',DB:{prepare,async batch(steps){db.exec('BEGIN');try{const result=[];for(const step of steps)result.push({meta:{changes:Number(db.prepare(step.sql).run(...step.bindings).changes)}});db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}}};
async function call({method='GET',body,role='client',clientId='C1',storeId='S1',suffix='',mode='sandbox',auth=true}={}){
 const url=new URL('https://synthetic.invalid/api/document-settings'+suffix);url.searchParams.set('clientId',clientId);url.searchParams.set('storeId',storeId);
 return handleDocumentSettings({request:new Request(url,{method,...(body?{body:JSON.stringify(body),headers:{'Content-Type':'application/json'}}:{})}),env:{...env,APP_ENV:mode},ctx:{},delegate:{fetch:async()=>Response.json(auth?{role,clientId:'C1',uid:'U1'}:{},{status:auth?200:401})}});
}
assert.equal((await call({auth:false})).status,401);
assert.equal((await call({role:'viewer'})).status,403);
assert.equal((await call({clientId:'C2',storeId:'S2'})).status,403);
assert.equal((await call({storeId:'S2'})).status,403);
assert.equal((await call({storeId:''})).status,400);
const unready=await (await call()).json();assert.equal(unready.storageReady,false);assert.equal(unready.writeEnabled,false);
const original=defaultDocumentSettings();assert.equal((await call({method:'PUT',body:{revision:0,config:original},mode:'production'})).status,403);
assert.equal((await call({method:'PUT',body:{revision:0,config:original},mode:'preview'})).status,403);
db.exec(readFileSync(new URL('../docs/sql/document-settings-sandbox.sql',import.meta.url),'utf8'));
assert.equal(DOCUMENT_TEMPLATES.length,11);
original.brand.name='<img src=x onerror=alert(1)>'; // remains text, escaped by renderer.
const save=()=>call({method:'PUT',body:{revision:0,config:original}});
const concurrent=await Promise.all([save(),save()]);assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]);
assert.equal(db.prepare('SELECT COUNT(*) n FROM document_settings_audit').get().n,1);
const stored=await (await call()).json();assert.equal(stored.revision,1);assert.equal(stored.config.brand.name,original.brand.name);
assert.equal((await call({method:'PUT',body:{revision:1,config:original,storeId:'S2'}})).status,403);
db.exec("CREATE TRIGGER fail_document_audit BEFORE INSERT ON document_settings_audit BEGIN SELECT RAISE(ABORT,'SYNTHETIC_AUDIT_FAILURE'); END;");
assert.equal((await call({method:'PUT',body:{revision:1,config:{...original,brand:{...original.brand,name:'Changed'}}}})).status,500);
assert.equal((await (await call()).json()).revision,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM document_settings_audit').get().n,1);db.exec('DROP TRIGGER fail_document_audit');
const logoBad={...original,brand:{...original.brand,logo:'https://external.invalid/logo.png'}};assert.throws(()=>normalizeDocumentSettings(logoBad));
assert.throws(()=>normalizeDocumentSettings({...original,profiles:[{id:'x',name:'x',size:'bad',template:'classic'}]}));
assert.throws(()=>normalizeDocumentSettings({...original,rules:[{enabled:true,state:'unknown',profileId:'default'}]}));
assert.throws(()=>normalizeDocumentSettings({...original,profiles:[original.profiles[0],original.profiles[0]]}));
const rules={...original,profiles:[...original.profiles,{id:'thermal',name:'Thermal',size:'receipt',template:'receipt'}],rules:[{enabled:true,state:'confirmed',minTotal:100,maxTotal:200,profileId:'thermal'}]};
assert.equal(selectDocumentProfile(rules,{state:'confirmed',total:100}).id,'thermal');assert.equal(selectDocumentProfile(rules,{state:'confirmed',total:200}).id,'thermal');assert.equal(selectDocumentProfile(rules,{state:'confirmed',total:null}).id,'default');assert.equal(selectDocumentProfile(rules,{state:'cancelled',total:150}).id,'default');
const event={id:'EVENT-001',orderId:'O1',template:'classic',size:'A4'};
assert.equal((await call({method:'POST',suffix:'/print-events',body:{...event,orderId:'O2'}})).status,404);
assert.equal((await call({method:'POST',suffix:'/print-events',body:event})).status,200);
assert.equal((await call({method:'POST',suffix:'/print-events',body:event})).status,200);
assert.equal(db.prepare('SELECT COUNT(*) n FROM document_print_events').get().n,1);
assert.equal((await call({method:'POST',suffix:'/print-events',body:{...event,size:'A5'}})).status,409);
const history=await (await call({suffix:'/print-events?orderId=O1'})).json();assert.equal(history.events.length,1);assert.equal(history.statusMeaning,'print_requested_not_confirmed');
assert.throws(()=>db.prepare('DELETE FROM document_print_events').run(),/IMMUTABLE/);
assert.throws(()=>db.prepare('DELETE FROM document_settings_audit').run(),/IMMUTABLE/);
console.log('Document settings SQLite PASS: missing-schema defaults, production/preview write denial, auth and store isolation, 11 templates, profile/rule validation, CAS race, atomic audit rollback, immutable/idempotent print requests, original-order scope. No external calls.');
