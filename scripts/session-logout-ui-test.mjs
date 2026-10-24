import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/v2/modules-v26-auth.js',import.meta.url),'utf8');
const line=source.split('\n').find(x=>x.includes("document.getElementById('v28LogoutBtn').onclick="));
for(const fail of [false,true]){
 const btn={disabled:false,textContent:'تسجيل الخروج'};let gates=0,notices=0,requests=0;
 const context={document:{getElementById:()=>btn},request:async()=>{requests++;if(fail)throw Error('offline')},showAuth:()=>gates++,window:{showToast:()=>notices++}};
 vm.runInNewContext(line,context);await btn.onclick();assert.equal(requests,1);assert.equal(gates,fail?0:1);assert.equal(notices,fail?1:0);if(fail){assert.equal(btn.disabled,false);assert.equal(btn.textContent,'تسجيل الخروج');}
}
console.log('Logout UI callback passed: login screen only after success; error remains visible and retry enabled.');
