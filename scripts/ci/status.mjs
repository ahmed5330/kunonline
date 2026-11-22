import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
const repo=JSON.parse(readFileSync(new URL('./commands.json',import.meta.url),'utf8')).repository;
if(!/^ahmed5330\/[a-z0-9-]+$/.test(repo))throw Error('Unexpected repository');
async function get(path){
 const response=await fetch('https://api.github.com/repos/'+repo+path,{headers:{Accept:'application/vnd.github+json',...(process.env.CI_GITHUB_TOKEN?{Authorization:'Bearer '+process.env.CI_GITHUB_TOKEN}:{})},signal:AbortSignal.timeout(30000)});
 if(!response.ok)return {unavailable:true,http:response.status};
 return response.json();
}
const [runs,prs,deployments]=await Promise.all([get('/actions/runs?per_page=100'),get('/pulls?state=open&per_page=100'),get('/deployments?per_page=20')]);
let local=null;
if(existsSync('.ci-status/verification.json'))local=JSON.parse(readFileSync('.ci-status/verification.json','utf8'));
const report={checkedAt:new Date().toISOString(),repository:repo,
 lastSuccessfulAction:runs.workflow_runs?.find(x=>x.conclusion==='success')||null,
 latestActions:runs.workflow_runs?.slice(0,10).map(x=>({sha:x.head_sha,name:x.name,conclusion:x.conclusion,url:x.html_url}))||runs,
 pendingPullRequests:Array.isArray(prs)?prs.map(x=>({number:x.number,title:x.title,head:x.head.sha,base:x.base.ref,draft:x.draft,url:x.html_url})):prs,
 providerDeployments:Array.isArray(deployments)?deployments.map(x=>({id:x.id,sha:x.sha,environment:x.environment,statusesUrl:x.statuses_url})):deployments,
 localVerification:local,
 productionVerified:false,rollbackVerified:false,
 ciUsage:{source:'GitHub billing UI/API required; workflow durations are not billed compute or storage totals'},
 limitations:['Last successful Action is searched within 100 recent runs only.','Provider deployment records do not prove the production URL serves that SHA.','Release readiness requires successful exact-SHA build, isolated feature tests, deployment and post-deploy smoke.']};
mkdirSync('.ci-status',{recursive:true});writeFileSync('.ci-status/status.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({repository:repo,checkedAt:report.checkedAt,productionVerified:false,pending:Array.isArray(prs)?prs.length:'unavailable'}));
