const LIVE_BASE='https://openapi.jtjms-eg.com';
const clean=value=>String(value??'').trim();
const rotl=(x,n)=>((x<<n)|(x>>>(32-n)))>>>0;
const shifts=[7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
const constants=Array.from({length:64},(_,i)=>(Math.floor(Math.abs(Math.sin(i+1))*4294967296)>>>0));

function md5Bytes(value){
  const input=new TextEncoder().encode(String(value)),bitLength=BigInt(input.length)*8n,paddedLength=Math.ceil((input.length+9)/64)*64,bytes=new Uint8Array(paddedLength);bytes.set(input);bytes[input.length]=0x80;
  for(let i=0;i<8;i++)bytes[paddedLength-8+i]=Number((bitLength>>BigInt(i*8))&255n);
  let a0=0x67452301,b0=0xefcdab89,c0=0x98badcfe,d0=0x10325476;
  for(let offset=0;offset<bytes.length;offset+=64){
    const m=new Uint32Array(16);for(let i=0;i<16;i++){const p=offset+i*4;m[i]=(bytes[p]|(bytes[p+1]<<8)|(bytes[p+2]<<16)|(bytes[p+3]<<24))>>>0;}
    let a=a0,b=b0,c=c0,d=d0;
    for(let i=0;i<64;i++){
      let f,g;if(i<16){f=(b&c)|((~b)&d);g=i;}else if(i<32){f=(d&b)|((~d)&c);g=(5*i+1)%16;}else if(i<48){f=b^c^d;g=(3*i+5)%16;}else{f=c^(b|(~d));g=(7*i)%16;}
      const sum=(a+(f>>>0)+constants[i]+m[g])>>>0,nextD=c,nextC=b,nextB=(b+rotl(sum,shifts[i]))>>>0;a=d;d=nextD;c=nextC;b=nextB;
    }
    a0=(a0+a)>>>0;b0=(b0+b)>>>0;c0=(c0+c)>>>0;d0=(d0+d)>>>0;
  }
  const out=new Uint8Array(16),words=[a0,b0,c0,d0];for(let i=0;i<4;i++)for(let j=0;j<4;j++)out[i*4+j]=(words[i]>>>(j*8))&255;return out;
}
const md5Hex=value=>[...md5Bytes(value)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
const md5Base64=value=>btoa(String.fromCharCode(...md5Bytes(value)));

function credentials(secrets){
  const fields={
    apiAccount:clean(secrets?.api_account||secrets?.apiAccount),
    privateKey:clean(secrets?.private_key),
    sourceCode:clean(secrets?.source_code||secrets?.sourceCode)
  };
  return {fields,missing:Object.entries(fields).filter(([,value])=>!value).map(([key])=>key)};
}

export async function validateJtExpressConnection({secrets}){
  const {fields,missing}=credentials(secrets);
  if(missing.length)return {ok:false,status:'disconnected',externalConnectivityChecked:false,code:'JT_CREDENTIALS_MISSING',message:'J&T Express Egypt يحتاج API Account وPrivate Key وSource Code من Developer Info.'};
  return {
    ok:true,
    status:'configured',
    externalConnectivityChecked:false,
    code:'JT_DEVELOPER_INFO_READY',
    externalStoreId:fields.sourceCode,
    config:{jtEnvironment:'production',jtApiBase:LIVE_BASE,sourceCode:fields.sourceCode,developerCredentialsReady:true},
    message:'تم حفظ بيانات J&T Developer Info الثلاثة: API Account + Private Key + Source Code. Source Name غير مطلوب. لن نعتبر الربط متصلًا بالكامل قبل اختبار API مفعّل للحساب؛ وCreate Order يجب أن تكون Online في بوابة J&T قبل إنشاء الشحنات.'
  };
}

export const __jtValidationInternals={md5Hex,md5Base64,LIVE_BASE};
