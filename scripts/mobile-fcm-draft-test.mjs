import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {
  pushEnabled,tokenFormatValid,installFormatValid,invalidationData,
  handleMobilePushDevices,dispatchOrderChangePush,sendFcmInvalidation,shouldNotifyOrderWrite
} from '../src/mobile-push.js';

const response=(value,status=200)=>new Response(JSON.stringify(value),{
  status,headers:{'Content-Type':'application/json'}
});
const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const registry=new DatabaseSync(':memory:');
try{
  registry.exec(source('migrations/0101_mobile_push_device_registry.sql'));
  const columns=registry.prepare('PRAGMA table_info(mobile_push_devices)').all().map(x=>x.name);
  for(const name of ['id','installation_hash','user_id','client_id','store_id',
      'token_hash','token_ciphertext','last_seq','retry_after']){
    assert(columns.includes(name),'Missing mobile push registry field '+name);
  }
  assert(!columns.includes('customer_name')&&!columns.includes('order_payload'));
  assert.throws(()=>registry.prepare('INSERT INTO mobile_push_devices(id,installation_hash,user_id,client_id,store_id,token_hash,token_ciphertext,last_seq,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run('a','i','u','c','s','h','e',-1,'now','now'),
    /CHECK constraint/);
}finally{registry.close();}

const installId='11111111-2222-4333-8444-555555555555';
const token='synthetic_token_v1:'+('A'.repeat(160));
assert(tokenFormatValid(token));
assert(installFormatValid(installId));
assert(!tokenFormatValid('hi'));
assert(!installFormatValid('../evil'));
assert(!pushEnabled({ORDER_FCM_ENABLED:'0',ORDER_CHANGE_FEED_ENABLED:'1'}));
const successful=new Response('{}',{status:200});
const denied=new Response('{}',{status:403});
for(const endpoint of ['/api/orders','/api/orders/ord1','/api/customer-service/ord1/notes',
  '/webhooks/easyorders','/api/jnt/shipments']){
  assert(shouldNotifyOrderWrite(new Request('https://kun.invalid'+endpoint,{method:'POST'}),successful),
    'An authorized order write should trigger fast push: '+endpoint);
}
assert(!shouldNotifyOrderWrite(new Request('https://kun.invalid/api/orders'),successful));
assert(!shouldNotifyOrderWrite(new Request('https://kun.invalid/api/orders',{method:'POST'}),denied));
assert(!shouldNotifyOrderWrite(new Request('https://kun.invalid/api/login',{method:'POST'}),successful));
assert.deepEqual(invalidationData({clientId:'c',storeId:'s',seq:42}),
  {kind:'orders_changed',clientId:'c',storeId:'s',seq:'42'});

const config={ORDER_FCM_ENABLED:'1',ORDER_CHANGE_FEED_ENABLED:'1',
  PUSH_TOKEN_ENC_KEY:'A synthetic test-only key; not a live secret'};
const request=(method,body)=>new Request('https://kun.invalid/api/mobile/push-devices',{
  method,headers:{Cookie:'ko_session=test', 'Content-Type':'application/json'},
  body:JSON.stringify(body)
});
const delegate={fetch:async req=>{
  if(new URL(req.url).pathname==='/api/me')return response({
    id:'USER-A',clientId:'CLIENT-A',role:'client'
  });
  return response({clients:[{id:'CLIENT-A',name:'Test Client'}]});
}};
const statements=[],batchJobs=[],rows=[];
let fakeStatus='active';
const db={
  prepare(sql){
    return {
      sql,args:[],
      bind(...values){this.args=values;return this},
      async first(){
        if(sql.includes('MAX(seq)'))return {n:5};
        if(sql.includes('FROM users WHERE id='))return {
          id:'USER-A',client_id:'CLIENT-A',role:'client',status:fakeStatus
        };
        if(sql.includes('FROM stores WHERE id='))return {id:'STORE-A'};
        return null;
      },
      async all(){
        if(sql.includes('FROM stores s WHERE'))return {results:[{
          id:'STORE-A',store_id:'STORE-A',client_id:'CLIENT-A',
          name:'Synthetic Store',status:'active'
        }]};
        if(sql.includes('FROM mobile_push_devices WHERE installation_hash='))return {results:[]};
        if(sql.includes('SELECT * FROM mobile_push_devices'))return {results:rows};
        return {results:[]};
      },
      async run(){statements.push({sql,args:this.args});return {success:true,meta:{changes:1}};}
    };
  },
  async batch(q){
    batchJobs.push(q.map(s=>({sql:s.sql,args:s.args})));
    return q.map(()=>({success:true}));
  }
};
const env={...config,DB:db,FIREBASE_SERVICE_ACCOUNT_JSON:'synthetic-credential-placeholder'};
const off=await handleMobilePushDevices({
  request:request('POST',{installationId:installId,token}),
  env:{...env,ORDER_FCM_ENABLED:'0'},delegate
});
assert.equal(off.status,404);
const unavailable=await handleMobilePushDevices({
  request:request('POST',{installationId:installId,token}),
  env:{...env,PUSH_TOKEN_ENC_KEY:''},delegate
});
assert.equal(unavailable.status,503);
const rejected=await handleMobilePushDevices({
  request:request('POST',{installationId:installId,token}),
  env,delegate:{fetch:async()=>response({ok:false},401)}
});
assert.equal(rejected.status,401);
const forged=await handleMobilePushDevices({
  request:request('POST',{installationId:installId,token,
    clientId:'CLIENT-B',storeId:'STORE-B',role:'admin'}),
  env,delegate
});
assert.equal(forged.status,200);
const registered=await forged.json();
assert.equal(registered.storeCount,1);
assert.equal(batchJobs.length,1);
const commands=batchJobs[0];
assert.equal(commands.filter(s=>s.sql.includes('INSERT INTO mobile_push_devices')).length,1);
const inserted=commands.find(s=>s.sql.includes('INSERT INTO mobile_push_devices'));
assert.equal(inserted.args[2],'USER-A');
assert.equal(inserted.args[3],'CLIENT-A');
assert.equal(inserted.args[4],'STORE-A');
assert.notEqual(inserted.args[6],token);
assert(inserted.args[6].startsWith('v1:'));
assert(!JSON.stringify(commands).includes('CLIENT-B'));
assert(!JSON.stringify(commands).includes('STORE-B'));
const deleted=await handleMobilePushDevices({
  request:request('DELETE',{installationId:installId}),env,delegate
});
assert.equal(deleted.status,200);
assert(statements.some(s=>s.sql.includes('DELETE FROM mobile_push_devices WHERE installation_hash=? AND user_id=?')));
const auth=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,
  publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const privateKey=await crypto.subtle.exportKey('pkcs8',auth.privateKey);
const pem='-----BEGIN PRIVATE KEY-----\n'+Buffer.from(privateKey).toString('base64').replace(/.{64}/g,'$&\n')+
  '\n-----END PRIVATE KEY-----';
const serviceAccount={
  project_id:'kun-test-synthetic',
  client_email:'service@kun-test-synthetic.iam.gserviceaccount.com',
  private_key:pem
};
rows.push({
  id:inserted.args[0],installation_hash:inserted.args[1],user_id:'USER-A',
  client_id:'CLIENT-A',store_id:'STORE-A',token_ciphertext:inserted.args[6],
  last_seq:5
});
const calls=[];
const http=async(url,options)=>{
  calls.push({url,options});
  if(url==='https://oauth2.googleapis.com/token')return response({access_token:'synthetic-oauth'});
  if(url.includes('fcm.googleapis.com'))return response({name:'projects/kun-test-synthetic/messages/1'});
  throw Error('Unapproved external URL in synthetic test');
};
const result=await dispatchOrderChangePush({...env,
  FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify(serviceAccount)},{http});
assert.equal(result.sent,1);
const outbound=calls.find(x=>x.url.includes('fcm.googleapis.com'));
assert(outbound);
const sent=JSON.parse(outbound.options.body);
assert.equal(sent.message.token,token);
assert.deepEqual(sent.message.data,{kind:'orders_changed',clientId:'CLIENT-A',storeId:'STORE-A',seq:'5'});
assert(!JSON.stringify(sent.message).match(/customer|phone|address|product/i));
assert(statements.some(s=>s.sql.includes('UPDATE mobile_push_devices SET last_seq=')));
calls.length=0;
const instant=await dispatchOrderChangePush({...env,
  FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify(serviceAccount)},{http,immediate:true});
assert.equal(instant.sent,1,'Immediate post-write fast path should also send a data-only hint');
assert.equal(calls.filter(x=>x.url.includes('fcm.googleapis.com')).length,1);
fakeStatus='suspended';
calls.length=0;
const revoked=await dispatchOrderChangePush({...env,
  FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify(serviceAccount)},{http});
assert.equal(revoked.revoked,1);
assert.equal(calls.length,0,'An inactive account must never receive a push');
const direct=await sendFcmInvalidation({
  account:serviceAccount,accessTokenValue:'test',token,
  scope:{clientId:'CLIENT-A',storeId:'STORE-A',seq:9},
  http:async()=>response({error:{details:[{errorCode:'UNREGISTERED'}]}},404)
});
assert.equal(direct.unregistered,true);

const android=source('android/app/src/main/java/com/kunonline/callerid/KunFirebaseMessagingService.kt');
assert(android.includes('SyncJobService.scheduleImmediate(this)'));
assert(android.includes('isValidOrderInvalidation(message.data)'));
assert(android.includes('KunApi.hasSession(this)'));
const gradle=source('android/app/build.gradle.kts');
assert(gradle.includes('file("google-services.json").exists()'));
const manifest=source('android/app/src/main/AndroidManifest.xml');
assert(manifest.includes('com.google.firebase.MESSAGING_EVENT'));
console.log('PASS: FCM disabled by default, server-derived tenant ACL, encrypted token, revocation, signed OAuth, metadata-only push, Android wake-up');
