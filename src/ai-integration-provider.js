/* Fixed, read-only API key verification. No text generation, token charges or user content. */
export const AI_PROVIDERS=Object.freeze([
  {id:'ai_openai',name:'OpenAI',site:'https://platform.openai.com/api-keys',endpoint:'https://api.openai.com/v1/models',modelField:'data'},
  {id:'ai_gemini',name:'Google Gemini',site:'https://aistudio.google.com/apikey',endpoint:'https://generativelanguage.googleapis.com/v1beta/models?pageSize=20',modelField:'models'},
  {id:'ai_anthropic',name:'Anthropic Claude',site:'https://console.anthropic.com/settings/keys',endpoint:'https://api.anthropic.com/v1/models?limit=20',modelField:'data'},
  {id:'ai_groq',name:'Groq',site:'https://console.groq.com/keys',endpoint:'https://api.groq.com/openai/v1/models',modelField:'data'}
]);
export const aiProvider=id=>AI_PROVIDERS.find(p=>p.id===id)||null;
function validationError(status){
  if(status===401||status===403)return {status:'disconnected',code:'AI_KEY_REJECTED',message:'المزود رفض مفتاح API أو صلاحياته. راجع المفتاح من لوحة حسابك.'};
  if(status===429)return {status:'configured',code:'AI_RATE_LIMITED',message:'المزود طلب تقليل المحاولات. المفتاح محفوظ، جرّب التحقق لاحقًا.'};
  return {status:'configured',code:'AI_PROVIDER_UNAVAILABLE',message:'تعذر التحقق من الخدمة حاليًا (HTTP '+status+'). جرّب لاحقًا.'};
}
export async function verifyAiProviderKey({providerId,apiKey,fetcher=fetch,timeoutMs=8000}){
  const provider=aiProvider(providerId),key=String(apiKey||'').trim();
  if(!provider)return {ok:false,status:'disconnected',externalConnectivityChecked:false,code:'AI_PROVIDER_UNSUPPORTED',message:'مزود الذكاء الاصطناعي غير مدعوم.'};
  if(!key)return {ok:false,status:'disconnected',externalConnectivityChecked:false,code:'AI_KEY_MISSING',message:'أدخل مفتاح API من حسابك.'};
  // Do not accept user-controlled endpoints or external URLs: no arbitrary network targets.
  const headers={Accept:'application/json'};
  if(providerId==='ai_gemini')headers['x-goog-api-key']=key;
  else if(providerId==='ai_anthropic'){headers['x-api-key']=key;headers['anthropic-version']='2023-06-01';}
  else headers.Authorization='Bearer '+key;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.min(12000,Math.max(1000,timeoutMs)));
  try{
    const response=await fetcher(provider.endpoint,{method:'GET',headers,signal:controller.signal,redirect:'error'});
    if(!response.ok)return {ok:false,externalConnectivityChecked:true,providerId,...validationError(response.status)};
    const data=await response.json().catch(()=>null);
    const models=data?.[provider.modelField];
    if(!Array.isArray(models)||!models.length)
      return {ok:false,status:'configured',externalConnectivityChecked:true,providerId,code:'AI_NO_AVAILABLE_MODELS',message:'تم الاتصال، لكن لم يرجع المزود نماذج يمكن استخدامها بهذا المفتاح.'};
    return {
      ok:true,status:'connected',externalConnectivityChecked:true,providerId,
      modelsPreview:models.slice(0,8).map(m=>String(m?.id||m?.name||'').replace(/^models\//,'')).filter(Boolean),
      modelCountSample:models.length,verifiedAt:new Date().toISOString(),
      message:'تم التحقق الحقيقي من الاتصال وقائمة النماذج، بدون إرسال طلب توليد أو استهلاك توكنز.'
    };
  }catch(error){
    return {ok:false,status:'configured',externalConnectivityChecked:false,providerId,
      code:error?.name==='AbortError'?'AI_CHECK_TIMEOUT':'AI_NETWORK_ERROR',
      message:error?.name==='AbortError'?'انتهت مهلة الاتصال بالمزود؛ حاول لاحقًا.':'تعذر الوصول إلى المزود؛ احتفظنا بالمفتاح دون كشفه.'};
  }finally{clearTimeout(timer);}
}
