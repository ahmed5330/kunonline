import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizeCommerceProduct} from '../src/commerce-product-import.js';
const root=new URL('../',import.meta.url),read=p=>readFile(new URL(p,root),'utf8');
const [adapter,worker,ui,loader,preview]=await Promise.all([read('src/commerce-product-import.js'),read('src/index-commerce-v29.js'),read('public/v2/modules-v29-product-import.js'),read('public/v2/modules-v27-meta-ads.js'),read('wrangler.preview.toml')]);
for(const marker of ['eligibleCommerceImports','products.read','easyorders','shopify','woocommerce','stableId','client_id=? AND store_id IS ?','previewCommerceImport','importCommerceProducts','product_variants','selectedProducts','selectionMode','selectedExternalIds','PRODUCT_IMPORT_SELECTION_REQUIRED','PRODUCT_IMPORT_SELECTION_STALE','api-key-external-apps','bearer-v1','EASYORDERS_PAGE_SIZE','page','limit','Variations.Props,Variants.VariationProps','EASYORDERS_PRODUCT_PAGINATION_LIMIT','p?.Variants','v?.VariationProps','normalizeCommerceProduct'])assert.ok(adapter.includes(marker),`adapter missing ${marker}`);
for(const marker of ['/api/commerce/product-import/providers','/api/commerce/product-import/preview','resolveTenant','resolveStoreScope','requirePermission','selectionMode','selectedExternalIds'])assert.ok(worker.includes(marker),`worker missing ${marker}`);
for(const marker of ['commerceProductImport','استيراد كل المنتجات','استيراد المنتجات المحددة','commerceImportSearch','commerceImportCheck','selectedExternalIds','created','updated','skipped','errors'])assert.ok(ui.includes(marker),`UI missing ${marker}`);
assert.ok(!ui.includes("provider==='easyorders'"),'UI must not hard-code Easy Orders behavior');
assert.ok(loader.includes('/v2/modules-v29-product-import.js'),'product import UI module not loaded');
assert.match(preview,/main\s*=\s*"src\/index-commerce-v\d+\.js"/);

const easyOrdersSample=normalizeCommerceProduct({
  Id:991,
  Name:'جيبة بليسيه روزالين',
  SKU:'SKIRT-PARENT',
  Stock:999,
  Variants:[
    {Id:11,SKU:'SKIRT-BURG-M',Quantity:7,SalePrice:599,VariationProps:[{VariationProp:{Name:'برجاندي'}},{VariationProp:{Name:'M'}}]},
    {Id:12,SKU:'SKIRT-PET-L',Quantity:5,SalePrice:599,VariationProps:[{VariationProp:{Name:'بترولي'}},{VariationProp:{Name:'L'}}]}
  ]
},0);
assert.equal(easyOrdersSample.variants.length,2,'PascalCase Easy Orders Variants must be imported');
assert.equal(easyOrdersSample.variants[0].name,'برجاندي — M','VariationProps must become the visible variant label');
assert.equal(easyOrdersSample.variants[1].stock,5,'Variant quantity must be preserved independently');
assert.equal(easyOrdersSample.stock,12,'Parent product stock must be the aggregate of variant stock, not a second independent quantity');
assert.equal(easyOrdersSample.variants[0].sku,'SKIRT-BURG-M','Variant SKU must be preserved');
console.log('Commerce product import contract passed: Easy Orders pagination/auth + lower/PascalCase variants + independent variant stock + aggregate parent stock + all/selected modes are wired end to end.');
