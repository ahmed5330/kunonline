import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const base=(process.argv[2]||'').replace(/\/$/,'');
if(!base)throw new Error('Usage: node scripts/smoke-test-current-preview.mjs <base-url>');

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const repoRoot=fileURLToPath(new URL('../',import.meta.url));
const config=await readFile(new URL('../wrangler.preview.toml',import.meta.url),'utf8');
const entrypoint=config.match(/^\s*main\s*=\s*"([^"]+)"/m)?.[1];
if(!entrypoint)throw new Error('Could not resolve Preview entrypoint from wrangler.preview.toml');

const importSpecs=source=>[...source.matchAll(/\b(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"](\.\.?\/[^'"]+)['"]/g)].map(match=>match[1]);
async function resolveVersionOwner(start){
  const queue=[path.resolve(repoRoot,start)],seen=new Set();
  while(queue.length){
    const filename=queue.shift();
    if(seen.has(filename))continue;seen.add(filename);
    let source='';try{source=await readFile(filename,'utf8');}catch{continue;}
    const build=source.match(/const\s+BUILD\s*=\s*['"]([^'"]+)['"]/i)?.[1]||'';
    if(source.includes('/api/preview/version')&&build){
      return {filename,build,entrypoint:path.basename(filename)};
    }
    for(const spec of importSpecs(source)){
      let child=path.resolve(path.dirname(filename),spec);
      if(!path.extname(child))child+='.js';
      if(child.startsWith(repoRoot))queue.push(child);
    }
  }
  return null;
}

const owner=await resolveVersionOwner(entrypoint);
if(!owner)throw new Error(`Could not resolve /api/preview/version owner and BUILD from dependency graph rooted at ${entrypoint}`);
const expectedBuild=owner.build;
const expectedEntrypoint=owner.entrypoint;
console.log(`Resolved Preview version owner: ${expectedEntrypoint} / ${expectedBuild} (root ${entrypoint})`);

let last='not requested';
for(let attempt=1;attempt<=48;attempt++){
  try{
    const response=await fetch(`${base}/api/preview/version?currentSmoke=${Date.now()}-${attempt}`,{
      redirect:'follow',
      headers:{'Cache-Control':'no-cache','Accept':'application/json'}
    });
    const body=await response.text();
    let data=null;try{data=JSON.parse(body)}catch{}
    if(response.ok&&data?.build===expectedBuild&&data?.entrypoint===expectedEntrypoint&&data?.environment==='preview'){
      console.log(`✓ Exact Preview candidate is live: ${data.entrypoint} / ${data.build}`);
      const health=await fetch(`${base}/healthz?currentSmoke=${Date.now()}`,{headers:{'Cache-Control':'no-cache','Accept':'application/json'}});
      const healthData=await health.json().catch(()=>({}));
      if(!health.ok||healthData?.ok!==true||healthData?.environment!=='preview'||healthData?.database!=='reachable'){
        throw new Error(`Preview health invalid: HTTP ${health.status} ${JSON.stringify(healthData)}`);
      }
      console.log('✓ Preview health and D1 reachability confirmed');
      process.exit(0);
    }
    last=`HTTP ${response.status}; build=${data?.build||'invalid'}; entrypoint=${data?.entrypoint||'invalid'}; environment=${data?.environment||'invalid'}`;
  }catch(error){last=error?.message||String(error)}
  if(attempt<48)await sleep(500);
}
throw new Error(`Current Preview candidate did not propagate. Expected root=${entrypoint}, versionOwner=${expectedEntrypoint}, build=${expectedBuild}; last=${last}`);
