import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const root=new URL('../',import.meta.url);
const plugin=JSON.parse(fs.readFileSync(new URL('../plugins/kun-online/plugin.json',import.meta.url),'utf8'));
const config=JSON.parse(fs.readFileSync(new URL('../plugins/kun-online/mcp.json',import.meta.url),'utf8'));
if(plugin.name!=='kun-online'||plugin.extensions?.['com.openai']?.interface?.displayName!=='Kun Online')throw Error('Plugin listing is incomplete');
const server=config.mcpServers?.['kun-online'];
if(server?.url!=='https://app.kun-online.com/mcp'||server?.extensions?.['com.openai']?.auth?.client?.mode!=='cimd'||server?.extensions?.['com.openai']?.auth?.type!=='oauth')throw Error('MCP provider/authorization metadata mismatch');
if(server.extensions['com.openai'].auth.baseScopes?.join(',')!=='kun:read')throw Error('Public plugin must remain read-only');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'kun-plugin-'));
try{
 const asset=path.join(directory,'assets');fs.mkdirSync(asset,{recursive:true});
 for(const name of ['plugin.json','mcp.json'])fs.copyFileSync(new URL('../plugins/kun-online/'+name,import.meta.url),path.join(directory,name));
 fs.copyFileSync(new URL('../public/logo.png',import.meta.url),path.join(asset,'logo.png'));
 if(fs.statSync(path.join(asset,'logo.png')).size<1000)throw Error('Kun Online logo asset missing');
 const dist=new URL('../dist/',import.meta.url).pathname;
 fs.mkdirSync(dist,{recursive:true});
 const target=path.join(dist,'kun-online-chatgpt-plugin-draft.zip');
 execFileSync('zip',['-q','-r',target,'plugin.json','mcp.json','assets'],{cwd:directory});
 console.log('Prepared draft ChatGPT plugin ZIP: '+target);
 console.log('Submission still requires verified developer, live legal policy/terms, domain verification and successful ChatGPT OAuth scan.');
}finally{fs.rmSync(directory,{recursive:true,force:true});}
