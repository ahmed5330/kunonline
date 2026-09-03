import {readFileSync} from 'node:fs';

const ui=readFileSync(new URL('../public/v2/modules-v72-campaign-visual-density.js',import.meta.url),'utf8');
const loader=readFileSync(new URL('../public/v2/modules-v57-section-reload.js',import.meta.url),'utf8');

const must=(condition,message)=>{if(!condition)throw new Error(`Campaign v72 UX contract failed: ${message}`);};

must(/metricOrder=\['spend','purchases','cpp','roas','ctr','cpm','frequency'\]/.test(ui),'comparison metric order must remain explicit and deterministic');
must(/min-width:88px;width:88px;padding:5px 6px/.test(ui),'desktop comparison cells must use the compact 88px density');
must(/ux67-metric-col[^}]*min-width:132px;max-width:132px;width:132px/.test(ui),'sticky metric column must be compact');
must(/thead th:last-child\{position:sticky;right:0/.test(ui)&&/tbody td:last-child\{position:sticky;right:0/.test(ui),'period total must stay sticky on the right while days scroll');
for(const metric of ['spend','purchases','cpp','roas','ctr','cpm','frequency'])must(ui.includes(`data-ux72-metric=\"${metric}\"`)||ui.includes(`data-ux72-metric="${metric}"`)||ui.includes(`data-ux72-metric=\\"${metric}\\"`)||ui.includes(`[data-ux72-metric=\"${metric}\"]`)||ui.includes(`[data-ux72-metric="${metric}"]`),`colored background selector missing for ${metric}`);
must(/ux67-value\.high\{background:color-mix/.test(ui)&&/ux67-value\.watch\{background:color-mix/.test(ui)&&/ux67-value\.good\{background:color-mix/.test(ui),'performance alerts must override neutral metric colors with stronger semantic backgrounds');
must(/data-ux72-kpi/.test(ui)&&/metricFromLabel/.test(ui),'analysis KPI cards must receive semantic color surfaces without changing core data rendering');
must(/data-ux72-summary/.test(ui),'entity summary values must receive compact colored surfaces');
must(/data-ux72-expand/.test(ui)&&/ux72-focus\{position:fixed;inset:10px/.test(ui),'comparison must expose a full-screen focus control');
must(/event\.key!=='Escape'/.test(ui)&&/ux72-no-scroll/.test(ui),'focus mode must be dismissible with Escape and lock background scroll');
must(/aria-pressed/.test(ui)&&/aria-label/.test(ui),'focus control must expose accessible state and label');
must(/MutationObserver\(queueEnhance\)/.test(ui)&&/if\(queued\)return/.test(ui),'DOM enhancement must remain idempotent and coalesced');
must(/modules-v72-campaign-visual-density\.js\?v=72\.0/.test(loader),'v72 must load from the Campaign layered loader');
must(/loadVisual/.test(loader)&&/loadControls/.test(loader),'v72 must be chained after the reliable v71 controls');

console.log('Campaign v72 visual-density contract passed: compact colored metrics, sticky context/total columns, semantic KPI surfaces and full-screen comparison focus are wired.');