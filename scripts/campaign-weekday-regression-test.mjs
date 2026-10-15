import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
const worker=await read('src/index-production-mobile-update.js');
// Exercise the actual Production HTML transformation without DB or API access.
const start=worker.indexOf('async function websiteWithDirectAndroidDownload(');
const end=worker.indexOf('\nasync function routeConfirmedOrdersToPrinting',start);
const transform=vm.runInNewContext(`(function(){const HTML_PATHS=new Set(['/','/index.html','/v2/','/v2/index.html']);const LEGACY_APK_URL='legacy';const DIRECT_APK_PATH='/api/mobile/app-update/apk';${worker.slice(start,end)};return websiteWithDirectAndroidDownload;})()`,{URL,Headers,Response});
const source=await read('public/v2/index.html');
for(const path of ['/v2/','/v2/index.html']){
  for(const version of ['57.1','57.2','57.3']){
    const html=source.replaceAll('v=57.3',`v=${version}`);
    const response=await transform(new Request(`https://example.test${path}`),{ASSETS:{fetch:async()=>new Response(html,{headers:{'Content-Type':'text/html'}})}});
    const output=await response.text();
    assert.equal((output.match(/modules-v57-section-reload\.js\?v=57\.3/g)||[]).length,1);
    assert(!/src=["'][^"']*modules-v(?:66|67|119)-/.test(output),'Worker must not create competing campaign owners');
    assert.match(response.headers.get('cache-control'),/no-store/);
  }
}
const loader=await read('public/v2/modules-v57-section-reload.js');
assert(loader.includes('modules-v67-campaign-comparison-ux.js?v=67.3'));
assert(loader.includes('window.KunCampaignUXV67'));
console.log('Campaign Production HTML regression passed: one loader, current version, no competing injections.');
