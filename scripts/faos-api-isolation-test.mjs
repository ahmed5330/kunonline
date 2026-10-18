import assert from 'node:assert/strict';
import {handleFinancialAccountingOS} from '../src/accounting-faos-api.js';

// Actual API handler, fully isolated: DB must never be touched for synthetic QA.
const env={DB:{prepare(){throw new Error('LIVE_DB_ACCESSED_BY_SIMULATION')}}};
const context={};
const delegate=(role,clientId='TENANT-TEST')=>({fetch:async()=>new Response(JSON.stringify({role,clientId}),{status:200,headers:{'Content-Type':'application/json'}})});
async function request(url,role,method='GET',body=null){
  const req=new Request(url,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
  const response=await handleFinancialAccountingOS({request:req,env,ctx:context,delegate:delegate(role)});
  return {status:response.status,json:await response.json()};
}
const scenario=await request('https://kun.local/api/accounting/faos/simulation','client');
assert.equal(scenario.status,200);
assert.equal(scenario.json.fakeOrders.length,4);
assert.ok(scenario.json.checks.every(x=>x.pass));
assert.equal(scenario.json.actual.assets,scenario.json.actual.liabilities+scenario.json.actual.equity);
const catalog=await request('https://kun.local/api/accounting/faos/catalog','accountant');
assert.equal(catalog.status,200);
assert.ok(catalog.json.accounts.some(x=>x.code==='1230'));
const forbidden=await request('https://kun.local/api/accounting/faos/simulation','viewer');
assert.equal(forbidden.status,403);
assert.equal(forbidden.json.code,'PERMISSION_DENIED');
const crossTenant=await request('https://kun.local/api/accounting/faos/journals','client','POST',
  {clientId:'OTHER-TENANT',storeId:'FAKE-S',date:'2026-10-18',description:'Test entry',idempotencyKey:'TEST-KEY-123',
   lines:[{accountCode:'1120',debit:10},{accountCode:'3100',credit:10}]});
assert.equal(crossTenant.status,403);
assert.equal(crossTenant.json.code,'TENANT_ISOLATION');
const writeDenied=await request('https://kun.local/api/accounting/faos/journals','ops','POST',
  {clientId:'TENANT-TEST',storeId:'FAKE-S',date:'2026-10-18',description:'Test entry',idempotencyKey:'TEST-KEY-123',
   lines:[{accountCode:'1120',debit:10},{accountCode:'3100',credit:10}]});
assert.equal(writeDenied.status,403);
assert.equal(writeDenied.json.code,'PERMISSION_DENIED');
console.log('PASS: live handler synthetic scenario no DB access; accounting catalog; viewer/ops writes denied; tenant spoof rejected.');
