import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {handlePublicSiteReviews} from '../src/public-site-reviews.js';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const app='https://app.kun-online.com';
const site='https://kun-online.com';
const reviewed=[];
const rates=new Map();
const schemaColumns=new Set(['id','category','rating','author','body','photo_jpeg','status','created_at']);
const DB={
 prepare(sql){
  let args=[];
  const stmt={
   bind(...data){args=data;return stmt;},
   async run(){
    if(/CREATE /.test(sql))return {meta:{changes:0}};
    if(sql.startsWith('ALTER TABLE site_reviews ADD COLUMN store_name')){schemaColumns.add('store_name');return {meta:{changes:0}};}
    if(sql.startsWith('ALTER TABLE site_reviews ADD COLUMN store_photo_jpeg')){schemaColumns.add('store_photo_jpeg');return {meta:{changes:0}};}
    if(sql.startsWith('INSERT OR IGNORE INTO site_review_rate')){if(!rates.has(args[0]))rates.set(args[0],0);return {meta:{changes:1}};}
    if(sql.startsWith('UPDATE site_review_rate')){const n=rates.get(args[0]);if(n>=3)return {meta:{changes:0}};rates.set(args[0],n+1);return {meta:{changes:1}};}
    if(sql.startsWith('INSERT INTO site_reviews')){reviewed.push({id:args[0],category:args[1],rating:args[2],author:args[3],store_name:args[4],body:args[5],photo_jpeg:args[6],status:'pending',created_at:args[7]});return {meta:{changes:1}};}
    if(sql.startsWith('UPDATE site_reviews')){const photoUpdate=sql.includes('store_photo_jpeg=?');const r=reviewed.find(row=>row.id===args[photoUpdate?4:3]);if(!r)return {meta:{changes:0}};r.status=args[0];if(photoUpdate)r.store_photo_jpeg=args[1];return {meta:{changes:1}};}
    if(sql.startsWith('DELETE FROM site_reviews')){const i=reviewed.findIndex(row=>row.id===args[0]);if(i<0)return {meta:{changes:0}};reviewed.splice(i,1);return {meta:{changes:1}};}
    throw Error('Unexpected SQL: '+sql);
   },
   async all(){
    if(sql.startsWith('PRAGMA table_info(site_reviews)'))return {results:[...schemaColumns].map(name=>({name}))};
    if(sql.includes("WHERE status='approved'"))return {results:reviewed.filter(r=>r.status==='approved'&&(!sql.includes('AND category=?')||r.category===args[0])).slice(0,30)};
    if(sql.includes('FROM site_reviews ORDER BY'))return {results:reviewed.slice(0,100)};
    throw Error('Unexpected read: '+sql);
   }
  };
  return stmt;
 }
};
const env={DB,SESSION_SECRET:'test-review-secret-do-not-use'};
const authorizeAdmin=async()=>({role:'admin',uid:'admin-id'});
function request(method,path='/api/public-reviews',body=null,origin=site,otherHeaders={}){
 const headers={...(origin?{Origin:origin}:{}),...otherHeaders};
 if(body!==null)headers['Content-Type']='application/json';
 return new Request(app+path,{method,headers,body:body===null?undefined:JSON.stringify(body)});
}
async function call(req,auth){const response=await handlePublicSiteReviews(req,env,{authorizeAdmin:auth});return {status:response.status,body:await response.json()};}
const entry={name:'عميل اختبار',storeName:'متجر اختبار للأزياء',text:'تجربتي واضحة ومحددة ومفيدة لمن يريد التعامل مع كن أونلاين.',category:'services',rating:5,consent:true,photo:null,website:''};
test('reject origins, bad ratings and unapproved photos before database write',async()=>{
 assert.equal((await call(request('POST','/api/public-reviews',entry,'https://evil.example'))).status,403);
 assert.equal((await call(request('POST','/api/public-reviews',{...entry,rating:0}))).status,400);
 assert.equal((await call(request('POST','/api/public-reviews',{...entry,photo:'data:image/svg+xml;base64,PHN2Zz4='}))).status,400);
 assert.equal((await call(request('POST','/api/public-reviews',{...entry,consent:false}))).status,400);
 assert.equal(reviewed.length,0);
});
test('store name rejects unsupported data types',async()=>{
 assert.equal((await call(request('POST','/api/public-reviews',{...entry,storeName:{unexpected:true}}))).status,400);
 assert.equal(reviewed.length,0);
});
test('new user review persists pending and is not disclosed on public reads',async()=>{
 const created=await call(request('POST','/api/public-reviews',entry));
 assert.equal(created.status,202);assert.equal(created.body.pending,true);
 assert.equal(reviewed.length,1);
 assert.equal(reviewed[0].store_name,entry.storeName);
 assert.equal(schemaColumns.has('store_name'),true);
 assert.equal(schemaColumns.has('store_photo_jpeg'),true);
 const publicGet=await call(request('GET','/api/public-reviews',null,site));
 assert.deepEqual(publicGet.body.reviews,[]);
 assert.equal(publicGet.status,200);
});
test('admin role required; approval and deletion work without cross-site mutation',async()=>{
 const id=reviewed[0].id;
 assert.equal((await call(request('GET','/api/public-reviews?admin=1',null,null))).status,403);
 assert.equal((await call(request('PATCH','/api/public-reviews/'+id,{status:'approved'},site),authorizeAdmin)).status,403);
 assert.equal((await call(request('PATCH','/api/public-reviews/'+id,{status:'approved'},app),async()=>({role:'client',uid:'bad'}))).status,403);
 let updated=await call(request('PATCH','/api/public-reviews/'+id,{status:'approved'},app),authorizeAdmin);
 assert.equal(updated.status,200);assert.equal(updated.body.changed,true);
 let listed=await call(request('GET','/api/public-reviews',null,site));
 assert.equal(listed.body.reviews.length,1);
 assert.equal(listed.body.reviews[0].name,entry.name);
 assert.equal(listed.body.reviews[0].storeName,entry.storeName);
 assert.equal((await call(request('GET','/api/public-reviews?admin=1',null,null),authorizeAdmin)).body.reviews.length,1);
 assert.equal((await call(request('DELETE','/api/public-reviews/'+id,null,app),authorizeAdmin)).body.deleted,true);
 listed=await call(request('GET','/api/public-reviews',null,site));assert.equal(listed.body.reviews.length,0);
});
test('admin store photo is separate from customer photo, approved only and replaceable',async()=>{
 const item=await call(request('POST','/api/public-reviews',{...entry,photo:null}));
 assert.equal(item.status,202);
 const id=reviewed.at(-1).id;
 const path='/api/public-reviews/'+id;
 const image='data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2Q==';
 assert.equal((await call(request('PATCH',path,{status:'approved',storePhoto:image},site),authorizeAdmin)).status,403);
 assert.equal((await call(request('PATCH',path,{status:'approved',storePhoto:image},app),async()=>({role:'client',uid:'bad'}))).status,403);
 assert.equal((await call(request('PATCH',path,{status:'hidden',storePhoto:image},app),authorizeAdmin)).status,400);
 assert.equal((await call(request('PATCH',path,{status:'approved',storePhoto:'data:image/svg+xml;base64,PHN2Zz4='},app),authorizeAdmin)).status,400);
 const before=await call(request('GET','/api/public-reviews',null,site));
 assert.equal(before.body.reviews.some(r=>r.id===id),false);
 let result=await call(request('PATCH',path,{status:'approved',storePhoto:image},app),authorizeAdmin);
 assert.equal(result.status,200);
 let publicRow=(await call(request('GET','/api/public-reviews',null,site))).body.reviews.find(r=>r.id===id);
 assert.equal(publicRow.storePhoto,image);
 assert.equal(publicRow.photo,null);
 assert.equal(publicRow.storeName,entry.storeName);
 const replacement='data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/4g==';
 result=await call(request('PATCH',path,{status:'approved',storePhoto:replacement},app),authorizeAdmin);
 assert.equal(result.status,200);
 assert.equal((await call(request('GET','/api/public-reviews',null,site))).body.reviews.find(r=>r.id===id).storePhoto,replacement);
 result=await call(request('PATCH',path,{status:'hidden'},app),authorizeAdmin);
 assert.equal(result.status,200);
 assert.equal((await call(request('GET','/api/public-reviews',null,site))).body.reviews.some(r=>r.id===id),false);
 result=await call(request('PATCH',path,{status:'approved'},app),authorizeAdmin);
 assert.equal(result.status,200);
 assert.equal((await call(request('GET','/api/public-reviews',null,site))).body.reviews.find(r=>r.id===id).storePhoto,replacement);
 result=await call(request('PATCH',path,{status:'approved',storePhoto:null},app),authorizeAdmin);
 assert.equal(result.status,200);
 assert.equal((await call(request('GET','/api/public-reviews',null,site))).body.reviews.find(r=>r.id===id).storePhoto,null);
 await call(request('DELETE',path,null,app),authorizeAdmin);
});
test('public POST has a strict daily rate cap',async()=>{
 rates.clear(); // A fresh daily budget for this isolated rate-limit fixture.
 for(let i=0;i<2;i++)assert.equal((await call(request('POST','/api/public-reviews',i===0?{...entry,storeName:undefined}:entry))).status,202);
 assert.equal(reviewed[0].store_name,null); // Older forms remain compatible.
 assert.equal((await call(request('POST','/api/public-reviews',entry))).status,429);
});
test('OPTIONS preflight grants only expected marketing origin',async()=>{
 const response=await handlePublicSiteReviews(request('OPTIONS','/api/public-reviews',null,site),env);
 assert.equal(response.status,204);
 assert.equal(response.headers.get('access-control-allow-origin'),site);
});

test('review invitation links appear only after administrator authentication',async()=>{
  const {readFileSync}=await import('node:fs');
  const adminPage=readFileSync(new URL('../public/reviews-admin.html',import.meta.url),'utf8');
  assert.match(adminPage,/<section id="inviteLinks"[^>]+hidden/);
  assert.match(adminPage,/data-invite-type="services"/);
  assert.match(adminPage,/data-invite-type="consultations"/);
  assert.match(adminPage,/data-invite-type="all"/);
  assert.match(adminPage,/url\.hash='write-review'/);
  assert.match(adminPage,/if\(!response\.ok\|\|!data\.ok\)\{filters\.hidden=true;inviteLinks\.hidden=true/);
  assert.match(adminPage,/records=data\.reviews;filters\.hidden=false;inviteLinks\.hidden=false;/);
  assert.match(adminPage,/https:\/\/kun-online\.com\/reviews\//);
  assert.match(adminPage,/resizeStorePhoto/);
  assert.match(adminPage,/storePhoto:null/);
  assert.match(adminPage,/photoInput\.type='file'/);
});
