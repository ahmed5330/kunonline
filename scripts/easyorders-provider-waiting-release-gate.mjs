import {pathToFileURL} from 'node:url';
export async function verifyProviderWaitingReader({fetcher=fetch}={}){
  const response=await fetcher('https://app.kun-online.com/health/easyorders-sync',{
    method:'GET',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'Cache-Control':'no-cache'}});
  const payload=await response.json().catch(()=>null);
  if(!response.ok||payload?.ok!==true||payload?.supportsProviderWaitingState!==true)
    throw Error('EASYORDERS_PROVIDER_WAITING_READER_NOT_READY');
  return {ok:true,supportsProviderWaitingState:true};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{console.log(JSON.stringify(await verifyProviderWaitingReader()));}
  catch{console.error('EASYORDERS_PROVIDER_WAITING_READER_NOT_READY');process.exitCode=1;}
}
