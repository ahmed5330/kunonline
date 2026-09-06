const text=v=>String(v??'').trim();
const r2=v=>Math.round((Number(v)||0)*100)/100;
const norm=v=>text(v).normalize('NFKC').toLowerCase().replace(/[\u064b-\u065f]/g,'').replace(/[،,;|]+/g,' | ').replace(/\s+/g,' ').trim();
const phone=raw=>{let d=text(raw).replace(/[^\d]/g,'');if(d.startsWith('0020'))d='0'+d.slice(4);else if(d.startsWith('20')&&d.length===12)d='0'+d.slice(2);else if(d.startsWith('00966'))d='0'+d.slice(5);else if(d.startsWith('966')&&d.length===12)d='0'+d.slice(3);return d||text(raw);};
const day=v=>{const s=text(v);if(/^\d{4}-\d{2}-\d{2}/.test(s))return s.slice(0,10);const d=new Date(s);return Number.isNaN(d.getTime())?'':d.toISOString().slice(0,10);};
const stamp=v=>{const d=new Date(text(v));return Number.isNaN(d.getTime())?null:d.getTime();};
const closeTime=(a,b,maxMinutes=20)=>{const x=stamp(a),y=stamp(b);return x!==null&&y!==null&&Math.abs(x-y)<=maxMinutes*60000;};
const variation=v=>norm(v).split('|').map(x=>x.trim()).filter(Boolean).sort((a,b)=>a.localeCompare(b,'ar')).join('|');
const itemKey=i=>[norm(i.sku),norm(i.productName),variation(i.variantLabel),r2(i.qty),r2(i.unitPrice),r2(i.lineTotal)].join('¦');
const sortItems=items=>items.map(i=>({sku:text(i.sku),productName:text(i.productName),variantLabel:text(i.variantLabel),qty:r2(i.qty||1),unitPrice:r2(i.unitPrice),lineTotal:r2(i.lineTotal||r2(i.unitPrice)*r2(i.qty||1))})).sort((a,b)=>itemKey(a).localeCompare(itemKey(b),'ar'));

