import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url),read=p=>readFile(new URL(p,root),'utf8');
const [adapter,worker,ui,loader,preview]=await Promise.all([read('src/commerce-product-import.js'),read('src/index-commerce-v29.js'),read('public/v2/modules-v29-product-import.js'),read('public/v2/modules-v27-meta-ads.js'),read('wrangler.preview.toml')]);
for(const marker of ['eligibleCommerceImports','products.read','easyorders','shopify','woocommerce','stableId','client_id=? AND store_id IS ?','previewCommerceImport','importCommerceProducts','product_variants'])assert.ok(adapter.includes(marker),`adapter missing ${marker}`);
for(const marker of ['/api/commerce/product-import/providers','/api/commerce/product-import/preview','resolveTenant','resolveStoreScope','requirePermission'])assert.ok(worker.includes(marker),`worker missing ${marker}`);
for(const marker of ['commerceProductImport','استيراد المنتجات','created','updated','skipped','errors'])assert.ok(ui.includes(marker),`UI missing ${marker}`);
assert.ok(!ui.includes("provider==='easyorders'"),'UI must not hard-code Easy Orders');
assert.ok(loader.includes('/v2/modules-v29-product-import.js'),'product import UI module not loaded');
assert.match(preview,/main\s*=\s*"src\/index-commerce-v29\.js"/);
console.log('Commerce product import contract passed.');

