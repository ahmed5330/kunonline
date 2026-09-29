import fs from 'node:fs';
import assert from 'node:assert/strict';

const read=path=>fs.readFileSync(path,'utf8');
const ui=read('public/v2/modules-v125-dashboard-section-periods.js');
const preview=read('src/index-commerce-v38.js');
const production=read('src/index-production-mobile-update.js');

for(const label of ['اليوم','أمس','من بداية الأسبوع','آخر ٧ أيام','من بداية الشهر','آخر شهر','مدة معينة']){
  assert.ok(ui.includes(label),`missing section period label: ${label}`);
}
for(const section of ['overview','trend','finance','ads','rates','provinces','ai']){
  assert.ok(ui.includes(`'${section}'`),`missing main dashboard section: ${section}`);
}

assert.ok(ui.includes('dash-v125-period-bar'),'each section must receive a dedicated persistent period bar');
assert.ok(ui.includes("head.insertAdjacentHTML('beforeend'"),'period bar must live in the section header instead of the volatile action controls');
assert.ok(ui.includes('data-v125-period'),'period selects must use the v125 event contract');
assert.ok(ui.includes('KunDashboardPeriodsProvinceV124'),'v125 must delegate range calculation/application to the established v124 period controller');
assert.ok(ui.includes('api.apply(value)'),'section selectors must actually apply the selected date range');
assert.ok(ui.includes("MutationObserver(()=>schedule(80))"),'section period bars must be restored after dashboard rerenders');
assert.ok(ui.includes('.dash-section-actions .dash-v124-period-control{display:none!important}'),'old volatile section controls must not create duplicates');

assert.ok(preview.includes('/v2/modules-v125-dashboard-section-periods.js?v=125.0'),'preview must inject dashboard v125');
assert.ok(production.includes('/v2/modules-v125-dashboard-section-periods.js?v=125.0'),'production must inject dashboard v125');
assert.ok(preview.indexOf('modules-v125-dashboard-section-periods.js')>preview.indexOf('modules-v124-dashboard-periods-province.js'),'preview must load v125 after v124');
assert.ok(production.indexOf('modules-v125-dashboard-section-periods.js')>production.indexOf('modules-v124-dashboard-periods-province.js'),'production must load v125 after v124');

for(const unsafe of ['DROP TABLE','DELETE FROM','ALTER TABLE','CREATE TABLE','migrations/']){
  assert.ok(!ui.includes(unsafe),`dashboard v125 must not contain database mutation token: ${unsafe}`);
}

console.log('dashboard v125 contract: ok');
