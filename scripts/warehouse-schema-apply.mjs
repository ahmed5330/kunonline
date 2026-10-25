import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const config=readFileSync('wrangler.preview.toml','utf8');
if(!/^name\s*=\s*"kunonline-preview"/m.test(config)||!config.includes('31cd5cdf-fc01-42d7-ba1e-571f3dd58495'))throw Error('Canonical Preview inventory target mismatch');
for(const file of ['migrations/0092_inventory_unit_qr_tracking.sql','migrations/0093_inventory_scan_fulfillment_returns.sql','migrations/0094_warehouse_unit_operations.sql']){
 const sql=readFileSync(file,'utf8');
 if(/\b(?:DROP\s|ALTER\s|INSERT\s+INTO\s|DELETE\s+FROM\s|UPDATE\s+(?:products|product_variants|inventory_batch_items)\b)/i.test(sql))throw Error('Inventory schema must be additive only: '+file);
 if(process.argv.includes('--check-only'))continue;
 execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','kunonline-preview','--remote','--config','wrangler.preview.toml','--file',file],{stdio:'inherit'});
}
console.log(process.argv.includes('--check-only')?'Canonical inventory schema safety check passed.':'Additive inventory schema applied to canonical Preview; no stock DML executed.');
