import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const base=process.env.CAMPAIGN_LIVE_BASE||'https://app.kun-online.com';
const files=['modules-v57-section-reload.js?v=57.3','modules-v66-campaign-hub.js?v=66.1','modules-v67-campaign-comparison-ux.js?v=67.3','modules-v72-campaign-visual-density.js?v=72.0'];
const normalize=s=>s.replace(/\r\n/g,'\n').trim();
async function verify(){
  for(const path of ['/v2/','/v2/index.html']){
    const response=await fetch(base+path,{headers:{'Cache-Control':'no-cache'}});
    assert(response.ok);const html=await response.text();
    assert.equal((html.match(/modules-v57-section-reload\.js\?v=57\.3/g)||[]).length,1);
    assert(!/src=["'][^"']*modules-v(?:66|67|119)-/.test(html),'Competing campaign injection is still live');
    assert.match(response.headers.get('cache-control')||'',/no-store/);
  }
  for(const file of files){
    const response=await fetch(`${base}/v2/${file}`,{headers:{'Cache-Control':'no-cache'}});
    assert(response.ok);assert.equal(normalize(await response.text()),normalize(await readFile(new URL('../public/v2/'+file.split('?')[0],import.meta.url),'utf8')),`Live asset differs: ${file}`);
  }
}
for(let attempt=1;;attempt++){
  try{await verify();break;}catch(error){if(attempt===10)throw error;console.log(`Waiting for campaign asset propagation (${attempt}/10)`);await new Promise(r=>setTimeout(r,3000));}
}
console.log('Live campaign HTML and all four assets match the release; no database/API requests were made.');
