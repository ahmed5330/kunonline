import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {handlePublicSiteReviews} from '../src/public-site-reviews.js';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const app='https://app.kun-online.com';
const site='https://kun-online.com';
const reviewed=[];
const rates=new Map();
const DB={
 prepare(sql){
  let args=[];
  const stmt={
   bind(...data){args=data;return stmt;},
   async run(){
    if(/CREATE /.test(sql))return {meta:{changes:0}};
    if(sql.startsWith('INSERT OR IGNORE INTO site_review_rate')){if(!rates.has(args[0]))rates.set(args[0],0);return {meta:{changes:1}};}
    if(sql.startsWith('UPDATE site_review_rate')){const n=rates.get(args[0]);if(n>=3)return {meta:{changes:0}};rates.set(args[0],n+1);return {meta:{changes:1}};}
    if(sql.startsWith('INSERT INTO site_reviews')){reviewed.push({id:args[0],category:args[1],rating:args[2],author:args[3],body:args[4],photo_jpeg:args[5],status:'pending',created_at:args[6]});return {meta:{changes:1}};}
    if(sql.startsWith('UPDATE site_reviews')){const r=reviewed.find(row=>row.id===args[3]);if(!r)return {meta:{changes:0}};r.status=args[0];return {meta:{changes:1}};}
    if(sql.startsWith('DELETE FROM site_reviews')){const i=reviewed.findIndex(row=>row.id===args[0]);if(i<0)return {meta:{changes:0}};reviewed.splice(i,1);return {meta:{changes:1}};}
    throw Error('Unexpected SQL: '+sql);
   },
   async all(){
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
const entry={name:'عميل اختبار',text:'تجربتي واضحة ومحددة ومفيدة لمن يريد التعامل مع كن أونلاين.',category:'services',rating:5,consent:true,photo:null,website:''};
test('reject origins, bad ratings and unapproved photos before database write',async()=>{
 assert.equal((await call(request('POST','/api/public-reviews',entry,'https://evil.example'))).status,403);
 assert.equal((await call(request('POST','/api/public-reviews',{...entry,rating:0}))).status,400);
 assert.equal((await call(request('POST','/api/public-reviews',{...entry,photo:'data:image/svg+xml;base64,PHN2Zz4='}))).status,400);
 assert.equal((await call(request('POST','/api/public-reviews',{...entry,consent:false}))).status,400);
 assert.equal(reviewed.length,0);
});
test('new user review persists pending and is not disclosed on public reads',async()=>{
 const created=await call(request('POST','/api/public-reviews',entry));
 assert.equal(created.status,202);assert.equal(created.body.pending,true);
 assert.equal(reviewed.length,1);
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
 assert.equal((await call(request('GET','/api/public-reviews?admin=1',null,null),authorizeAdmin)).body.reviews.length,1);
 assert.equal((await call(request('DELETE','/api/public-reviews/'+id,null,app),authorizeAdmin)).body.deleted,true);
 listed=await call(request('GET','/api/public-reviews',null,site));assert.equal(listed.body.reviews.length,0);
});
test('public POST has a strict daily rate cap',async()=>{
 for(let i=0;i<2;i++)assert.equal((await call(request('POST','/api/public-reviews',entry))).status,202);
 assert.equal((await call(request('POST','/api/public-reviews',entry))).status,429);
});
test('OPTIONS preflight grants only expected marketing origin',async()=>{
 const response=await handlePublicSiteReviews(request('OPTIONS','/api/public-reviews',null,site),env);
 assert.equal(response.status,204);
 assert.equal(response.headers.get('access-control-allow-origin'),site);
});
