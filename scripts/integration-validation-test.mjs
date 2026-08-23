import {readFile} from 'node:fs/promises';
const worker=await readFile(new URL('../src/index-commerce-v19.js',import.meta.url),'utf8');
const must=(ok,msg)=>{if(!ok)throw new Error(msg)};
for(const marker of ['/validate','requiredSecrets','integration_secrets','externalConnectivityChecked:false'])must(worker.includes(marker),`Integration validation missing ${marker}`);
must(worker.includes("requirePermission(m,'integrations','write')"),'Validation must require integrations.write');
must(worker.includes('WHERE id=? AND client_id=?'),'Validation must be tenant scoped');
console.log('Integration validation checks passed.');
