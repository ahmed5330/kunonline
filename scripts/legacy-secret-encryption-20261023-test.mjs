/* Isolated legacy account-state secret storage regression. No real D1/network. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../src/index.js',import.meta.url),'utf8');
const cryptoApi=globalThis.crypto;
assert.ok(cryptoApi?.subtle,'WebCrypto is required for encryption QA');
const encBegin=source.indexOf('async function encKeyFrom(env)');
const encEnd=source.indexOf('/** آخر ٤ حروف',encBegin);
assert.ok(encBegin>0&&encEnd>encBegin,'extract real production encryption functions');
const bytesToB64=bytes=>Buffer.from(bytes).toString('base64');
const bytesFromB64=s=>new Uint8Array(Buffer.from(s,'base64'));
const {encryptSecret,decryptSecret}=new Function(
  'crypto','TextEncoder','TextDecoder','toB64','fromB64',
  source.slice(encBegin,encEnd)+'\nreturn {encryptSecret,decryptSecret};'
)(cryptoApi,TextEncoder,TextDecoder,bytesToB64,bytesFromB64);
const stateBegin=source.indexOf('const SECRET_FIELDS = ');
const stateEnd=source.indexOf('const ORDER_COLS = ',stateBegin);
assert.ok(stateBegin>0&&stateEnd>stateBegin,'extract real production account-state writers');
const {saveState,loadState}=new Function(
  'encryptSecret','decryptSecret','maskTail',
  source.slice(stateBegin,stateEnd)+'\nreturn {saveState,loadState};'
)(encryptSecret,decryptSecret,()=>null);

const makeEnv=TOKEN_ENC_KEY=>{
  let stateRow=null;
  const writes=[];
  return {
    TOKEN_ENC_KEY,
    writes,
    DB:{
      prepare(sql){
        if(sql.includes('INSERT INTO state'))return {bind(json,date){
          return {async run(){writes.push({json,date});stateRow={json};return {success:true,meta:{changes:1}};}}
        }};
        if(sql.includes('SELECT json FROM state'))return {async first(){return stateRow;}};
        throw Error('Unexpected SQL '+sql);
      }
    }
  };
};
const fake='FAKE_SECRET_FOR_TESTING_ONLY';
const input={agency:{name:'QA'},clients:[{id:'tenant-qa',metaToken:fake,easyOrdersToken:'FAKE_EASY',emailPassword:'FAKE_MAIL'}],entries:[],funding:[]};
const missing=makeEnv(undefined);
await assert.rejects(()=>saveState(missing,input),err=>err.code==='TOKEN_ENC_KEY_MISSING'&&err.status===503);
assert.equal(missing.writes.length,0,'missing encryption key must not write unencrypted provider secrets');
assert.equal(input.clients[0].metaToken,fake,'failed encryption must not mutate input data');
await saveState(missing,{agency:{name:'no secrets'},clients:[{id:'empty'}],entries:[],funding:[]});
assert.equal(missing.writes.length,1,'non-secret writes may still proceed without a key');
const authorized=makeEnv('QA_KEY_NOT_FOR_PRODUCTION');
await saveState(authorized,input);
assert.equal(authorized.writes.length,1);
const persisted=authorized.writes[0].json;
for(const secret of [fake,'FAKE_EASY','FAKE_MAIL'])assert.equal(persisted.includes(secret),false,'plaintext must not reach D1');
const row=JSON.parse(persisted).clients[0];
for(const field of ['metaToken','easyOrdersToken','emailPassword'])assert.ok(row[field].startsWith('enc$'),'secret must use AES-GCM envelope');
const roundtrip=await loadState(authorized);
assert.equal(roundtrip.clients[0].metaToken,fake);
assert.equal(roundtrip.clients[0].easyOrdersToken,'FAKE_EASY');
assert.equal(roundtrip.clients[0].emailPassword,'FAKE_MAIL');
await assert.rejects(()=>decryptSecret(row.metaToken,makeEnv('WRONG_KEY')),err=>err.code==='TOKEN_DECRYPT_FAILED','wrong key must reject instead of deleting saved encrypted data');
await assert.rejects(()=>decryptSecret(row.metaToken,makeEnv(undefined)),err=>err.code==='TOKEN_ENC_KEY_MISSING','missing key must reject existing ciphertext');
await assert.rejects(()=>decryptSecret('enc$invalid',authorized),err=>err.code==='TOKEN_DECRYPT_FAILED','malformed envelope must fail closed');
const readWithoutKey=makeEnv(undefined);
readWithoutKey.DB.prepare=authorized.DB.prepare.bind(authorized.DB);
await assert.rejects(()=>loadState(readWithoutKey),err=>err.code==='TOKEN_ENC_KEY_MISSING','encrypted rows may not be silently blanked during read');
assert.equal(readWithoutKey.writes.length,0,'failed decrypt must not persist a blanked credential');
const code=source.slice(source.indexOf('async function readSession(request'),source.indexOf('/* ---------- تشفير توكنز التكامل',source.indexOf('async function readSession(request')));
assert.match(code,/Number\.isSafeInteger\(p\.exp\)/,'signed sessions require a safe integer expiry');
assert.match(code,/p\.exp <= Math\.floor\(Date\.now\(\) \/ 1000\)/,'expiry second itself is invalid');
console.log('SEC-03 legacy secret storage PASS: no plaintext fallback, zero DB writes on missing key, ciphertext-preserving decrypt failures, AES-GCM roundtrip, strict session expiry.');
