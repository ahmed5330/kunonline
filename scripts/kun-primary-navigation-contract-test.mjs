/* Navigation design v145 — guarantee primary commerce destinations remain discoverable.
 * Offline-only checks: do not call production APIs or customer data. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const base=new URL('../public/v2/',import.meta.url);
const [html,js,css,access]=await Promise.all([
  'index.html','kun-design-v143.js','kun-design-v143.css','modules-v51-permission-navigation.js'
].map(name=>readFile(new URL(name,base),'utf8')));

const required=[
 'dashboard','orders','customer-service','printing','shipping','returns-exchanges',
 'products','inventory','campaigns','finance','accounting','wallet','integrations','settings','subscriptions'
];
const ids=new Set(required);
const match=js.match(/const NAV=\[([\s\S]*?)\];\s*const icons=/);
assert.ok(match,'Primary NAV declaration missing');
const nav=Function('"use strict";return ['+match[1]+']')();
assert.deepEqual(nav.map(x=>x[0]),required,'Core navigation priority/order regressed');
assert.equal(new Set(nav.map(x=>x[0])).size,required.length,'Duplicate primary route');
for(const route of required){
  assert.ok(html.includes('data-view="'+route+'"'),route+' missing from original routed app');
  assert.ok(js.includes('item.hidden')&&js.includes('item.style.display'),'Permissions must filter actual routes');
}
const groupsBlock=js.match(/const MAIN_GROUPS=\[([\s\S]*?)\];\s*const MAIN_VIEWS=/);
assert.ok(groupsBlock,'Named core work areas missing');
const groups=Function('"use strict";return ['+groupsBlock[1]+']')();
assert.equal(groups.length,6,'Workspace grouping changed unexpectedly');
assert.deepEqual(groups.flatMap(group=>group[1]),required,'Top-level headings must cover all primary routes exactly once');
assert.ok(groups.every(group=>group[1].every(route=>ids.has(route))),'Unexpected workspace in group');
assert.deepEqual(groups.at(-1),['إدارة المنصة',['subscriptions']],'Subscriptions must have their own independent admin workspace');
assert.match(js,/MAIN_VIEWS\.has\(view\)/,'Primary route must remain its own active destination');
assert.match(js,/link\.dataset\.kunPrimary/, 'Secondary links must exclude original top-level routes');
assert.match(js,/group\.classList\.toggle\('kun143-secondary-empty'/, 'Empty submenus should disappear');
assert.match(css,/\.kun143-secondary[^}]*data-kun-primary="1"/,'Duplicate links in nested menu must be visually hidden');
assert.match(css,/\.nav-group\.kun143-secondary-empty/,'Empty secondary groups must be hidden');
assert.match(js,/\[\['dashboard','الرئيسية'\],\['orders','الطلبات'\],\['customer-service','خدمة العملاء'\],\['printing','الطباعة'\]\]/,'Mobile bar must contain daily operational routes');
assert.match(js,/origin\(view\)\.click\(\)/, 'Primary button must call existing authorized route rather than parallel renderer');
assert.match(access,/'returns-exchanges':\['support\.read','shipping\.read'\]/,'Returns navigation must use existing support/shipping permissions');
for(const route of required){
 const regex=new RegExp('(?:^|[\\n, ])(?:\\x27'+route+'\\x27|'+route+'):\\s*\\[','m');
 assert.ok(regex.test(access),route+' needs a permission rule');
}
assert.ok(html.includes('/v2/kun-design-v143.js?v=145.1'),'Production must point at current JS');
assert.ok(html.includes('/v2/kun-design-v143.css?v=145.0'),'Production must point at current CSS');
const subscriptionUi=await readFile(new URL('modules-v127-subscriptions.js',base),'utf8');
assert.ok(html.includes('/v2/modules-v127-subscriptions.js?v=127.22'),'Production V2 must load the current subscription interface');
assert.match(html,/data-view="subscriptions" hidden>الاشتراكات والمدفوعات/,'Subscriptions start hidden until role validation');
assert.match(access,/if\(view==='subscriptions'\)return data\.role==='admin'/,'Only platform admin may navigate to subscriptions');
assert.ok(subscriptionUi.includes('if(state.me?.role!==\'admin\')return;'),'Subscription module must gate admin UI');
assert.ok(subscriptionUi.includes('window.KunDesignShellV143?.sync?.()'),'Admin subscription button must refresh main navigation');
assert.match(css,/\.kun143-primary-button\[hidden\]/,'Hidden admin primary route must not occupy space');
console.log('Kun primary navigation contract: 15 primary routes, 6 groups, standalone admin subscriptions, role gating and submenu deduplication OK.');
