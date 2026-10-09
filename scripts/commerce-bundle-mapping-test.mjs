import assert from 'node:assert/strict';
import {normalizeBundleChanges,validateBundleChanges,saveBundleChange,commerceBundleOptions} from '../src/commerce-bundle-mapping.js';
const products=new Map([['SKU-1',{id:'SKU-1',name:'نظارة',stock:15}],['SKU-2',{id:'SKU-2',name:'جراب',stock:8}],['BND-ID',{id:'BND-ID',name:'باكدج',stock:2}]]);
const rows=new Map(),sqlLog=[];
const env={DB:{prepare(sql){return{bind(...args){
 return {
   async run(){sqlLog.push([sql,args]);if(sql.startsWith('INSERT INTO commerce_bundle_mappings'))rows.set(args[3],{external_id:args[3],product_id:args[4],components_json:args[5],updated_at:args[6]});if(sql.startsWith('DELETE FROM commerce_bundle_mappings'))rows.delete(args[3]);return{success:true};},
   async first(){
     if(sql.startsWith('SELECT id FROM products WHERE id=?')){const [id,cid,sid]=args;return cid==='C1'&&sid==='S1'&&products.has(id)?{id}:null;}
     if(sql.startsWith('SELECT external_id FROM commerce_bundle_mappings')){const [productId,cid,sid]=args;return cid==='C1'&&sid==='S1'?[...rows.values()].find(r=>r.product_id===productId)||null:null;}
     throw Error('Unsupported SQL first '+sql);
   },
   async all(){
     if(sql.startsWith('SELECT id,name,sku,category,stock FROM products'))return {results:[...products.values()]};
     if(sql.startsWith('SELECT external_id,product_id,components_json'))return {results:[...rows.values()]};
     throw Error('Unsupported SQL all '+sql);
   }
 };
 }};}}};
const scope={clientId:'C1',storeId:'S1',providerId:'easyorders'};
const imported=[{externalId:'EXT1',id:'BND-ID',existingId:'BND-ID'}];
assert.deepEqual(normalizeBundleChanges(undefined,{selectedExternalIds:['EXT1']}),{},'Omitted mapping must preserve all existing links');
assert.deepEqual(normalizeBundleChanges({},{selectedExternalIds:['EXT1']}),{},'Empty mapping must preserve legacy import even without store');
assert.deepEqual(normalizeBundleChanges({EXT1:[]},{providerId:'easyorders',storeId:'S1',selectedExternalIds:['EXT1']}),{EXT1:[]},'Explicit [] clears existing mapping');
let change=normalizeBundleChanges({EXT1:[{productId:'SKU-1',quantity:1},{productId:'SKU-2',quantity:2}]},{providerId:'easyorders',storeId:'S1',selectedExternalIds:['EXT1']});
assert.equal(change.EXT1.length,2);
await validateBundleChanges(env,{...scope,changes:change,items:imported});
await saveBundleChange(env,{...scope,externalId:'EXT1',productId:'BND-ID',components:change.EXT1});
let options=await commerceBundleOptions(env,scope);
assert.equal(options.mappings.EXT1.components.length,2);
assert.equal(options.mappings.EXT1.components[1].quantity,2);
assert.equal(options.products.length,3);
assert.throws(()=>normalizeBundleChanges({OTHER:[]},{providerId:'easyorders',storeId:'S1',selectedExternalIds:['EXT1']}),/خارج نطاق/);
assert.throws(()=>normalizeBundleChanges({EXT1:[{productId:'SKU-1',quantity:0}]},{providerId:'easyorders',storeId:'S1',selectedExternalIds:['EXT1']}),/كمية/);
assert.throws(()=>normalizeBundleChanges({EXT1:[{productId:'SKU-1',quantity:1},{productId:'SKU-1',quantity:2}]},{providerId:'easyorders',storeId:'S1',selectedExternalIds:['EXT1']}),/تكرار/);
assert.throws(()=>normalizeBundleChanges({EXT1:[{productId:'SKU-1',quantity:1}]},{providerId:'shopify',storeId:'S1',selectedExternalIds:['EXT1']}),/Easy Orders/);
await assert.rejects(validateBundleChanges(env,{...scope,changes:{EXT1:[{productId:'BND-ID',quantity:1}]},items:imported}),/نفسه/);
await assert.rejects(validateBundleChanges(env,{...scope,changes:{EXT1:[{productId:'FOREIGN',quantity:1}]},items:imported}),/المتجر الحالي/);
await assert.rejects(validateBundleChanges(env,{...scope,changes:{EXT1:[{productId:'SKU-1',quantity:1}]},items:[{externalId:'EXT1',existingId:'SKU-1'}]}),/نفسه/);
await saveBundleChange(env,{...scope,externalId:'EXT1',productId:'BND-ID',components:[]});
options=await commerceBundleOptions(env,scope);
assert.equal(options.mappings.EXT1,undefined,'Unlink deletes only mapping metadata, never inventory products');
assert.equal(products.size,3,'Bundle operations cannot mutate source product stock');
assert.equal(sqlLog.some(([sql])=>/UPDATE products|DELETE FROM products|INSERT INTO orders/.test(sql)),false);
console.log('Optional bundle mapping contract PASSED: default untouched, strict store scope, existing SKU components, quantity validation, explicit stage/remove, no product or stock writes.');
