import {readFile} from 'node:fs/promises';

const controls=await readFile(new URL('../public/v2/modules-v71-breakdown-controls.js',import.meta.url),'utf8');
const loader=await readFile(new URL('../public/v2/modules-v57-section-reload.js',import.meta.url),'utf8');
const browser=await readFile(new URL('./browser-preview-breakdown-controls-test.mjs',import.meta.url),'utf8');
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
  "box.setAttribute('aria-live','polite')"
])must(controls.includes(marker),`Breakdown v71 missing contract marker: ${marker}`);

must(/activeController\.abort\(/.test(controls),'Breakdown v71 must abort the previous in-flight request');
must(!/changeSelection\([^)]*\)[\s\S]{0,500}\.render\(/.test(controls),'Breakdown selection change must not repaint the full Campaign Hub');
for(const marker of [
  "modules-v70-breakdown-measurements.js?v=70.0",
  "modules-v71-breakdown-controls.js?v=71.0",
  "measure.addEventListener('load',loadControls,{once:true})",
  "if(window.KunBreakdownMeasurementsV70)loadControls()",
  "breakdown.addEventListener('load',loadMeasurements,{once:true})"
])must(loader.includes(marker),`Breakdown layered loader missing behavior marker: ${marker}`);
for(const marker of ['body_asset','title_asset','action__action_type','campaign71BreakdownRetry','META_BREAKDOWN_UNAVAILABLE','stale-request cancellation','data-status','data-date-preset','data-section-mode','data-campaign-section','data-kun-section-reload'])must(browser.includes(marker),`Browser Breakdown QA missing coverage marker: ${marker}`);

console.log('Breakdown controls contract passed: no selection repaint, delegated controls, busy/double-click guard, abort/stale protection, generic error+retry UX, event-driven v70->v71 loader behavior and browser interaction coverage are wired.');
