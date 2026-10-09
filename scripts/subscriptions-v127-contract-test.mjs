import fs from 'node:fs';
import assert from 'node:assert/strict';
import {__subscriptionInternals,subscriptionAccess} from '../src/subscription-billing.js';
import {handleSubscriptionControl} from '../src/subscription-control.js';

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
const admin=fs.readFileSync('src/admin-control.js','utf8');
const adminUi=fs.readFileSync('public/v2/modules-v23-admin.js','utf8');
const subscriptionBilling=fs.readFileSync('src/subscription-billing.js','utf8');
const commerce27=fs.readFileSync('src/index-commerce-v27.js','utf8');

for(const token of ['subscription-minimum:','monthlyMinimum','trialing','balanceEmpty','ensureManagedWallet'])assert.ok(billing.includes(token),`billing contract missing ${token}`);
assert.equal(billing.includes("MONTHLY_MINIMUM_INSUFFICIENT"),false,'monthly minimum must be posted to the wallet ledger instead of creating a hidden due state');
assert.equal(billing.includes("monthly_minimum_due"),false,'managed access must not depend on a second hidden monthly-due lock state');
assert.ok(billing.includes("const requiredCredit=Math.max(Number(account.credit_limit)||0,shortage)"),'monthly minimum must be able to cross the visible balance below zero safely');
assert.ok(billing.includes("applyMonthly:body.endFreeTrial===true||body.applyMonthly===true||status==='active'"),'activating a subscription must apply the current monthly charge immediately');
assert.ok(billing.includes("await migrateLegacyBilling(env,clientId,actor)"),'every managed subscription path must migrate billing at an explicit order cutoff');
assert.ok(billing.includes("subscription.billing.start"),'paid subscription access must persist an immutable billing start timestamp');
assert.ok(billing.includes("billingStartedAt"),'subscription access/admin snapshot must expose the paid billing start timestamp');
assert.ok(orders.includes('subscriptionOrderFee'),'orders must waive fee during approved trial');
assert.ok(billing.includes("return clampMoney(account.base_order_fee)"),'managed subscriptions must charge exactly the admin base order fee');
assert.ok(billing.includes("orderFee=inTrial?0:clampMoney(account.base_order_fee)"),'client access must display the exact admin-defined fee');
assert.ok(billing.includes("baseOrderFee,orderFee:inTrial?0:baseOrderFee"),'admin subscription list must show the exact base fee for managed clients');
assert.ok(topups.includes('reconcileSubscriptionAfterTopup'),'topup approval must immediately reconcile access');
assert.ok(topups.includes("String(row.status)==='approved'"),'topup approval must be idempotent for already-approved requests');
assert.ok(topups.includes("TOPUP_APPROVAL_INTEGRITY"),'an approved payment without a matching wallet ledger entry must be rejected as an integrity error');
assert.ok(topups.includes("appliedTopupCredit"),'topup approval must verify its authoritative wallet ledger entry');
assert.ok(topups.includes("recoveredRequestState:true"),'a pending request with an existing credit must heal status without double-crediting');
assert.ok(topups.includes('creditedAmount!==requestedAmount'),'topup approval must record whether admin adjusted the credited amount');
assert.ok(topups.includes("creditAmount")||topups.includes('creditedAmount'),'topup approval must support an admin-confirmed credited amount');
assert.ok(!topups.includes("reconcileUnbilledOrders(env,{clientId:row.client_id,limit:300})"),'topup approval must not silently consume new credit against old pending orders');
assert.ok(topups.includes('getPendingTopupProofAdmin'),'admin proof endpoint must exist');
const pendingListBlock=topups.slice(topups.indexOf('export async function listPendingTopupsAdmin'),topups.indexOf('export async function getPendingTopupProofAdmin'));
assert.ok(!pendingListBlock.includes('proof_data_url,proof_url,status'),'pending topup list must not select Base64 screenshots');
assert.ok(pendingListBlock.includes('has_proof'),'pending topup list should expose only a lightweight proof-presence flag');
assert.ok(commerce27.includes("getPendingTopupProofAdmin(env,decodeURIComponent(m[1]))"),'admin proof route must be wired');
assert.ok(control.includes('SUBSCRIPTION_BALANCE_REQUIRED'),'paid wallet exhaustion must return a distinct 402 code');
assert.ok(control.includes("path==='/api/wallet/topups'&&method==='POST'"),'client topup submission must remain available while locked');
assert.ok(!billing.includes("reason=walletPaused?'wallet_paused':emptyBalance?'balance_empty':insufficientOrderBalance"),'small positive balances should remain active until zero');
assert.ok(billing.includes("const locked=walletPaused||(billed&&emptyBalance)"),'unmanaged legacy accounts are exempt unless v27 wallet billing is explicitly configured');
assert.ok(billing.includes("const locked=subscriptionPaused||walletPaused||emptyBalance"),'managed paid zero balances must be locked');
assert.ok(billing.includes("emptyBalance?'balance_empty':null"),'client and admin must expose the precise balance-empty reason');
assert.ok(ui.includes('الرصيد انتهى — التشغيل متوقف'),'client UI must communicate the balance-based lock');
assert.ok(ui.includes('refreshTopupHistory'),'client should see approval/pending/rejection status');
const topupRequest=fs.readFileSync('src/wallet-topup-request.js','utf8');
const listTopupSql=topupRequest.slice(topupRequest.indexOf('export async function listTopups'));
assert.ok(listTopupSql.includes('has_proof'),'client topup list should only receive proof presence');
assert.ok(!listTopupSql.includes('transfer_method,proof_data_url,proof_url,status'),'client status updates must not download entire payment screenshot');
assert.ok(preview.indexOf('const subscription=await handleSubscriptionControl')<preview.indexOf('const competitors=await handleCompetitorIntelligence'),'preview must enforce billing before add-on AI and competitors routes');
assert.ok(ui.includes('updateBalanceBanner'),'client must receive a proactive balance alert');
assert.ok(ui.includes("state.adminClients.filter(x=>x.reason==='balance_empty')"),'admin exhausted-balance count must reflect true billing locks');
assert.ok(fs.readFileSync('public/v2/modules-v79-printing.js','utf8').includes("try{await render();if(window.KunSubscriptionsV127?.access?.locked"),'J&T sending state must unwind after billing/refresh errors');
assert.ok(orders.includes('startingBalance<=0'),'order billing must stop only after balance is exhausted');
assert.ok(orders.includes('const shortage=round2(fee-startingBalance)'),'final order must be allowed to consume the remaining positive balance and cross once below zero');
assert.ok(orders.includes('orderBeforeBillingStart'),'order billing must compare business order date with the paid billing start');
assert.ok(orders.includes("PRE_BILLING_DATE"),'late-synced historical orders must be waived instead of charged');
assert.ok(orders.includes("date,created_at FROM orders"),'billOrder must load the business order date, not rowid only');
assert.ok(orders.includes("wallet.billing.migrate"),'older managed accounts must fall back to the original migration timestamp when no paid marker exists');
assert.ok(billing.includes('managed:false,locked,reason,balanceEmpty:emptyBalance'),'legacy clients must expose empty balance without turning it into a global app lock');
assert.ok(control.includes("path==='/api/dashboard'"),'dashboard must remain available while locked');
assert.ok(control.includes("path==='/api/wallet/topups'"),'topup submission must remain available while locked');
assert.ok(control.includes("path==='/api/admin/wallet/topups'&&method==='GET'"),'production subscription control must own admin topup listing');
assert.ok(control.includes("getPendingTopupProofAdmin(env,decodeURIComponent(match[1]))"),'production subscription control must own proof loading');
assert.ok(control.includes("approveTopup(env,topupId,actor,note,{creditAmount:body.creditAmount})"),'production subscription control must pass the admin-confirmed credit amount');
assert.ok(control.includes("/ledger$/"),'admin wallet ledger route must be owned by subscription control');
assert.ok(control.includes("listWalletLog(env,clientId"),'admin wallet ledger must read wallet movements');
assert.ok(control.includes("adminCreditWallet(env,clientId,amount,actor"),'admin subscriptions must support explicit manual balance correction');
assert.ok(control.includes("/credit$/"),'manual balance correction route must be owned by subscription control');
assert.ok(control.includes("path.startsWith('/api/admin/wallet/topups')"),'admin topup errors must not fall through to a stale delegated worker');
for(const label of ['الاشتراكات','منح 30 يوم مجانًا لهذا الحساب','الحد الأدنى الشهري','رسوم كل أوردر','صورة إثبات التحويل','اعتماد'])assert.ok(ui.includes(label),`UI contract missing ${label}`);
assert.ok(ui.includes("data-kun-subscription-locked"),'locked navigation must use a hard CSS lock');
assert.ok(ui.includes("String(view)!=='dashboard'"),'programmatic routing must also be blocked while locked');
assert.ok(ui.includes("accept=\"image/*\""),'payment proof input must support mobile image pickers');
assert.ok(ui.includes("typeof createImageBitmap==='function'"),'proof compression must include browser capability fallback');
assert.ok(ui.includes("sub127TrialToggle"),'admin must have an explicit free-trial toggle');
assert.ok(ui.includes('data-sub127-view-payment'),'admin must be able to open the payment proof');
assert.ok(ui.includes('رقم الهاتف المحوّل منه'),'admin payment modal must show sender phone');
assert.ok(ui.includes('sub127-proof-large'),'admin payment modal must render a large proof image');
assert.ok(ui.includes('data-sub127-view-client-payment'),'client table must expose pending payment details directly');
assert.ok(ui.includes("/api/admin/wallet/topups/${encodeURIComponent(key)}/proof"),'proof image must load lazily on demand');
assert.ok(ui.includes("root.dataset.sub127Admin==='loading'"),'admin screen must suppress duplicate concurrent loads');
assert.ok(ui.includes('state.locked?5000:60000'),'locked clients must recheck activation within five seconds');
assert.ok(ui.includes('KunPermissionNavigationV51?.load'),'unlock must reload navigation permissions, not only reapply stale state');
assert.ok(ui.includes("kun:subscription-access-restored"),'unlock must broadcast navigation restoration');
assert.ok(ui.includes("$('.nav .nav-group')"),'unlock must restore hidden navigation groups');
assert.ok(ui.includes('الرصيد الذي سيتم إضافته فعليًا'),'approval UI must let admin edit the balance that will be added');
assert.ok(ui.includes('sub127ApproveCreditAmount'),'approval UI must send an explicit credited amount');
assert.ok(ui.includes('الطلب كان معتمدًا بالفعل ولن يتم إضافة الرصيد مرة ثانية'),'approval UI must explain idempotent repeated approval');
assert.ok(ui.includes('رسوم كل أوردر — المبلغ النهائي'),'admin fee input must clearly represent the final charged amount');
assert.ok(ui.includes('بدون أي إضافات مخفية'),'admin fee input must promise no hidden module surcharge for managed subscriptions');
assert.ok(ui.includes('سجل الرصيد والخصومات'),'admin must expose wallet movement history per client');
assert.ok(ui.includes('إضافة / تصحيح رصيد يدوي'),'admin must expose a manual balance correction control');
assert.ok(ui.includes('sub127ManualCreditAmount'),'manual credit amount must be editable');
assert.ok(ui.includes("/api/admin/subscriptions/${encodeURIComponent(clientId)}/credit"),'manual credit UI must call the admin credit endpoint');
assert.ok(ui.includes('adminLockReason'),'admin subscriptions must expose the actual lock reason');
assert.ok(ui.includes('المصدر الوحيد: Wallet Ledger'),'admin UI must identify the wallet ledger as the single balance source');
assert.ok(ui.includes('بدء الفوترة المدفوعة'),'admin UI must expose the billing date cutoff for diagnosis');
assert.ok(ui.includes('سلامة الدفعات'),'admin UI must expose approved-payment integrity');
assert.ok(ui.includes('الحساب ما زال على Billing قديم'),'admin UI must warn before explicitly migrating an older managed billing account');
assert.ok(ui.includes('اعتماد بدون قيد Ledger'),'admin UI must surface approved payments missing a ledger entry');
assert.ok(ui.includes('/ledger?limit=40'),'admin client ledger must load from the read-only ledger endpoint');
assert.ok(ui.includes('تم إعادة تفعيل الحساب وكل الأقسام تلقائيًا'),'client should receive automatic reactivation feedback after an explicit pause is removed');
assert.ok(ui.includes('Promise.allSettled'),'admin screen must tolerate a secondary payment API failure');
assert.ok(ui.includes("$$('[data-sub127-manage]',root).forEach"),'admin manage buttons must use querySelectorAll semantics');
assert.ok(ui.includes("$$('[data-sub127-view-payment]',root).forEach"),'payment proof buttons must use querySelectorAll semantics');
assert.ok(ui.includes("$$('[data-sub127-view-client-payment]',root).forEach"),'client payment buttons must use querySelectorAll semantics');
assert.ok(ui.includes("الفترة المجانية اختيارية من الإدارة فقط"),'UI must state that free trial is admin-only and optional');
assert.ok(ui.includes("topupDraft:{amount:'',phone:'',file:null,fileName:''}"),'client topup form must keep an in-memory draft');
assert.equal(ui.includes('panel.outerHTML=html'),false,'access refresh must never replace the client topup form DOM');
assert.ok(ui.includes('function patchClientPanel'),'access refresh must patch subscription KPIs without rebuilding inputs');
assert.ok(ui.includes('function bindClientPanel'),'client topup form bindings must be stable and one-time');
assert.ok(ui.includes("proofInput?.files?.[0]||state.topupDraft.file"),'selected proof file must survive a dashboard rerender');
assert.ok(ui.includes("state.topupDraft.amount=amount.value"),'amount typing must persist immediately');
assert.ok(ui.includes("state.topupDraft.phone=phone.value"),'sender phone typing must persist immediately');
assert.ok(ui.includes("$$('.nav button[data-view]').forEach"),'subscriptions active-route sync must use the defined $$ collection helper');
assert.ok(ui.includes("target==='subscriptions'&&state.me?.role==='admin'"),'subscriptions route must be explicitly owned by the subscription module');
assert.ok(ui.includes('event.stopImmediatePropagation();setAdminActive();setTimeout(renderAdmin,0)'),'subscriptions route must block the legacy app placeholder before it renders');
assert.ok(ui.includes("!$('.sub127-admin',root)&&root.dataset.sub127Admin!=='loading'"),'subscriptions screen must recover if another renderer replaces it with a placeholder');
assert.ok(ui.includes("b.onclick=event=>{event?.preventDefault?.();event?.stopPropagation?.();setAdminActive();renderAdmin();}"),'admin subscriptions nav button must directly render the real subscriptions screen');
assert.ok(ui.includes("$$('[data-sub127-hidden=\"1\"]')"),'restore navigation must iterate all hidden routes');
assert.ok(ui.includes("$('.nav button[data-view]')"),'navigation state sync must iterate all routes with querySelectorAll semantics');
assert.equal(/(?<!\$)\$\([^\n;]*\)\.forEach\s*\(/.test(ui),false,'single-element $() helper must never be used with forEach');
assert.ok(preview.includes('/v2/modules-v127-subscriptions.js?v=127.17'),'preview must load v127.17 UI');
assert.ok(production.includes('/v2/modules-v127-subscriptions.js?v=127.17'),'production must load v127.17 UI');
assert.ok(preview.includes('handleSubscriptionControl'),'preview must enforce subscription control server-side');
assert.ok(production.includes('handleSubscriptionControl'),'production wrapper must enforce before production-specific APIs');
assert.ok(admin.includes("const allowedPlans=new Set(['starter','growth','pro','enterprise'])"),'Trial must not be a billing plan for new accounts');
assert.ok(admin.includes(":'starter',currency="),'new account plan must default to starter, not trial');
assert.ok(adminUi.includes('id=\"v23TrialApproved\"'),'new client form must expose an explicit free-trial checkbox');
assert.ok(!adminUi.includes('<option value=\"trial\">Trial</option>'),'Trial must not appear as a plan option');

for(const file of [billing,control,orders,topups,ui]){
  for(const unsafe of ['DROP TABLE','ALTER TABLE','CREATE TABLE','DELETE FROM subscriptions','DELETE FROM wallet_accounts'])assert.ok(!file.includes(unsafe),`unexpected destructive/migration token: ${unsafe}`);
}

const makeBillingEnv=({balance=0,walletStatus='active',subscriptionStatus='active'}={})=>{
  const wallet={client_id:'billing-test',balance,currency:'EGP',status:walletStatus,billing_version:'v27',base_order_fee:2};
  const sub={id:'SUB-TEST',client_id:'billing-test',status:subscriptionStatus,amount:0,currency:'EGP',billing_cycle:'monthly',period_end:'2099-12-31',created_at:'2026-01-01T00:00:00.000Z'};
  return {DB:{prepare(sql){
    return {bind(){return {
      async first(){
        if(sql.includes('SELECT * FROM wallet_accounts'))return wallet;
        if(sql.includes('SELECT * FROM subscriptions'))return sub;
        if(sql.includes('SELECT created_at FROM audit_log'))return {created_at:'2026-01-01T00:00:00.000Z'};
        if(sql.includes('SELECT balance,status,currency FROM wallet_accounts'))return wallet;
        throw new Error('Unexpected billing query: '+sql);
      }
    }}};
  }}};
};
const empty=await subscriptionAccess(makeBillingEnv({balance:0}),'billing-test',{applyMonthly:false});
assert.equal(empty.locked,true);
assert.equal(empty.reason,'balance_empty');
assert.equal(empty.balanceEmpty,true);
const debt=await subscriptionAccess(makeBillingEnv({balance:-19}),'billing-test',{applyMonthly:false});
assert.equal(debt.reason,'balance_empty');
const replenished=await subscriptionAccess(makeBillingEnv({balance:1}),'billing-test',{applyMonthly:false});
assert.equal(replenished.locked,false);
assert.equal(replenished.reason,null);
const freeTrial=await subscriptionAccess(makeBillingEnv({balance:0,subscriptionStatus:'trialing'}),'billing-test',{applyMonthly:false});
assert.equal(freeTrial.trialActive,true);
assert.equal(freeTrial.locked,false,'approved free trial must stay usable at zero balance');
const adminPause=await subscriptionAccess(makeBillingEnv({balance:50,subscriptionStatus:'paused'}),'billing-test',{applyMonthly:false});
assert.equal(adminPause.reason,'subscription_paused');


const guardedRequest=async({path,method='GET',balance=0,subscriptionStatus='active',role='client'}={})=>{
  const delegate={fetch:async request=>{
    assert.equal(new URL(request.url).pathname,'/api/me','billing middleware should only delegate identity checks');
    return Response.json({role,clientId:'billing-test'});
  }};
  return handleSubscriptionControl({
    request:new Request('https://kun.example.test'+path,{method,headers:{Cookie:'qa_session=stub'},...(method==='GET'?{}:{body:'{}'})}),
    env:makeBillingEnv({balance,subscriptionStatus}),ctx:{},delegate
  });
};
const bootstrap=await guardedRequest({path:'/api/state'});
assert.equal(bootstrap,null,'GET /api/state must remain readable so the dashboard and recharge form can boot at zero balance');
const stateWrite=await guardedRequest({path:'/api/state',method:'PUT'});
assert.equal(stateWrite.status,402,'all state writes must remain blocked at zero balance');
assert.equal((await stateWrite.json()).code,'SUBSCRIPTION_BALANCE_REQUIRED','state write should provide precise billing status');
const printing=await guardedRequest({path:'/api/printing?clientId=billing-test'});
assert.equal(printing.status,402,'printing remains inaccessible at zero balance');
const jnt=await guardedRequest({path:'/api/jt/shipments/ORDER-1/print',method:'POST'});
assert.equal(jnt.status,402,'J&T dispatch must not bypass the zero-balance restriction');
assert.equal(await guardedRequest({path:'/api/dashboard'}),null,'read-only dashboard must remain accessible');
assert.equal(await guardedRequest({path:'/api/wallet/log'}),null,'wallet transaction history must remain accessible');
const accessResponse=await guardedRequest({path:'/api/subscription/access'});
assert.equal(accessResponse.status,200,'access status must be readable for reactivation');
assert.equal((await accessResponse.json()).reason,'balance_empty');
assert.equal(await guardedRequest({path:'/api/state',method:'PUT',balance:50}),null,'replenished wallets should regain operations');
assert.equal(await guardedRequest({path:'/api/state',method:'PUT',subscriptionStatus:'trialing'}),null,'approved trial must not require credit');
assert.equal((await guardedRequest({path:'/api/printing',role:'staff'})).status,402,'store staff must respect the same server wallet gate');

console.log('subscriptions v127.17 billing contract: ok');
