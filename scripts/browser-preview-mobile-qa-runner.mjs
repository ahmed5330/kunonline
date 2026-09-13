import {readFile,writeFile,rm} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {dirname,join} from 'node:path';

const sourceUrl=new URL('./browser-preview-mobile-qa.mjs',import.meta.url);
const sourcePath=fileURLToPath(sourceUrl);
const source=await readFile(sourcePath,'utf8');
const needle="a.addEventListener('click',event=>event.preventDefault(),{once:true});";
const replacement="window.addEventListener('click',event=>{if(event.target===a||event.target.closest?.('[data-cs-action=\"call\"]')===a)event.preventDefault();},{capture:true,once:true});";
const matches=source.split(needle).length-1;
if(matches!==1)throw new Error(`Mobile QA tel interception patch expected exactly one target listener, found ${matches}`);
const patched=source.replace(needle,replacement);
const runtimePath=join(dirname(sourcePath),`.browser-preview-mobile-qa-runtime-${process.pid}-${Date.now()}.mjs`);
try{
  await writeFile(runtimePath,patched,'utf8');
  await import(`${pathToFileURL(runtimePath).href}?runtime=${Date.now()}`);
}finally{
  await rm(runtimePath,{force:true}).catch(()=>{});
}
