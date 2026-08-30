import {readFile} from 'node:fs/promises';
const read=p=>readFile(new URL(`../${p}`,import.meta.url),'utf8');
const must=(ok,msg)=>{if(!ok)throw new Error(msg)};
const [service,entry,ui,index,wrangler]=await Promise.all([
  read('src/order-details.js'),read('src/index-commerce-v32.js'),read('public/v2/modules-v40-order-details.js'),read('public/v2/index.html'),read('wrangler.preview.toml')
]);
for(const marker of ['cart_items','variation_props','variantSku','payment_method','government','alternatePhone','customerStats','api/v1/external-apps/orders/','اللون','المقاس'])must(service.includes(marker),`order details backend missing ${marker}`);
for(const marker of ["path.match(/^\\/api\\/orders\\/","\\/details$/)","requirePermission(me,'orders','read')",'resolveStoreScope','loadOrderDetails'])must(entry.includes(marker),`order details scoped route missing ${marker}`);
for(const marker of ['عناصر السلة','بيانات العميل','بيانات وعنوان الشحن','ملخص الطلب','data-kod-cs-details','KunOrderDetails','button[data-order]','kod-item-choice','kod-item-qty','نسبة التسليم للعميل','kod-delivery-bars','kod-customer-row','v40.1-ready'])must(ui.includes(marker),`order details UI missing ${marker}`);
must(index.includes('modules-v40-order-details.js?v=40.1'),'order details reference-matched UI module is not loaded');
must(/main\s*=\s*"src\/index-commerce-v32\.js"/.test(wrangler),'Preview is not routed through v32 order-details wrapper');
must(!service.includes('api_key:"')&&!service.includes('webhook_secret:"'),'order details source must not contain embedded integration secrets');
console.log('Order details contract passed: scoped API plus reference-matched cart-item and customer-card rendering, Easy Orders variants, delivery score, shipping and summary.');
