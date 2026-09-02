import {readFile} from 'node:fs/promises';

const [controls,loader,browser,resolver,measurements]=await Promise.all([
  readFile(new URL('../public/v2/modules-v71-breakdown-controls.js',import.meta.url),'utf8'),
  readFile(new URL('../public/v2/modules-v57-section-reload.js',import.meta.url),'utf8'),
  readFile(new URL('./browser-preview-breakdown-controls-test.mjs',import.meta.url),'utf8'),
  readFile(new URL('../src/meta-ads-campaign-detail-v3.js',import.meta.url),'utf8'),
  readFile(new URL('../public/v2/modules-v70-breakdown-measurements.js',import.meta.url),'utf8')
]);
const must=(ok,message)=>{if(!ok)throw new Error(message);};

for(const marker of [
  'window.KunBreakdownControlsV71',
  "document.addEventListener('change'",
  "document.addEventListener('click'",
  'event.stopImmediatePropagation()',
  'AbortController',
  'requestId!==sequence',
  'activeKey!==key',
  'aria-busy',
  'campaign71BreakdownRetry',
  '/api/integrations/meta-ads/breakdowns?',
  "state.breakdownData=null",
  "state.breakdownData={error:",
  "button:not([type])",
  "box.setAttribute('aria-live','polite')",
  'decorateCatalog',
  '· مشروط',
  '· متوافق تلقائيًا',
  'الطلب اشتغل بنجاح، لكن Meta لم ترجع بيانات'
])must(controls.includes(marker),`Breakdown v71 missing contract marker: ${marker}`);

must(/activeController\.abort\(/.test(controls),'Breakdown v71 must abort the previous in-flight request');
must(!/changeSelection\([^)]*\)[\s\S]{0,500}\.render\(/.test(controls),'Breakdown selection change must not repaint the full Campaign Hub');
for(const marker of [
  "modules-v70-breakdown-measurements.js?v=70.1",
  "modules-v71-breakdown-controls.js?v=71.1",
  "measure.addEventListener('load',loadControls,{once:true})",
  "if(window.KunBreakdownMeasurementsV70)loadControls()",
  "breakdown.addEventListener('load',loadMeasurements,{once:true})"
])must(loader.includes(marker),`Breakdown layered loader missing behavior marker: ${marker}`);
for(const marker of [
  "impression_device:['publisher_platform','impression_device']",
  "platform_position:['publisher_platform','platform_position']",
  'NO_REACH_DIMENSIONS',
  "target.searchParams.set('breakdowns',profile.requestBreakdowns.join(','))",
  "field!=='reach'&&field!=='frequency'",
  "support:'conditional'",
  "support:'compatible-composite'",
  'metricAvailability'
])must(resolver.includes(marker),`Meta Breakdown compatibility resolver missing marker: ${marker}`);
for(const marker of ['availability.frequency!==false','Reach/Frequency غير معروضين هنا','version:\'70.1\''])must(measurements.includes(marker),`Breakdown measurement availability missing marker: ${marker}`);
for(const marker of ['body_asset','title_asset','action__action_type','campaign71BreakdownRetry','META_BREAKDOWN_UNAVAILABLE','stale-request cancellation','data-status','data-date-preset','data-section-mode','data-campaign-section','data-kun-section-reload'])must(browser.includes(marker),`Browser Breakdown QA missing coverage marker: ${marker}`);

console.log('Breakdown controls contract passed: no selection repaint, delegated controls, busy/double-click guard, abort/stale protection, error/empty guidance, compatibility-aware Meta requests, metric availability, current v70.1/v71.1 assets and browser interaction coverage are wired.');
