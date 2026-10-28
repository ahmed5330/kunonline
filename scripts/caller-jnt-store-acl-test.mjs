import assert from 'node:assert/strict';
import {handleProductionCallerJntEdit} from '../src/production-caller-jnt-edit.js';

const base = {
  id:'O-1',client_id:'C-1',store_id:'S-1',state:'confirmed',awb:'',
  name:'عميل',phone:'01012345678',product:'منتج',product_id:null,
  variant_id:null,product_note:'',qty:1,unit_price:100,total:100,
  note:'',history:'[]'
};
function setup({row={...base},grant='member',changes=1,identity={role:'support',uid:'U-1',clientId:null}}={}){
  let writes=0,queries=[];
  const env={DB:{prepare(sql){
    let binds=[];
    queries.push(sql);
    return {
      bind(...args){binds=args;return this;},
      async first(){
        if(sql.includes('FROM orders WHERE'))return binds[0]===row.id && binds[1]===row.client_id ? row : null;
        if(sql.includes('FROM stores WHERE'))return binds[0]===row.store_id&&binds[1]===row.client_id?{id:row.store_id,status:'active'}:null;
        return null;
      },
      async all(){
        if(sql.includes('FROM user_store_access a JOIN stores s')){
          return {results: grant ? [{store_id:row.store_id,role:grant,name:'متجر',status:'active'}] : []};
        }
        return {results:[]};
      },
      async run(){
        if(sql.startsWith('UPDATE orders')){writes++;return {meta:{changes}};}
        return {meta:{changes:1}};
      }
    };
  }}};
  const delegate={fetch:async()=>new Response(JSON.stringify(identity),{status:200,headers:{'Content-Type':'application/json'}})};
  return {env,delegate,get writes(){return writes},queries};
}
function request(clientId='C-1'){
  return new Request('https://app.kun-online.com/api/caller-jnt/orders/O-1',{method:'PATCH',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({clientId,name:'عميل متعدل',phone:'01012345678',
      product:'منتج',quantity:1,total:100,
      jntAddress:{province:'القاهرة',city:'مدينة نصر',area:'الحي الأول',street:'شارع 10'}})
  });
}
async function run(h,clientId='C-1'){
  return handleProductionCallerJntEdit({request:request(clientId),env:h.env,ctx:{},delegate:h.delegate});
}

let h=setup();
assert.equal((await run(h)).status,200);
assert.equal(h.writes,1);
assert(h.queries.some(s=>s.includes("store_id IS ? AND state=? AND COALESCE(awb,'')='' AND history IS ?")), 'write must atomically check store, state, AWB and history');

h=setup({grant:null});
assert.equal((await run(h)).status,403, 'support staff cannot write to a non-assigned store');
assert.equal(h.writes,0);

h=setup({grant:'viewer'});
assert.equal((await run(h)).status,403, 'viewer permission cannot write');
assert.equal(h.writes,0);

h=setup({row:{...base,state:'shipped',awb:'AWB-1'}});
assert.equal((await run(h)).status,409, 'shipped order is locked');
assert.equal(h.writes,0);

h=setup({row:{...base,state:'signed',awb:''}});
assert.equal((await run(h)).status,409, 'already delivered order is locked');
assert.equal(h.writes,0);

h=setup({changes:0});
assert.equal((await run(h)).status,409, 'a concurrent order update must not report success');

h=setup({identity:{role:'client',uid:'U-1',clientId:'C-1'}});
assert.equal((await run(h,'C-2')).status,403, 'client cannot cross its tenant');
assert.equal(h.writes,0);

console.log('PASS: caller J&T edits require explicit live store grant, non-viewer role, pre-shipping state and CAS order version');
