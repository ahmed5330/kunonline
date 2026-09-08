const LIVE_BASE='https://openapi.jtjms-eg.com';
const GET_ORDERS_PATH='/webopenplatformapi/api/order/getOrders';
const PASSWORD_SALT='jadada236t2';
const AUTH_CODES=new Set(['145003010','145003030','145003031']);
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
function businessDigest(customerCode,password,privateKey,mode){
  if(mode==='raw')return md5Base64(customerCode+password+privateKey);
  const hashedPassword=md5Hex(password+PASSWORD_SALT).toUpperCase();return md5Base64(customerCode+hashedPassword+privateKey);
}
async function probe({apiAccount,privateKey,customerCode,password,mode,fetcher}){
  const bizContent=JSON.stringify({command:1,serialNumber:[`KUN-VALIDATE-${Date.now()}`],customerCode,digest:businessDigest(customerCode,password,privateKey,mode)}),timestamp=String(Date.now());
  const response=await fetcher(`${LIVE_BASE}${GET_ORDERS_PATH}`,{method:'POST',headers:{Accept:'application/json','Content-Type':'application/x-www-form-urlencoded',apiAccount,digest:md5Base64(bizContent+privateKey),timestamp},body:new URLSearchParams({bizContent}).toString()});
  const data=await response.clone().json().catch(()=>null),code=clean(data?.code),message=clean(data?.msg||data?.message);
  return {response,data,code,message,mode};
}
function credentials(secrets){
  const fields={apiAccount:clean(secrets?.api_account||secrets?.apiAccount),privateKey:clean(secrets?.private_key||secrets?.api_key),customerCode:clean(secrets?.customer_code||secrets?.customerCode),password:clean(secrets?.customer_password||secrets?.customer_pwd||secrets?.password)};
  return {fields,missing:Object.entries(fields).filter(([,value])=>!value).map(([key])=>key)};
}
function authFailure(result){
  const text=`${result?.code||''} ${result?.message||''}`.toLowerCase();return AUTH_CODES.has(result?.code)||/(api account|signature|digest|credential|password|customer code).*(invalid|fail|not exist|wrong)|verification failed/.test(text);
}

export async function validateJtExpressConnection({secrets,fetcher=fetch}){
  const {fields,missing}=credentials(secrets);
  if(missing.length)return {ok:false,status:'disconnected',externalConnectivityChecked:false,code:'JT_CREDENTIALS_MISSING',message:'J&T Express Egypt يحتاج API Account وPrivate Key وCustomer Code وCustomer Password كاملة.'};
  const modes=['salted','raw'];let last=null;
  for(const mode of modes){
    try{last=await probe({...fields,mode,fetcher});}catch(error){return {ok:false,status:'disconnected',externalConnectivityChecked:true,code:'JT_CONNECTIVITY_FAILED',message:`تعذر الاتصال بـ J&T Express Egypt: ${clean(error?.message)||'network error'}`};}
    if(!last.response.ok)return {ok:false,status:'disconnected',externalConnectivityChecked:true,code:'JT_HTTP_ERROR',httpStatus:last.response.status,message:`J&T Express Egypt أعاد HTTP ${last.response.status}.`};
    if(last.code==='1')return {ok:true,status:'connected',externalConnectivityChecked:true,externalStoreId:fields.customerCode,config:{jtEnvironment:'production',jtApiBase:LIVE_BASE,customerCode:fields.customerCode,digestMode:mode},message:`تم الاتصال بـ J&T Express Egypt بنجاح — ${fields.customerCode}.`};
    if(last.code==='145003031'&&mode==='salted')continue;
    if(authFailure(last))return {ok:false,status:'disconnected',externalConnectivityChecked:true,code:'JT_CREDENTIALS_REJECTED',jtCode:last.code||null,message:`J&T رفض بيانات الربط${last.code?` (${last.code})`:''}: ${last.message||'تحقق من بيانات OpenAPI الأربعة.'}`};
    return {ok:false,status:'configured',externalConnectivityChecked:true,code:'JT_VALIDATION_INCONCLUSIVE',jtCode:last.code||null,message:`تم الوصول إلى J&T لكن اختبار الحساب لم ينجح${last.code?` (${last.code})`:''}: ${last.message||'استجابة غير متوقعة'}.`};
  }
  return {ok:false,status:'disconnected',externalConnectivityChecked:true,code:'JT_CREDENTIALS_REJECTED',jtCode:last?.code||null,message:`J&T رفض بيانات Customer Password/Customer Code${last?.code?` (${last.code})`:''}: ${last?.message||'تحقق من بيانات OpenAPI.'}`};
}

export const __jtValidationInternals={md5Hex,md5Base64,businessDigest,LIVE_BASE,GET_ORDERS_PATH};
