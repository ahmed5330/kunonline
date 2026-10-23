/* Real Chromium interaction, fake network only: auth logout success vs D1 failure.
 * Never sends credentials or authenticates against deployed services. */
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';

const root=fileURLToPath(new URL('../',import.meta.url));
const app=readFileSync(join(root,'public/v2/modules-v26-auth.js'),'utf8');
const index=readFileSync(join(root,'public/v2/index.html'),'utf8');
assert.ok(index.includes('/v2/modules-v26-auth.js?v=26.2'),'auth browser must load refreshed UI code');
const chrome=[
  process.env.KUN_CHROME_PATH,process.env.CHROME_PATH,
  '/usr/bin/google-chrome','/usr/bin/google-chrome-stable',
  '/usr/bin/chromium','/usr/bin/chromium-browser'
].find(x=>x&&existsSync(x));
assert.ok(chrome,'Chrome required for auth logout failure browser fixture');
const dir=mkdtempSync(join(tmpdir(),'kun-logout-qa-'));
try{
  for(const status of [200,503]){
    const html='<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"></head>'+
      '<body><div class="app"><header class="top"></header><div id="private">بيانات الحساب</div></div><output id="test-result"></output>'+
      '<script>window.__calls=[];window.fetch=async function(path,options={}){'+
      'const method=options.method||"GET";window.__calls.push({path,method});'+
      'if(path==="/api/me")return new Response(JSON.stringify({role:"client",email:"qa@example.invalid",name:"Test"}),{status:200});'+
      'if(path==="/api/logout")return new Response(JSON.stringify('+JSON.stringify(status===200?{ok:true}:{ok:false,error:'SESSION_REVOCATION_UNAVAILABLE'})+'),{status:'+status+'});'+
      'throw Error("Unexpected network request: "+path);};</script>'+
      '<script>'+app+'</script>'+
      '<script>setTimeout(()=>{document.getElementById("v28LogoutBtn")?.click();},140);'+
      'setTimeout(()=>{const warning=document.getElementById("v28LoginError");'+
      'document.getElementById("test-result").textContent=JSON.stringify({'+
      'view:document.documentElement.dataset.v28Auth,'+
      'hidden:document.querySelector(".app")?.style.display==="none",'+
      'alert:warning?.classList.contains("show")||false,'+
      'message:warning?.textContent||"",role:warning?.getAttribute("role")||"",'+
      'calls:window.__calls});},580);</script></body></html>';
    const file=join(dir,'case-'+status+'.html');
    writeFileSync(file,html);
    const result=spawnSync(chrome,['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
      '--no-first-run','--virtual-time-budget=1700','--dump-dom',pathToFileURL(file).href],{
      encoding:'utf8',timeout:35000,maxBuffer:2_000_000
    });
    assert.equal(result.status,0,'Chrome fixture failed: '+result.stderr?.slice(-1000));
    const match=result.stdout.match(/<output id="test-result">([^<]+)<\/output>/);
    assert.ok(match,'Chrome did not complete logout test status '+status);
    const data=JSON.parse(match[1].replace(/&quot;/g,'"').replace(/&amp;/g,'&'));
    assert.equal(data.hidden,true,'Sensitive dashboard must close after logout attempt');
    assert.equal(data.view,'anonymous','Client UI must return to login on logout attempt');
    assert.deepEqual(data.calls.map(x=>[x.path,x.method]),
      [['/api/me','GET'],['/api/logout','POST']],'Never issue GET logout');
    if(status===503){
      assert.equal(data.alert,true,'Backend revocation failures must be visible');
      assert.equal(data.role,'alert');
      assert.match(data.message,/تعذر تأكيد إبطال الجلسة/);
      assert.match(data.message,/قد تظل صالحة/);
    }else{
      assert.equal(data.alert,false,'Successful logout must not show a failure');
    }
  }
  console.log('SEC-02 logout browser fixture PASS: backend 503 warning displayed without claiming session revocation; 200 success stays clear.');
}finally{rmSync(dir,{recursive:true,force:true});}
