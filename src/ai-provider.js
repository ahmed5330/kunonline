function extractText(data){
  if(typeof data?.output_text==='string')return data.output_text;
  const chunks=[];
  for(const item of data?.output||[])for(const c of item?.content||[])if(typeof c?.text==='string')chunks.push(c.text);
  return chunks.join('\n');
}
function parseJsonText(text){
  const cleaned=String(text||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  try{return JSON.parse(cleaned)}catch{return null}
}

export async function enrichBusinessBriefWithAI(env,brief){
  if(!env.OPENAI_API_KEY||!env.OPENAI_TEXT_MODEL)return {...brief,ai:{used:false,status:'not_configured'}};
  const model=env.OPENAI_TEXT_MODEL;
  const instruction=`أنت محلل Performance Marketing وCommerce داخل Kun Online. حلل الفترة المحددة فقط والأرقام المرسلة فقط. بيانات marketing.campaigns تمثل كل الحملات التي لها نشاط داخل الفترة، ويجب عمل breakdown حقيقي لها وليس الاكتفاء بالإجمالي. قارن على الأقل: Spend, CTR, CPC, CPM, Frequency, CPP الفعلي, Confirmed CPP, Delivered CPP, Platform ROAS, Real ROAS, التأكيد، التسليم، الإلغاء والمرتجع. وضّح الحملات الرابحة، الحملات التي تهدر الميزانية، فجوة Attribution بين المنصة والنتيجة الحقيقية، وأين توجد مشكلة Funnel. لا تعتبر حملة بلا إنفاق حملة خاسرة، ولا تخترع أرقامًا أو أسبابًا غير موجودة. أعد JSON صالح فقط بالشكل {"summary":"ملخص للفترة","adAnalysis":{"summary":"خلاصة الإعلانات","winners":[{"campaign":"","detail":""}],"risks":[{"campaign":"","type":"","detail":""}]},"recommendations":[{"type":"marketing|operations|inventory|finance|wallet|crm","severity":"info|warning|danger|success","title":"...","detail":"...","action":"..."}]}. لا تنفذ أي إجراء.`;
  const payload={model,input:[{role:'system',content:instruction},{role:'user',content:JSON.stringify({period:{from:brief.from,to:brief.to},metrics:brief.metrics,ruleAdAnalysis:brief.adAnalysis,ruleRecommendations:brief.recommendations})}],max_output_tokens:2800};
  try{
    const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'Authorization':`Bearer ${env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify(payload)});
    if(!response.ok){const err=await response.text().catch(()=>String(response.status));return {...brief,ai:{used:false,status:'provider_error',httpStatus:response.status,error:err.slice(0,300)}};}
    const data=await response.json(),parsed=parseJsonText(extractText(data));
    if(!parsed||!Array.isArray(parsed.recommendations))return {...brief,ai:{used:false,status:'invalid_output'}};
    const adAnalysis=parsed.adAnalysis&&typeof parsed.adAnalysis==='object'?parsed.adAnalysis:brief.adAnalysis;
    return {...brief,summary:String(parsed.summary||''),adAnalysis,recommendations:parsed.recommendations.slice(0,16),ai:{used:true,status:'ok',model}};
  }catch(error){return {...brief,ai:{used:false,status:'network_error',error:String(error?.message||error).slice(0,300)}};}
}

export async function generateAdVariantsAI(env,context){
  const fallback=()=>{
    const name=context.product?.name||context.name||'المنتج',offer=context.offerText||context.offer||'',aud=context.targetAudience||'عملاء المتجر';
    const angles=(context.angles?.length?context.angles:['حل المشكلة','القيمة مقابل السعر','الدليل الاجتماعي']).slice(0,5);
    return angles.map((angle,i)=>({platform:context.platform||'meta',angle,hook:`${angle}: ${name}`,primaryText:`اكتشف ${name}. ${offer}`.trim(),headline:offer||name,description:`رسالة موجهة إلى ${aud}`,cta:'SHOP_NOW',audience:{description:aud},campaignPlan:{objective:context.objective||'sales',variant:i+1},aiEngine:'rules-v27'}));
  };
  if(!env.OPENAI_API_KEY||!env.OPENAI_TEXT_MODEL)return {variants:fallback(),ai:{used:false,status:'not_configured'}};
  const model=env.OPENAI_TEXT_MODEL;
  const instruction=`أنت Creative Strategist للتجارة الإلكترونية. استخدم بيانات المنتج فقط. أعد JSON صالح فقط بالشكل {"variants":[{"platform":"meta|google|tiktok","angle":"","hook":"","primaryText":"","headline":"","description":"","cta":"SHOP_NOW","audience":{},"campaignPlan":{}}]}. أنشئ 5 زوايا مختلفة، بدون ادعاءات غير مثبتة أو وعود مضللة.`;
  try{
    const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'Authorization':`Bearer ${env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model,input:[{role:'system',content:instruction},{role:'user',content:JSON.stringify(context)}],max_output_tokens:2600})});
    if(!response.ok)return {variants:fallback(),ai:{used:false,status:'provider_error',httpStatus:response.status}};
    const parsed=parseJsonText(extractText(await response.json()));
    if(!parsed||!Array.isArray(parsed.variants)||!parsed.variants.length)return {variants:fallback(),ai:{used:false,status:'invalid_output'}};
    return {variants:parsed.variants.slice(0,8).map(v=>({...v,aiEngine:model})),ai:{used:true,status:'ok',model}};
  }catch(error){return {variants:fallback(),ai:{used:false,status:'network_error',error:String(error?.message||error).slice(0,200)}};}
}
