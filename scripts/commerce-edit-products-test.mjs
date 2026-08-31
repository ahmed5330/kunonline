import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url),read=name=>readFile(new URL(name,root),'utf8');
const [edit,editableDetails,products,entry,customerUi,productUi,migration,postShipping,postShippingUi,postShippingMigration,orderWorkflowUi,index]=await Promise.all([
  read('src/order-edit.js'),read('src/order-edit-details.js'),read('src/product-management.js'),read('src/index-commerce-v33.js'),read('public/v2/modules-v44-customer-service-order-edit.js'),read('public/v2/modules-v43-product-catalog.js'),read('migrations/0019_detailed_products.sql'),read('src/post-shipping.js'),read('public/v2/modules-v45-post-shipping.js'),read('migrations/0020_post_shipping_services.sql'),read('public/v2/modules-v54-order-workflow-controls.js'),read('public/v2/index.html')
]);
for(const marker of ['EDITABLE_STATES','order_edit','ORDER_EDIT_STATE_LOCKED','before','after','order_items','audit_log'])assert.ok(edit.includes(marker),`order edit backend missing ${marker}`);
for(const marker of ['localEdit','locallyEdited','آخر نسخة عدّلها فريق خدمة العملاء'])assert.ok(editableDetails.includes(marker),`editable details missing ${marker}`);
for(const marker of ['options_json','option_values_json','compare_at_price','images_json','low_stock_threshold','saveDetailedProduct','listDetailedProducts'])assert.ok(products.includes(marker),`product management missing ${marker}`);
for(const marker of ['/edit','/api/catalog/products','index-commerce-v33.js','products','orders'])assert.ok(entry.includes(marker),`v33 entry missing ${marker}`);
for(const marker of ['معدّل','تعديل الطلب','منتجات الطلب','/edit','التعديل متاح قبل خروج الطلب للشحن فقط'])assert.ok(customerUi.includes(marker),`Customer Service edit UI missing ${marker}`);
for(const marker of ['اللون','المقاس','الخامة','تكوين المتغيرات تلقائيًا','optionValues','المخزون حسب اللون والمقاس','variantId','compareAtPrice','seoDescription'])assert.ok(productUi.includes(marker),`detailed product UI missing ${marker}`);
for(const marker of ['ALTER TABLE products','ALTER TABLE product_variants','images_json','option_values_json','low_stock_threshold'])assert.ok(migration.includes(marker),`detailed products migration missing ${marker}`);
for(const marker of ['shipped','signed','collected','collected_amount','cod_collection','markPostShippingDelivered','collectPostShippingOrder'])assert.ok(postShipping.includes(marker),`post-shipping backend missing ${marker}`);
for(const marker of ['خدمات ما بعد الشحن','جاري الشحن','تم الشحن','تم التحصيل','المبلغ المستلم من شركة الشحن','/collect'])assert.ok(postShippingUi.includes(marker),`post-shipping UI missing ${marker}`);
for(const marker of ['إدارة الطلب','تحديث الحالة','تعديل الطلب','STATUS_ORDER','collecting','deferred','/api/customer-service/orders/','/api/post-shipping/orders/','refreshVisibleWorkspace','KunCustomerServiceV31','KunPostShippingV47','kun:order-workflow-updated'])assert.ok(orderWorkflowUi.includes(marker),`order details workflow UI missing ${marker}`);
assert.ok(index.includes('/v2/modules-v54-order-workflow-controls.js?v=54.0'),'v2 shell must load the order-details workflow controls');
assert.ok(postShippingMigration.includes('ALTER TABLE orders ADD COLUMN collected_amount REAL'),'post-shipping collected amount migration is missing');
assert.doesNotThrow(()=>new Function(customerUi),'Customer Service order edit browser module must parse');
assert.doesNotThrow(()=>new Function(productUi),'detailed product browser module must parse');
assert.doesNotThrow(()=>new Function(postShippingUi),'post-shipping browser module must parse');
assert.doesNotThrow(()=>new Function(orderWorkflowUi),'order-details workflow controls browser module must parse');
console.log('Order edit + detailed product catalog + post-shipping services + order-details workflow controls contract passed.');
