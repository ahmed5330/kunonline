/* Read-only release preflight: inspect secret NAMES only; never their values.
 * CLI requires an explicit Wrangler config and a Cloudflare CI token. */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const REQUIRED_AUTH_SECRETS=Object.freeze(['SESSION_SECRET','TOKEN_ENC_KEY']);
export function verifyWorkerSecretNames(raw,{required=REQUIRED_AUTH_SECRETS}={}){
  let entries;
  try{entries=JSON.parse(String(raw||''));}
  catch{throw Error('SECRET_NAME_PREFLIGHT_INVALID_JSON');}
  if(!Array.isArray(entries))throw Error('SECRET_NAME_PREFLIGHT_EXPECTED_ARRAY');
  // Wrangler returns {name, type}, NEVER {value}. Reject accidental value
  // collection so the preflight cannot become a secret exfiltration path.
  if(entries.some(item=>!item||typeof item!=='object'||typeof item.name!=='string'||('value' in item))){
    throw Error('SECRET_NAME_PREFLIGHT_INVALID_RESPONSE');
  }
  const names=new Set(entries.filter(x=>x.type==='secret_text'||x.type==='secret_key').map(x=>x.name));
  const missing=required.filter(name=>!names.has(name));
  if(missing.length)throw Error('SECRET_NAME_PREFLIGHT_MISSING:'+missing.join(','));
  return {ok:true,requiredCount:required.length,valuesInspected:false};
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  const config=process.argv[2];
  if(!['wrangler.production.toml','wrangler.preview.toml'].includes(config)){
    throw Error('Only the two existing effective backend Worker configs are permitted');
  }
  assert.ok(process.env.CLOUDFLARE_API_TOKEN,'Cloudflare token required for authenticated read-only secret list');
  const cmd=process.platform==='win32'?'npx.cmd':'npx';
  const child=spawnSync(cmd,['wrangler','secret','list','--config',config,'--format','json'],{
    encoding:'utf8',timeout:60000,maxBuffer:2_000_000,env:process.env
  });
  if(child.error||child.status!==0)throw Error('SECRET_NAME_PREFLIGHT_WRANGLER_FAILED: '+(child.error?.code||child.status));
  const result=verifyWorkerSecretNames(child.stdout);
  console.log('Required authentication/encryption secret names verified for '+config+' ('+result.requiredCount+' entries; no values returned).');
}
