import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const legacy=await readFile(new URL('../public/v2/modules-v23-create.js',import.meta.url),'utf8');
const form=await readFile(new URL('../public/v2/modules-v106-manual-jnt-order.js',import.meta.url),'utf8');
const cascade=await readFile(new URL('../public/v2/modules-v80-jnt-address-cascade.js',import.meta.url),'utf8');
const backend=await readFile(new URL('../src/operational-workflow-v105.js',import.meta.url),'utf8');
const migration=await readFile(new URL('../migrations/0090_customer_service_claim_jnt_address.sql',import.meta.url),'utf8');
const index=await readFile(new URL('../public/v2/index.html',import.meta.url),'utf8');
new Function(legacy);new Function(form);new Function(cascade);

for(const marker of ['اسم المستلم','رقم التليفون','المحافظة — J&T','المدينة / الحي — J&T','المنطقة — J&T','الشارع والعنوان التفصيلي','وصل الأوردر منين','v106OrderProductSelect','v106OrderProductManual','v106OrderQty','v106OrderProductNote','إجمالي المطلوب','v106OrderCoupon','v106OrderDate','v106OrderNote','تسجيل الأوردر'])assert.ok(form.includes(marker),`Manual J&T order form missing ${marker}`);
for(const marker of ['data-jnt-address-form="1"','/api/orders/manual-jnt','provinceCode','cityCode','districtCode','addressCountryCode',"state:'pending'"])assert.ok(form.includes(marker),`Manual J&T order payload missing ${marker}`);
for(const source of ['whatsapp','facebook','instagram','website','tiktok','phone','manual'])assert.ok(form.includes(`value=\"${source}\"`),`Manual order source missing ${source}`);
assert.ok(form.includes('Number(selected.price)')&&form.includes('*qty'),'Selected product price must recalculate order total by quantity');
assert.ok(form.includes("manual.oninput=()=>{if(manual.value.trim())productSelect.value='';}"),'Manual product name must clear selected catalog product');
for(const marker of ['form[data-jnt-address-form="1"]','provinceCode','cityCode','districtCode','addressCountryCode','enhance,version'])assert.ok(cascade.includes(marker),`Reusable J&T address cascade missing ${marker}`);
for(const marker of ['/api/orders/manual-jnt','JNT_ADDRESS_REQUIRED','jnt_province','jnt_city','jnt_area','jnt_street','jnt_province_code','jnt_city_code','jnt_district_code','jnt_country_code'])assert.ok(backend.includes(marker),`Manual J&T backend missing ${marker}`);
for(const column of ['jnt_province','jnt_city','jnt_area','jnt_street','jnt_province_code','jnt_city_code','jnt_district_code','jnt_country_code'])assert.ok(migration.includes(`ADD COLUMN ${column}`),`Migration missing ${column}`);
assert.ok(cascade.includes('modules-v106-manual-jnt-order.js?v=106.0'),'Manual J&T override must be loaded by the authoritative address module');
assert.ok(index.includes('/v2/modules-v23-create.js?v=23.2'),'Legacy create module remains available before the J&T override');
console.log('Manual order form contract passed: manual orders require the authoritative J&T province/city/area/street hierarchy, persist carrier codes, and retain product/source/order fields.');
