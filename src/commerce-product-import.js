import {readConnectionSecrets} from './integration-provider-validation.js';
import {providerById} from './provider-registry.js';

const PRODUCT_COLS='id,client_id,store_id,name,sku,category,price,cost,active,stock,low_stock_threshold,created_at';
const text=v=>String(v??'').trim();
const num=v=>Number.isFinite(Number(v))?Number(v):0;
const list=v=>Array.isArray(v)?v:[];
const first=(...xs)=>xs.find(x=>x!==undefined&&x!==null&&x!=='');
const firstList=(...xs)=>xs.find(x=>Array.isArray(x)&&x.length)||xs.find(Array.isArray)||[];
const EASYORDERS_PAGE_SIZE=100;
const EASYORDERS_MAX_PAGES=100;
const EASYORDERS_AUTH_PROFILES=[
  {id:'api-key-external-apps',url:'https://api.easy-orders.net/api/v1/external-apps/products',headers:key=>({'Api-Key':key})},
  {id:'bearer-v1',url:'https://api.easy-orders.net/v1/products',headers:key=>({Authorization:`Bearer ${key}`})}
];

const json=async response=>{
  const data=await response.json().catch(()=>null);
  if(!response.ok){
    const e=new Error(data?.message||data?.error||`Provider HTTP ${response.status}`);
    e.status=response.status;
    e.code='COMMERCE_PROVIDER_ERROR';
    throw e;
  }
  return data;
};

async function stableId(prefix,...parts){
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(parts.map(text).join('\u001f')));
  return `${prefix}-${[...new Uint8Array(hash)].slice(0,12).map(x=>x.toString(16).padStart(2,'0')).join('').toUpperCase()}`;
}

function propText(x){
  const nested=first(x?.variation_prop,x?.variationProp,x?.VariationProp,x?.prop,x?.Prop);
  if(nested&&typeof nested==='object')return text(first(nested?.value,nested?.Value,nested?.name,nested?.Name,nested?.title,nested?.Title,nested?.label,nested?.Label));
  return text(first(nested,x?.value,x?.Value,x?.name,x?.Name,x?.title,x?.Title,x?.label,x?.Label));
}
function variantName(v){
  const props=firstList(v?.variation_props,v?.variationProps,v?.VariationProps,v?.props,v?.Props).map(propText).filter(Boolean);
  const direct=[first(v?.color,v?.Color),first(v?.size,v?.Size)].map(text).filter(Boolean).join(' — ');
  return text(first(props.join(' — '),direct,v?.name,v?.Name,v?.title,v?.Title,'متغير'));
}
function activeFlag(v,{product=false}={}){
  const explicit=first(v?.active,v?.Active,product?first(v?.published,v?.Published):undefined);
  if(explicit===false||explicit===0||text(explicit).toLowerCase()==='false')return false;
  const status=text(first(v?.status,v?.Status)).toLowerCase();
  return !(product?['draft','archived','inactive','disabled']:['draft','archived','inactive','disabled']).includes(status);
}
function normalizeVariant(v,i){
  return {
    externalId:text(first(v?.id,v?.Id,v?.ID,v?.variant_id,v?.variantId,v?.VariantId,v?.external_id,v?.externalId,v?.ExternalId,i)),
    name:variantName(v),
    sku:text(first(v?.sku,v?.SKU,v?.code,v?.Code,v?.taager_code,v?.taagerCode,v?.TaagerCode)),
    price:num(first(v?.sale_price,v?.salePrice,v?.SalePrice,v?.price,v?.Price)),
    stock:Math.max(0,num(first(v?.stock,v?.Stock,v?.quantity,v?.Quantity,v?.inventory_quantity,v?.inventoryQuantity,v?.InventoryQuantity))),
    active:activeFlag(v)
  };
}
function normalizeProduct(p,i){
  const variants=firstList(p?.variants,p?.Variants,p?.options,p?.Options).map(normalizeVariant);
  const variantStock=variants.reduce((sum,v)=>sum+v.stock,0);
  const parentStock=Math.max(0,num(first(p?.stock,p?.Stock,p?.quantity,p?.Quantity,p?.inventory_quantity,p?.inventoryQuantity,p?.InventoryQuantity)));
  const categories=firstList(p?.categories,p?.Categories).map(x=>text(first(x?.name,x?.Name,x))).filter(Boolean).join('، ');
  const images=firstList(p?.images,p?.Images,p?.image?[p.image]:[],p?.Image?[p.Image]:[]).map(x=>text(first(x?.src,x?.Src,x?.url,x?.Url,x))).filter(Boolean);
  return {
    externalId:text(first(p?.id,p?.Id,p?.ID,p?.product_id,p?.productId,p?.ProductId,p?.external_id,p?.externalId,p?.ExternalId,i)),
    name:text(first(p?.name,p?.Name,p?.title,p?.Title)),
    sku:text(first(p?.sku,p?.SKU,p?.code,p?.Code,p?.taager_code,p?.taagerCode,p?.TaagerCode)),
    price:num(first(p?.sale_price,p?.salePrice,p?.SalePrice,p?.price,p?.Price,p?.regular_price,p?.regularPrice,p?.RegularPrice)),
    stock:variants.length?variantStock:parentStock,
    category:text(first(p?.category?.name,p?.Category?.Name,p?.category_name,p?.categoryName,p?.CategoryName,categories)),
    active:activeFlag(p,{product:true}),
    images,
    variants
  };
}
function rows(data){return firstList(data?.data?.products,data?.data?.Products,data?.Data?.Products,data?.data?.items,data?.data?.Items,data?.Data?.Items,data?.products,data?.Products,data?.items,data?.Items,data?.data,data?.Data,data);}
async function get(fetcher,url,headers){return json(await fetcher(url,{method:'GET',headers:{Accept:'application/json',...headers}}));}

