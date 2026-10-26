import assert from 'node:assert/strict';
import {projectFinancialEvent} from '../src/accounting-faos-event-projector.js';
import {trialBalance} from '../src/accounting-faos-core.js';

const base={clientId:'FAKE-TENANT',storeId:'FAKE-STORE',currency:'EGP',orderId:'FAKE-ORDER',eventDate:'2026-10-18',sourceDocument:'MOCK-RECORD-001'};
const project=(type,eventId,rest)=>projectFinancialEvent({...base,type,eventId,...rest});
const sale=project('delivery_verified','SHIP-E-001',{
  evidenceType:'carrier_delivery_confirmation',paymentChannel:'cod',productRevenue:900,customerShippingRevenue:100,outputTax:0
});
const cost=project('inventory_cogs_verified','COST-E-001',{
  evidenceType:'verified_inventory_snapshot',cost:420
});
const settlement=project('carrier_cod_settled','SETTLE-E-001',{
  evidenceType:'carrier_cod_statement',awb:'FAKE-AWB',settlementId:'MOCK-SETTLE',
  codGross:1000,bankReceived:900,shippingFee:80,codFee:20
});
const secondSale=project('delivery_verified','SHIP-E-002',{
  evidenceType:'signed_receipt',paymentChannel:'cod',productRevenue:700,customerShippingRevenue:0,outputTax:0
});
const secondCost=project('inventory_cogs_verified','COST-E-002',{
  evidenceType:'verified_inventory_snapshot',cost:300
});
const returned=project('return_approved','RTO-E-002',{
  evidenceType:'approved_return_document',refundDestination:'carrier_receivable',refundAmount:700,outputTaxReversal:0
});
const stock=project('return_stock_inspected','RESTOCK-E-002',{
  evidenceType:'quality_inspection_report',stockOutcome:'restock',originalCost:300
});
const grossRefund=project('return_approved','RTO-E-003',{
  evidenceType:'approved_return_document',refundDestination:'refund_payable',refundAmount:120,outputTaxReversal:20
});
const cashRefund=project('refund_paid','REFUND-E-003',{
  evidenceType:'bank_statement',bankReference:'MOCK-TRANSFER',amount:120
});
const all=[sale,cost,settlement,secondSale,secondCost,returned,stock,grossRefund,cashRefund];
assert.equal(all.length,9);
assert.ok(all.every(j=>j.debit===j.credit&&j.status==='draft_only'&&j.autoPosted===false));
assert.ok(all.every(j=>j.sourceType==='commerce_event'));
assert.equal(sale.sourceKey,'delivery_verified:SHIP-E-001','stable event identity');
assert.deepEqual(sale.lines.map(x=>x.accountCode),['1230','4100','4110'],'merchant shipping revenue separate');
assert.deepEqual(settlement.lines.map(x=>x.accountCode),['1120','6110','6114','1230']);
assert.ok(settlement.lines.some(x=>x.accountCode==='6114'&&x.debit===20));
assert.ok(returned.lines.some(x=>x.accountCode==='4191'&&x.debit===700));
assert.ok(stock.lines.some(x=>x.accountCode==='1300'&&x.debit===300));
const tb=trialBalance(all.map((x,i)=>({id:'J-'+i,storeId:'FAKE-STORE',lines:x.lines})));
assert.equal(tb.balanced,true);
assert.equal(tb.netProfitMinor,38000,'COD revenue-cost-fees plus returned/paid customer refund');
const get=code=>tb.accounts.find(x=>x.code===code)?.balanceMinor||0;
assert.equal(get('1230'),0,'COD settlements and carrier-adjusted returns reconcile');
assert.equal(get('2150'),0,'approved refund and actual bank refund reconcile');
assert.throws(()=>project('delivery_verified','MISSING-DOC',{sourceDocument:''}),/Missing sourceDocument/);
assert.throws(()=>project('delivery_verified','MISSING-PROOF',{
  evidenceType:'carrier_cod_statement',paymentChannel:'cod',productRevenue:1,customerShippingRevenue:0,outputTax:0
}),/Verified delivery evidence required/);
assert.throws(()=>project('carrier_cod_settled','MISMATCH',{
  evidenceType:'carrier_cod_statement',awb:'FAKE',settlementId:'FAKE',
  codGross:1000,bankReceived:900,shippingFee:80,codFee:10
}),/does not reconcile/);
assert.throws(()=>project('inventory_cogs_verified','NO-SNAPSHOT',{
  evidenceType:'signed_receipt',cost:100
}),/Verified cost snapshot required/);
assert.throws(()=>project('return_stock_inspected','UNKNOWN-OUTCOME',{
  evidenceType:'quality_inspection_report',stockOutcome:'uncertain',originalCost:200
}),/Return stock outcome required/);
assert.throws(()=>projectFinancialEvent({...base,type:'wallet_topup',eventId:'SIMULATED',evidenceType:'bank_statement'}),/Unsupported commerce event/);
console.log('PASS FAOS verified commerce event projections: deliveries, COGS, COD net settlement, return, inspected restock and refund; never auto posted.');
