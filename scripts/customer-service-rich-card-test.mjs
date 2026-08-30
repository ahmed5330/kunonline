import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const [ui,index]=await Promise.all([
  readFile(new URL('../public/v2/modules-v42-customer-service-rich-cards.js',import.meta.url),'utf8'),
  readFile(new URL('../public/v2/index.html',import.meta.url),'utf8')
]);
for(const marker of ['/api/orders/','/details?clientId=','IntersectionObserver','data-cs-copy-value','navigator.clipboard','cs-rich-product','cs-rich-customer','نسبة التسليم للعميل','نسخ اسم العميل','نسخ رقم الهاتف','نسخ البريد الإلكتروني','نسخ العنوان بالكامل','نسخ اسم المنتج','نسخ اللون/المقاس/الاختيارات','نسخ الكمية والسعر','item.options','item.lineTotal'])assert.ok(ui.includes(marker),`rich Customer Service card UI missing ${marker}`);
assert.ok(ui.includes("document.querySelectorAll('#root .cs-order[data-cs-order]')"),'rich cards must target Customer Service order cards');
assert.ok(ui.includes("card.classList.add('cs-rich-loaded')"),'rich cards must replace the legacy summary only after details load');
assert.ok(index.includes('modules-v42-customer-service-rich-cards.js?v=42.0'),'v42 rich card module is not loaded by the app shell');
assert.doesNotThrow(()=>new Function(ui),'v42 Customer Service rich card module must parse as browser JavaScript');
console.log('Customer Service rich card contract passed: visible-card lazy details, customer/product parity and per-value copy actions.');