function easyOrdersProfiles(config){
  const preferred=text(config?.authentication);
  return [...EASYORDERS_AUTH_PROFILES].sort((a,b)=>Number(b.id===preferred)-Number(a.id===preferred));
}
function productKey(p,i){return text(first(p?.id,p?.Id,p?.ID,p?.product_id,p?.productId,p?.ProductId,p?.external_id,p?.externalId,p?.ExternalId,p?.sku,p?.SKU,p?.taager_code,p?.taagerCode,p?.TaagerCode,`row-${i}`));}
async function fetchAllEasyOrdersProducts({secrets,config,fetcher}){
  const key=text(secrets?.api_key);
  if(!key)throw Object.assign(new Error('مفتاح Easy Orders API غير موجود'),{status:409,code:'EASYORDERS_API_KEY_MISSING'});
  const failures=[];
  for(const profile of easyOrdersProfiles(config)){
    const all=[],seen=new Set();
    try{
      for(let page=1;page<=EASYORDERS_MAX_PAGES;page++){
        const url=new URL(profile.url);
        url.searchParams.set('page',String(page));
        url.searchParams.set('limit',String(EASYORDERS_PAGE_SIZE));
        url.searchParams.set('join','Variations.Props,Variants.VariationProps');
        const payload=await get(fetcher,url.toString(),profile.headers(key)),batch=rows(payload);
        let added=0;
        for(const [i,p] of batch.entries()){
          const id=productKey(p,(page-1)*EASYORDERS_PAGE_SIZE+i);
          if(seen.has(id))continue;
          seen.add(id);all.push(p);added++;
        }
        if(batch.length<EASYORDERS_PAGE_SIZE||added===0)break;
        if(page===EASYORDERS_MAX_PAGES)throw Object.assign(new Error('عدد صفحات منتجات Easy Orders تجاوز حد الأمان. قلل النتائج أو راجع إعدادات المتجر.'),{status:409,code:'EASYORDERS_PRODUCT_PAGINATION_LIMIT'});
      }
      return all.map(normalizeProduct);
    }catch(error){
      failures.push({profile:profile.id,status:Number(error?.status)||0,message:error?.message||String(error)});
      if(![0,401,404].includes(Number(error?.status)||0)&&Number(error?.status)!==403)throw error;
    }
  }
  const statuses=failures.map(x=>x.status).filter(Boolean);
  if(statuses.includes(403))throw Object.assign(new Error('مفتاح Easy Orders لا يملك صلاحية products:read المطلوبة لاستيراد المنتجات'),{status:403,code:'EASYORDERS_PRODUCTS_READ_FORBIDDEN'});
  throw Object.assign(new Error('تعذر قراءة منتجات Easy Orders بطريقتي الاتصال الموثقتين. أعد اختبار الربط ثم حاول مرة أخرى.'),{status:502,code:'EASYORDERS_PRODUCT_IMPORT_CONNECTIVITY_FAILED'});
}

