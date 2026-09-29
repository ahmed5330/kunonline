import fs from 'node:fs';
import assert from 'node:assert/strict';

const read=path=>fs.readFileSync(path,'utf8');
const ui=read('public/v2/modules-v124-dashboard-periods-province.js');
const preview=read('src/index-commerce-v38.js');
const production=read('src/index-production-mobile-update.js');

for(const label of ['اليوم','أمس','من بداية الأسبوع','آخر ٧ أيام','من بداية الشهر','آخر شهر','مدة معينة']){
  assert.ok(ui.includes(label),`missing dashboard period label: ${label}`);
}
assert.match(ui,/preset==='week_to_date'.*weekStart\(anchor\)/s,'week-to-date must start at current week start');
assert.match(ui,/preset==='last_7_days'.*addDays\(anchor,-6\)/s,'last 7 days must include today plus previous six days');
assert.match(ui,/preset==='last_month'.*addDays\(anchor,-29\)/s,'last month must be a rolling 30-day window');
assert.match(ui,/daysSinceSaturday=.*getUTCDay\(\)-6/s,'dashboard week must start on Saturday');

assert.ok(ui.includes("$$('.dash-section[data-dash-section]'"),'period controls must be added to dashboard sections');
assert.ok(ui.includes('data-v124-period'),'section period selects must use the v124 event contract');
assert.ok(ui.includes('[data-dash-preset="custom"]'),'preset ranges must reuse the established dashboard range flow');
assert.ok(ui.includes('#dashApplyRange'),'custom ranges must apply through the established dashboard loader');
assert.ok(ui.includes('KunAdsExpertV48?.refresh?.()'),'period changes must refresh the Meta expert view for the same range');

assert.ok(ui.includes("list?.remove()"),'duplicate province card list must be removed');
assert.ok(ui.includes("tableWrap.classList.remove('dash-u-province-hidden')"),'the merged province table must remain visible');
assert.ok(ui.includes('dash-v124-orders-track'),'order-volume visualization must be merged into the province table');
assert.ok(ui.includes('بدون تكرار نفس المحافظات مرتين'),'province copy must explain the single merged view');

assert.ok(preview.includes('/v2/modules-v124-dashboard-periods-province.js?v=124.0'),'preview must inject dashboard v124');
assert.ok(production.includes('/v2/modules-v124-dashboard-periods-province.js?v=124.0'),'production must inject dashboard v124');

for(const unsafe of ['DROP TABLE','DELETE FROM','ALTER TABLE','CREATE TABLE','migrations/']){
  assert.ok(!ui.includes(unsafe),`dashboard v124 must not contain database mutation token: ${unsafe}`);
}

console.log('dashboard v124 contract: ok');
