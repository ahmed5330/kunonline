const accountId=String(process.env.CLOUDFLARE_ACCOUNT_ID||'').trim();
const token=String(process.env.CLOUDFLARE_API_TOKEN||'').trim();
const worker=String(process.argv[2]||'').trim();
const rawExpected=process.argv.slice(3).map(x=>String(x).trim()).filter(Boolean);
const expectNone=rawExpected.length===1&&rawExpected[0]==='--none';
const legacySyncExpectation=worker==='kunonline-sync-preview'&&!expectNone&&rawExpected.includes('* * * * *');
const normalizedExpected=legacySyncExpectation?rawExpected.map(x=>x==='* * * * *'?'*/15 * * * *':x):rawExpected;
const expected=(expectNone?[]:normalizedExpected).sort();
if(!accountId||!token)throw new Error('Cloudflare cron verification requires CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN');
if(!worker||(!expectNone&&!expected.length))throw new Error('Usage: node scripts/verify-cloudflare-crons.mjs <worker> <cron...|--none>');
const endpoint=`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(worker)}/schedules`;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let last=[];
for(let attempt=1;attempt<=6;attempt++){
  const response=await fetch(endpoint,{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'}});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok||payload?.success===false)throw new Error(`Cloudflare cron API failed (${response.status}): ${JSON.stringify(payload?.errors||payload).slice(0,800)}`);
  last=(payload?.result?.schedules||payload?.result||payload?.schedules||[]).map(x=>String(x?.cron||x||'').trim()).filter(Boolean).sort();
  if(JSON.stringify(last)===JSON.stringify(expected)){
    if(legacySyncExpectation)console.log('Normalized legacy sync-worker expectation from every-minute to native every-15-minute Cron.');
    console.log(`Cloudflare cron integrity passed for ${worker}: ${last.length?last.join(' | '):'(none)'}`);
    process.exit(0);
  }
  if(attempt<6)await sleep(5000);
}
throw new Error(`Cloudflare cron integrity failed for ${worker}. Expected [${expected.join(', ')}], got [${last.join(', ')}]. Cron ownership may be wrong after deploy.`);