const ADAPTERS={
  easyorders:{fetchProducts:fetchAllEasyOrdersProducts},
  shopify:{async fetchProducts({secrets,config,fetcher}){
    const domain=text(first(config.shopDomain,config.storeUrl,secrets.shop_domain)).replace(/^https?:\/\//,'').replace(/\/$/,'');
    if(!domain)throw Object.assign(new Error('رابط متجر Shopify غير محفوظ في إعدادات الربط'),{status:409,code:'SHOPIFY_DOMAIN_MISSING'});
    return rows(await get(fetcher,`https://${domain}/admin/api/2026-07/products.json?limit=250`,{'X-Shopify-Access-Token':secrets.access_token})).map(normalizeProduct);
  }},
  woocommerce:{async fetchProducts({secrets,config,fetcher}){
    const base=text(first(config.storeUrl,secrets.store_url)).replace(/\/$/,'');
    if(!base)throw Object.assign(new Error('رابط متجر WooCommerce غير محفوظ في إعدادات الربط'),{status:409,code:'WOOCOMMERCE_URL_MISSING'});
    const url=new URL(`${base}/wp-json/wc/v3/products`);
    url.searchParams.set('per_page','100');url.searchParams.set('consumer_key',secrets.consumer_key);url.searchParams.set('consumer_secret',secrets.consumer_secret);
    return rows(await get(fetcher,url.toString(),{})).map(normalizeProduct);
  }}
};

function parseConfig(row){try{return JSON.parse(row?.config_json||'{}')}catch{return {};}}
function scopes(row,provider){try{const saved=JSON.parse(row?.scopes_json||'[]');return Array.isArray(saved)&&saved.length?saved:provider.capabilities;}catch{return provider.capabilities;}}

export async function eligibleCommerceImports(env,clientId,storeId){
  const {results=[]}=await env.DB.prepare("SELECT id,provider,status,scopes_json,config_json FROM store_connections WHERE client_id=? AND status='connected' ORDER BY updated_at DESC").bind(clientId).all(),seen=new Set(),out=[];
  for(const row of results){
    const provider=providerById(row.provider);
    if(!provider||provider.category!=='commerce'||!ADAPTERS[row.provider]||!scopes(row,provider).includes('products.read')||seen.has(row.provider))continue;
    const config=parseConfig(row),boundStore=text(config.storeId||config.kunStoreId);
    if(storeId&&boundStore&&boundStore!==storeId)continue;
    seen.add(row.provider);out.push({connectionId:row.id,provider:provider.id,name:provider.name,label:`استيراد من ${provider.name}`,capabilities:provider.capabilities});
  }
  return out;
}
async function connection(env,{clientId,storeId,providerId}){
  const item=(await eligibleCommerceImports(env,clientId,storeId)).find(x=>x.provider===providerId);
  if(!item)throw Object.assign(new Error('هذا المزود غير متصل أو لا يدعم صلاحية products.read'),{status:409,code:'PRODUCT_IMPORT_NOT_AVAILABLE'});
  const row=await env.DB.prepare('SELECT * FROM store_connections WHERE id=? AND client_id=?').bind(item.connectionId,clientId).first();
  return {item,row,adapter:ADAPTERS[providerId],secrets:await readConnectionSecrets(env,clientId,row.id),config:parseConfig(row)};
}
export async function pullCommerceProducts(env,{clientId,storeId,providerId,fetcher=fetch}){
  const c=await connection(env,{clientId,storeId,providerId}),products=(await c.adapter.fetchProducts({...c,fetcher})).filter(x=>x.name&&(x.externalId||x.sku));
  return {...c,products};
}
function selectedProducts(products,args){
  if(text(args.selectionMode||'all')!=='selected')return products;
  const selected=new Set(list(args.selectedExternalIds).map(text).filter(Boolean));
  if(!selected.size)throw Object.assign(new Error('حدد منتجًا واحدًا على الأقل للاستيراد'),{status:400,code:'PRODUCT_IMPORT_SELECTION_REQUIRED'});
  const chosen=products.filter(p=>selected.has(text(p.externalId)));
  if(!chosen.length)throw Object.assign(new Error('المنتجات المحددة لم تعد موجودة لدى مزود المتجر. حدّث المعاينة وحاول مرة أخرى.'),{status:409,code:'PRODUCT_IMPORT_SELECTION_STALE'});
  return chosen;
}
async function classify(env,{clientId,storeId,providerId,products}){
  const result=[];
  for(const p of products){
    const id=await stableId('IMP',clientId,storeId||'',providerId,p.externalId||p.sku),existing=await env.DB.prepare("SELECT id FROM products WHERE client_id=? AND store_id IS ? AND (id=? OR (?<>'' AND LOWER(sku)=LOWER(?))) LIMIT 1").bind(clientId,storeId||null,id,p.sku,p.sku).first();
    result.push({...p,id,action:existing?'updated':'created',existingId:existing?.id||null});
  }
  return result;
}
export async function previewCommerceImport(env,args){
  const pulled=await pullCommerceProducts(env,args),items=await classify(env,{...args,products:pulled.products});
  return {provider:pulled.item.provider,name:pulled.item.name,total:items.length,created:items.filter(x=>x.action==='created').length,updated:items.filter(x=>x.action==='updated').length,skipped:0,errors:[],items:items.map(x=>({externalId:x.externalId,name:x.name,sku:x.sku,price:x.price,stock:x.stock,category:x.category,action:x.action,variants:x.variants.length,images:x.images.length}))};
}
export async function importCommerceProducts(env,args){
  const pulled=await pullCommerceProducts(env,args),chosen=selectedProducts(pulled.products,args),items=await classify(env,{...args,products:chosen}),selectionMode=text(args.selectionMode||'all')==='selected'?'selected':'all',summary={provider:pulled.item.provider,name:pulled.item.name,selectionMode,total:items.length,created:0,updated:0,skipped:0,errors:[]},ts=new Date().toISOString();
  for(const p of items){
    try{
      const productId=p.existingId||p.id;
      await env.DB.prepare(`INSERT INTO products (${PRODUCT_COLS}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,sku=excluded.sku,category=excluded.category,price=excluded.price,active=excluded.active,stock=excluded.stock`).bind(productId,args.clientId,args.storeId||null,p.name,p.sku,p.category,p.price,0,p.active?1:0,p.stock,5,ts).run();
      for(const [i,v] of p.variants.entries()){
        const variantId=await stableId('IMV',args.clientId,args.storeId||'',args.providerId,p.externalId||p.sku,v.externalId||v.sku||i),match=await env.DB.prepare("SELECT id FROM product_variants WHERE client_id=? AND store_id IS ? AND product_id=? AND (id=? OR (?<>'' AND LOWER(sku)=LOWER(?))) LIMIT 1").bind(args.clientId,args.storeId||null,productId,variantId,v.sku,v.sku).first();
        await env.DB.prepare('INSERT INTO product_variants (id,product_id,client_id,store_id,name,sku,stock,price,active,created_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,sku=excluded.sku,stock=excluded.stock,price=excluded.price,active=excluded.active').bind(match?.id||variantId,productId,args.clientId,args.storeId||null,v.name,v.sku,v.stock,v.price||null,v.active?1:0,ts).run();
      }
      summary[p.action]++;
    }catch(error){summary.errors.push({externalId:p.externalId,sku:p.sku,name:p.name,message:error?.message||String(error)});}
  }
  summary.skipped=summary.total-summary.created-summary.updated-summary.errors.length;
  await env.DB.prepare('UPDATE store_connections SET last_sync_at=?,last_error=?,updated_at=? WHERE id=? AND client_id=?').bind(ts,summary.errors.length?`${summary.errors.length} product import errors`:null,ts,pulled.row.id,args.clientId).run();
  return summary;
}
export const normalizeCommerceProduct=normalizeProduct;
export const commerceProductImportAdapters=Object.freeze(Object.keys(ADAPTERS));
