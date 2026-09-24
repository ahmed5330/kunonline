import {readFile,writeFile,unlink} from 'node:fs/promises';

const sourceUrl=new URL('./browser-preview-mobile-qa.mjs',import.meta.url);
const source=await readFile(sourceUrl,'utf8');

// The collaboration route is injected after the static grouped navigation. Guard the real
// phone navigation so a working chat API cannot ship with an invisible sidebar entry.
const navNeedle=`  await navigate(\`${'${base}'}/v2/\`);await waitFor(\`document.documentElement.dataset.mobileUx==='v88.2-ready'&&window.KunMobileUXV88?.version==='88.2'&&document.getElementById('mobileMenuBtn')&&document.getElementById('root')\`,'mobile UX v88.2 ready',20000);await sleep(700);`;
const navReplacement=`${navNeedle}\n  await waitFor(\`document.documentElement.dataset.collaborationSidebar==='ready'&&document.querySelector('.nav > button[data-view="collaboration"]')\`,'collaboration standalone sidebar route',12000);\n  const collaborationNav=await evalJs(\`(()=>{const button=document.querySelector('.nav > button[data-view="collaboration"]');if(!button)return null;const style=getComputedStyle(button),rect=button.getBoundingClientRect();return {label:(button.querySelector('.nav-item-label')?.textContent||'').trim(),display:style.display,visibility:style.visibility,hidden:button.hidden,width:rect.width,height:rect.height,parent:button.parentElement?.className||'',standalone:button.classList.contains('nav-standalone')};})()\`);\n  if(!collaborationNav||collaborationNav.label!=='تواصل الفريق'||collaborationNav.hidden||collaborationNav.display==='none'||collaborationNav.visibility==='hidden'||collaborationNav.width<20||collaborationNav.height<20||!collaborationNav.standalone)throw new Error(\`Mobile collaboration sidebar route is not visibly standalone: \${JSON.stringify(collaborationNav)}\`);`;
if(!source.includes(navNeedle))throw new Error('Mobile QA shell bootstrap changed; refresh the collaboration standalone sidebar route guard');
const sourceWithNavCheck=source.replace(navNeedle,navReplacement);

// The exhaustive 390px pass intentionally starts many asynchronous view loaders.
// A few of those can finish after the test switches to 360px and detach the old
// app shell, producing a false all-zero layout failure in an unrelated section.
// Re-enter the app once between viewport passes so each width is tested against a
// fresh document. This is a QA isolation patch only; production/browser code is
// not altered, and the runner fails loudly if the expected loop changes.
const needle=`  for(const [width,height] of [[390,844],[360,800]]){\n    await setViewport(width,height);`;
const replacement=`  for(const [width,height] of [[390,844],[360,800]]){\n    await setViewport(width,height);\n    if(tested.length){\n      await navigate(\`\${base}/v2/\`);\n      await waitFor(\`document.documentElement.dataset.mobileUx==='v88.2-ready'&&document.documentElement.dataset.permissionNavigation==='ready'&&document.getElementById('mobileMenuBtn')&&document.getElementById('root')\`,\`fresh mobile shell before \${width}px sweep\`,20000);\n      await sleep(650);\n    }`;
if(!sourceWithNavCheck.includes(needle))throw new Error('Mobile QA viewport loop changed; refresh the isolation patch instead of silently skipping it');
const runtimeSource=sourceWithNavCheck.replace(needle,replacement);
const nonce=`${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const runtimeUrl=new URL(`./browser-preview-mobile-qa.runtime-${nonce}.mjs`,import.meta.url);
await writeFile(runtimeUrl,runtimeSource,'utf8');
try{await import(runtimeUrl.href);}finally{await unlink(runtimeUrl).catch(()=>{});}
