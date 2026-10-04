import fs from 'node:fs';
import assert from 'node:assert/strict';
import {__subscriptionInternals} from '../src/subscription-billing.js';

const {monthBounds,trialActive,daysBetween}=__subscriptionInternals;
assert.deepEqual(monthBounds('2026-10-04'),{key:'2026-10',from:'2026-10-01',to:'2026-10-31'});
assert.equal(trialActive({status:'trialing',period_end:'2026-11-03'},'2026-10-04'),true);
assert.equal(trialActive({status:'trialing',period_end:'2026-11-03'},'2026-11-03'),false);
assert.equal(daysBetween('2026-10-04','2026-11-03'),30);

const billing=fs.readFileSync('src/subscription-billing.js','utf8');
const control=fs.readFileSync('src/subscription-control.js','utf8');
const orders=fs.readFileSync('src/wallet-orders.js','utf8');
const topups=fs.readFileSync('src/wallet-topup-admin.js','utf8');
const ui=fs.readFileSync('public/v2/modules-v127-subscriptions.js','utf8');
const preview=fs.readFileSync('src/index-commerce-v38.js','utf8');
const production=fs.readFileSync('src/index-production-mobile-update.js','utf8');

for(const token of ['subscription-minimum:','monthlyMinimum','trialing','balance_empty','monthly_minimum_due'])assert.ok(billing.includes(token),`billing contract missing ${token}`);
assert.ok(orders.includes('subscriptionOrderFee'),'orders must waive fee during approved trial');
assert.ok(topups.includes('reconcileSubscriptionAfterTopup'),'topup approval must immediately reconcile access');
assert.ok(control.includes('SUBSCRIPTION_BALANCE_REQUIRED'),'server must block paid sections when balance is unavailable');
assert.ok(control.includes("path==='/api/wallet/topups'&&method==='POST'"),'client topup submission must bypass normal feature routing');
assert.ok(billing.includes('order_fee_insufficient'),'balance below the next order fee must lock the system');
assert.ok(billing.includes('managed:false,locked'),'legacy clients without a subscription row must still be balance-locked');
assert.ok(control.includes("path==='/api/dashboard'"),'dashboard must remain available while locked');
assert.ok(control.includes("path==='/api/wallet/topups'"),'topup submission must remain available while locked');
for(const label of ['الاشتراكات','تفعيل شهر مجاني','الحد الأدنى الشهري','رسوم كل أوردر','صورة إثبات التحويل','اعتماد'])assert.ok(ui.includes(label),`UI contract missing ${label}`);
assert.ok(ui.includes("data-kun-subscription-locked"),'locked navigation must use a hard CSS lock');
assert.ok(ui.includes("String(view)!=='dashboard'"),'programmatic routing must also be blocked while locked');
assert.ok(ui.includes("accept=\"image/*\""),'payment proof input must support mobile image pickers');
assert.ok(ui.includes("typeof createImageBitmap==='function'"),'proof compression must include browser capability fallback');
assert.ok(preview.includes('/v2/modules-v127-subscriptions.js?v=127.1'),'preview must load v127 UI');
assert.ok(production.includes('/v2/modules-v127-subscriptions.js?v=127.1'),'production must load v127 UI');
assert.ok(preview.includes('handleSubscriptionControl'),'preview must enforce subscription control server-side');
assert.ok(production.includes('handleSubscriptionControl'),'production wrapper must enforce before production-specific APIs');

for(const file of [billing,control,orders,topups,ui]){
  for(const unsafe of ['DROP TABLE','ALTER TABLE','CREATE TABLE','DELETE FROM subscriptions','DELETE FROM wallet_accounts'])assert.ok(!file.includes(unsafe),`unexpected destructive/migration token: ${unsafe}`);
}
console.log('subscriptions v127 contract: ok');
