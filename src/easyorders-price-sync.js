import {pullCommerceProducts} from './commerce-product-import.js';

const clean=value=>String(value??'').trim();
const num=value=>Number.isFinite(Number(value))?Number(value):0;
async function stableId(prefix,...parts){const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(parts.map(clean).join('\u001f')));return `${prefix}-${[...new Uint8Array(hash)].slice(0,12).map(x=>x.toString(16).padStart(2,'0')).join('').toUpperCase()}`;}
function parseConfig(row){try{return JSON.parse(row?.config_json||'{}')}catch{return {};}}
async function storeForConnection(env,row){
  const config=parseConfig(row),bound=clean(config.storeId||config.kunStoreId);if(bound)return bound;
  const {results=[]}=await env.DB.prepare('SELECT id FROM stores WHERE client_id=? ORDER BY created_at,id LIMIT 2').bind(row.client_id).all();
  return results.length===1?clean(results[0].id):'';
}
async function syncConnection(env,row){
  const storeId=await storeForConnection(env,row);if(!storeId)return {connectionId:row.id,clientId:row.client_id,skipped:true,reason:'STORE_BINDING_REQUIRED',productsChanged:0,variantsChanged:0};
  const pulled=await pullCommerceProducts(env,{clientId:row.client_id,storeId,providerId:'easyorders'}),result={connectionId:row.id,clientId:row.client_id,storeId,productsSeen:pulled.products.length,productsChanged:0,variantsChanged:0,skipped:false};
  for(const product of pulled.products){
    const importedId=await stableId('IMP',row.client_id,storeId,'easyorders',product.externalId||product.sku),match=await env.DB.prepare("SELECT id,price FROM products WHERE client_id=? AND store_id IS ? AND (id=? OR (?<>'' AND LOWER(sku)=LOWER(?))) LIMIT 1").bind(row.client_id,storeId,importedId,product.sku||'',product.sku||'').first();
    if(!match)continue;const nextPrice=num(product.price);if(Number(match.price)!==nextPrice){await env.DB.prepare('UPDATE products SET price=? WHERE id=? AND client_id=?').bind(nextPrice,match.id,row.client_id).run();result.productsChanged++;}
    for(const [index,variant] of (product.variants||[]).entries()){
      const importedVariantId=await stableId('IMV',row.client_id,storeId,'easyorders',product.externalId||product.sku,variant.externalId||variant.sku||index),variantMatch=await env.DB.prepare("SELECT id,price FROM product_variants WHERE client_id=? AND store_id IS ? AND product_id=? AND (id=? OR (?<>'' AND LOWER(sku)=LOWER(?))) LIMIT 1").bind(row.client_id,storeId,match.id,importedVariantId,variant.sku||'',variant.sku||'').first();
      if(!variantMatch)continue;const nextVariantPrice=num(variant.price)||null,current=variantMatch.price===null?null:Number(variantMatch.price);if(current!==nextVariantPrice){await env.DB.prepare('UPDATE product_variants SET price=? WHERE id=? AND client_id=?').bind(nextVariantPrice,variantMatch.id,row.client_id).run();result.variantsChanged++;}
    }
  }
  return result;
}
export async function syncEasyOrdersPrices(env,{clientId=null,limitConnections=40}={}){
  const binds=[];let where="provider='easyorders' AND status='connected'";if(clientId){where+=' AND client_id=?';binds.push(clientId);}const {results=[]}=await env.DB.prepare(`SELECT id,client_id,config_json,updated_at FROM store_connections WHERE ${where} ORDER BY updated_at DESC LIMIT ?`).bind(...binds,Math.max(1,Math.min(100,Number(limitConnections)||40))).all();
  const summary={ok:true,connections:results.length,synced:0,skipped:0,productsChanged:0,variantsChanged:0,errors:[]};
  for(const row of results){try{const item=await syncConnection(env,row);if(item.skipped)summary.skipped++;else summary.synced++;summary.productsChanged+=item.productsChanged||0;summary.variantsChanged+=item.variantsChanged||0;}catch(error){summary.errors.push({connectionId:row.id,clientId:row.client_id,message:error?.message||String(error),code:error?.code||null});}}
  return summary;
}
