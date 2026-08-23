const enc=new TextEncoder();
const dec=new TextDecoder();
const b64ToBytes=s=>Uint8Array.from(atob(String(s||'')),c=>c.charCodeAt(0));
const bytesToB64=b=>btoa(String.fromCharCode(...new Uint8Array(b)));
async function keyFromEnv(env){
  const raw=env.INTEGRATION_ENCRYPTION_KEY;
  if(!raw)throw Object.assign(new Error('INTEGRATION_ENCRYPTION_KEY غير مهيأ'),{status:503,code:'INTEGRATION_KEY_MISSING'});
  const bytes=b64ToBytes(raw);
  if(bytes.length!==32)throw Object.assign(new Error('INTEGRATION_ENCRYPTION_KEY يجب أن يكون 32-byte base64'),{status:503,code:'INTEGRATION_KEY_INVALID'});
  return crypto.subtle.importKey('raw',bytes,{name:'AES-GCM'},false,['encrypt','decrypt']);
}
export async function encryptSecret(env,value){const key=await keyFromEnv(env);const iv=crypto.getRandomValues(new Uint8Array(12));const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,enc.encode(String(value)));return {ciphertextB64:bytesToB64(cipher),ivB64:bytesToB64(iv)};}
export async function decryptSecret(env,ciphertextB64,ivB64){const key=await keyFromEnv(env);const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:b64ToBytes(ivB64)},key,b64ToBytes(ciphertextB64));return dec.decode(plain);}
