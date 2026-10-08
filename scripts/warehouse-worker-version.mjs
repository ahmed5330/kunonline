import {execFileSync} from 'node:child_process';
const raw=execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','deployments','status','--config','wrangler.preview.toml','--json'],{encoding:'utf8'}),hits=[];
function walk(x){if(Array.isArray(x)){x.forEach(walk);return;}if(!x||typeof x!=='object')return;const id=x.version_id||x.versionId,pct=x.percentage??x.traffic_percentage??x.trafficPercentage;if(id)hits.push({id:String(id),pct:pct==null?null:Number(pct)});Object.values(x).forEach(walk);}
walk(JSON.parse(raw));const unique=[...new Map(hits.map(x=>[x.id,x])).values()],full=unique.find(x=>x.pct===100||x.pct===1)||(unique.length===1?unique[0]:null);if(!full)throw new Error('Cannot determine a single active Preview Worker version');process.stdout.write(full.id);
