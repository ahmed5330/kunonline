import assert from 'node:assert/strict';
import {handleProductionCustomerService} from '../src/production-customer-service.js';

const base={id:'ORD1',client_id:'C2',store_id:'S2',ref:'ORD1',state:'shipped',awb:'AWB1',name:'Test',phone:'01000000000',note:'old',history:'[]',total:100,product:'Item',qty:1,unit_price:100};
function fake({role='support',grant='member',changes=1,row={...base}}={}){
  let writes=0,audits=0;
  const me={role,uid:'U1',clientId:'C1',name:'Agent'};
  const delegate={fetch:async()=>new Response(JSON.stringify(me),{status:200,headers:{'content-type':'application/json'}})};
  const env={DB:{prepare(sql){let args=[];return {
    bind(...x){args=x;return this;},
    async first(){
      if(sql.includes('FROM orders WHERE id=? AND client_id=?'))return row;
      if(sql.includes('FROM stores WHERE'))return {id:'S2',status:'active'};
      return null;
    },
    async all(){if(sql.includes('FROM user_store_access'))return {results:grant?[{store_id:'S2',name:'Store',status:'active',role:grant}]:[]};return {results:[]}},
    async run(){if(sql.startsWith('UPDATE orders')){writes++;if(changes){row.note=args[0];row.history=JSON.stringify([{type:'order_edit'}]);}return {meta:{changes}};}if(sql.startsWith('INSERT INTO order_events'))audits++;return {meta:{changes:1}};}
  }}}};
  async function call(payload){
    const request=new Request('https://app.kun-online.com/api/customer-service/orders/ORD1/edit?clientId=C2&storeId=S2',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({clientId:'C2',storeId:'S2',...payload})});
    const response=await handleProductionCustomerService({request,env,ctx:{},delegate});
    return response.status;
  }
  return {call,get writes(){return writes},get audits(){return audits},get row(){return row}};
}
let a=fake();
assert.equal(await a.call({editMode:'notes',customerNote:'new'}),200);
assert.equal(a.row.note,'new');
assert.equal(a.row.awb,'AWB1');
assert.equal(a.row.total,100);
assert.equal(a.audits,1);
a=fake();assert.equal(await a.call({name:'Changed',phone:'01000000000',total:1}),409);assert.equal(a.writes,0);
a=fake({grant:null});assert.equal(await a.call({editMode:'notes',customerNote:'x'}),403);
a=fake({grant:'viewer'});assert.equal(await a.call({editMode:'notes',customerNote:'x'}),403);
a=fake({changes:0});assert.equal(await a.call({editMode:'notes',customerNote:'x'}),409);assert.equal(a.audits,0);
a=fake({role:'client'});assert.equal(await a.call({editMode:'notes',customerNote:'x'}),403);
console.log('PASS: cross-client support grant, shipped notes-only, immutable AWB/amount, viewer, owner and concurrency guards');
