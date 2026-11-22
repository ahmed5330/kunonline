import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,writeFileSync,readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
function fixture(steps){
 mkdirSync('.ci-status',{recursive:true});
 const root=mkdtempSync(resolve('.ci-status/fixture-'));
 mkdirSync(root+'/scripts/ci',{recursive:true});
 copyFileSync('scripts/ci/verify.mjs',root+'/scripts/ci/verify.mjs');
 writeFileSync(root+'/scripts/ci/commands.json',JSON.stringify({install:[],quick:steps,full:steps}));
 writeFileSync(root+'/.gitignore','.ci-status/\n');
 for(const args of [['init'],['add','.'],['-c','user.name=CI Test','-c','user.email=ci@example.invalid','commit','-m','fixture']]){
  const r=spawnSync('git',args,{cwd:root,encoding:'utf8'});assert.equal(r.status,0,r.stderr);
 }
 return root;
}
test('failure halts later commands and cannot produce a release candidate',()=>{
 const root=fixture([['node','-e','process.exit(7)'],['node','-e',"require('fs').writeFileSync('should-not-run','x')"]]);
 const r=spawnSync(process.execPath,['scripts/ci/verify.mjs','full'],{cwd:root,encoding:'utf8'});
 assert.equal(r.status,1,r.stderr);const report=JSON.parse(readFileSync(root+'/.ci-status/verification.json'));
 assert.equal(report.steps.length,1);assert.equal(report.steps[0].exitCode,7);assert.equal(report.fullBuildPassed,false);
});
test('successful quick check never claims a full build or deployment',()=>{
 const root=fixture([['node','-e','process.exit(0)']]);
 const r=spawnSync(process.execPath,['scripts/ci/verify.mjs','quick'],{cwd:root,encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);const report=JSON.parse(readFileSync(root+'/.ci-status/verification.json'));
 assert.equal(report.verificationPassed,true);assert.equal(report.fullBuildPassed,false);assert.equal(report.deploymentVerified,false);
});
test('uncommitted source invalidates release candidacy even after successful commands',()=>{
 const root=fixture([['node','-e','process.exit(0)']]);writeFileSync(root+'/unreviewed-source.js','export default 1');
 const r=spawnSync(process.execPath,['scripts/ci/verify.mjs','full'],{cwd:root,encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);const report=JSON.parse(readFileSync(root+'/.ci-status/verification.json'));
 assert.equal(report.dirty,true);assert.equal(report.releaseCandidate,false);assert.equal(report.deploymentVerified,false);
});

