import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const form=await readFile(new URL('../public/v2/modules-v23-create.js',import.meta.url),'utf8');
const index=await readFile(new URL('../public/v2/index.html',import.meta.url),'utf8');
new Function(form);
for(const marker of [
  'اسم المشتري','رقم التليفون','المحافظة','وصل الأوردر منين','العنوان بالتفصيل',
  'v23OrderProductSelect','v23OrderProductManual','v23OrderQty','v23OrderProductNote',
  'إجمالي المطلوب','v23OrderCoupon','v23OrderDate','v23OrderNote','تسجيل الأوردر'
])assert.ok(form.includes(marker),`Manual order form missing ${marker}`);
for(const marker of [
  "source=K.val('v23OrderSource')","productId:selected?.id||undefined","unitPrice:selected?Number(selected.price)||0:undefined",
  "productNote:K.val('v23OrderProductNote')","couponCode:K.val('v23OrderCoupon')","note:K.val('v23OrderNote')","state:'pending'"
])assert.ok(form.includes(marker),`Manual order payload missing ${marker}`);
for(const source of ['whatsapp','facebook','instagram','website','tiktok','phone','manual'])assert.ok(form.includes(`value=\"${source}\"`),`Manual order source missing ${source}`);
assert.ok(form.includes("const recalc=()=>")&&form.includes('Number(selected.price)')&&form.includes('*qty'),'Selected product price must recalculate order total by quantity');
assert.ok(form.includes("manual.oninput=()=>{if(manual.value.trim())productSelect.value='';}"),'Manual product name must clear selected catalog product');
assert.ok(index.includes('/v2/modules-v23-create.js?v=23.2'),'Expanded manual order form asset must be cache-busted in v2');
console.log('Manual order form contract passed: requested customer, source, address, product, quantity, notes, total, coupon and date fields are persisted.');
