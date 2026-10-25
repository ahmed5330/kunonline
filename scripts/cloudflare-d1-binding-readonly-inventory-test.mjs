import assert from 'node:assert/strict';
import {inspectD1Bindings} from './cloudflare-d1-binding-readonly-inventory.mjs';

const preview='31cd5cdf-fc01-42d7-ba1e-571f3dd58495',production='c426601d-182f-486e-a5c1-bb1bca0ecb0b';
const accountId='a'.repeat(32),token='PRIVATE_TOKEN',bookmark='PRIVATE_BOOKMARK';
let mismatched=false,denied=false,missingBookmark=false,calls=[];
async function fetcher(url,options){
  calls.push(url);
  assert.equal(options.method,'GET');
  assert.equal(options.redirect,'error');
  assert.equal(options.headers.Authorization,`Bearer ${token}`);
  assert.ok(url.startsWith(`https://api.cloudflare.com/client/v4/accounts/${accountId}/`));
  assert.doesNotMatch(url,/query|export|restore/);
  if(denied)return Response.json({success:false,errors:[{message:token}]},{status:403});
  let result;
  if(url.includes('/workers/')){
    result={bindings:url.includes('/kunonline-preview/')?[{type:'d1',name:'DB',id:preview}]:[
      {type:'d1',name:'DB',id:production},{type:'d1',name:'PREVIEW_DB',id:mismatched?production:preview},
      {type:'secret_text',name:'SECRET',text:token}]};
  }else if(url.endsWith('/time_travel/bookmark'))result=missingBookmark?{}:{bookmark};
  else result={uuid:url.split('/').at(-1),version:'production',file_size:1024};
  return Response.json({success:true,result});
}
const options={accountId,token,fetcher};
const result=await inspectD1Bindings(options);
assert.equal(result.passesMetadataGate,true);
assert.equal(calls.length,6,'Two Worker settings plus metadata/bookmark for two unique D1s');
assert.equal(result.isolatedRestoreProven,false);
assert.equal(result.independentBackupCreated,false);
assert.equal(result.customerRowsRead,false);
for(const secret of [token,accountId,preview,production,bookmark])assert.ok(!JSON.stringify(result).includes(secret));
mismatched=true;
assert.equal((await inspectD1Bindings(options)).checks.productionPreviewDbMatchesPreview,false);
mismatched=false;missingBookmark=true;
await assert.rejects(inspectD1Bindings(options),/bookmark unavailable/);
missingBookmark=false;denied=true;calls=[];
await assert.rejects(inspectD1Bindings(options),/Metadata request failed/);
assert.equal(calls.length,1,'Stop immediately when metadata access is denied');
console.log('PASS: GET-only binding identity and recovery metadata, mismatched bindings rejected, unavailable bookmarks rejected, no raw identifiers or secrets.');
