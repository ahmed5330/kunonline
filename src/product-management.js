const clean=(value,max=4000)=>String(value??'').trim().slice(0,max);
const number=(value,fallback=0)=>{const n=Number(value);return Number.isFinite(n)?n:fallback;};
const nullableNumber=value=>value===''||value===null||value===undefined?null:Math.max(0,number(value));
const parseJson=(value,fallback)=>{try{return JSON.parse(value||'');}catch{return fallback;}};
const fail=(message,status=400,code='PRODUCT_DETAILS_ERROR')=>{throw Object.assign(new Error(message),{status,code});};
const stamp=()=>new Date().toISOString();
const slugify=value=>clean(value,180).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'-').replace(/^-+|-+$/g,'');

function normalizeImages(value){
  const raw=Array.isArray(value)?value:String(value||'').split(/[\n,]+/);
  return [...new Set(raw.map(x=>clean(x,1000)).filter(Boolean))].slice(0,12);
}
function normalizeOptions(value){
  if(!Array.isArray(value))return [];
  const names=new Set(),out=[];
  for(const entry of value.slice(0,5)){
    const name=clean(entry?.name,80),values=[...new Set((Array.isArray(entry?.values)?entry.values:String(entry?.values||'').split(',')).map(x=>clean(x,100)).filter(Boolean))].slice(0,50);
    if(!name||!values.length||names.has(name.toLowerCase()))continue;names.add(name.toLowerCase());out.push({name,values});
  }
  return out;
}
function normalizeOptionValues(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return {};
  return Object.fromEntries(Object.entries(value).slice(0,5).map(([key,val])=>[clean(key,80),clean(val,100)]).filter(([key,val])=>key&&val));
}
function variantName(optionValues,fallback){return Object.entries(optionValues).map(([key,val])=>`${key}: ${val}`).join(' — ')||clean(fallback,240)||'اختيار';}
function normalizeVariants(value,{basePrice,baseCost,baseWeight,weightUnit}){
  if(!Array.isArray(value))return [];
  if(value.length>150)fail('الحد الأقصى 150 متغيرًا للمنتج الواحد',400,'PRODUCT_VARIANTS_LIMIT');
  return value.map((entry,index)=>{
    const optionValues=normalizeOptionValues(entry?.optionValues||entry?.option_values),name=variantName(optionValues,entry?.name);
    return {id:clean(entry?.id,120)||null,name,optionValues,sku:clean(entry?.sku,160)||null,barcode:clean(entry?.barcode,160)||null,
      price:nullableNumber(entry?.price)??basePrice,compareAtPrice:nullableNumber(entry?.compareAtPrice??entry?.compare_at_price),cost:nullableNumber(entry?.cost)??baseCost,
      stock:Math.max(0,Math.floor(number(entry?.stock))),lowStockThreshold:Math.max(0,Math.floor(number(entry?.lowStockThreshold??entry?.low_stock_threshold,5))),
      image:clean(entry?.image,1000)||null,weight:nullableNumber(entry?.weight)??baseWeight,weightUnit:clean(entry?.weightUnit||entry?.weight_unit,20)||weightUnit,active:entry?.active===false||Number(entry?.active)===0?0:1,index
    };
  });
}
function mapVariant(row){return {id:row.id,productId:row.product_id,name:row.name||'',sku:row.sku||'',barcode:row.barcode||'',price:row.price===null?null:number(row.price),compareAtPrice:row.compare_at_price===null?null:number(row.compare_at_price),cost:row.cost===null?null:number(row.cost),stock:Math.max(0,number(row.stock)),lowStockThreshold:Math.max(0,number(row.low_stock_threshold,5)),image:row.image||'',weight:row.weight===null?null:number(row.weight),weightUnit:row.weight_unit||'kg',optionValues:parseJson(row.option_values_json,{}),active:Number(row.active)!==0};}
function mapProduct(row,variants=[]){return {id:row.id,clientId:row.client_id,storeId:row.store_id||null,name:row.name||'',slug:row.slug||'',sku:row.sku||'',barcode:row.barcode||'',category:row.category||'',brand:row.brand||'',description:row.description||'',price:number(row.price),compareAtPrice:row.compare_at_price===null?null:number(row.compare_at_price),cost:number(row.cost),stock:Math.max(0,number(row.stock)),lowStockThreshold:Math.max(0,number(row.low_stock_threshold,5)),weight:row.weight===null?null:number(row.weight),weightUnit:row.weight_unit||'kg',images:parseJson(row.images_json,[]),options:parseJson(row.options_json,[]),seoTitle:row.seo_title||'',seoDescription:row.seo_description||'',active:Number(row.active)!==0,createdAt:row.created_at||null,updatedAt:row.updated_at||null,variants};}

