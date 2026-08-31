const base=String(process.argv[2]||'https://kunonline-sync-preview.mr-a-mnaa.workers.dev').replace(/\/+$/,'');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const attempts=Math.max(1,Number(process.env.SYNC_SMOKE_ATTEMPTS||36));
const interval=Math.max(1000,Number(process.env.SYNC_SMOKE_INTERVAL_MS||5000));
let last=null;
for(let attempt=1;attempt<=attempts;attempt++){
  try{
    const response=await fetch(`${base}/healthz`,{headers:{Accept:'application/json'}}),data=await response.json().catch(()=>({}));
    last={status:response.status,data};
    if(response.ok&&data?.ok===true&&data?.service==='kunonline-sync-preview'&&data?.upstream?.ok===true&&data?.upstream?.service==='kunonline-sync-rpc'){
      console.log(`Sync Preview smoke passed: scheduler -> private RPC -> app (${data.build} -> ${data.upstream.build}) on attempt ${attempt}/${attempts}.`);
      process.exit(0);
    }
    if(attempt===1||attempt%6===0)console.log(`Sync RPC not ready yet (${attempt}/${attempts}): ${data?.code||response.status} ${data?.error||''}`.trim());
  }catch(error){last={error:error?.message||String(error)};if(attempt===1||attempt%6===0)console.log(`Sync RPC probe failed (${attempt}/${attempts}): ${last.error}`);}
  if(attempt<attempts)await sleep(interval);
}
throw new Error(`Sync Preview smoke failed after ${attempts} attempts: ${JSON.stringify(last).slice(0,1200)}`);
