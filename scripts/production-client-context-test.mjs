import assert from 'node:assert/strict';
import {handleProductionClientContext} from '../src/production-client-context.js';

const endpoint='https://app.kun-online.com/api/my-client-context';
function fake(me){
  const queries=[];
  const env={DB:{prepare(sql){
    return {bind(...args){
      queries.push({sql,args});
      return {
        async first(){
          if(sql.includes('FROM state WHERE id=1'))return {json:JSON.stringify({clients:[{id:'C1',name:'Store One'},{id:'C2',name:'Store Two'}]})};
          return null;
        },
        async all(){
          if(sql.includes('SELECT DISTINCT a.client_id')){
            assert.deepEqual(args,['U1'],'only authenticated user id may select grants');
            return {results:[{client_id:'C1'},{client_id:'C2'}]};
          }
          if(sql.includes('SELECT DISTINCT client_id FROM stores'))return {results:[{client_id:'C1'},{client_id:'C2'}]};
          return {results:[]};
        }
      };
    },async first(){
      if(sql.includes('FROM state WHERE id=1'))return {json:JSON.stringify({clients:[{id:'C1',name:'Store One'},{id:'C2',name:'Store Two'}]})};
      return null;
    },async all(){
      if(sql.includes('SELECT DISTINCT client_id FROM stores'))return {results:[{client_id:'C1'},{client_id:'C2'}]};
      return {results:[]};
    }};
  }}};
  const delegate={async fetch(req){
    assert.equal(new URL(req.url).pathname,'/api/me');
    assert.equal(req.headers.get('Cookie'),'ko_session=synthetic');
    return new Response(JSON.stringify(me||{role:null}),{status:me?200:401});
  }};
  return {env,delegate,queries};
}
async function ask(me,url=endpoint){
  const f=fake(me),request=new Request(url,{headers:{Cookie:'ko_session=synthetic'}});
  const response=await handleProductionClientContext({request,env:f.env,delegate:f.delegate});
  return {response,data:await response.json(),queries:f.queries};
}
let x=await ask({uid:'U1',role:'support',clientId:'C1'});
assert.equal(x.response.status,200);
assert.deepEqual(x.data.clients.map(c=>c.id),['C1','C2'],'bound staff must see explicit cross-client grants');
assert.equal(x.response.headers.get('Cache-Control'),'private, no-store');
x=await ask({uid:'U1',role:'client',clientId:'C1'});
assert.deepEqual(x.data.clients.map(c=>c.id),['C1'],'owner still sees only own tenant');
x=await ask({uid:'U1',role:'admin',clientId:null});
assert.deepEqual(x.data.clients.map(c=>c.id),['C1','C2'],'platform admin keeps current platform scope');
x=await ask(null);assert.equal(x.response.status,401);
assert.equal(await handleProductionClientContext({request:new Request(endpoint,{method:'POST'}),env:{},delegate:{}}),null);
assert.equal(await handleProductionClientContext({request:new Request('https://app.kun-online.com/api/other'),env:{},delegate:{}}),null);
console.log('PASS: production staff context matches active scoped grants; owner isolation and authorization preserved');
