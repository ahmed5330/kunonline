import {readFile,writeFile,unlink} from 'node:fs/promises';

const sourceUrl=new URL('./browser-preview-mobile-qa.mjs',import.meta.url);
const source=await readFile(sourceUrl,'utf8');

// The exhaustive 390px pass intentionally starts many asynchronous view loaders.
// A few of those can finish after the test switches to 360px and detach the old
// app shell, producing a false all-zero layout failure in an unrelated section.
// Re-enter the app once between viewport passes so each width is tested against a
// fresh document. This is a QA isolation patch only; production/browser code is
// not altered, and the runner fails loudly if the expected loop changes.
const needle=`  for(const [width,height] of [[390,844],[360,800]]){\n    await setViewport(width,height);`;
const replacement=`  for(const [width,height] of [[390,844],[360,800]]){\n    await setViewport(width,height);\n    if(tested.length){\n      await navigate(\`\${base}/v2/\`);\n      await waitFor(\`document.documentElement.dataset.mobileUx==='v88.2-ready'&&document.documentElement.dataset.permissionNavigation==='ready'&&document.getElementById('mobileMenuBtn')&&document.getElementById('root')\`,\`fresh mobile shell before \${width}px sweep\`,20000);\n      await sleep(650);\n    }`;
if(!source.includes(needle))throw new Error('Mobile QA viewport loop changed; refresh the isolation patch instead of silently skipping it');
const runtimeSource=source.replace(needle,replacement);
const nonce=`${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const runtimeUrl=new URL(`./browser-preview-mobile-qa.runtime-${nonce}.mjs`,import.meta.url);
await writeFile(runtimeUrl,runtimeSource,'utf8');
try{await import(runtimeUrl.href);}finally{await unlink(runtimeUrl).catch(()=>{});}
