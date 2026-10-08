import assert from 'node:assert/strict';
import {buildEasyOrdersAction,runEasyOrdersStoreControl,findBoundEasyOrdersConnection,EASYORDERS_CONTROL_CAPABILITIES} from '../src/easyorders-store-control.js';

assert.equal(EASYORDERS_CONTROL_CAPABILITIES.themes.write,false,'Do not claim undocumented theme operations');
assert.equal(buildEasyOrdersAction({operation:'product.stock',entityId:'ABC-01',payload:{quantity:0}}).path,'products/sku/ABC-01/quantity');
assert.deepEqual(buildEasyOrdersAction({operation:'variant.stock',entityId:'VAR123',payload:{productTaagerCode:'PROD123',quantity:12}}).payload,{quantity:12});
assert.deepEqual(buildEasyOrdersAction({operation:'shipping.update',payload:{cities:[{name:'القاهرة',shipping_cost:30},{name:'الإسكندرية',shipping_cost:45}]}}).payload,{is_active:true,cities:'القاهرة:30,الإسكندرية:45'});
assert.equal(buildEasyOrdersAction({operation:'order.status',entityId:'order-A',payload:{status:'delivered'}}).path,'orders/order-A/status');
assert.equal(buildEasyOrdersAction({operation:'order.note',entityId:'order-A',payload:{note:'مراجعة',store_id:'easy-store'}}).method,'POST');
assert.throws(()=>buildEasyOrdersAction({operation:'theme.publish',payload:{}}),/غير مدعومة/);
assert.throws(()=>buildEasyOrdersAction({operation:'shipping.update',payload:{cities:[{name:'القاهرة',shipping_cost:30},{name:'القاهرة',shipping_cost:90}]}}),/مكررة/);
assert.throws(()=>buildEasyOrdersAction({operation:'product.stock',entityId:'X',payload:{quantity:-1}}),/غير صالح/);
assert.throws(()=>buildEasyOrdersAction({operation:'product.update',entityId:'https://attacker/',payload:{name:'NO'}}),/غير صالح/);
assert.throws(()=>buildEasyOrdersAction({operation:'order.status',entityId:'X',payload:{status:'anything'}}),/غير معتمدة/);
assert.throws(()=>buildEasyOrdersAction({operation:'category.create',payload:{}}),/مطلوب/);

const row={id:'conn-1',client_id:'tenant-A',provider:'easyorders',status:'connected',config_json:JSON.stringify({kunStoreId:'store-A'}),external_store_id:'easy-A',updated_at:'2026-10-08'};
const records=[],outbound=[];
let me={role:'client',clientId:'tenant-A',uid:'user-1',email:'store@example.com'};
let failAudit=false;
const env={DB:{prepare(sql){return{bind(...args){
 return {
  async all(){if(sql.includes('FROM store_connections'))return {results:[row]};throw Error('Unexpected all: '+sql);},
  async first(){if(sql.includes('FROM stores WHERE'))return args[0]==='store-A'&&args[1]==='tenant-A'?{id:'store-A',name:'Sample',status:'active'}:null;throw Error('Unexpected first: '+sql);},
  async run(){if(!sql.startsWith('INSERT INTO audit_log'))throw Error('Unexpected run: '+sql);if(failAudit)throw Error('Audit DB offline');records.push({sql,args});return{success:true};}
 };}};}}};
const delegate={fetch:async()=>new Response(JSON.stringify(me),{status:200,headers:{'Content-Type':'application/json'}})};
const secretReader=async(_env,clientId,connectionId)=>{assert.equal(clientId,'tenant-A');assert.equal(connectionId,'conn-1');return {api_key:'TOP_SECRET_KEY'};};
const provider=async(url,opts)=>{
 outbound.push({url,opts});
 if(opts.method==='PATCH'&&url.endsWith('/orders/order-A/status'))return new Response(JSON.stringify({store_id:'easy-A',status:'confirmed'}),{status:200});
 if(url.endsWith('/orders/order-A'))return new Response(JSON.stringify({id:'order-A',store_id:'easy-A',status:'pending'}),{status:200});
 if(url.endsWith('/products/X'))return new Response(JSON.stringify({id:'X',store_id:'easy-A',name:'X'}),{status:200});
 if(url.endsWith('/products'))return new Response(JSON.stringify([{id:'X',store_id:'easy-A',name:'X'}]),{status:200});
 return new Response(JSON.stringify({store_id:'easy-A',ok:true}),{status:200});
};
async function perform({method='GET',resource='capabilities',body={},headers={},path='/api/integrations/easyorders/store-control',fetcher=provider}={}){
 const url=new URL('https://app.kun-online.com'+path);
 if(method==='GET'){url.searchParams.set('clientId','tenant-A');url.searchParams.set('storeId','store-A');url.searchParams.set('resource',resource);}
 const request=new Request(url,{method,headers:{...(method==='POST'?{'Content-Type':'application/json','X-Kun-Store-Action':'confirmed'}:{}),...headers},body:method==='POST'?JSON.stringify({clientId:'tenant-A',storeId:'store-A',...body}):undefined});
 const response=await runEasyOrdersStoreControl({request,env,delegate,ctx:{},fetcher,secretReader});
 return {status:response.status,data:await response.json()};
}
let result=await perform();
assert.equal(result.status,200);assert.equal(result.data.connected,true);assert.equal(result.data.connection.externalStoreId,'easy-A');
assert.ok(!JSON.stringify(result.data).includes('TOP_SECRET_KEY'),'Never expose provider API key');
assert.equal(outbound.length,0,'Capability request must not call external API');
result=await perform({resource:'products'});
assert.equal(result.status,200);assert.equal(result.data.data[0].name,'X');
assert.equal(outbound[0].opts.headers['Api-Key'],'TOP_SECRET_KEY');

