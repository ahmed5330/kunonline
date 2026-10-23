/* Real headless Chromium + mocked network (NO deployed requests or live data).
 * Explicit logout retry must POST the same browser cookie (HttpOnly, never read
 * by client JS); ambiguous cookies must not claim successful retry. */
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';

const root=fileURLToPath(new URL('../',import.meta.url));
const app=readFileSync(join(root,'public/v2/modules-v26-auth.js'),'utf8');
const htmlRoot=readFileSync(join(root,'public/v2/index.html'),'utf8');
assert.ok(htmlRoot.includes('/v2/modules-v26-auth.js?v=26.2'),'retry UI must invalidate old login shell asset');
const chrome=[
  process.env.KUN_CHROME_PATH,process.env.CHROME_PATH,
  '/usr/bin/google-chrome','/usr/bin/google-chrome-stable',
  '/usr/bin/chromium','/usr/bin/chromium-browser'
].find(x=>x&&existsSync(x));
assert.ok(chrome,'Real Chromium required for isolated logout retry QA');

const folder=mkdtempSync(join(tmpdir(),'kun-logout-retry-'));
try{
  for(const test of [
    {name:'recover',codes:[503,200],attempts:2,showRetry:false},
    {name:'still-offline',codes:[503,503],attempts:2,showRetry:true},
    {name:'duplicate',codes:[400],attempts:1,showRetry:false}
  ]){
    const responses=JSON.stringify(test.codes);
    const pre='<html lang="ar"><head><meta charset="utf-8"></head><body><div class="app"><div class="top"></div><div id="private">حساب تجريبي</div></div><output id="result"></output>';
    const mock='<script>window.__calls=[];window.__codes='+responses+';window.fetch=async(path,opts={})=>{'+
      'window.__calls.push({path,method:opts.method||"GET",credentials:opts.credentials});'+
      'if(path==="/api/me")return new Response(JSON.stringify({role:"client",email:"qa@example.invalid",name:"QA"}),{status:200});'+
      'if(path==="/api/logout"){const n=window.__calls.filter(x=>x.path==="/api/logout").length-1;const status=window.__codes[Math.min(n,window.__codes.length-1)];'+
      'return new Response(JSON.stringify(status===200?{ok:true}:{ok:false,error:status===400?"AMBIGUOUS_SESSION_COOKIE":"SESSION_REVOCATION_UNAVAILABLE"}),{status});}'+
      'throw Error("Unexpected URL");};</script>';
    const controls='<script>'+
      'setTimeout(()=>document.getElementById("v28LogoutBtn")?.click(),140);'+
      'setTimeout(()=>{window.__first={hidden:document.querySelector(".app")?.style.display==="none",'+
        'warn:document.getElementById("v28LoginError")?.classList.contains("show"),'+
        'retry:!!document.getElementById("v28LogoutRetryBtn"),'+
        'role:document.getElementById("v28LoginError")?.getAttribute("role")};},480);'+
      'setTimeout(()=>document.getElementById("v28LogoutRetryBtn")?.click(),650);'+
      'setTimeout(()=>{document.getElementById("result").textContent=JSON.stringify({'+
        'first:window.__first,hidden:document.querySelector(".app")?.style.display==="none",'+
        'retry:!!document.getElementById("v28LogoutRetryBtn"),'+
        'disabled:document.getElementById("v28LogoutRetryBtn")?.disabled||false,'+
        'warn:document.getElementById("v28LoginError")?.classList.contains("show"),'+
        'label:document.getElementById("v28LoginError")?.textContent||"",calls:window.__calls});},1100);'+
      '</script>';
    const testFile=join(folder,test.name+'.html');
    writeFileSync(testFile,pre+mock+'<script>'+app+'</script>'+controls+'</body></html>');
    const launched=spawnSync(chrome,['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
      '--no-first-run','--virtual-time-budget=2400','--dump-dom',pathToFileURL(testFile).href],
      {encoding:'utf8',timeout:40000,maxBuffer:3_000_000});
    assert.equal(launched.status,0,'Isolated Chrome '+test.name+' startup failed: '+launched.stderr?.slice(-1000));
    const match=launched.stdout.match(/<output id="result">([^<]+)<\/output>/);
    assert.ok(match,'Browser did not complete '+test.name);
    const data=JSON.parse(match[1].replace(/&quot;/g,'"').replace(/&amp;/g,'&'));
    assert.equal(data.first.hidden,true,'private dashboard must be hidden immediately');
    assert.equal(data.first.warn,true,'logout failure must be visible before retry');
    assert.equal(data.first.role,'alert');
    assert.equal(data.first.retry,test.codes[0]!==400,'retry only possible with unambiguous cookie');
    assert.equal(data.hidden,true,'sensitive UI must stay hidden');
    assert.equal(data.retry,test.showRetry,'wrong retry state for '+test.name);
    assert.equal(data.calls.filter(x=>x.path==='/api/logout').length,test.attempts);
    assert.ok(data.calls.filter(x=>x.path==='/api/logout').every(x=>x.method==='POST'&&x.credentials==='include'),'retry must send original cookie through credentials include and POST');
    if(test.name==='recover')assert.equal(data.warn,false,'successful retry clears warning');
    if(test.name==='still-offline'){
      assert.equal(data.warn,true,'repeat failure retains warning');
      assert.equal(data.disabled,false,'failed retry should allow another attempt');
      assert.match(data.label,/قد تظل الجلسة القديمة صالحة/);
    }
    if(test.name==='duplicate'){
      assert.match(data.label,/أكثر من كوكي جلسة/);
      assert.equal(data.warn,true);
    }
  }
  console.log('SEC-02 real Chromium logout retry PASS: 503-to-200 success, sustained 503 alert, 400 ambiguous cookies, protected dashboard and POST-only cookie forwarding.');
}finally{rmSync(folder,{recursive:true,force:true});}
