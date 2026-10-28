import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
const [sync,printing,customer,production,ship]=await Promise.all([
  read('src/commerce-order-sync.js'),
  read('src/production-printing-queue.js'),
  read('src/production-customer-service.js'),
  read('src/index-production-mobile-update.js'),
  read('src/jt-shipping-claim.js')
]);

// A replay from Easy Orders must not reassign a manually routed order to a
// different default store, nor regress its operational state.
assert.match(sync,/store_id=COALESCE\(orders\.store_id,excluded\.store_id\)/);
for(const marker of [
  "orders.state IN ('shipped','signed','collected','returned','cancelled')",
  "excluded.state IN ('pending','confirmed','preparing')",
  "orders.state IN ('confirmed','preparing') AND excluded.state='pending'",
  "state IN ('shipped','signed','collected','returned','cancelled') AND ? IN ('pending','confirmed','preparing')",
  "state IN ('confirmed','preparing') AND ?='pending'",
  "state IN ('no_answer','deferred') THEN state"
])assert.ok(sync.includes(marker),'Missing Easy Orders reconciliation guard: '+marker);

// The exact same store-scoped predicates must control counts and page results.
assert.ok(printing.includes("const printedFilter="));
assert.ok(printing.includes("const waitingFilter="));
assert.ok(printing.includes("const stateFilter=tab==='waiting'?waitingFilter:printedFilter"));
assert.ok(printing.includes("WHEN ${waitingFilter}"));
assert.ok(printing.includes("WHEN ${printedFilter}"));
assert.ok(printing.includes("AND ${waitingFilter}"));
assert.ok(printing.includes("AND ${printedFilter}"));
assert.ok(printing.includes("o.state IN ('confirmed','preparing','shipped')"),'Previously printed orders with a stale marketplace state must stay visible');
assert.ok(printing.includes("o.state='shipped' AND instr"),'Retryable J&T labels must not vanish after carrier acceptance');
assert.ok(printing.includes('listMyStores(env,me,clientId)'));
assert.ok(customer.includes('listMyStores(env,me,clientId)'));
assert.ok(customer.includes("'confirmed','preparing','shipped'"));
assert.ok(production.includes("const dataEnv=previewRuntimeEnv(env)"));
assert.ok(production.includes("handleProductionPrintingQueue({request,env:dataEnv,ctx,delegate})"));
assert.ok(production.includes("handleProductionCustomerService({request,env:dataEnv,ctx,delegate})"));
assert.ok(ship.includes("UPDATE orders SET state='shipped',checkpoint='جاري الشحن'") && ship.includes("jt_label_printed") && ship.includes("official:true"),"Only atomic official J&T label proof may transition to shipping");

console.log('Operational order/store regression contract passed: protected marketplace states, stable store identity, consistent printing queue and customer-service visibility.');
