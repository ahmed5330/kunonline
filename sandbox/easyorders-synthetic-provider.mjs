export const SYNTHETIC_API_KEY='KUN_SYNTHETIC_EASYORDERS_QA_ONLY';
export const SYNTHETIC_EXTERNAL_STORE='EO-SYNTHETIC-QA';

// This replaces outbound fetch only in the separately deployed QA entrypoint.
// No real upstream is contacted, even if application code requests another URL.
export async function syntheticProviderFetch(input,init={}){
  const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
  const method=init.method||(input instanceof Request?input.method:'GET');
  const headers=new Headers(init.headers||(input instanceof Request?input.headers:undefined));
  if(url.protocol!=='https:'||url.hostname!=='api.easy-orders.net'||method!=='GET'||headers.get('Api-Key')!==SYNTHETIC_API_KEY)
    throw new Error('QA_EXTERNAL_NETWORK_FORBIDDEN');
  const match=url.pathname.match(/^\/api\/v1\/external-apps\/orders\/(?:short\/)?(?:QA-PROVIDER-)?(\d+)\/?$/);
  if(!match)throw new Error('QA_PROVIDER_PATH_NOT_ALLOWLISTED');
  const id=Number(match[1]);
  if(id===429)return Response.json({error:'synthetic quota limit'},{status:429});
  if(id===503)return Response.json({error:'record not found'},{status:503});
  if(![1,2,3].includes(id))return Response.json({error:'record not found'},{status:404});
  return Response.json({id:`QA-PROVIDER-${id}`,short_id:id,store_id:SYNTHETIC_EXTERNAL_STORE,
    full_name:'Synthetic QA Customer',phone:'01000000000',status:'pending',
    total:100,total_cost:100,shipping_cost:0,cost:0,created_at:'2026-10-25T00:00:00Z',
    items:[{id:'QA-PRODUCT',name:'Synthetic product',price:100,quantity:1}]});
}
