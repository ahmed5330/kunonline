// Read-only production gateway compatibility for Preview deployments that lag COD routes.
// Financial writes, authentication errors, and unrelated 404s must NEVER be retried.
const READ_PATHS=new Set(['/api/cod-reconciliation/summary','/api/cod-reconciliation/candidates','/api/cod-reconciliation']);

export async function routeProductionCodRead({request,fetchPreview,fetchLocal}){
  if(request.method!=='GET'||!READ_PATHS.has(new URL(request.url).pathname))return null;
  const upstream=await fetchPreview(request);
  if(!upstream)return fetchLocal(request);
  if(upstream.status!==404)return upstream;
  const body=await upstream.clone().json().catch(()=>null);
  // Only the explicit Preview "unknown route" envelope authorizes a local fallback.
  if(body?.error!=='مسار غير معروف')return upstream;
  return fetchLocal(request);
}
