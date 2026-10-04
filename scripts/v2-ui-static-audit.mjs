import fs from 'node:fs';
import path from 'node:path';

const ROOT='public/v2';
const methods='(?:forEach|map|filter|some|every|find)';
const issues=[];

function walk(dir){
  const out=[];
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const full=path.join(dir,entry.name);
    if(entry.isDirectory())out.push(...walk(full));
    else if(entry.isFile()&&entry.name.endsWith('.js'))out.push(full);
  }
  return out;
}

for(const file of walk(ROOT)){
  const src=fs.readFileSync(file,'utf8');
  try{new Function(src);}catch(error){
    issues.push(`${file}: syntax error: ${error.message}`);
    continue;
  }
  const dollarIsSingleSelector=
    /const\s+\$\s*=\s*[^;\n]{0,260}querySelector/.test(src) ||
    /function\s+\$\s*\([^)]*\)\s*\{[^}]{0,260}querySelector/.test(src);
  const lines=src.split('\n');
  lines.forEach((line,index)=>{
    if(dollarIsSingleSelector){
      const rx=new RegExp(`(?<!\\$)\\$\\([^;\\n]*?\\)\\.${methods}\\s*\\(`);
      if(rx.test(line))issues.push(`${file}:${index+1}: single-element $() used with collection method: ${line.trim().slice(0,220)}`);
    }
    const direct=new RegExp(`(?:document\\.)?querySelector\\([^;\\n]*?\\)\\.${methods}\\s*\\(`);
    if(direct.test(line))issues.push(`${file}:${index+1}: querySelector used with collection method: ${line.trim().slice(0,220)}`);
    const byId=new RegExp(`getElementById\\([^;\\n]*?\\)\\.${methods}\\s*\\(`);
    if(byId.test(line))issues.push(`${file}:${index+1}: getElementById used with collection method: ${line.trim().slice(0,220)}`);
  });
}

if(issues.length){
  console.error('V2 UI static audit failed:');
  for(const issue of issues)console.error('- '+issue);
  process.exit(1);
}
console.log('V2 UI static audit: ok');
