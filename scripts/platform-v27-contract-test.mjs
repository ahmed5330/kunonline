import {readFile} from 'node:fs/promises';
const read=p=>readFile(new URL(`../${p}`,import.meta.url),'utf8');
const must=(ok,msg)=>{if(!ok)throw new Error(msg)};
const [migration,worker,wallet,features,events,marketing,admin,ad,html,css,scope,access,provider,wrangler]=await Promise.all([
  read('migrations/0014_platform_control_wallet_marketing.sql'),read('src/index-commerce-v27.js'),read('src/wallet-billing.js'),read('src/feature-entitlements.js'),read('src/order-events.js'),read('src/marketing-intelligence.js'),read('src/admin-control.js'),read('src/ad-studio.js'),read('public/v2/index.html'),read('public/v2/kun-v9.css'),read('src/store-scope.js'),read('src/access-control.js'),read('src/provider-registry.js'),read('wrangler.preview.toml')
]);
for(const table of ['tenant_modules','wallet_accounts','wallet_topup_requests','order_billing','order_events','order_notes','customer_channel_identities','order_attribution','ad_studio_drafts','ad_creative_assets','ad_draft_variants','platform_client_notes'])must(migration.includes(`CREATE TABLE IF NOT EXISTS ${table}`),`Missing ${table}`);
must(migration.includes('ai_insight_snapshots already exists since migration 0011'),'v27 migration must reuse the existing AI snapshot table');
const business=await read('src/business-intelligence.js');
for(const marker of ['insight_type','metric_json','suggested_payload_json','generated_at'])must(business.includes(marker),`Business brief persistence must use existing AI snapshot column: ${marker}`);
for(const endpoint of ['/api/tenant/features','/api/admin/clients','/api/admin/wallet/topups','/api/wallet/topups','/api/marketing/performance','/api/ai/business-brief','/api/ad-studio/drafts'])must(worker.includes(endpoint),`Missing ${endpoint}`);
must(worker.includes("filterLegacyStateByFeatures"),'State payload must be filtered by entitlements');
must(worker.includes("/^Bearer\\s+/i"),'Bearer ingest compatibility guard missing');
must(wallet.includes("idempotency_key")&&wallet.includes("env.DB.batch"),'Wallet must use atomic/idempotent ledger writes');
must(wallet.includes("billing_start_rowid")&&wallet.includes("pre_v27_order"),'Wallet migration must not retroactively bill historical orders');
must(features.includes('FEATURE_DISABLED')&&features.includes('per_order_fee_delta'),'Entitlement enforcement/fees missing');
must(events.includes('order_events')&&events.includes('order_notes')&&events.includes('whatsapp_outbox'),'Order command timeline/contact missing');
must(marketing.includes('realOrderCost')&&marketing.includes('deliveredOrderCost')&&marketing.includes('realRoas')&&marketing.includes('cac'),'True marketing metrics missing');
must(admin.includes('clientOverview')&&admin.includes('updateClientModules'),'Admin control plane missing');
must(ad.includes('approval_requests')&&ad.includes('publish_campaign')&&ad.includes('`ads.${action}`'),'Ad actions must be approval-gated');
must(html.includes('data-view="wallet"')&&html.includes('data-view="admin-clients"')&&html.includes('data-view="ad-studio"')&&html.includes('modules-v22.js'),'v27 UI entry points missing');
must(css.includes('.v27-order-actions'),'v27 responsive UI styles missing');
must(scope.includes('/api/ad-studio')&&scope.includes('/api/ai/business-brief'),'New store-scoped endpoints missing');
must(access.includes("marketing:")&&access.includes("'ads.*'")&&access.includes("'wallet.read'"),'v27 permissions missing');
for(const p of ['tiktok_messaging','bosta','mylerz','aramex','custom_shipping'])must(provider.includes(`id:'${p}'`),`Provider ${p} missing`);
must(wrangler.includes('main = "src/index-commerce-v27.js"'),'Preview entrypoint not v27');
must(!wrangler.includes('kunonline"\n')||wrangler.includes('name = "kunonline-preview"'),'Preview config safety failed');
console.log('v27 contract checks passed: control plane, entitlements, wallet, order timeline, marketing, AI/ads, integrations and Preview entrypoint.');
