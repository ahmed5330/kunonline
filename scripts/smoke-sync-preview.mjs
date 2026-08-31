const base=String(process.argv[2]||'https://kunonline-sync-preview.mr-a-mnaa.workers.dev').replace(/\/+$/,'');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let last=null;
for(let attempt=1;attempt<=8;attempt++){
  try{
    const response=await fetch(`${base}/healthz`,{headers:{Accept:'application/json'}}),data=await response.json().catch(()=>({}));
    last={status:response.status,data};
    if(response.ok&&data?.ok===true&&data?.service==='kunonline-sync-preview'&&data?.upstream?.ok===true&&data?.upstream?.service==='kunonline-sync-rpc'){
      console.log(`Sync Preview smoke passed: scheduler -> private RPC -> app (${data.build} -> ${data.upstream.build}).`);
      process.exit(0);
    }
  }catch(error){last={error:error?.message||String(error)};}
  if(attempt<8)await sleep(3000);
}
throw new Error(`Sync Preview smoke failed: ${JSON.stringify(last).slice(0,1200)}`);
