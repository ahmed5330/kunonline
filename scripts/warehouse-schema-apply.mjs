import {execFileSync} from 'node:child_process';
if(!process.argv.includes('--check-only'))throw Error('Remote schema application is disabled; these are isolated test declarations, not a release migration queue');
execFileSync(process.execPath,['scripts/inventory-migrations-compatibility-test.mjs'],{stdio:'inherit'});
