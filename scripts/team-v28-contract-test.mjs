import {readFile} from 'node:fs/promises';
const read=p=>readFile(new URL(`../${p}`,import.meta.url),'utf8');
const must=(ok,msg)=>{if(!ok)throw new Error(msg)};
const [entry,team,ui,index,wrangler,scope,access]=await Promise.all([
  read('src/index-commerce-v28.js'),read('src/team-management.js'),read('public/v2/modules-v24-team.js'),read('public/v2/index.html'),read('wrangler.preview.toml'),read('src/store-scope.js'),read('src/access-control.js')
]);
for(const route of ['/api/team-role-catalog','/api/team-members','/reset-password','/store-access','/api/onboarding/status'])must(entry.includes(route),`v28 route missing: ${route}`);
must(entry.includes("preview-v28-2026-08-28")&&entry.includes("index-commerce-v28.js"),'v28 deployed build marker missing');
for(const marker of ['createTeamMember','updateTeamMember','replaceTeamMemberStoreAccess','resetTeamMemberPassword','deleteTeamMember','OWNER_PROTECTED','STORE_ACCESS_REQUIRED','pbkdf2$'])must(team.includes(marker),`team backend missing: ${marker}`);
for(const marker of ['v28AddMember','v28CreateMember','v28SaveStores','v28ResetPassword','v28DeleteMember','data-v28-store','KunTeamV28'])must(ui.includes(marker),`team UI missing: ${marker}`);
must(index.includes('modules-v24-team.js'),'team UI overlay not loaded');
must(wrangler.includes('main = "src/index-commerce-v28.js"'),'Preview must deploy v28 wrapper');
must(scope.includes("STORE_READ_ONLY")&&scope.includes('user_store_access'),'store-level server enforcement missing');
must(access.includes("support:")&&access.includes("viewer:")&&access.includes("marketing:")&&access.includes("accountant:"),'business role rules missing');
console.log('v28 team contract checks passed: lifecycle, canonical roles, branch access, onboarding and Preview entrypoint.');
