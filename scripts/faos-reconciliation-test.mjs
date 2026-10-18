import assert from 'node:assert/strict';
import {reconcileAccountingSources} from '../src/accounting-faos-reconciliation.js';
const observed=reconcileAccountingSources({
  legacy:{deliveredRevenue:1000,collectedRevenue:900,verifiedCollectedRevenue:800,
    netCash:700,unverifiedCollectedOrders:2},
  ledger:{netSales:1000,netProfit:410,includesLegacyOperationalEvents:false},
  quality:{missingSaleCostSnapshots:1,inventoryPurchasesExpensed:300,unreversedManagementFees:1,manualAdExpense:150}
});
assert.equal(observed.certified,false);
assert.equal(observed.canPublishStatutoryStatements,false);
assert.equal(observed.status,'needs_source_document_reconciliation');
assert.equal(observed.rows.find(x=>x.key==='revenue').variance,0,'identical sales totals alone cannot certify books');
assert.equal(observed.rows.find(x=>x.key==='revenue').status,'verification_required');
assert.equal(observed.rows.find(x=>x.key==='estimated_cod').operational,100);
assert.equal(observed.rows.find(x=>x.key==='cod').ledger,null,'not a bank-cleared posting');
assert.equal(observed.rows.find(x=>x.key==='net_cash').operational,700);
assert.ok(observed.exceptions.some(x=>x.code==='UNVERIFIED_COLLECTIONS'));
assert.ok(observed.exceptions.some(x=>x.code==='INVENTORY_DUPLICATE_EXPENSE_RISK'));
assert.ok(observed.exceptions.some(x=>x.code==='MISSING_COST_SNAPSHOT'));
assert.equal(observed.coverage.bankReconciliationDone,false);
const absent=reconcileAccountingSources({legacy:{},ledger:{},quality:{}});
assert.equal(absent.rows.find(x=>x.key==='revenue').operational,null,'not available must never become zero');
assert.equal(absent.rows.find(x=>x.key==='cod').operational,null);
assert.equal(absent.rows.find(x=>x.key==='estimated_cod').operational,null);
assert.equal(absent.rows.find(x=>x.key==='revenue').variance,null);
assert.equal(absent.certified,false);
console.log('PASS FAOS reconciliation: no false reconciliation/certification, estimated COD split, missing sources, critical exceptions.');
