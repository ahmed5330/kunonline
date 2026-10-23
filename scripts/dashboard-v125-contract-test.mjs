import fs from 'node:fs';
import assert from 'node:assert/strict';

const read=path=>fs.readFileSync(path,'utf8');
const ui=read('public/v2/modules-v125-dashboard-section-periods.js');
const preview=read('src/index-commerce-v38.js');
const production=read('src/index-production-mobile-update.js');

for(const label of ['اليوم','أمس','من بداية الأسبوع','آخر ٧ أيام','من بداية الشهر','آخر ٣٠ يوم','مدة معينة']){
  assert.ok(ui.includes(label),`missing section period label: ${label}`);
}
for(const section of ['overview','trend','finance','ads','rates','provinces','ai','summary']){
  assert.ok(ui.includes(`'${section}'`),`missing main dashboard section: ${section}`);
}

assert.ok(ui.includes('data-dashboard-finance-top="126"')&&ui.includes('dash-f126-headline'),'consolidated summary must expose the same filter as other dashboard sections');
assert.ok(ui.includes('dash-v125-period-bar'),'each section must receive a dedicated persistent period bar');
assert.ok(ui.includes("sec.insertAdjacentHTML('afterbegin'")&&ui.includes('sec.insertBefore(old,sec.firstChild)'),'filters must always mount before section headings with relocation from legacy placement');
assert.ok(ui.includes("const active=()=>!!$('#root .v33-dashboard')"),'filters must not vanish when side navigation active state is stale');
assert.ok(ui.includes('.dash-section>.dash-v125-period-bar{position:relative'),'filters must be visible above each section rather than clipped in legacy header');
assert.ok(ui.includes('if(status&&status.textContent!==nextStatus)'),'bar decoration must not create infinite childList observer rerenders');
assert.ok(ui.includes("sec.insertAdjacentHTML('afterbegin'"),'period bar must be the first child of each section rather than inside clipped headers');
assert.ok(ui.includes('data-v125-period'),'period selects must use the v125 event contract');
assert.ok(ui.includes('KunDashboardPeriodsProvinceV124'),'v125 must delegate range calculation/application to the established v124 period controller');
assert.ok(ui.includes('requestJson(')&&ui.includes('XMLHttpRequest'),'independent date filters must request their own server-backed snapshot');
assert.ok(ui.includes('renderScopedSection')&&ui.includes('setScopedDashboard'),'each section must render scoped financial and operational values');
assert.ok(ui.includes("url.searchParams.set('clientId'" )&&ui.includes("url.searchParams.set('storeId'"),'scoped requests must preserve tenant/store context');
assert.ok(ui.includes('clearSection')&&ui.includes('unify()'),'each section must support independent reset and all-section synchronization');
assert.ok(ui.includes('customModal(section)')&&ui.includes('calendarDate('),'custom date picker must validate dates without changing dashboard global selection');
assert.ok(ui.includes("MutationObserver(()=>schedule(80))"),'section period bars must be restored after dashboard rerenders');
assert.ok(ui.includes('.dash-section-actions .dash-v124-period-control{display:none!important}'),'old volatile section controls must not create duplicates');

assert.ok(preview.includes('/v2/modules-v125-dashboard-section-periods.js?v=125.4'),'preview must inject dashboard v125');
assert.ok(production.includes('/v2/modules-v125-dashboard-section-periods.js?v=125.4'),'production must inject dashboard v125');
assert.ok(preview.indexOf('modules-v125-dashboard-section-periods.js')>preview.indexOf('modules-v124-dashboard-periods-province.js'),'preview must load v125 after v124');
assert.ok(production.indexOf('modules-v125-dashboard-section-periods.js')>production.indexOf('modules-v124-dashboard-periods-province.js'),'production must load v125 after v124');

for(const unsafe of ['DROP TABLE','DELETE FROM','ALTER TABLE','CREATE TABLE','migrations/']){
  assert.ok(!ui.includes(unsafe),`dashboard v125 must not contain database mutation token: ${unsafe}`);
}

console.log('dashboard v125 contract: ok');
