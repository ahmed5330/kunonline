import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const [ui,customerService,index]=await Promise.all([
  readFile(new URL('../public/v2/modules-v42-customer-service-rich-cards.js',import.meta.url),'utf8'),
  readFile(new URL('../public/v2/modules-v31-customer-service.js',import.meta.url),'utf8'),
  readFile(new URL('../public/v2/index.html',import.meta.url),'utf8')
]);
for(const marker of ['/api/orders/','/details?clientId=','IntersectionObserver','data-cs-copy-value','navigator.clipboard','cs-rich-product','cs-rich-top','cs-rich-order-total','font-size:18px','border:2px solid','cs-note-field','نسبة التسليم للعميل','نسخ رقم الهاتف','نسخ البريد الإلكتروني','نسخ العنوان بالكامل','item.options','item.lineTotal'])assert.ok(ui.includes(marker),`rich Customer Service card UI missing ${marker}`);
assert.ok(ui.includes("document.querySelectorAll('#root .cs-order[data-cs-order]')"),'rich cards must target Customer Service order cards');
assert.ok(ui.includes("card.classList.add('cs-rich-loaded')"),'rich cards must replace the legacy summary only after details load');
for(const removedLabel of ['نسخ اسم العميل','نسخ نسبة التسليم','نسخ اسم المنتج','نسخ اللون/المقاس/الاختيارات','نسخ الكمية والسعر','نسخ إجمالي المنتج','نسخ الإجمالي','نسخ الكمية','نسخ التاريخ'])assert.ok(!ui.includes(removedLabel),`redundant copy action still present: ${removedLabel}`);
assert.ok(customerService.includes('class="cs-field cs-note-field"')&&customerService.includes('class="btn primary cs-note-add" data-cs-action="note">إضافة</button>'),'internal note must have a nearby Add button');
assert.equal((customerService.match(/data-cs-action="note"/g)||[]).length,1,'internal note action must not be duplicated');
assert.ok(index.includes('modules-v31-customer-service.js?v=31.1'),'v31.1 Customer Service module is not loaded by the app shell');
assert.ok(index.includes('modules-v42-customer-service-rich-cards.js?v=42.1'),'v42.1 rich card module is not loaded by the app shell');
assert.doesNotThrow(()=>new Function(ui),'v42 Customer Service rich card module must parse as browser JavaScript');
console.log('Customer Service rich card contract passed: framed orders, focused copy actions, prominent total and inline internal-note add.');
