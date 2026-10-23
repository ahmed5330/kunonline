import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {handleMobileOrderAlerts} from '../src/mobile-order-alerts.js';

const native=await readFile(new URL('../android/app/src/main/java/com/kunonline/callerid/OrderNotifications.kt',import.meta.url),'utf8');
const manifest=await readFile(new URL('../android/app/src/main/AndroidManifest.xml',import.meta.url),'utf8');
const settings=await readFile(new URL('../android/app/src/main/java/com/kunonline/callerid/KunSystemSections.kt',import.meta.url),'utf8');
const job=await readFile(new URL('../android/app/src/main/java/com/kunonline/callerid/SyncJobService.kt',import.meta.url),'utf8');
const shell=await readFile(new URL('../android/app/src/main/java/com/kunonline/callerid/KunNativeAppV26.kt',import.meta.url),'utf8');
const gateway=await readFile(new URL('../src/index-production-mobile-update.js',import.meta.url),'utf8');
for(const marker of ['NotificationChannel(', 'ACTION_CHANNEL_NOTIFICATION_SETTINGS','openStoreSoundSettings','POST_NOTIFICATIONS','notify(identifier, notification)','@Synchronized fun poll','nextAfter','getSharedPreferences','KunApi.sessionCookie(context) != cookie'])
  assert.ok(native.includes(marker), 'Missing Android alert guard: '+marker);
assert.ok(manifest.includes('android.permission.POST_NOTIFICATIONS'));
for (const marker of ['NewOrderAlert(', 'customerName', 'customerPhone', 'productName',
  'governorate', 'BigTextStyle()', 'addAction(', '"اتصال"', '"مراجعة"',
  'Intent.ACTION_DIAL', 'EXTRA_ORDER_ID', 'EXTRA_CLIENT_ID', 'EXTRA_STORE_ID',
  'NotificationCompat.VISIBILITY_PRIVATE']) {
  assert.ok(native.includes(marker), 'Missing rich Android order notification guard: '+marker);
}
assert.ok(!native.includes('val ref = row.optString("ref")'), 'The notification must never show a long Easy Orders reference');
assert.ok(settings.includes('تخصيص صوت إشعار المتجر')&&settings.includes('تجربة إشعار لهذا المتجر'));
assert.ok(job.includes('OrderNotifications.poll(this)'));
assert.ok(shell.includes('ForegroundPolling(key = "new-order-alerts"')&&shell.includes('30_000L'));
assert.ok(gateway.includes('handleMobileOrderAlerts({request,env:dataEnv,delegate})'));

const now='2026-10-23T04:00:00.000Z';
let seenBindings=[];
const env={DB:{prepare(sql){return {bind(...values){return {
  async all(){
    if(sql.includes('FROM user_store_access'))return {results:[
      {store_id:'S1',client_id:'C1',name:'متجر ألف',role:'member'},
      {store_id:'S2',client_id:'C2',name:'لا يصل إليه',role:'member'}
    ]};
    assert.ok(sql.includes('o.client_id=? AND o.store_id=?'),'Must scope orders to both tenant and store');
    seenBindings.push(values);
    assert.equal(values[0],'C1');
    assert.equal(values[1],'S1');
    const after=values.at(-4),afterId=values.at(-2);
    const orders=[
      {id:'O1',ref:'101',clientId:'C1',storeId:'S1',createdAt:'2026-10-23T03:00:00.000Z',
        customerName:'مريم',customerPhone:'01012345678',productName:'جيبة بليسيه',productNote:'برجاندي',
        quantity:2,total:890,governorate:'أسيوط'},
      {id:'O2',ref:'102',clientId:'C1',storeId:'S1',createdAt:'2026-10-23T03:05:00.000Z'}
    ];
    return {results:orders.filter(x=>x.createdAt>after||(x.createdAt===after&&x.id>afterId))};
  }
};}};}}};
const delegate={fetch:async r=>{
  const path=new URL(r.url).pathname;
  assert.ok(r.headers.get('Cookie'),'Must forward authenticated identity');
  if(path==='/api/me')return new Response(JSON.stringify({role:'accountant',uid:'U1',clientId:'C1'}),{status:200});
  if(path==='/api/my-client-context')return new Response(JSON.stringify({clients:[{id:'C1',name:'Tenant 1'}]}),{status:200});
  throw new Error('Unexpected delegated route: '+path);
}};
const mk=(query='',cookie=true)=>new Request('https://app.kun-online.com/api/mobile/order-alerts'+query,{
  headers:cookie?{Cookie:'ko_session=valid'}:{}
});
const clock=()=>new Date(now);
const bootstrap=await handleMobileOrderAlerts({request:mk(),env,delegate,clock});
const init=await bootstrap.json();
assert.equal(init.initialized,true);
assert.deepEqual(init.orders,[]);
assert.equal(init.nextAfter,now);
const full=await handleMobileOrderAlerts({request:mk('?after=2026-10-23T02%3A00%3A00.000Z'),env,delegate,clock});
const data=await full.json();
assert.equal(data.orders.length,2);
assert.equal(data.orders[0].storeName,'متجر ألف');
assert.equal(data.orders[0].customerName,'مريم');
assert.equal(data.orders[0].customerPhone,'01012345678');
assert.equal(data.orders[0].productName,'جيبة بليسيه');
assert.equal(data.orders[0].productNote,'برجاندي');
assert.equal(data.orders[0].quantity,2);
assert.equal(data.orders[0].total,890);
assert.equal(data.orders[0].governorate,'أسيوط');
assert.equal(data.orders[1].customerName,'');
assert.equal(data.orders[1].quantity,1);
assert.equal(data.orders[1].id,'O2');
assert.equal(data.nextAfter,'2026-10-23T03:05:00.000Z');
assert.equal(data.nextId,'O2');
assert.equal(data.hasMore,false);
assert.ok(seenBindings.length>0);
const same=await handleMobileOrderAlerts({request:mk('?after='+encodeURIComponent(data.nextAfter)+'&afterId=O2'),env,delegate,clock});
assert.equal((await same.json()).orders.length,0,'Cursor should not resend seen orders');
const malformed=await handleMobileOrderAlerts({request:mk('?after=tomorrow'),env,delegate,clock});
assert.equal(malformed.status,400);
const unauthorized=await handleMobileOrderAlerts({request:mk('',false),env,delegate:{fetch:async()=>new Response(JSON.stringify({error:'login'}),{status:401})},clock});
assert.equal(unauthorized.status,401);
console.log('PASS: rich Android order alert details/actions, tenant isolation, cursor bootstrap/pagination, notification privacy and channels');
