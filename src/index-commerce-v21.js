import commerceV20 from './index-commerce-v20.js';

const SECURITY_HEADERS={
  'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; upgrade-insecure-requests",
  'X-Content-Type-Options':'nosniff',
  'X-Frame-Options':'DENY',
  'Referrer-Policy':'strict-origin-when-cross-origin',
  'Permissions-Policy':'camera=(), microphone=(), geolocation=(), payment=()',
  'Cross-Origin-Opener-Policy':'same-origin',
  'Cross-Origin-Resource-Policy':'same-origin'
};

function hardenedEnv(env){
  if(env.TOKEN_ENC_KEY)return env;
  const inherited=Object.create(env);
  if(env.INTEGRATION_ENCRYPTION_KEY)inherited.TOKEN_ENC_KEY=`legacy-state:${env.INTEGRATION_ENCRYPTION_KEY}`;
  else if(env.SESSION_SECRET)inherited.TOKEN_ENC_KEY=`legacy-state:${env.SESSION_SECRET}`;
  return inherited;
}

function harden(response,path){
  const headers=new Headers(response.headers);
  for(const [k,v] of Object.entries(SECURITY_HEADERS))headers.set(k,v);
  if(path.startsWith('/api/'))headers.set('Cache-Control','no-store');
  else if(path==='/v2/'||path==='/v2/index.html')headers.set('Cache-Control','no-cache');
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}

async function fetchV21(request,env,ctx){
  const url=new URL(request.url);
  const response=await commerceV20.fetch(request,hardenedEnv(env),ctx);
  return harden(response,url.pathname);
}

export default {
  fetch:fetchV21,
  scheduled(controller,env,ctx){return commerceV20.scheduled?.(controller,hardenedEnv(env),ctx);}
};
