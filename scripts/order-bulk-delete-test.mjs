import {readFile} from 'node:fs/promises';
const read=p=>readFile(new URL(`../${p}`,import.meta.url),'utf8');
const must=(ok,msg)=>{if(!ok)throw new Error(msg)};
const [ui,index,pkg]=await Promise.all([read('public/v2/modules-v41-order-bulk-delete.js'),read('public/v2/index.html'),read('package.json')]);
for(const marker of ['data-v41-order-select','data-v41-order-select-all','تحديد كل الظاهر','إلغاء التحديد','حذف المحدد','تم تحديد ${count} طلب','selected=new Set','workerCount=Math.min(6','Promise.all(workers)','confirm(`هل أنت متأكد من حذف ${ids.length} طلب؟'])must(ui.includes(marker),`bulk order UI missing ${marker}`);
for(const marker of ["['admin','client','ops']",'/api/customer-service/orders/${encodeURIComponent(orderId)}/delete',"method:'DELETE'",'K.scope()','failed.length','if(typeof load===\'function\')await load()'])must(ui.includes(marker),`bulk order delete safety missing ${marker}`);
must(index.includes('modules-v41-order-bulk-delete.js?v=41.0'),'bulk order delete module is not loaded');
must(pkg.includes('test:order-bulk-delete'),'bulk order delete test is not registered');
console.log('Bulk order delete contract passed: visible multi-select, select-all, permission-preserving delete, confirmation, bounded concurrency and partial-failure reporting are wired.');
