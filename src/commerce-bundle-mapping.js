/* Optional Easy Orders bundle composition, independent of legacy product/stock import. */
const fail=(code,message,status=400)=>{throw Object.assign(new Error(message),{code,status});};
const clean=x=>String(x??'').trim();
const bounded=(s,max,label)=>{const v=clean(s);if(!v||v.length>max)fail('BUNDLE_INVALID_ID',label+' غير صالح');return v;};
export async function ensureCommerceBundleSchema(env){
  // D1 idempotent additive metadata only; no modifications to existing products/orders/tokens.
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS commerce_bundle_mappings (client_id TEXT NOT NULL,store_id TEXT NOT NULL,provider TEXT NOT NULL,external_id TEXT NOT NULL,product_id TEXT NOT NULL,components_json TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(client_id,store_id,provider,external_id))").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_commerce_bundle_product ON commerce_bundle_mappings(client_id,store_id,product_id)").run();
}
function assertScope({clientId,storeId,providerId}){
  bounded(clientId,100,'معرف العميل');bounded(storeId,100,'معرف المتجر');
  if(providerId!=='easyorders')fail('BUNDLE_PROVIDER_UNSUPPORTED','ربط الباندلز في الاستيراد متاح لـ Easy Orders فقط');
}
export async function commerceBundleOptions(env,{clientId,storeId,providerId='easyorders',search='',limit=250}={}){
  assertScope({clientId,storeId,providerId});
  await ensureCommerceBundleSchema(env);
  const q=clean(search).slice(0,110);
  const size=Math.max(1,Math.min(250,Math.floor(Number(limit)||250)));
  const {results:products=[]}=await env.DB.prepare("SELECT id,name,sku,category,stock FROM products WHERE client_id=? AND store_id=? AND (?='' OR LOWER(name) LIKE LOWER(?) OR LOWER(sku) LIKE LOWER(?)) ORDER BY name,id LIMIT ?").bind(clientId,storeId,q,'%'+q+'%','%'+q+'%',size).all();
  const {results:rows=[]}=await env.DB.prepare("SELECT external_id,product_id,components_json,updated_at FROM commerce_bundle_mappings WHERE client_id=? AND store_id=? AND provider=?").bind(clientId,storeId,providerId).all();
  return {products:products.map(p=>({id:p.id,name:p.name,sku:p.sku||'',category:p.category||'',stock:Number(p.stock)||0})),mappings:Object.fromEntries(rows.map(r=>[r.external_id,{productId:r.product_id,components:JSON.parse(r.components_json),updatedAt:r.updated_at}]))};
}
export function normalizeBundleChanges(raw,{selectedExternalIds,providerId,storeId}){
  if(raw===undefined||raw===null)return {};
  assertScope({clientId:'validated-by-import-route',storeId,providerId});
  if(typeof raw!=='object'||Array.isArray(raw))fail('BUNDLE_INVALID_MAPPING','تنسيق مكونات الباندل غير صحيح');
  const entries=Object.entries(raw);
  if(!entries.length)return {};
  if(entries.length>60)fail('BUNDLE_TOO_MANY_CHANGES','حد أقصى 60 تعديلًا لمكونات الباندلز في العملية');
  const selected=new Set(selectedExternalIds.map(clean));
  const output=Object.create(null);
  for(const [externalId,values] of entries){
    if(!selected.has(externalId))fail('BUNDLE_PRODUCT_NOT_SELECTED','لا يمكن تعديل مكونات منتج خارج نطاق المزامنة');
    if(externalId.length>150||!externalId)fail('BUNDLE_INVALID_ID','معرف المنتج الخارجي غير صالح');
    if(!Array.isArray(values)||values.length>40)fail('BUNDLE_INVALID_COMPONENTS','المكونات يجب أن تكون قائمة لا تتجاوز 40 منتجًا');
    const seen=new Set(),components=[];
    for(const part of values){
      if(!part||typeof part!=='object'||Array.isArray(part))fail('BUNDLE_INVALID_COMPONENTS','بيانات مكونات الباندل غير صحيحة');
      const productId=bounded(part.productId,120,'معرف المكون');
      const quantity=Number(part.quantity);
      if(!Number.isSafeInteger(quantity)||quantity<1||quantity>1000)fail('BUNDLE_INVALID_QTY','كمية كل مكون يجب أن تكون عددًا صحيحًا بين 1 و1000');
      if(seen.has(productId))fail('BUNDLE_DUPLICATE_COMPONENT','لا يمكن تكرار نفس المنتج داخل الباندل؛ زوّد كميته بدلًا من ذلك');
      seen.add(productId);components.push({productId,quantity});
    }
    output[externalId]=components;
  }
  return output;
}
export async function validateBundleChanges(env,{clientId,storeId,providerId,changes,items}){
  if(!Object.keys(changes).length)return;
  assertScope({clientId,storeId,providerId});
  await ensureCommerceBundleSchema(env);
  const parents=new Map(items.map(item=>[clean(item.externalId),item]));
  for(const [externalId,components] of Object.entries(changes)){
    const parent=parents.get(externalId);
    if(!parent)fail('BUNDLE_PRODUCT_NOT_SELECTED','منتج الباندل غير موجود ضمن المنتجات المختارة');
    // [] is an explicit "return to ordinary product" action; omission is no change.
    for(const item of components){
      if(item.productId===parent.existingId||item.productId===parent.id)fail('BUNDLE_SELF_REFERENCE','الباندل لا يمكن أن يحتوي على نفسه');
      const p=await env.DB.prepare("SELECT id FROM products WHERE id=? AND client_id=? AND store_id=?").bind(item.productId,clientId,storeId).first();
      if(!p)fail('BUNDLE_COMPONENT_WRONG_STORE','المكون غير موجود في مخزون المتجر الحالي');
      const nested=await env.DB.prepare("SELECT external_id FROM commerce_bundle_mappings WHERE product_id=? AND client_id=? AND store_id=? LIMIT 1").bind(item.productId,clientId,storeId).first();
      if(nested)fail('BUNDLE_NESTING_UNSUPPORTED','اختار منتجًا عاديًا من المخزون، وليس باندلًا آخر');
    }
  }
}
export async function saveBundleChange(env,{clientId,storeId,providerId,externalId,productId,components}){
  assertScope({clientId,storeId,providerId});
  if(!Array.isArray(components))fail('BUNDLE_INVALID_MAPPING','لم يتم تحديد مكونات الباندل');
  if(!components.length){
    await env.DB.prepare("DELETE FROM commerce_bundle_mappings WHERE client_id=? AND store_id=? AND provider=? AND external_id=?").bind(clientId,storeId,providerId,externalId).run();
    return;
  }
  await env.DB.prepare("INSERT INTO commerce_bundle_mappings(client_id,store_id,provider,external_id,product_id,components_json,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(client_id,store_id,provider,external_id) DO UPDATE SET product_id=excluded.product_id,components_json=excluded.components_json,updated_at=excluded.updated_at").bind(clientId,storeId,providerId,externalId,productId,JSON.stringify(components),new Date().toISOString()).run();
}
