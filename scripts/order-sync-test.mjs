import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url),read=p=>readFile(new URL(p,root),'utf8');
const [sync,worker,ui,loader,validator,preview]=await Promise.all([read('src/commerce-order-sync.js'),read('src/index-commerce-v30.js'),read('public/v2/modules-v30-order-sync.js'),read('public/v2/modules-v29-product-import.js'),read('src/integration-provider-validation.js'),read('wrangler.preview.toml')]);
for(const marker of ['all','month','seven_days','day','since_connection','orders.read','EASYORDERS_HISTORICAL_ORDERS_UNAVAILABLE','external_store_id=?','client_id=?','store_id','webhook_secret','ON CONFLICT(id)','last_sync_at'])assert.ok(sync.includes(marker),`sync missing ${marker}`);
for(const marker of ['/api/commerce/order-sync/providers','/api/commerce/order-sync','/webhooks/easyorders','resolveTenant','resolveStoreScope','requirePermission'])assert.ok(worker.includes(marker),`worker missing ${marker}`);
for(const marker of ['provider.modes','orderSyncMode','supported','commerceOrderSync','رابط Webhook في Easy Orders','غير متاح من API هذا المزود'])assert.ok(ui.includes(marker),`UI missing ${marker}`);
assert.ok(loader.includes('/v2/modules-v30-order-sync.js'),'order sync UI module not loaded');
assert.ok(validator.includes('easyOrdersStoreId')&&validator.includes('externalStoreId'),'Easy Orders validation must bind the external store id');
assert.match(preview,/main\s*=\s*"src\/index-commerce-v30\.js"/);
console.log('Commerce order sync contract passed.');

