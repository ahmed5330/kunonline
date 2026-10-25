import {pathToFileURL} from 'node:url';
const requiredSteps=[
  'Attest newly deployed Production Worker version',
  'Verify live branded dashboard and isolated daisyUI design preview',
  'Verify live Campaign comparison assets',
  'Verify live dashboard Easy Orders source and warning'
];
export function productionWorkerReadyForAndroid(run,jobs,{sha,currentHead}){
  if(currentHead!==sha)throw Error('ANDROID_RELEASE_MAIN_HEAD_CHANGED');
  if(run?.head_sha!==sha||run?.path!=='.github/workflows/production.yml')return false;
  if(run.conclusion&&run.conclusion!=='success')throw Error('ANDROID_RELEASE_PRODUCTION_RUN_FAILED');
  const job=jobs.find(x=>x.name==='deploy');
  if(!job)return false;
  if(job.conclusion&&job.conclusion!=='success'||job.steps?.some(x=>x.conclusion==='failure'))
    throw Error('ANDROID_RELEASE_PRODUCTION_JOB_FAILED');
  // Waiting for the entire job would deadlock its checks of the new APK.
  // Require the server deployment and independent live checks before publishing.
  return requiredSteps.every(name=>job.steps?.some(x=>x.name===name&&x.conclusion==='success'));
}
async function main(){
  const repo=process.env.GITHUB_REPOSITORY,sha=process.env.GITHUB_SHA,token=process.env.GH_TOKEN;
  if(repo!=='ahmed5330/kunonline'||process.env.GITHUB_REF!=='refs/heads/main'||!token||!/^[a-f0-9]{40}$/i.test(sha||''))
    throw Error('ANDROID_RELEASE_GATE_RUNTIME_UNAVAILABLE');
  async function get(path){
    const response=await fetch(`https://api.github.com/repos/${repo}/${path}`,{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}});
    if(!response.ok)throw Error('ANDROID_RELEASE_GATE_METADATA_UNAVAILABLE');
    return response.json();
  }
  const deadline=Date.now()+15*60*1000;
  while(Date.now()<deadline){
    const head=await get('git/ref/heads/main');
    if(head.object?.sha!==sha)throw Error('ANDROID_RELEASE_MAIN_HEAD_CHANGED');
    const result=await get(`actions/workflows/production.yml/runs?head_sha=${sha}&per_page=20`);
    const run=result.workflow_runs?.filter(x=>x.head_sha===sha&&x.path==='.github/workflows/production.yml')
      .sort((a,b)=>b.id-a.id)[0];
    if(run){
      const result=await get(`actions/runs/${run.id}/jobs?filter=latest&per_page=100`);
      if(productionWorkerReadyForAndroid(run,result.jobs||[],{sha,currentHead:head.object.sha})){
        // A later Main push cannot authorize this run's APK publication.
        const latest=await get('git/ref/heads/main');
        if(latest.object?.sha!==sha)throw Error('ANDROID_RELEASE_MAIN_HEAD_CHANGED');
        console.log(JSON.stringify({productionWorkerGatePassed:true,sourceSha:sha,productionRun:run.id,apkPublished:false}));
        return;
      }
    }
    console.log('Waiting for the same Main commit to pass Production Worker attestation and independent live checks.');
    await new Promise(resolve=>setTimeout(resolve,20000));
  }
  throw Error('ANDROID_RELEASE_PRODUCTION_GATE_TIMEOUT');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)
  main().catch(e=>{console.error(/^[A-Z0-9_]+$/.test(e?.message||'')?e.message:'ANDROID_RELEASE_GATE_FAILED');process.exitCode=1;});