export async function listDetailedProducts(env,{clientId,storeId=null}){
  const productBinds=[clientId],variantBinds=[clientId];let productWhere='client_id=?',variantWhere='client_id=?';
  if(storeId){productWhere+=' AND store_id=?';variantWhere+=' AND store_id=?';productBinds.push(storeId);variantBinds.push(storeId);}
  const [{results:products=[]},{results:variants=[]}]=await Promise.all([
    env.DB.prepare(`SELECT * FROM products WHERE ${productWhere} ORDER BY active DESC,name`).bind(...productBinds).all(),
    env.DB.prepare(`SELECT * FROM product_variants WHERE ${variantWhere} ORDER BY product_id,active DESC,name`).bind(...variantBinds).all()
  ]);
  const grouped=new Map();for(const row of variants){if(!grouped.has(row.product_id))grouped.set(row.product_id,[]);grouped.get(row.product_id).push(mapVariant(row));}
  return products.map(row=>mapProduct(row,grouped.get(row.id)||[]));
}
export async function loadDetailedProduct(env,{clientId,productId}){
  const row=await env.DB.prepare('SELECT * FROM products WHERE id=? AND client_id=?').bind(productId,clientId).first();if(!row)fail('المنتج غير موجود',404,'PRODUCT_NOT_FOUND');
  const {results=[]}=await env.DB.prepare('SELECT * FROM product_variants WHERE product_id=? AND client_id=? ORDER BY active DESC,name').bind(productId,clientId).all();return mapProduct(row,results.map(mapVariant));
}
export async function saveDetailedProduct(env,{clientId,storeId=null,productId=null,body={},me}){
  const existing=productId?await env.DB.prepare('SELECT * FROM products WHERE id=? AND client_id=?').bind(productId,clientId).first():null;
  if(productId&&!existing)fail('المنتج غير موجود',404,'PRODUCT_NOT_FOUND');
  if(existing&&String(existing.store_id||'')!==String(storeId||''))fail('المنتج خارج المتجر المحدد',403,'PRODUCT_STORE_ISOLATION');
  const name=clean(body.name,240);if(!name)fail('اسم المنتج مطلوب',400,'PRODUCT_NAME_REQUIRED');
  const price=Math.max(0,number(body.price)),cost=Math.max(0,number(body.cost)),baseWeight=nullableNumber(body.weight),weightUnit=clean(body.weightUnit||body.weight_unit,20)||'kg';
  const options=normalizeOptions(body.options),images=normalizeImages(body.images||body.images_json),variants=normalizeVariants(body.variants,{basePrice:price,baseCost:cost,baseWeight,weightUnit});
  const id=existing?.id||`PRD-${crypto.randomUUID().slice(0,10).toUpperCase()}`,ts=stamp(),slug=slugify(body.slug||name),stock=variants.length?variants.filter(x=>x.active).reduce((sum,x)=>sum+x.stock,0):Math.max(0,Math.floor(number(body.stock)));
  const values={name,slug,sku:clean(body.sku,160)||null,barcode:clean(body.barcode,160)||null,category:clean(body.category,160)||null,brand:clean(body.brand,160)||null,description:clean(body.description,12000)||null,price,compareAtPrice:nullableNumber(body.compareAtPrice??body.compare_at_price),cost,stock,lowStockThreshold:Math.max(0,Math.floor(number(body.lowStockThreshold??body.low_stock_threshold,5))),weight:baseWeight,weightUnit,images,options,seoTitle:clean(body.seoTitle||body.seo_title,240)||null,seoDescription:clean(body.seoDescription||body.seo_description,500)||null,active:body.active===false||Number(body.active)===0?0:1};
  const statements=[];
  if(existing)statements.push(env.DB.prepare(`UPDATE products SET name=?,slug=?,sku=?,barcode=?,category=?,brand=?,description=?,price=?,compare_at_price=?,cost=?,stock=?,low_stock_threshold=?,weight=?,weight_unit=?,images_json=?,options_json=?,seo_title=?,seo_description=?,active=?,updated_at=? WHERE id=? AND client_id=?`).bind(values.name,values.slug,values.sku,values.barcode,values.category,values.brand,values.description,values.price,values.compareAtPrice,values.cost,values.stock,values.lowStockThreshold,values.weight,values.weightUnit,JSON.stringify(values.images),JSON.stringify(values.options),values.seoTitle,values.seoDescription,values.active,ts,id,clientId));
  else statements.push(env.DB.prepare(`INSERT INTO products (id,client_id,store_id,name,slug,sku,barcode,category,brand,description,price,compare_at_price,cost,stock,low_stock_threshold,weight,weight_unit,images_json,options_json,seo_title,seo_description,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,clientId,storeId,values.name,values.slug,values.sku,values.barcode,values.category,values.brand,values.description,values.price,values.compareAtPrice,values.cost,values.stock,values.lowStockThreshold,values.weight,values.weightUnit,JSON.stringify(values.images),JSON.stringify(values.options),values.seoTitle,values.seoDescription,values.active,ts,ts));
  const existingVariants=existing?(await env.DB.prepare('SELECT id FROM product_variants WHERE product_id=? AND client_id=?').bind(id,clientId).all()).results||[]:[],allowedIds=new Set(existingVariants.map(x=>String(x.id))),usedIds=new Set();
  if(existing)statements.push(env.DB.prepare('UPDATE product_variants SET active=0,updated_at=? WHERE product_id=? AND client_id=?').bind(ts,id,clientId));
  for(const variant of variants){let variantId=variant.id&&allowedIds.has(String(variant.id))?variant.id:`VAR-${crypto.randomUUID().slice(0,12).toUpperCase()}`;if(usedIds.has(variantId))fail('يوجد متغير مكرر في المنتج',400,'PRODUCT_VARIANT_DUPLICATE');usedIds.add(variantId);
    statements.push(env.DB.prepare(`INSERT INTO product_variants (id,product_id,client_id,store_id,name,sku,barcode,stock,price,compare_at_price,cost,active,option_values_json,image,weight,weight_unit,low_stock_threshold,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,sku=excluded.sku,barcode=excluded.barcode,stock=excluded.stock,price=excluded.price,compare_at_price=excluded.compare_at_price,cost=excluded.cost,active=excluded.active,option_values_json=excluded.option_values_json,image=excluded.image,weight=excluded.weight,weight_unit=excluded.weight_unit,low_stock_threshold=excluded.low_stock_threshold,updated_at=excluded.updated_at`).bind(variantId,id,clientId,storeId,variant.name,variant.sku,variant.barcode,variant.stock,variant.price,variant.compareAtPrice,variant.cost,variant.active,JSON.stringify(variant.optionValues),variant.image,variant.weight,variant.weightUnit,variant.lowStockThreshold,ts,ts));
  }
  await env.DB.batch(statements);
  try{await env.DB.prepare('INSERT INTO audit_log (id,client_id,store_id,actor_user_id,actor_email,action,entity_type,entity_id,before_json,after_json,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').bind(`AUD-${crypto.randomUUID().slice(0,10).toUpperCase()}`,clientId,storeId,me?.uid||me?.id||null,me?.email||me?.name||me?.role||'user',existing?'product.edit':'product.create','product',id,existing?JSON.stringify(existing):null,JSON.stringify({...values,variantCount:variants.length}),JSON.stringify({source:'product_catalog'}),ts).run();}catch{}
  return loadDetailedProduct(env,{clientId,productId:id});
}
