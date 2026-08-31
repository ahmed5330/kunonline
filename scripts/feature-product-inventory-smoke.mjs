const base=(process.argv[2]||'').replace(/\/$/,'');
if(!base)throw new Error('Usage: node scripts/feature-product-inventory-smoke.mjs <base-url>');
async function read(path){const r=await fetch(`${base}${path}`,{redirect:'follow'}),body=await r.text();if(!r.ok)throw new Error(`${path} returned ${r.status}: ${body.slice(0,500)}`);return body;}
function markers(body,path,items){for(const marker of items)if(!body.includes(marker))throw new Error(`${path} missing marker: ${marker}`);}
const shell=await read('/v2/');markers(shell,'/v2/',['modules-v37-inventory.js?v=37.0','modules-v53-stock-clear.js?v=53.0']);
const productImport=await read('/v2/modules-v29-product-import.js');markers(productImport,'modules-v29-product-import.js',['استيراد كل المنتجات','استيراد المنتجات المحددة','commerceImportSearch','selectedExternalIds']);
const inventory=await read('/v2/modules-v37-inventory.js');markers(inventory,'modules-v37-inventory.js',['تاريخ المخزون','/api/inventory/stock-adjust','/api/inventory/stock-log','سجل إضافات المخزون','وقت التسجيل']);
const clearUi=await read('/v2/modules-v53-stock-clear.js');markers(clearUi,'modules-v53-stock-clear.js',['تصفير الكمية','data-v53-clear-stock','/api/inventory/products/','دفعات الاستوك المسماة']);
for(const [path,method] of [['/api/inventory/stock-log','GET'],['/api/commerce/product-import/providers','GET'],['/api/inventory/products/anonymous-test/clear','POST']]){const r=await fetch(`${base}${path}`,{method,headers:{'Content-Type':'application/json'},body:method==='POST'?'{}':undefined}),body=await r.text();if(![401,403].includes(r.status))throw new Error(`${method} ${path} must reject anonymous access; got ${r.status}: ${body.slice(0,300)}`);}
console.log('Feature smoke passed: Easy Orders product import + dated inventory/history + clear-all stock UI are deployed, and inventory APIs reject anonymous access.');
