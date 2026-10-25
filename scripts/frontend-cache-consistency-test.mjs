import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../public/v2/performance-core-v52.js',import.meta.url),'utf8');
let calls=0,releaseOld;
const window={fetch:async()=>{
  calls++;
  if(calls===1)return new Promise(resolve=>{releaseOld=()=>resolve(Response.json({contactCount:1}));});
  return Response.json({contactCount:2});
}};
vm.runInNewContext(source,{window,location:{origin:'https://qa.example'},URL,Date,setTimeout,document:{querySelector:()=>null}});
const beforeWrite=window.fetch('/api/customer-service?clientId=synthetic');
window.KunPerformanceCore.invalidate('/api/customer-service');
const afterWrite=window.fetch('/api/customer-service?clientId=synthetic');
assert.equal((await afterWrite).clone().status,200);
releaseOld();
assert.equal((await (await beforeWrite).json()).contactCount,2,'A pre-write request must not deliver its stale contact count after invalidation');
assert.equal((await (await window.fetch('/api/customer-service?clientId=synthetic')).json()).contactCount,2);
assert.equal(calls,2,'The stale request should reuse the fresh cached result, not create another request');
await window.fetch('/api/customer-service/orders/qa/contact',{method:'POST'});
await window.fetch('/api/customer-service/orders/qa/contact',{method:'POST'});
assert.equal(calls,4,'Writes are never cached or deduplicated');

let renders=0,view='customer-service',content='page';
class Element{
  constructor(){this.dataset={};}
  querySelector(selector){return content&&selector.includes('.cs-page')?{}:null;}
}
const root=new Element();
const guardWindow={fetch:async()=>Response.json({}),render:()=>{renders++;},KunCustomerServiceV31:{}};
const document={readyState:'complete',getElementById:id=>id==='root'?root:null,
  querySelector:()=>({dataset:{view}}),addEventListener:()=>{}};
const guard=await readFile(new URL('../public/v2/modules-v89-stale-async-guard.js',import.meta.url),'utf8');
vm.runInNewContext(guard,{window:guardWindow,document,Element,location:{origin:'https://qa.example'},URL,Response,setTimeout});
guardWindow.render();assert.equal(renders,0,'A late base render cannot replace an active Customer Service workspace');
content='loading';guardWindow.render();assert.equal(renders,0,'The async Customer Service loading state is protected too');
view='orders';guardWindow.render();assert.equal(renders,1,'Normal navigation away must still render');
console.log('PASS: stale in-flight reads cannot overwrite contact changes, writes remain uncached, and late base renders preserve the active Customer Service page.');
