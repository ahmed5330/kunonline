import {readFile} from 'node:fs/promises';
const read=p=>readFile(new URL(`../${p}`,import.meta.url),'utf8');
const must=(ok,msg)=>{if(!ok)throw new Error(msg)};
const [ui,index,entry,wrangler]=await Promise.all([
  read('public/v2/modules-v59-shipping-sheet-import.js'),
  read('public/v2/index.html'),
  read('src/index-commerce-v36.js'),
  read('wrangler.preview.toml')
]);
new Function(ui);
for(const marker of ['J&T Express','Bosta','Mylerz','ShipBlu','Aramex','iMile','شركة أخرى / شيت عام'])must(ui.includes(marker),`Shipping carrier choice missing: ${marker}`);
for(const marker of ["['delivered','تم التوصيل']","['returned','المرتجعات']","['shipped','جاري الشحن']","['all','الكل — حسب حالة كل صف']"])must(ui.includes(marker),`Shipping sheet type missing: ${marker}`);
for(const marker of ['parseXlsx','DecompressionStream','parseDelimited','.xlsx','.csv'])must(ui.includes(marker),`CSV/XLSX parser capability missing: ${marker}`);
for(const marker of ['data-ps59-map="awb"','data-ps59-map="orderId"','data-ps59-map="status"','data-ps59-map="shippingCost"'])must(ui.includes(marker),`Sheet column mapping missing: ${marker}`);
must(ui.includes("const returned=['return'")&&ui.includes("const delivered=['delivered'")&&ui.includes("const shipped=['shipped'"),'All-sheet status classification groups are missing');
must(ui.includes("if(['signed','collected','returned','cancelled'].includes(baseState)||current==='collecting')")&&ui.includes('لن يتم إرجاع الأوردر'),'Stale shipping sheets must not downgrade delivered/final orders back to shipped');
must(ui.includes("if(baseState==='collected')return {kind:'blocked'")&&ui.includes('يحتاج مراجعة يدوية'),'Collected orders must not be auto-returned from a carrier sheet');
must(ui.includes("if(!state.mapping.awb&&!state.mapping.orderId)"),'Matching must require AWB or order/reference');
must(!/phone\).*match|match.*phone/i.test(ui),'Carrier sheet matching must not use phone numbers');
must(ui.includes("sourceSection:'post-shipping-sheet'")&&ui.includes('مرتجع حسب شيت'),'Carrier returns must use governed return workflow with an auditable reason');
must(ui.includes("concurrency=Math.min(4")&&ui.includes('buildPreview()'),'Bulk apply must be bounded and revalidate before applying');
must(index.includes('modules-v59-shipping-sheet-import.js?v=59.0'),'Shipping sheet importer asset is not loaded');
must(wrangler.includes('main = "src/index-commerce-v36.js"'),'Preview must use the v36 stock guard wrapper');
for(const marker of ['returned','restocked=0','explicitInventoryLinks','restoreLegacyReturnFlagIfStillReturned','SyncEntrypoint'])must(entry.includes(marker),`Returned-order reconfirmation guard missing: ${marker}`);
console.log('Post-shipping carrier sheet contract passed: carrier/type selection, CSV/XLSX parsing, safe AWB/order matching, status classification, stale-status guards, governed returns and v36 reconfirmation stock protection are wired.');
