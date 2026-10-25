import {createHash} from 'node:crypto';

const expectedPreview='31cd5cdf-fc01-42d7-ba1e-571f3dd58495';
const expectedProduction='c426601d-182f-486e-a5c1-bb1bca0ecb0b';
const fingerprint=value=>createHash('sha256').update(value).digest('hex');

// Control-plane metadata only. No SQL, export, restore, deployment or provider requests.
export async function inspectD1Bindings({accountId,token,fetcher=fetch}={}){
  if(!/^[a-f0-9]{32}$/i.test(accountId||'')||!token)throw new Error('Credentials unavailable');
  const httpChecks=[];
  async function get(path,label){
    const response=await fetcher(`https://api.cloudflare.com/client/v4/accounts/${accountId}/${path}`,{
      method:'GET',redirect:'error',signal:AbortSignal.timeout(10000),
      headers:{Authorization:`Bearer ${token}`,Accept:'application/json'}
    });
    let payload;
    if(response.ok)try{payload=await response.json();}catch{}
    const ok=response.ok&&payload?.success===true;
    httpChecks.push({label,httpStatus:response.status,ok});
    if(!ok)throw new Error('Metadata request failed');
    return payload.result;
  }
  const workers={};
  const databaseIds=new Set();
  for(const worker of ['kunonline','kunonline-preview']){
    const result=await get(`workers/scripts/${worker}/settings`,`${worker} settings`);
    const bindings=result?.bindings||result?.settings?.bindings;
    if(!Array.isArray(bindings))throw new Error('Worker bindings unavailable');
    workers[worker]=[];
    for(const binding of bindings.filter(x=>x.type==='d1')){
      const id=binding.id;
      if(!/^[a-f0-9-]{36}$/i.test(id||''))throw new Error('D1 identity unavailable');
      databaseIds.add(id);
      workers[worker].push({binding:binding.name,databaseFingerprint:fingerprint(id),
        matchesRepositoryPreview:id===expectedPreview,matchesRepositoryProduction:id===expectedProduction});
    }
  }
  const databases=[];
  for(const id of databaseIds){
    const info=await get(`d1/database/${id}`,'bound D1 metadata');
    if(info.uuid!==id)throw new Error('D1 metadata identity mismatch');
    const bookmark=await get(`d1/database/${id}/time_travel/bookmark`,'bound D1 recovery bookmark');
    const value=typeof bookmark==='string'?bookmark:bookmark?.bookmark;
    if(typeof value!=='string'||!value.trim())throw new Error('Recovery bookmark unavailable');
    databases.push({databaseFingerprint:fingerprint(id),version:info.version||null,
      fileSizeBytes:Number.isFinite(info.file_size)?info.file_size:null,
      recoveryBookmarkPresent:true,recoveryBookmarkFingerprint:fingerprint(value),
      independentBackupCreated:false,isolatedRestoreProven:false});
  }
  const preview=workers['kunonline-preview'].find(x=>x.binding==='DB');
  const productionPreview=workers.kunonline.find(x=>x.binding==='PREVIEW_DB');
  const checks={previewDbMatchesRepository:preview?.matchesRepositoryPreview===true,
    productionDbMatchesRepository:workers.kunonline.find(x=>x.binding==='DB')?.matchesRepositoryProduction===true,
    productionPreviewDbMatchesPreview:!!preview&&!!productionPreview&&preview.databaseFingerprint===productionPreview.databaseFingerprint,
    allBoundDatabasesHaveRecoveryBookmark:databases.length>0&&databases.every(x=>x.recoveryBookmarkPresent)};
  return {kind:'D1_BINDING_AND_RECOVERY_METADATA_ONLY',testedAt:new Date().toISOString(),
    checks,passesMetadataGate:Object.values(checks).every(Boolean),workers,databases,httpChecks,
    customerRowsRead:false,cloudflareMutated:false,independentBackupCreated:false,isolatedRestoreProven:false};
}

if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  try{
    const result=await inspectD1Bindings({accountId:process.env.CLOUDFLARE_ACCOUNT_ID,token:process.env.CLOUDFLARE_API_TOKEN});
    console.log(JSON.stringify(result,null,2));
    if(!result.passesMetadataGate)process.exitCode=1;
  }catch(error){
    console.error(JSON.stringify({ok:false,code:'D1_METADATA_UNAVAILABLE',category:error?.name||'Error',customerRowsRead:false,cloudflareMutated:false}));
    process.exitCode=1;
  }
}
