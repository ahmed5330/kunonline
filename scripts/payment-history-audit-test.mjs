import assert from 'node:assert/strict';
import {summarizePaymentHistory} from './payment-history-audit.mjs';
import {createProviderPaymentEvent} from '../src/order-payment-status.js';

const rows=[
  {client_id:'client-1',store_id:'store-a',source:'Easy Orders',state:'confirmed',
   history:JSON.stringify([createProviderPaymentEvent('paid',{reference:'A',at:'2026-11-06T08:00:00Z'})]),
   phone:'01000000000',name:'Never exported'},
  {client_id:'client-1',store_id:'store-a',ref:'easyorders:2',state:'collected',
   history:JSON.stringify([{state:'collected'}])},
  {client_id:'client-1',store_id:'store-a',ref:'easyorders:3',state:'shipped',
   history:JSON.stringify([createProviderPaymentEvent('refunded',{reference:'C'})])},
  {client_id:'client-2',store_id:'store-b',ref:'easyorders:4',state:'confirmed',
   history:'not json'},
  {client_id:'client-1',store_id:'store-a',source:'manual',state:'paid',
   history:JSON.stringify([createProviderPaymentEvent('paid')])},
];
const report=summarizePaymentHistory(rows);
assert.equal(report.mode,'READ_ONLY_NO_BACKFILL');
assert.deepEqual(report.totals,{
  total:4,
  verifiedPaid:1,
  verifiedRefunded:1,
  unknownNeedsProviderCheck:2,
  codCollectedIsNotProof:1,
});
assert.equal(report.stores.length,2);
assert.equal(report.stores[0].verifiedPaid,1);
const rendered=JSON.stringify(report);
assert(!rendered.includes('01000000000'));
assert(!rendered.includes('Never exported'));
assert(!rendered.includes('easyorders:2'));
assert(!rendered.includes('"history":'));
assert.throws(()=>summarizePaymentHistory({not:'an array'}),TypeError);
console.log('PASS: read-only historical payment audit, COD exclusion, tenant counts, no PII');
