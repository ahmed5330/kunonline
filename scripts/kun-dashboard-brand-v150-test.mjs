import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync('public/v2/index.html','utf8');
const js=fs.readFileSync('public/v2/kun-dashboard-brand-v150.js','utf8');
const css=fs.readFileSync('public/v2/kun-dashboard-polish-v150.css','utf8');
const oldCss=fs.readFileSync('public/v2/kun-design-branded-v149.css','utf8');
const dashboard=fs.readFileSync('public/v2/modules-v126-dashboard-finance-top.js','utf8');
const periods=fs.readFileSync('public/v2/modules-v125-dashboard-section-periods.js','utf8');

assert.ok(html.includes('<link rel="icon" type="image/png" href="/logo.png">'),'Original Kun logo must remain tab icon');
assert.ok(html.includes('/v2/kun-dashboard-polish-v150.css?v=150.0'),'Brand styling must be loaded');
assert.ok(html.includes('/v2/kun-dashboard-brand-v150.js?v=150.0'),'Dashboard decoration must be loaded');
assert.ok(html.includes('/v2/modules-v142-login-gateway.js'),'Existing login flow must remain');
assert.ok(html.includes('/v2/modules-v128-unit-tracking.js'),'Existing inventory flow must remain');
assert.ok(html.includes('/v2/kun-design-branded-v149.css'),'Previous styling must remain');
assert.ok(dashboard.includes("card('cpp','سعر الطلب الفعلي'"),'Live CPP from actual ad-spend/orders must stay visible');
assert.ok(periods.includes('data-v125-period-bar'),'Independent date bars must remain in production');
assert.ok(css.includes('.dash-v125-period-bar'),'Keep independent date bars readable');
assert.ok(css.includes('.dash-f126-card.cpp'),'Live actual-order-cost KPI must be designed');
assert.ok(css.includes('body[data-theme="dark"]'),'Retain dark mode');
assert.ok(oldCss.includes('kun143-primary-button'),'Retain permission-aware core navigation branding');
assert.ok(js.includes("logo.src='/logo.png'"),'Original logo must appear inside the live dashboard');
assert.ok(js.includes("if(!permitted(view))return"),'Shortcut permissions must be validated before dispatch');
assert.ok(js.includes("shell.navigate(view)"),'Shortcuts must use existing navigation');
assert.ok(!/window\.fetch\s*=|\.innerHTML\s*=|localStorage\.|sessionStorage\.|\/api\//.test(js),
  'Decorator must not replace requests, inject untrusted HTML, touch data or bypass API logic');
assert.ok(!/https:\/\/cdn\.|tailwindcss\.com|daisyui\.com/.test(html),'Production UI must not load browser CDN runtime');
new vm.Script(js,{filename:'kun-dashboard-brand-v150.js'});
console.log('PASS: branded live dashboard, original auth, KPI, date filters and safe navigation contract');
