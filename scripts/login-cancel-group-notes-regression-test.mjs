import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {attachVisibleGroupOrderNotes} from '../src/collaboration-order-board-notes.js';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const performance=read('public/v2/performance-core-v52.js');
const gateway=read('public/v2/modules-v142-login-gateway.js');
const backend=read('src/production-customer-service.js');
const mobile=read('android/app/src/main/java/com/kunonline/callerid/CallerCardActivity.kt');
const cs=read('public/v2/modules-v31-customer-service.js');
const collab=read('public/v2/modules-v117-team-collaboration.js');
const html=read('public/v2/index.html');
for(const p of ['public/v2/performance-core-v52.js','public/v2/modules-v31-customer-service.js','public/v2/modules-v117-team-collaboration.js'])new Function(read(p));
let loggedIn=false,identityCalls=0,loginCalls=0;

const response=()=>({ok:true,status:200,headers,json:async()=>({role:loggedIn?'support':null}),clone(){return response()}});
const window={fetch:async(input,init={})=>{
 const url=new URL(typeof input==='string'?input:input.url,'https://app.kun-online.com');
 if(url.pathname==='/api/login'){loginCalls++;loggedIn=true;return response();}
 if(url.pathname==='/api/me'){identityCalls++;return response();}
 return response();
}};
vm.runInNewContext(performance,{window,location:{origin:'https://app.kun-online.com'},Headers,URL,Date,setTimeout,console});
const first=await window.fetch('/api/me');
assert.equal((await first.json()).role,null);
assert.equal(identityCalls,1);
const cached=await window.fetch('/api/me');
assert.equal(identityCalls,1,'anonymous me should be cacheable until login');
await window.fetch('/api/login',{method:'POST',body:'{}'});
assert.equal(loginCalls,1);
const verified=await window.fetch('/api/me',{credentials:'include',cache:'no-store',headers:{'Cache-Control':'no-cache'}});
assert.equal((await verified.json()).role,'support','login validation bypasses previous anonymous cache');
assert.equal(identityCalls,2,'login verification must reach server');
const next=await window.fetch('/api/me');
assert.equal((await next.json()).role,'support','auth change invalidates anonymous identity');
assert.equal(identityCalls,3);
assert.match(gateway,/verifyLoginSession/);
assert.match(backend,/\['pending','new','contacting','no_answer','confirmed','preparing','deferred'\]/,'in-call cancel valid before shipping');
assert.match(backend,/CANCEL_REASON_REQUIRED/,'reason always mandatory');
assert.match(backend,/reason:state==='cancelled'\?cancelReason:null/,'reason persists in audit event');
assert.match(mobile,/cancelReason = reason/,'call overlay must send reason');
assert.match(mobile,/dialog.setMessage/,'server errors shown without discarding the reason');
assert.match(cs,/class="cs-group-notes"/,'group notes appear on order card');
assert.match(collab,/appendGroupNote/,'saved linked message updates service card');
assert.match(html,/performance-core-v52\.js\?v=52\.2/,'auth cache is cache-busted');
let selectedSQL='',args=[];
const db={prepare(sql){selectedSQL=sql;return {bind(...binds){args=binds;return {async all(){return {results:[
{id:'m-1',order_id:'order-a',store_id:'store-a',body:'اتصل بالعميل غدًا',sender_name:'رندا',created_at:'2026-10-20T12:00:00Z'},
{id:'m-2',order_id:'order-a',store_id:'store-b',body:'from other store',sender_name:'X',created_at:'2026-10-20T12:01:00Z'}
]}}};}}}}};
const orders=[{id:'order-a',storeId:'store-a'},{id:'order-b',storeId:'store-b'}];
await attachVisibleGroupOrderNotes({DB:db},'client-a',{uid:'member-a'},orders);
assert.match(selectedSQL,/JOIN collab_members member/,'only group members can see linked notes');
assert.match(selectedSQL,/c\.type='group'/,'private chat never appears on shared order');
assert.match(selectedSQL,/m\.client_id=\?/,'tenant scoped');
assert.match(selectedSQL,/m\.order_id IN/,'only explicitly linked messages');
assert.deepEqual(args.slice(0,2),['member-a','client-a']);
assert.equal(orders[0].groupNotes.length,1,'different store message must be rejected');
assert.equal(orders[0].groupNotes[0].note,'اتصل بالعميل غدًا');
assert.equal(orders[1].groupNotes,undefined);
const blank=[{id:'order-x',storeId:'store-a'}];
await attachVisibleGroupOrderNotes({DB:{prepare(){throw new Error('no such table: collab_messages');}}},'client-a',{uid:'member-a'},blank);
assert.equal(blank[0].groupNotes,undefined,'legacy missing group tables do not block board');
console.log('PASS: login stale cache fixed, cancellation reason checks and secure order-linked group notes');
