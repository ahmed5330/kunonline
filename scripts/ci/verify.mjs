import {spawnSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
process.chdir(root);
const mode=process.argv[2]||'full';
if(!['quick','full'].includes(mode))throw Error('Usage: node scripts/ci/verify.mjs quick|full');
const config=JSON.parse(readFileSync('scripts/ci/commands.json','utf8'));
const run=(argv)=>spawnSync(argv[0],argv.slice(1),{cwd:root,stdio:'inherit',shell:false,timeout:20*60*1000});
function command(argv){
 if(argv[0]==='node')return [process.execPath,...argv.slice(1)];
 if(argv[0]==='npm'&&process.platform==='win32'){
  const cli=resolve(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
  if(!existsSync(cli))throw Error('npm CLI missing beside Node. Use Linux/WSL or install official Node with npm.');
  return [process.execPath,cli,...argv.slice(1)];
 }
 return argv;
}
const git=(...args)=>spawnSync('git',args,{cwd:root,encoding:'utf8',shell:false});
const head=git('rev-parse','HEAD');
if(head.status!==0)throw Error('Run from a Git checkout so verification is tied to an exact commit.');
const sha=head.stdout.trim();
mkdirSync('.ci-status',{recursive:true});
const report={schema:1,sha,mode,startedAt:new Date().toISOString(),steps:[],verificationPassed:false,fullBuildPassed:false,deploymentVerified:false};
let failed=false;
try{
 const steps=[...(mode==='full'?config.install:[]),...config[mode]];
 if(!steps.length)throw Error('No verification commands configured.');
 for(const argv of steps){
  const started=Date.now();
  const result=run(command(argv));
  report.steps.push({command:argv,durationMs:Date.now()-started,exitCode:result.status,error:result.error?.code||null,signal:result.signal||null});
  if(result.error||result.status!==0){failed=true;break;}
 }
 const end=git('rev-parse','HEAD');
 const dirty=git('status','--porcelain','--untracked-files=normal');
 if(end.status!==0||dirty.status!==0)throw Error('Unable to verify final checkout identity.');
 report.checkoutChanged=end.stdout.trim()!==sha;
 report.dirty=dirty.stdout.split(/\r?\n/).filter(Boolean).filter(x=>!x.slice(3).startsWith('.ci-status/')).length>0;
 report.verificationPassed=!failed&&!report.checkoutChanged;
 report.fullBuildPassed=report.verificationPassed&&mode==='full';
 report.releaseCandidate=report.fullBuildPassed&&!report.dirty;
}catch(error){report.error=String(error.message);failed=true;}
finally{
 report.finishedAt=new Date().toISOString();
 writeFileSync('.ci-status/verification.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({sha,mode,verificationPassed:report.verificationPassed,fullBuildPassed:report.fullBuildPassed,releaseCandidate:report.releaseCandidate||false,deploymentVerified:false}));
}
process.exitCode=failed||!report.verificationPassed?1:0;