export function normalizeEasyOrdersPayload(input){
  const root=input&&typeof input==='object'&&!Array.isArray(input)?input:{},nested=[root.data?.order,root.order,root.payload?.order,root.payload,root.data].find(x=>x&&typeof x==='object'&&!Array.isArray(x)),p={...(nested||root)};
  if(root.event_type&&!p.event_type)p.event_type=root.event_type;if(root.eventType&&!p.event_type)p.event_type=root.eventType;if(p.eventType&&!p.event_type)p.event_type=p.eventType;
  if(root.store_id&&!p.store_id)p.store_id=root.store_id;if(root.storeId&&!p.store_id)p.store_id=root.storeId;if(p.storeId&&!p.store_id)p.store_id=p.storeId;
  if(p.orderId&&!p.order_id)p.order_id=p.orderId;if(p.cartItems&&!p.cart_items)p.cart_items=p.cartItems;if(p.fullName&&!p.full_name)p.full_name=p.fullName;
  if(p.shippingCost!==undefined&&p.shipping_cost===undefined)p.shipping_cost=p.shippingCost;if(p.totalCost!==undefined&&p.total_cost===undefined)p.total_cost=p.totalCost;if(p.createdAt&&!p.created_at)p.created_at=p.createdAt;
  return p;
}
function easyItems(p){return sortItems((Array.isArray(p.cart_items)?p.cart_items:[]).map((x,index)=>{const props=x?.variant?.variation_props||x?.variation_props||[];const variant=props.map(v=>`${text(v.variation||v.name)}: ${text(v.variation_prop||v.value)}`).filter(x=>x!==': ').join(' | ')||text(x?.variant?.name||x?.variant_name||x?.variant);const q=Math.max(1,Number(x.quantity)||1),unit=Number(x.price??x.unit_price??x?.variant?.price??x?.product?.price)||0;return {lineKey:text(x.id)||`easy-${index+1}`,sku:text(x.sku||x?.variant?.sku||x?.product?.sku),productName:text(x?.product?.name||x.product_name||x.name),variantLabel:variant,qty:q,unitPrice:unit,lineTotal:Number(x.total??x.line_total)||unit*q};}));}
function sheetItems(row){const source=Array.isArray(row.items)&&row.items.length?row.items:[{product:row.product,variant:row.productNote,qty:row.qty,sku:row.sku,unitPrice:row.unitPrice,lineTotal:row.lineTotal}];return sortItems(source.filter(x=>text(x.product||x.productName||x.sku)).map(x=>{const q=Math.max(1,Number(x.qty)||1),unit=Number(x.unitPrice)||0;return {sku:text(x.sku),productName:text(x.product||x.productName),variantLabel:text(x.variant||x.variantLabel||x.productNote),qty:q,unitPrice:unit,lineTotal:Number(x.lineTotal)||unit*q};}));}
function easySnapshot(p){const items=easyItems(p);return {name:norm(p.full_name),phone:phone(p.phone),gov:norm(p.government||p.city),address:norm(p.address),date:day(p.created_at),createdAt:text(p.created_at),total:r2(p.total_cost),shipping:r2(p.shipping_cost),qty:r2(items.reduce((s,x)=>s+x.qty,0)),items};}
function sheetSnapshot(row){const items=sheetItems(row);return {name:norm(row.name),phone:phone(row.phone),gov:norm(row.gov),address:norm(row.address),date:day(row.createdAt||row.date),createdAt:text(row.createdAt||row.date),total:r2(row.total),shipping:r2(row.shippingCost),qty:r2(items.reduce((s,x)=>s+x.qty,0)||Number(row.qty)||1),items};}
async function dbSnapshot(env,order){let {results:rows=[]}=await env.DB.prepare('SELECT sku,product_name,variant_label,qty,unit_price,line_total FROM order_items WHERE order_id=? AND client_id=? AND qty>0 ORDER BY id').bind(order.id,order.client_id).all();let items=sortItems(rows.map(x=>({sku:x.sku,productName:x.product_name,variantLabel:x.variant_label,qty:x.qty,unitPrice:x.unit_price,lineTotal:x.line_total})));
  if(!items.length&&!text(order.product).includes(' + ')){items=sortItems([{sku:'',productName:order.product,variantLabel:order.product_note,qty:Number(order.qty)||1,unitPrice:Number(order.unit_price)||0,lineTotal:(Number(order.unit_price)||0)*(Number(order.qty)||1)}]);}
  return {name:norm(order.name),phone:phone(order.phone),gov:norm(order.gov),address:norm(order.address),date:day(order.created_at||order.date),createdAt:text(order.created_at||order.date),total:r2(order.total),shipping:r2(order.shipping_cost),qty:r2(order.qty),items};
}
function sameSnapshot(a,b,{requireCloseTime=false}={}){if(!a||!b)return false;for(const key of ['name','phone','gov','address','date'])if(String(a[key]??'')!==String(b[key]??''))return false;for(const key of ['total','shipping','qty'])if(r2(a[key])!==r2(b[key]))return false;if(requireCloseTime&&!closeTime(a.createdAt,b.createdAt))return false;if(!a.items.length||a.items.length!==b.items.length)return false;for(let i=0;i<a.items.length;i++)if(itemKey(a.items[i])!==itemKey(b.items[i]))return false;return true;}
async function defaultStore(env,clientId){const row=await env.DB.prepare("SELECT id FROM stores WHERE client_id=? AND status='active' ORDER BY is_default DESC,created_at LIMIT 1").bind(clientId).first();return row?.id||null;}
function parseConfig(row){try{return JSON.parse(row?.config_json||'{}')}catch{return {};}}
async function audit(env,{clientId,storeId,orderId,externalId,direction}){try{await env.DB.prepare('INSERT INTO audit_log (id,client_id,store_id,actor_email,action,entity_type,entity_id,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(`AUD-${crypto.randomUUID().slice(0,10).toUpperCase()}`,clientId,storeId||null,'system','order.dedupe.easyorders_sheet','order',orderId,JSON.stringify({externalId,direction,match:'strict_full_order'}),new Date().toISOString()).run();}catch{}}

export async function prepareIncomingEasyOrdersDedupe(env,{connectionId,payload}={}){
  const p=normalizeEasyOrdersPayload(payload);if(!p.id||p.event_type==='order-status-update')return {matched:false,payload:p};
  const connection=await env.DB.prepare("SELECT client_id,config_json FROM store_connections WHERE id=? AND provider='easyorders' AND status='connected'").bind(connectionId).first();if(!connection)return {matched:false,payload:p};
  const clientId=connection.client_id,config=parseConfig(connection),storeId=text(config.kunStoreId||config.storeId)||await defaultStore(env,clientId),externalId=text(p.id),ref=`easyorders:${externalId}`;if(!storeId)return {matched:false,payload:p};
  const native=await env.DB.prepare('SELECT id FROM orders WHERE client_id=? AND store_id IS ? AND (id=? OR ref=?) LIMIT 1').bind(clientId,storeId,externalId,ref).first();if(native)return {matched:false,payload:p,clientId,storeId,nativeOrderId:native.id};
  const target=easySnapshot(p),{results=[]}=await env.DB.prepare("SELECT * FROM orders WHERE client_id=? AND store_id IS ? AND source LIKE 'شيت easyorders%' AND phone=? AND date(COALESCE(date,created_at))=date(?) AND ROUND(COALESCE(total,0),2)=? ORDER BY created_at DESC LIMIT 30").bind(clientId,storeId,target.phone,target.date,target.total).all();
  for(const row of results){const current=await dbSnapshot(env,row);if(!sameSnapshot(target,current,{requireCloseTime:true}))continue;await env.DB.prepare("UPDATE orders SET ref=?,source='المتجر (Easy Orders)' WHERE id=? AND client_id=?").bind(ref,row.id,clientId).run();await audit(env,{clientId,storeId,orderId:row.id,externalId,direction:'webhook_into_sheet'});return {matched:true,payload:p,clientId,storeId,orderId:row.id,externalId};}
  return {matched:false,payload:p,clientId,storeId};
}

export async function prepareEasyOrdersSheetRows(env,{clientId,storeId,rows=[]}={}){
  const out=[],matchedOrderIds=[];for(const raw of Array.isArray(rows)?rows:[]){const row={...raw},target=sheetSnapshot(row),given=text(row.externalId||row.orderId||row.externalOrderId||row.platformId);if(!target.phone||!target.date){out.push(row);continue;}
    const {results=[]}=await env.DB.prepare("SELECT * FROM orders WHERE client_id=? AND store_id IS ? AND (ref LIKE 'easyorders:%' OR source='المتجر (Easy Orders)') AND phone=? AND date(COALESCE(date,created_at))=date(?) AND ROUND(COALESCE(total,0),2)=? ORDER BY created_at DESC LIMIT 30").bind(clientId,storeId,target.phone,target.date,target.total).all();let hit=null;
    for(const candidate of results){const ext=text(candidate.ref).replace(/^easyorders:/i,'')||text(candidate.id),sameId=given&&(given===ext||given===text(candidate.id));if(!sameId&&!closeTime(target.createdAt,candidate.created_at))continue;const current=await dbSnapshot(env,candidate);if(sameSnapshot(target,current,{requireCloseTime:!sameId})){hit={candidate,ext};break;}}
    if(hit){row.externalId=hit.ext;matchedOrderIds.push(hit.candidate.id);}out.push(row);
  }return {rows:out,matchedOrderIds:[...new Set(matchedOrderIds)],deduplicated:matchedOrderIds.length};
}

export async function persistEasyOrdersLineItems(env,{clientId,storeId,orderId,payload,skip=false}={}){
  if(skip||!orderId||!clientId)return {saved:0,skipped:true};const allocated=await env.DB.prepare("SELECT COUNT(*) n FROM order_item_stock_allocations WHERE order_id=? AND client_id=? AND status='allocated'").bind(orderId,clientId).first();if(Number(allocated?.n||0)>0)return {saved:0,skipped:true,reason:'allocated_sheet_items'};
  const p=normalizeEasyOrdersPayload(payload),items=easyItems(p),ts=new Date().toISOString();if(!items.length)return {saved:0};await env.DB.prepare('DELETE FROM order_items WHERE order_id=? AND client_id=?').bind(orderId,clientId).run();let saved=0;
  for(let i=0;i<items.length;i++){const x=items[i],key=`easy:${i+1}:${norm(x.sku||x.productName)}:${variation(x.variantLabel)}`.slice(0,240);await env.DB.prepare('INSERT INTO order_items (id,order_id,client_id,store_id,line_key,product_id,variant_id,sku,product_name,variant_label,qty,unit_price,line_total,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(`OIT-${crypto.randomUUID().slice(0,10).toUpperCase()}`,orderId,clientId,storeId||null,key,null,null,x.sku||null,x.productName,x.variantLabel||null,x.qty,x.unitPrice,x.lineTotal,ts,ts).run();saved++;}return {saved};
}

export async function restoreNativeSourceForMatchedSheetOrders(env,{clientId,storeId,orderIds=[]}={}){const ids=[...new Set(orderIds.filter(Boolean))];if(!ids.length)return 0;const marks=ids.map(()=>'?').join(',');const r=await env.DB.prepare(`UPDATE orders SET source='المتجر (Easy Orders)' WHERE client_id=? AND store_id IS ? AND id IN (${marks}) AND ref LIKE 'easyorders:%'`).bind(clientId,storeId,...ids).run();return Number(r?.meta?.changes||0);}

export const __dedupeTest={norm,phone,day,variation,sameSnapshot,easySnapshot,sheetSnapshot,itemKey};
