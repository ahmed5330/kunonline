import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {handleProductionJntShippingEdit} from '../src/production-jnt-shipping-edit.js';

const src=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const api=src('src/production-jnt-shipping-edit.js');
const editor=src('public/v2/modules-v40-order-details.js');
const app=src('android/app/src/main/java/com/kunonline/callerid/KunNativeAppV25.kt');
const native=src('android/app/src/main/java/com/kunonline/callerid/CallerJntOrderEditActivity.kt');
const bridge=src('android/app/src/main/java/com/kunonline/callerid/CallerJntEditApi.kt');
const models=src('android/app/src/main/java/com/kunonline/callerid/CommerceModels.kt');
const details=src('src/order-details.js');
const index=src('public/v2/index.html');
const gradle=src('android/app/build.gradle.kts');

for(const token of ['resolveStoreScope(env,me,clientId,storeId,{write:true})',"client_id=? AND store_id=?","JNT_SHIPMENT_ALREADY_ISSUED","JNT_DIRECTORY_UNAVAILABLE","ORDER_EDIT_CONFLICT","audit_log", "jnt_shipping_edit"])
  assert.ok(api.includes(token),'Server isolation or audit missing: '+token);
assert.ok(editor.includes('data-kod-jnt-edit')&&editor.includes('KunJntAddressesV80.enhance')&&editor.includes("expectedLastEditAt")&&editor.includes('edited.byName'));
assert.ok(details.includes('latestJntEdit?order.address:null'),'Edited Kun address must override stale Easy Orders provider data');
assert.ok(app.includes('EXTRA_SHIPPING_ONLY')&&app.includes('v25VisibleOrderRef'));
assert.ok(app.includes('lastEditBy'),'Order card must show editor identity');
assert.ok(bridge.includes('/shipping-jnt'));
assert.ok(native.includes('saveShipping(context, orderId')&&native.includes('shippingOnly'));
assert.ok(models.includes('lastEditBy = lastEdit(o)'));
assert.ok(index.includes('modules-v40-order-details.js?v=40.2'));
assert.ok(Number(gradle.match(/versionCode\s*=\s*(\d+)/)?.[1]||0)>=134,'Android build code must not regress');
assert.match(gradle,/versionName\s*=\s*"\d+\.\d+\.\d+"/);

const address={province:'القاهرة',provinceCode:'1011',city:'مدينة نصر',cityCode:'1011000',cityKey:'1011000:مدينة نصر',area:'حي السلام',areaCode:'A001',street:'شارع التحرير ١',phone2:'01123456789',weight:2.5};
const mockFetch=async url=>new Response(JSON.stringify(url.includes('index.json')?
  {countryCode:'100000',provinces:[{name:'القاهرة',code:'1011',file:'p14.json'}]}:
  {cities:[{name:'مدينة نصر',code:'1011000',key:'1011000:مدينة نصر',areas:[{name:'حي السلام',code:'A001'}]}]}),{status:200});
const initial={id:'e-123',client_id:'c1',store_id:'s1',name:'عميل',phone:'01000000',gov:'الجيزة',address:'العنوان القديم',awb:'',state:'confirmed',history:'[]'};
function harness(row={...initial}){
  let updates=0,history=null,audits=0;
  const db={prepare(sql){
    let args=[];
    return {
      bind(...v){args=v;return this;},
      async first(){
        if(sql.includes('FROM stores WHERE'))return args[0]==='s1'&&args[1]==='c1'?{id:'s1',status:'active'}:null;
        if(sql.includes('FROM orders WHERE'))return args[0]===row.id&&args[1]===row.client_id&&args[2]===row.store_id?row:null;
        return null;
      },
      async run(){
        if(sql.startsWith('UPDATE orders')){updates++;history=JSON.parse(args[4]);return {meta:{changes:1}};}
        if(sql.startsWith('INSERT INTO audit_log'))audits++;
        return {meta:{changes:1}};
      }
    };
  }};
  return {env:{DB:db},get updates(){return updates;},get history(){return history;},get audits(){return audits;}};
}
const delegate={fetch:async()=>new Response(JSON.stringify({role:'client',clientId:'c1',uid:'u-7',email:'editor@kun.example',name:'مندوب المتجر'}),{status:200,headers:{'Content-Type':'application/json'}})};
function req(jntAddress=address,storeId='s1'){return new Request('https://app.kun-online.com/api/orders/e-123/shipping-jnt',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({clientId:'c1',storeId,name:'اسم جديد',phone:'01011111',expectedLastEditAt:'',jntAddress})});}
// Updating a locally queued shipment also changes the exact payload that
// the Printing workflow later sends to J&T.
const queuedHistory=JSON.stringify([{type:'jt_print_queued',shipment:{receiverName:'old',province:'الجيزة',itemName:'قطعة',codAmount:510,quantity:2}}]);
const queued=harness({...initial,history:queuedHistory});
const queuedResponse=await handleProductionJntShippingEdit({request:req(),env:queued.env,delegate,ctx:{},fetcher:mockFetch});
assert.equal(queuedResponse.status,200);
assert.equal(queued.history[0].shipment.receiverName,'اسم جديد');
assert.equal(queued.history[0].shipment.area,'حي السلام');
assert.equal(queued.history[0].shipment.weight,2.5);
assert.equal(queued.history[0].shipment.codAmount,510);
assert.equal(queued.history[0].shipment.quantity,2);
const staged=harness({...initial,history:JSON.stringify([{type:'jt_print_queued',shipment:{receiverName:'old',codAmount:510,itemName:'منتج',quantity:2}}])});
const stagedResponse=await handleProductionJntShippingEdit({request:req(),env:staged.env,delegate,ctx:{},fetcher:mockFetch});
assert.equal(stagedResponse.status,200);
assert.equal(staged.history[0].shipment.receiverName,'اسم جديد');
assert.equal(staged.history[0].shipment.area,'حي السلام');
assert.equal(staged.history[0].shipment.weight,2.5);
assert.equal(staged.history[0].shipment.codAmount,510);
assert.equal(staged.history[0].shipment.quantity,2);
const valid=harness();
const ok=await handleProductionJntShippingEdit({request:req(),env:valid.env,delegate,ctx:{},fetcher:mockFetch});
assert.equal(ok.status,200,await ok.text().catch(()=>'')); // status only
assert.equal(valid.updates,1);
assert.equal(valid.history[0].byName,'مندوب المتجر');
assert.equal(valid.history[0].event,'jnt_shipping_edit');
assert.equal(valid.audits,1);
const wrong=harness();
assert.equal((await handleProductionJntShippingEdit({request:req({...address,area:'منطقة غير مطابقة'}),env:wrong.env,delegate,ctx:{},fetcher:mockFetch})).status,400);
assert.equal(wrong.updates,0);
const scoped=harness();
assert.equal((await handleProductionJntShippingEdit({request:req(address,'s2'),env:scoped.env,delegate,ctx:{},fetcher:mockFetch})).status,403);
const issued=harness({...initial,awb:'AWB-123'});
assert.equal((await handleProductionJntShippingEdit({request:req(),env:issued.env,delegate,ctx:{},fetcher:mockFetch})).status,409);
assert.equal(issued.updates,0);
console.log('J&T shipping edit contract: tenant/store guard, reference area validation, actor audit, AWB lock and native/web UI passed.');
