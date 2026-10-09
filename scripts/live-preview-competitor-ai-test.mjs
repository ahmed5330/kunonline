/* Live Preview-only synthetic competitor AI contract.
 * Creates an isolated QA store; never reads merchant orders/ads.
 * Tests real env.AI.run through authenticated app, never mocks the model.
 */
import {readFile} from 'node:fs/promises';
import {randomBytes,webcrypto} from 'node:crypto';

const base=(process.argv[2]||'').replace(/\/$/,'');
if(!base||!base.startsWith('https://kunonline-preview.'))throw Error('Only the Kun Online Preview URL may be tested');
const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
if(!account||!token)throw Error('Cloudflare preview environment credentials required');
const config=await readFile(new URL('../wrangler.preview.toml',import.meta.url),'utf8');
const db=config.match(/database_id\s*=\s*"([^"]+)"/)?.[1];
if(!db)throw Error('Preview D1 database not configured');
const endpoint='https://api.cloudflare.com/client/v4/accounts/'+account+'/d1/database/'+db+'/query';
const nonce=randomBytes(6).toString('hex');
const tenant='PREVIEW-STORE-001',storeId='QA-COMP-'+nonce,uid='QA-AIC-'+nonce;
const email='qa-comp-'+nonce+'@example.test',password='Tester!'+randomBytes(15).toString('hex')+'Aa1';
const stamp=new Date().toISOString(),q='?clientId='+encodeURIComponent(tenant)+'&storeId='+encodeURIComponent(storeId);
let cookie='',primary=null;
async function d1(sql,params=[]){
 const r=await fetch(endpoint,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({sql,params})});
 const data=await r.json().catch(()=>({})),out=data?.result?.[0];
 if(!r.ok||data.success===false||out?.success===false)throw Error('Preview test D1 operation failed; HTTP '+r.status+'; codes '+JSON.stringify(data.errors||out?.error||'unknown').slice(0,200));
 return out?.results||[];
}
async function hash(v){
 const salt=randomBytes(16),key=await webcrypto.subtle.importKey('raw',new TextEncoder().encode(v),'PBKDF2',false,['deriveBits']);
 const bits=await webcrypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:100000,hash:'SHA-256'},key,256);
 return 'pbkdf2$100000$'+salt.toString('base64')+'$'+Buffer.from(bits).toString('base64');
}
async function request(path,{method='GET',body,auth=true}={}){
 const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(auth&&cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(75000)});
 const t=await r.text();let d;try{d=JSON.parse(t)}catch{d={}}
 return {status:r.status,data:d};
}
const must=(ok,msg)=>{if(!ok)throw Error(msg)};
async function cleanup(){
 const errs=[];
 for(const [sql,p] of [
   ['DELETE FROM competitor_analysis_reports WHERE client_id=? AND store_id=?',[tenant,storeId]],
   ['DELETE FROM competitor_library_search_usage WHERE client_id=? AND store_id=?',[tenant,storeId]],
   ['DELETE FROM login_attempts WHERE email=?',[email]],
   ['DELETE FROM users WHERE id=?',[uid]],
   ['DELETE FROM stores WHERE id=? AND client_id=?',[storeId,tenant]]
 ]){try{await d1(sql,p)}catch(e){errs.push(String(e.message).slice(0,100))}}
 if(errs.length)throw Error('Synthetic QA cleanup failure: '+errs.join(', '));
}
try{
 await d1('SELECT id FROM stores WHERE client_id=? LIMIT 1',[tenant]).then(x=>must(x.length>0,'Preview QA tenant not found'));
 await d1('INSERT INTO stores(id,client_id,name,code,status,is_default,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',[storeId,tenant,'QA Synthetic Competitor Store', 'AIC'+nonce.slice(0,8),'active',0,stamp,stamp]);
 await d1('INSERT INTO users(id,email,name,password,role,client_id,status,created_at,last_login) VALUES (?,?,?,?,?,NULL,?,?,NULL)',[uid,email,'AI Competitor QA',await hash(password),'admin','active',stamp]);
 const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});
 must(login.ok,'QA login unsuccessful: '+login.status);
 cookie=(login.headers.get('set-cookie')||'').split(';')[0];
 must(Boolean(cookie),'QA login cookie not present');
 const unauth=await request('/api/competitors/status'+q,{auth:false});
 must(unauth.status===401,'Competitor API is not protected: '+unauth.status);
 const status=await request('/api/competitors/status'+q);
 must(status.status===200&&status.data.ok===true,'Competitor status failed: '+status.status+' '+status.data.code);
 must(status.data.configured===true,'Real Cloudflare Workers AI binding unavailable in Preview');
 const forbidden=await request('/api/competitors/status?clientId='+tenant+'&storeId=NO_SUCH_QA_STORE');
 must(forbidden.status===403,'Competitor store isolation failed: '+forbidden.status);
 const short=await request('/api/competitors/analyze'+q,{method:'POST',body:{name:'QA Test Shop',country:'EG',adCopy:'short'}});
 must(short.status===400&&short.data.code==='COMPETITOR_EVIDENCE_REQUIRED','Evidence guard did not reject empty input');
 const body={name:'QA Synthetic Eyewear Merchant',country:'EG',adCopy:'دلوقتي خصم 20 بالمية على النظارات المختارة مع توصيل لكل المحافظات لمدة أسبوع. اختار المقاس المناسب وشوف تفاصيل كل فريم قبل الطلب.',headline:'نضارتك بتكمل اللوك',offer:'خصم 20% على مجموعة محددة',creativeNotes:'وصف تجريبي من تاجر: صورة للنظارة على خلفية محايدة، بدون عرض فيديو فعلي',format:'image'};
 const first=await request('/api/competitors/analyze'+q,{method:'POST',body});
 must(first.status===200,'Real model analysis returned '+first.status+' code='+first.data.code);
 must(first.data.result?.realAI===true,'Competitor response did not confirm real inference');
 must((first.data.result?.report?.angles||[]).length>0,'AI did not produce structured competitor angles');
 must((first.data.result?.report?.tests||[]).length>0,'AI did not produce structured experiments');
 const same=await request('/api/competitors/analyze'+q,{method:'POST',body});
 must(same.status===200&&same.data.cached===true,'Duplicate evidence must use cached report');
 must(first.data.result?.id===same.data.result?.id,'Cache report ID mismatch');
 const history=await request('/api/competitors/status'+q);
 must(history.data.usedToday===1,'AI usage should reserve exactly one analysis');
 must(history.data.results?.some(x=>x.id===first.data.result.id&&x.status==='ready'),'Generated analysis not in per-store history');
 console.log('Real Workers AI Competitor v139 smoke PASSED; synthetic creative only; scoped auth, real structured LLM output, cached rerun, history, quota.');
}catch(e){primary=e}
finally{try{await cleanup()}catch(e){if(primary)primary=new Error(primary.message+'; '+e.message);else primary=e}}
if(primary)throw primary;
