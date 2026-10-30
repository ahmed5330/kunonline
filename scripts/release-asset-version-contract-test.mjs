// Keep post-deployment smoke expectations aligned with the reviewed app shell.
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');
const [html,workflow,units]=await Promise.all([read('public/v2/index.html'),read('.github/workflows/production.yml'),read('public/v2/modules-v128-unit-tracking.js')]);
for(const name of ['modules-v79-printing','modules-v128-unit-tracking']){
 const escaped=name.replaceAll('-','\\-'),pattern=escaped+'\\.js\\?v=([0-9.]+)',expected=new RegExp(pattern).exec(html)?.[1];assert.ok(expected,name+' must be in app shell');
 const versions=[...workflow.matchAll(new RegExp(pattern,'g'))].map(m=>m[1]);assert.ok(versions.length>=2,'workflow must fetch and verify '+name);assert.ok(versions.every(v=>v===expected),name+' smoke versions must equal shell '+expected);
 if(name.includes('unit-tracking')){assert.ok(units.includes("version:'"+expected+"'"));assert.ok(workflow.includes("version:'"+expected+"'"));}
}
console.log('PASS: Production post-deploy fetch and version assertions match reviewed printing/unit-tracking assets.');