result=await perform({method:'POST',body:{operation:'order.status',entityId:'order-A',payload:{status:'confirmed'}}});
assert.equal(result.status,409,'Publishing requires explicit confirmation');
assert.equal(outbound.length,1,'No side effects before confirmation');
result=await perform({method:'POST',body:{operation:'order.status',entityId:'order-A',payload:{status:'confirmed'},confirm:'CONFIRM_PUBLISH_EASYORDERS'}});
assert.equal(result.status,200);assert.equal(result.data.published,true);assert.equal(outbound.length,3,'Order verification GET must precede remote write');
assert.equal(records.length,2,'Intent and success must both be audited');
assert.ok(!JSON.stringify(records).includes('TOP_SECRET_KEY'),'Never log API key');

result=await perform({method:'POST',body:{operation:'theme.publish',confirm:'CONFIRM_PUBLISH_EASYORDERS'}});
assert.equal(result.status,400,'Undocumented theme writes must fail closed');
result=await perform({method:'POST',body:{operation:'product.create',payload:{name:'Socks',price:100},confirm:'CONFIRM_PUBLISH_EASYORDERS'},headers:{'X-Kun-Store-Action':'no'}});
assert.equal(result.status,403,'CSRF-style header required');
result=await perform({method:'POST',body:{operation:'shipping.update',payload:{cities:[{name:'القاهرة',shipping_cost:50}]},confirm:'CONFIRM_PUBLISH_EASYORDERS'}});
assert.equal(result.status,409,'Whole shipping replacement needs additional confirmation');
assert.equal(outbound.length,3,'Rejected requests must never reach Easy Orders');
let originalMe=me;me={role:'viewer',clientId:'tenant-A',uid:'viewer'};
result=await perform();assert.equal(result.status,403,'Viewer denied integration reading');
me=originalMe;
result=await perform({method:'POST',body:{operation:'product.create',payload:{name:'Socks',price:100},confirm:'CONFIRM_PUBLISH_EASYORDERS',clientId:'tenant-B'}});
assert.equal(result.status,403,'Cross-tenant write denied');
assert.equal(outbound.length,3);
const originalBound=row.config_json;row.config_json=JSON.stringify({kunStoreId:'another-store'});
result=await perform();assert.equal(result.data.connected,false,'Wrong-store binding cannot enable management');
await assert.rejects(findBoundEasyOrdersConnection(env,{clientId:'tenant-A',storeId:'store-A'}),/اربط Easy Orders/);
row.config_json=originalBound;
result=await perform({resource:'product',body:{},path:'/api/integrations/easyorders/store-control',fetcher:async()=>new Response(JSON.stringify({store_id:'easy-B'}),{status:200})});
assert.equal(result.status,400,'Product lookup without product id must be rejected');
const url=new URL('https://app.kun-online.com/api/integrations/easyorders/store-control?clientId=tenant-A&storeId=store-A&resource=products');
const bad=await runEasyOrdersStoreControl({request:new Request(url),env,delegate,fetcher:async()=>new Response(JSON.stringify([{store_id:'easy-B'}]),{status:200}),secretReader});
assert.equal(bad.status,409,'Reject provider response from another linked store');
await new Promise(resolve=>setTimeout(resolve,2600));
failAudit=true;
const attempted=await perform({method:'POST',body:{operation:'product.create',payload:{name:'Test',price:200},confirm:'CONFIRM_PUBLISH_EASYORDERS'}});
assert.equal(attempted.status,503,'Audit outage prevents provider write');
assert.equal(outbound.length,3);
console.log('Easy Orders store-control contract PASSED: 9 supported write types, no unsupported theme writes, tenant/store isolation, live data ownership, secure header, preview confirmation, double shipping confirmation and audit fail-closed.');
