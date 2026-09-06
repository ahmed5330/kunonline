import {readFile} from 'node:fs/promises';
import {randomBytes,webcrypto} from 'node:crypto';

const base=(process.argv[2]||'').replace(/\/$/,'');
if(!base)throw new Error('Usage: node scripts/live-preview-shipping-smart-sync-test.mjs <base-url>');
const accountId=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
if(!accountId||!token)throw new Error('Preview Smart Shipping QA requires Cloudflare account/token environment');
const config=await readFile(new URL('../wrangler.preview.toml',import.meta.url),'utf8'),databaseId=config.match(/database_id\s*=\s*"([^"]+)"/)?.[1];
if(!databaseId)throw new Error('Preview database_id missing');
const nonce=randomBytes(5).toString('hex').toUpperCase(),clientId=`QA-SS-${nonce}`,storeId=`QA-SS-ST-${nonce}`,productId=`QA-SS-PR-${nonce}`,userId=`QA-SS-US-${nonce}`,email=`qa-smart-shipping-${nonce.toLowerCase()}@example.test`,password=`SmartShip!${randomBytes(12).toString('hex')}Aa1`,today=new Date().toISOString().slice(0,10),d1Url=`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;let cookie='';

async function d1(sql,params=[]){const r=await fetch(d1Url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({sql,params})}),p=await r.json().catch(()=>({})),x=p?.result?.[0];if(!r.ok||p.success===false||x?.success===false)throw new Error(`Preview D1 query failed (${r.status}): ${JSON.stringify(p?.errors||x?.error||p).slice(0,900)}`);return x?.results||[];}
async function hashPassword(value){const salt=randomBytes(16),key=await webcrypto.subtle.importKey('raw',new TextEncoder().encode(value),'PBKDF2',false,['deriveBits']),bits=await webcrypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:100000,hash:'SHA-256'},key,256);return `pbkdf2$100000$${salt.toString('base64')}$${Buffer.from(bits).toString('base64')}`;}
async function api(path,{method='GET',body,ok=[200]}={}){const r=await fetch(`${base}${path}`,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)}),txt=await r.text();let data={};try{data=JSON.parse(txt)}catch{data={raw:txt}}if(!ok.includes(r.status))throw new Error(`${method} ${path} expected ${ok.join('/')}, got ${r.status}: ${txt.slice(0,900)}`);return {status:r.status,data};}
const qs=()=>`clientId=${encodeURIComponent(clientId)}&storeId=${encodeURIComponent(storeId)}`;
const orderIdOf=data=>data?.id||data?.order?.id||data?.orderId||null;
async function cleanup(){for(const [sql,params] of [
  ['DELETE FROM order_item_stock_allocations WHERE client_id=?',[clientId]],['DELETE FROM order_stock_allocations WHERE client_id=?',[clientId]],['DELETE FROM order_items WHERE client_id=?',[clientId]],['DELETE FROM order_billing WHERE client_id=?',[clientId]],['DELETE FROM order_notes WHERE client_id=?',[clientId]],['DELETE FROM order_events WHERE client_id=?',[clientId]],['DELETE FROM order_attribution WHERE client_id=?',[clientId]],['DELETE FROM whatsapp_outbox WHERE client_id=?',[clientId]],['DELETE FROM orders WHERE client_id=?',[clientId]],['DELETE FROM customers WHERE client_id=?',[clientId]],['DELETE FROM inventory_batch_items WHERE client_id=?',[clientId]],['DELETE FROM inventory_batches WHERE client_id=?',[clientId]],['DELETE FROM stock_log WHERE client_id=?',[clientId]],['DELETE FROM product_variants WHERE client_id=?',[clientId]],['DELETE FROM products WHERE client_id=?',[clientId]],['DELETE FROM audit_log WHERE client_id=?',[clientId]],['DELETE FROM user_store_access WHERE client_id=?',[clientId]],['DELETE FROM stores WHERE client_id=?',[clientId]],['DELETE FROM login_attempts WHERE email=?',[email]],['DELETE FROM users WHERE id=?',[userId]]
]){try{await d1(sql,params)}catch{}}}
async function productStock(){return Number((await d1('SELECT stock FROM products WHERE id=? AND client_id=?',[productId,clientId]))[0]?.stock||0);}
async function allocationQty(orderId){return Number((await d1("SELECT COALESCE(SUM(qty),0) qty FROM order_item_stock_allocations WHERE order_id=? AND client_id=? AND status='allocated'",[orderId,clientId]))[0]?.qty||0);}
async function makeOrder({name,phone,total,qty=1,linkProduct=false,state='pending'}){
  const created=(await api('/api/orders',{method:'POST',ok:[200,201],body:{clientId,storeId,name,phone,gov:'القاهرة',address:'QA Smart Shipping',product:'QA Smart Shipping Product',qty,total,source:'manual',date:today,state:'pending'}})).data,orderId=orderIdOf(created);if(!orderId)throw new Error(`QA order create failed: ${JSON.stringify(created)}`);
  if(linkProduct){await api(`/api/customer-service/orders/${encodeURIComponent(orderId)}/edit?${qs()}`,{method:'PATCH',body:{clientId,storeId,name,phone,gov:'القاهرة',address:'QA Smart Shipping',total,customerNote:'shipping smart live QA',items:[{productId,productName:'QA Smart Shipping Product',qty,unitPrice:total/qty}]}});}
  if(state!=='pending')await d1('UPDATE orders SET state=?,checkpoint=? WHERE id=? AND client_id=?',[state,state==='confirmed'?'تم التأكيد':state,orderId,clientId]);
  return orderId;
}
async function matchRow(row){return (await api('/api/post-shipping/shipping-sheet-match',{method:'POST',body:{clientId,storeId,rows:[row]}})).data.matches?.[0];}
async function applySheet(orderId,body,{ok=[200]}={}){return api(`/api/post-shipping/orders/${encodeURIComponent(orderId)}/shipping-sheet-apply?${qs()}`,{method:'PATCH',body:{clientId,storeId,...body},ok});}

let primaryError=null;
try{
  await cleanup();const ts=new Date().toISOString(),hash=await hashPassword(password);
  await d1('INSERT INTO stores (id,client_id,name,code,currency,timezone,status,is_default,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',[storeId,clientId,'QA Smart Shipping Store',`SS-${nonce}`,'EGP','Africa/Cairo','active',1,ts,ts]);
  await d1('INSERT INTO products (id,client_id,store_id,name,sku,category,price,cost,active,stock,low_stock_threshold,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',[productId,clientId,storeId,'QA Smart Shipping Product',`SS-${nonce}`,'QA',325,120,1,0,2,ts]);
  await d1('INSERT INTO users (id,email,name,password,role,client_id,status,created_at,last_login) VALUES (?,?,?,?,?,NULL,?,?,NULL)',[userId,email,'QA Smart Shipping Admin',hash,'admin','active',ts]);
  const login=await fetch(`${base}/api/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})}),loginText=await login.text();if(!login.ok)throw new Error(`Smart Shipping admin login failed ${login.status}: ${loginText.slice(0,500)}`);cookie=(login.headers.get('set-cookie')||'').split(';')[0];if(!cookie)throw new Error('Smart Shipping admin cookie missing');

  const firstBatch=(await api('/api/inventory/batches',{method:'POST',ok:[201],body:{clientId,storeId,name:'QA Smart Shipping Initial',stockDate:today,note:'smart shipping idempotency',items:[{productId,qty:10}]}})).data;if(!firstBatch.id)throw new Error('Initial Smart Shipping inventory batch missing');
  if(await productStock()!==10)throw new Error('Initial Smart Shipping product stock must be 10');

  // Order A is already fully allocated by normal confirmation. Shipping sync must NEVER deduct it again.
  const nameA='أحمد محمد علي',phoneA='01012345678',orderA=await makeOrder({name:nameA,phone:phoneA,total:650,qty:2,linkProduct:true});
  await api(`/api/customer-service/orders/${encodeURIComponent(orderA)}/state?${qs()}`,{method:'PATCH',body:{clientId,storeId,state:'confirmed'}});
  if(await productStock()!==8||await allocationQty(orderA)!==2)throw new Error(`Normal confirmation did not allocate exactly 2 units: stock=${await productStock()} allocation=${await allocationQty(orderA)}`);
  await api(`/api/customer-service/orders/${encodeURIComponent(orderA)}/state?${qs()}`,{method:'PATCH',body:{clientId,storeId,state:'shipped'}});

  const matchedA=await matchRow({rowNo:2,phone:'+20 10 1234 5678',name:'احمد محمد على',amount:650,target:'delivered'});
  if(!matchedA?.matched||matchedA.order?.id!==orderA||matchedA.matchedBy!=='phone-name-amount'||Number(matchedA.score)<90)throw new Error(`Composite phone/name/COD live match failed: ${JSON.stringify(matchedA)}`);
  for(const field of ['name','phone','total'])if(field in (matchedA.order||{}))throw new Error(`Smart match leaked PII field ${field}`);

  const carrierA={provider:'qa',carrierName:'QA Carrier',sheetType:'delivered',codAmount:650,shippingCost:70,codServiceFee:5,sourceFile:'qa-live.csv'};
  const appliedA=(await applySheet(orderA,{target:'delivered',shippingCost:70,carrierName:'QA Carrier',sourceFile:'qa-live.csv',carrierFinancials:carrierA})).data;
  if(!appliedA.inventoryAlreadySynced||appliedA.inventoryAllocatedNow)throw new Error(`Already-allocated order must be reported as already synced: ${JSON.stringify(appliedA)}`);
  if(await productStock()!==8||await allocationQty(orderA)!==2)throw new Error('First carrier sync deducted an already allocated order again');
  const repeatedA=(await applySheet(orderA,{target:'delivered',shippingCost:70,carrierName:'QA Carrier',sourceFile:'qa-live.csv',carrierFinancials:carrierA})).data;
  if(!repeatedA.inventoryAlreadySynced||repeatedA.inventoryAllocatedNow||await productStock()!==8||await allocationQty(orderA)!==2)throw new Error(`Repeated carrier sync must be stock-idempotent: ${JSON.stringify(repeatedA)}`);

  // Order B simulates a historical/legacy confirmed order that never deducted stock. First carrier sync must deduct once, second sync must not.
  const orderB=await makeOrder({name:'منى السيد',phone:'01123456789',total:325,qty:1,linkProduct:true,state:'confirmed'});
  if(await allocationQty(orderB)!==0||await productStock()!==8)throw new Error('Legacy unsynced QA setup unexpectedly allocated stock');
  const appliedB=(await applySheet(orderB,{target:'delivered',shippingCost:65,carrierName:'QA Carrier',sourceFile:'qa-live.csv',carrierFinancials:{provider:'qa',carrierName:'QA Carrier',sheetType:'delivered',codAmount:325,shippingCost:65,codServiceFee:4,sourceFile:'qa-live.csv'}})).data;
  if(!appliedB.inventoryAllocatedNow||appliedB.inventoryAlreadySynced)throw new Error(`Previously unsynced order must allocate exactly once: ${JSON.stringify(appliedB)}`);
  if(await productStock()!==7||await allocationQty(orderB)!==1)throw new Error(`Unsynced order did not deduct one unit exactly once: stock=${await productStock()} allocation=${await allocationQty(orderB)}`);
  const repeatedB=(await applySheet(orderB,{target:'delivered',shippingCost:65,carrierName:'QA Carrier',sourceFile:'qa-live.csv',carrierFinancials:{provider:'qa',carrierName:'QA Carrier',sheetType:'delivered',codAmount:325,shippingCost:65,codServiceFee:4,sourceFile:'qa-live.csv'}})).data;
  if(!repeatedB.inventoryAlreadySynced||repeatedB.inventoryAllocatedNow||await productStock()!==7||await allocationQty(orderB)!==1)throw new Error('Second sync of newly reconciled order deducted stock twice');

  // Same phone/name/value on two live candidates must stop as ambiguous instead of picking an arbitrary order.
  const ambiguousPhone='01234567890',ambiguousName='عميل مكرر للاختبار';
  await makeOrder({name:ambiguousName,phone:ambiguousPhone,total:900,state:'confirmed'});await makeOrder({name:ambiguousName,phone:ambiguousPhone,total:900,state:'confirmed'});
  const ambiguous=await matchRow({rowNo:3,phone:ambiguousPhone,name:ambiguousName,amount:900,target:'delivered'});
  if(ambiguous?.matched||!ambiguous?.ambiguous)throw new Error(`Ambiguous composite live match must be blocked: ${JSON.stringify(ambiguous)}`);

  // A shortage must create a persistent privacy blocker with zero partial deduction; adding stock + retry completes it.
  const blockedName='عميل مخزون ناقص',blockedPhone='01555555555',orderBlocked=await makeOrder({name:blockedName,phone:blockedPhone,total:6500,qty:20,linkProduct:true,state:'confirmed'}),stockBeforeBlock=await productStock();
  const blocked=await applySheet(orderBlocked,{target:'delivered',shippingCost:80,carrierName:'QA Carrier',sourceFile:'qa-live.csv',carrierFinancials:{provider:'qa',carrierName:'QA Carrier',sheetType:'delivered',codAmount:6500,shippingCost:80,codServiceFee:10,sourceFile:'qa-live.csv'}},{ok:[409]});
  if(blocked.data.code!=='STOCK_FIFO_INSUFFICIENT'||!blocked.data.inventoryBlocked)throw new Error(`Shortage must return a persistent inventory blocker: ${JSON.stringify(blocked.data)}`);
  if(await productStock()!==stockBeforeBlock||await allocationQty(orderBlocked)!==0)throw new Error('Shortage path must not partially deduct inventory');
  const board=(await api(`/api/customer-service?${qs()}`)).data,redacted=(board.orders||[]).find(order=>String(order.id)===String(orderBlocked));
  if(!redacted?.inventoryBlocked||redacted.phone!==''||redacted.total!==null||String(redacted.name||'').includes(blockedName))throw new Error(`Blocked order must stay redacted on the operational board: ${JSON.stringify(redacted)}`);
  await api('/api/inventory/batches',{method:'POST',ok:[201],body:{clientId,storeId,name:'QA Smart Shipping Repair',stockDate:today,note:'retry after shortage',items:[{productId,qty:20}]}});
  const retried=(await api(`/api/post-shipping/orders/${encodeURIComponent(orderBlocked)}/shipping-sheet-retry?${qs()}`,{method:'PATCH',body:{clientId,storeId}})).data;
  if(!retried.ok||!retried.inventoryAllocatedNow)throw new Error(`Inventory retry did not complete pending shipping workflow: ${JSON.stringify(retried)}`);
  const blockedState=(await d1('SELECT state,history FROM orders WHERE id=? AND client_id=?',[orderBlocked,clientId]))[0];if(blockedState?.state!=='signed'||!String(blockedState?.history||'').includes('shipping_sheet_inventory_resolved'))throw new Error(`Resolved shortage did not finish delivery/clear blocker: ${JSON.stringify(blockedState)}`);

  console.log('Live Smart Shipping QA passed: unique phone+name+COD matching works without exposing PII; fully allocated orders never deduct again; legacy unsynced orders deduct exactly once; repeated sheets are idempotent; ambiguous rows stop; shortage blocks privately and retry completes after stock is added.');
}catch(error){primaryError=error;}finally{await cleanup();}
if(primaryError)throw primaryError;
