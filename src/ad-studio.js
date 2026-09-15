import {generateAdVariantsAI} from './ai-provider.js';

const now=()=>new Date().toISOString();
const rid=p=>`${p}-${crypto.randomUUID().slice(0,10).toUpperCase()}`;
const parse=v=>{try{return JSON.parse(v||'{}')}catch{return {}}};

export async function listAdDrafts(env,{clientId,storeId=null}){
  const {results=[]}=await env.DB.prepare(`SELECT * FROM ad_studio_drafts WHERE client_id=? ${storeId?'AND store_id=?':''} ORDER BY updated_at DESC LIMIT 200`).bind(...(storeId?[clientId,storeId]:[clientId])).all();
  return results.map(x=>({...x,productContext:parse(x.product_context_json)}));
}

export async function createAdDraft(env,{clientId,storeId=null,body,actor}){
  const name=String(body.name||'').trim();if(!name)throw Object.assign(new Error('اسم مسودة الإعلان مطلوب'),{status:400});
  const product=body.productId?await env.DB.prepare(`SELECT id,name,price,cost,category,sku FROM products WHERE id=? AND client_id=? ${storeId?'AND store_id=?':''}`).bind(...(storeId?[body.productId,clientId,storeId]:[body.productId,clientId])).first():null;
  if(body.productId&&!product)throw Object.assign(new Error('المنتج غير موجود في هذا الفرع'),{status:404});
  const id=rid('AD'),ts=now(),context={...(body.productContext&&typeof body.productContext==='object'?body.productContext:{}),product:product||body.product||null,angles:Array.isArray(body.angles)?body.angles:[],specs:body.specs||{},faq:body.faq||[],reviews:body.reviews||[]};
  await env.DB.prepare(`INSERT INTO ad_studio_drafts (id,client_id,store_id,product_id,name,objective,target_audience,offer_text,product_context_json,status,created_by,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,'draft',?,?,?)`).bind(id,clientId,storeId||null,product?.id||null,name,String(body.objective||'sales'),String(body.targetAudience||''),String(body.offerText||''),JSON.stringify(context),actor?.email||actor?.uid||'',ts,ts).run();
  if(Array.isArray(body.assets)&&body.assets.length){const statements=[];for(const asset of body.assets.slice(0,30))statements.push(env.DB.prepare(`INSERT INTO ad_creative_assets (id,client_id,store_id,draft_id,asset_type,asset_url,label,angle,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(rid('AST'),clientId,storeId||null,id,String(asset.type||'image'),asset.url?String(asset.url):null,String(asset.label||''),String(asset.angle||''),JSON.stringify(asset.metadata||{}),ts));await env.DB.batch(statements);}
  return {ok:true,id,status:'draft'};
}

export async function getAdDraft(env,{clientId,storeId=null,draftId}){
  const draft=await env.DB.prepare(`SELECT * FROM ad_studio_drafts WHERE id=? AND client_id=? ${storeId?'AND store_id=?':''}`).bind(...(storeId?[draftId,clientId,storeId]:[draftId,clientId])).first();
  if(!draft)throw Object.assign(new Error('مسودة الإعلان غير موجودة'),{status:404});
  const [{results:assets=[]},{results:variants=[]}]=await Promise.all([
    env.DB.prepare('SELECT * FROM ad_creative_assets WHERE client_id=? AND draft_id=? ORDER BY created_at').bind(clientId,draftId).all(),
    env.DB.prepare('SELECT * FROM ad_draft_variants WHERE client_id=? AND draft_id=? ORDER BY created_at DESC').bind(clientId,draftId).all()
  ]);
  return {...draft,productContext:parse(draft.product_context_json),assets,variants:variants.map(v=>({...v,audience:parse(v.audience_json),campaignPlan:parse(v.campaign_plan_json)}))};
}

export async function generateAdDraft(env,{clientId,storeId=null,draftId,body={},actor}){
  const draft=await getAdDraft(env,{clientId,storeId,draftId});
  const context={name:draft.name,objective:draft.objective,targetAudience:draft.target_audience,offerText:draft.offer_text,platform:body.platform||'meta',angles:Array.isArray(body.angles)&&body.angles.length?body.angles:draft.productContext.angles,product:draft.productContext.product||{},specs:draft.productContext.specs||{},reviews:draft.productContext.reviews||[],faq:draft.productContext.faq||[],assets:draft.assets.map(x=>({type:x.asset_type,url:x.asset_url,label:x.label,angle:x.angle}))};
  const generated=await generateAdVariantsAI(env,context),ts=now(),statements=[];
  for(const v of generated.variants){statements.push(env.DB.prepare(`INSERT INTO ad_draft_variants (id,client_id,store_id,draft_id,platform,angle,hook,primary_text,headline,description,cta,audience_json,campaign_plan_json,ai_engine,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(rid('ADV'),clientId,storeId||null,draftId,String(v.platform||body.platform||'meta'),String(v.angle||''),String(v.hook||''),String(v.primaryText||''),String(v.headline||''),String(v.description||''),String(v.cta||'SHOP_NOW'),JSON.stringify(v.audience||{}),JSON.stringify(v.campaignPlan||{}),String(v.aiEngine||generated.ai?.model||'rules-v27'),ts));}
  statements.push(env.DB.prepare("UPDATE ad_studio_drafts SET status='generated',updated_at=? WHERE id=? AND client_id=?").bind(ts,draftId,clientId));
  if(statements.length)await env.DB.batch(statements);
  await env.DB.prepare(`INSERT INTO audit_log (id,client_id,store_id,actor_user_id,actor_email,action,entity_type,entity_id,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(rid('AUD'),clientId,storeId||null,actor?.uid||null,actor?.email||actor?.role||null,'ad_studio.generate','ad_draft',draftId,JSON.stringify({count:generated.variants.length,ai:generated.ai}),ts).run();
  return {ok:true,draftId,count:generated.variants.length,ai:generated.ai,variants:(await getAdDraft(env,{clientId,storeId,draftId})).variants};
}

const SENSITIVE_ACTIONS=new Set(['publish_campaign','pause_campaign','resume_campaign','update_budget','create_adset','publish_ad']);
export async function requestAdAction(env,{clientId,storeId=null,draftId,body,actor}){
  const action=String(body.action||'').trim();if(!SENSITIVE_ACTIONS.has(action))throw Object.assign(new Error('إجراء الإعلان غير مدعوم'),{status:400});
  const draft=await getAdDraft(env,{clientId,storeId,draftId});
  const platform=String(body.platform||'meta_ads');if(!['meta_ads','google_ads','tiktok_ads'].includes(platform))throw Object.assign(new Error('منصة الإعلانات غير مدعومة'),{status:400});
  const key=String(body.idempotencyKey||`ad:${clientId}:${draftId}:${action}:${platform}:${body.variantId||'draft'}`),existing=await env.DB.prepare('SELECT id,status FROM approval_requests WHERE client_id=? AND idempotency_key=?').bind(clientId,key).first();
  if(existing)return {ok:true,deduplicated:true,approvalId:existing.id,status:existing.status};
  const id=rid('APR'),ts=now(),payload={draftId,storeId,platform,variantId:body.variantId||null,name:draft.name,objective:draft.objective,budget:body.budget??null,externalCampaignId:body.externalCampaignId||null,requestedAction:action};
  await env.DB.prepare(`INSERT INTO approval_requests (id,client_id,store_id,source,source_id,action_type,risk,payload_json,status,requested_by,requested_at,idempotency_key)
    VALUES (?,?,?,?,?,?,'sensitive',?,'pending',?,?,?)`).bind(id,clientId,storeId||null,'ad_studio',draftId,`ads.${action}`,JSON.stringify(payload),actor?.email||actor?.uid||'',ts,key).run();
  await env.DB.prepare("UPDATE ad_studio_drafts SET status='approval_pending',updated_at=? WHERE id=? AND client_id=?").bind(ts,draftId,clientId).run();
  return {ok:true,approvalId:id,status:'pending',action,platform};
}
