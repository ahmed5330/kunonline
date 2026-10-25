import {pathToFileURL} from 'node:url';

export function fullTrafficVersion(input){
  let root=typeof input==='string'?JSON.parse(input):input;
  if(root?.result)root=root.result;
  if(Array.isArray(root)){
    if(root.length!==1)throw new Error('AMBIGUOUS_CURRENT_DEPLOYMENT');
    root=root[0];
  }
  if(Array.isArray(root?.deployments))root=root.deployments[0];
  const rows=root?.versions;
  if(!Array.isArray(rows)||!rows.length)throw new Error('DEPLOYMENT_VERSIONS_UNAVAILABLE');
  const versions=rows.map(row=>({
    id:row.version_id||row.versionId||row.id,
    percentage:row.percentage??row.traffic_percentage??row.trafficPercentage
  }));
  if(versions.some(x=>!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(x.id||'')||
    x.percentage===null||x.percentage===undefined||!Number.isFinite(Number(x.percentage))||Number(x.percentage)<0||Number(x.percentage)>100))
    throw new Error('INVALID_TRAFFIC_METADATA');
  if(new Set(versions.map(x=>x.id)).size!==versions.length)throw new Error('DUPLICATE_TRAFFIC_VERSION');
  const active=versions.filter(x=>Number(x.percentage)>0);
  if(active.length!==1||Number(active[0].percentage)!==100)throw new Error('WORKER_NOT_EXCLUSIVELY_OWNED');
  return active[0].id;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    let raw='';for await(const chunk of process.stdin)raw+=chunk;
    process.stdout.write(fullTrafficVersion(raw));
  }catch{console.error('WORKER_FULL_TRAFFIC_VERSION_UNAVAILABLE');process.exitCode=1;}
}
