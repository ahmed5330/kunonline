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
  'META_BREAKDOWN_UNAVAILABLE',
  '/api/integrations/meta-ads/breakdowns?',
  "state.breakdownData=null",
  "button:not([type])",
  "box.setAttribute('aria-live','polite')"
])must(controls.includes(marker),`Breakdown v71 missing contract marker: ${marker}`);

must(/activeController\.abort\(/.test(controls),'Breakdown v71 must abort the previous in-flight request');
must(!/changeSelection\([^)]*\)[\s\S]{0,500}\.render\(/.test(controls),'Breakdown selection change must not repaint the full Campaign Hub');
must(loader.includes("modules-v71-breakdown-controls.js?v=71.0"),'v57 loader must load Breakdown controls v71');
must(loader.indexOf('modules-v70-breakdown-measurements.js?v=70.0')<loader.indexOf('modules-v71-breakdown-controls.js?v=71.0'),'v71 controls must load after v70 measurements');
for(const marker of ['body_asset','title_asset','action__action_type','campaign71BreakdownRetry','stale-request cancellation','data-status','data-date-preset','data-section-mode','data-campaign-section','data-kun-section-reload'])must(browser.includes(marker),`Browser Breakdown QA missing coverage marker: ${marker}`);

console.log('Breakdown controls contract passed: no selection repaint, delegated controls, busy/double-click guard, abort/stale protection, retry UX, v70->v71 loader order and browser interaction coverage are wired.');
