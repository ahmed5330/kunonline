// Temporary operator/QA caller. No D1 binding, provider key or business writes.
export default {
  async fetch(request,env){
    const token=String(env.AUDIT_READ_TOKEN||''),expires=Number(env.AUDIT_EXPIRES_AT);
    if(env.KUN_READONLY_AUDIT!=='true'||token.length<32||!Number.isFinite(expires)||Date.now()>expires||
      request.method!=='POST'||new URL(request.url).pathname!=='/audit'||request.headers.get('Authorization')!==`Bearer ${token}`)
      return new Response('Not found',{status:404});
    try{
      const body=await request.json(),from=Number(body.fromShortId),to=Number(body.toShortId);
      if(!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from<Number(env.AUDIT_MIN_SHORT_ID)||to>Number(env.AUDIT_MAX_SHORT_ID)||to<from||to-from>=10)
        return Response.json({ok:false,code:'READONLY_AUDIT_RANGE_INVALID'},{status:400});
      const result=await env.APP_AUDIT.auditEasyOrdersGapsReadOnly({clientId:env.AUDIT_CLIENT_ID,
        storeId:env.AUDIT_STORE_ID,connectionId:env.AUDIT_CONNECTION_ID,fromShortId:from,toShortId:to});
      if(result?.mode!=='read_only'||result.dbWritesAllowed!==false||result.recoveryPerformed!==false)throw Error('UNEXPECTED_AUDIT_RESULT');
      return Response.json(result,{headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
    }catch{return Response.json({ok:false,code:'READONLY_AUDIT_CALL_FAILED'},{status:502});}
  }
};
