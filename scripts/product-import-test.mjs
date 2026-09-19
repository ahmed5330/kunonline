import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizeCommerceProduct} from '../src/commerce-product-import.js';
const root=new URL('../',import.meta.url),read=p=>readFile(new URL(p,root),'utf8');
const [adapter,worker,ui,inventoryUi,loader,preview]=await Promise.all([read('src/commerce-product-import.js'),read('src/index-commerce-v29.js'),read('public/v2/modules-v29-product-import.js'),read('public/v2/modules-v46-variant-inventory-sync.js'),read('public/v2/modules-v27-meta-ads.js'),read('wrangler.preview.toml')]);
for(const marker of ['eligibleCommerceImports','products.read','easyorders','shopify','woocommerce','stableId','client_id=? AND store_id IS ?','previewCommerceImport','importCommerceProducts','product_variants','selectedProducts','requireSelectionMode','selectedExternalIds','productCosts','requiredProductCosts','PRODUCT_IMPORT_MODE_REQUIRED','PRODUCT_IMPORT_SELECTION_REQUIRED','PRODUCT_IMPORT_SELECTION_STALE','PRODUCT_IMPORT_COST_REQUIRED','PRODUCT_IMPORT_COST_INVALID','api-key-external-apps','bearer-v1','EASYORDERS_PAGE_SIZE','page','limit','Variations.Props,Variants.VariationProps','EASYORDERS_PRODUCT_PAGINATION_LIMIT','p?.Variants','v?.VariationProps','normalizeCommerceProduct','pricePair','discounted_price','DiscountedPrice','sale_price','compare_at_price','cost=excluded.cost'])assert.ok(adapter.includes(marker),`adapter missing ${marker}`);
assert.ok(!adapter.includes("text(args.selectionMode||'all')"),'backend must never default product synchronization to all products');
assert.ok(adapter.includes('p.importCost'),'product import must persist the user-supplied cost instead of a zero placeholder');
assert.ok(adapter.includes('compare_at_price,cost,active'),'variant import must persist product cost into imported variants');
for(const marker of ['/api/commerce/product-import/providers','/api/commerce/product-import/preview','resolveTenant','resolveStoreScope','requirePermission','selectionMode','selectedExternalIds','productCosts'])assert.ok(worker.includes(marker),`worker missing ${marker}`);
for(const marker of ['commerceProductImport','commerceImportMode','مزامنة كل المنتجات','مزامنة منتجات محددة','commerceImportSearch','commerceImportCheck','commerceImportCost','commerceBulkCost','commerceApplyBulkCost','syncCommerceProducts','productCosts','تكلفة كل منتج','راجع التكاليف قبل المزامنة','قبل المزامنة','السعر بعد الخصم','KunCommerceProductImportV29','openProvider','required-costs-v29.2'])assert.ok(ui.includes(marker),`UI missing ${marker}`);
assert.ok(!ui.includes('importAllCommerceProducts'),'old immediate import-all button must be removed so scope is explicit');
assert.ok(!ui.includes('importSelectedCommerceProducts'),'old immediate selected-import button must be removed so costs are validated before sync');
for(const marker of ['KunCommerceProductImportV29','review.open(\'easyorders\')','جاري فتح مراجعة التكاليف','مراجعة تكاليف Easy Orders','version:\'46.3\''])assert.ok(inventoryUi.includes(marker),`inventory sync missing governed cost-review marker ${marker}`);
assert.ok(!inventoryUi.includes("K.api('/api/commerce/product-import',{method:'POST'"),'Inventory Easy Orders button must not bypass the cost-review workflow with a direct import request');
assert.ok(loader.includes('/v2/modules-v29-product-import.js'),'product import UI module not loaded');
assert.match(preview,/main\s*=\s*"src\/index-commerce-v\d+\.js"/);

const easyOrdersSample=normalizeCommerceProduct({
  Id:991,
  Name:'جيبة بليسيه روزالين',
  SKU:'SKIRT-PARENT',
  Price:800,
  DiscountedPrice:599,
  Stock:999,
  Variants:[
    {Id:11,SKU:'SKIRT-BURG-M',Quantity:7,Price:800,DiscountedPrice:599,VariationProps:[{VariationProp:{Name:'برجاندي'}},{VariationProp:{Name:'M'}}]},
    {Id:12,SKU:'SKIRT-PET-L',Quantity:5,Price:800,SalePrice:599,VariationProps:[{VariationProp:{Name:'بترولي'}},{VariationProp:{Name:'L'}}]}
  ]
},0);
assert.equal(easyOrdersSample.price,599,'Easy Orders discounted price must become the authoritative selling price');
assert.equal(easyOrdersSample.compareAtPrice,800,'Easy Orders original price must be preserved as compare-at price while discounted');
assert.equal(easyOrdersSample.variants.length,2,'PascalCase Easy Orders Variants must be imported');
assert.equal(easyOrdersSample.variants[0].name,'برجاندي — M','VariationProps must become the visible variant label');
assert.equal(easyOrdersSample.variants[0].price,599,'Variant discounted price must become the selling price');
assert.equal(easyOrdersSample.variants[0].compareAtPrice,800,'Variant original price must be preserved as compare-at price');
assert.equal(easyOrdersSample.variants[1].price,599,'SalePrice remains supported as an Easy Orders discounted-price alias');
assert.equal(easyOrdersSample.variants[1].stock,5,'Variant quantity must be preserved independently');
assert.equal(easyOrdersSample.stock,12,'Parent product stock must be the aggregate of variant stock, not a second independent quantity');
assert.equal(easyOrdersSample.variants[0].sku,'SKIRT-BURG-M','Variant SKU must be preserved');

const snakeDiscount=normalizeCommerceProduct({Id:993,Name:'منتج خصم snake case',Price:500,discounted_price:425,Stock:2},0);
assert.equal(snakeDiscount.price,425,'discounted_price must be authoritative when Easy Orders returns snake_case');
assert.equal(snakeDiscount.compareAtPrice,500,'original Easy Orders price stays as compare-at reference');

const noDiscount=normalizeCommerceProduct({Id:992,Name:'جيبة بدون خصم',SKU:'NO-SALE',Price:800,DiscountedPrice:0,Stock:3,Variants:[{Id:21,SKU:'NO-SALE-V',Quantity:3,Price:750,SalePrice:0}]},0);
assert.equal(noDiscount.price,800,'discounted price=0 must fall back to the original Easy Orders price');
assert.equal(noDiscount.compareAtPrice,null,'No active discount means no compare-at price');
assert.equal(noDiscount.variants[0].price,750,'Variant discounted price=0 must fall back to its original price');
assert.equal(noDiscount.variants[0].compareAtPrice,null,'Variant without active discount must not show a fake compare-at price');
console.log('Commerce product import contract passed: inventory sync opens the in-system cost review, explicit all/selected scope is mandatory, every targeted product requires a cost that also feeds variants, and Easy Orders discounted price is authoritative.');