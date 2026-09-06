import {readFile} from 'node:fs/promises';
const read=p=>readFile(new URL(`../${p}`,import.meta.url),'utf8');
const must=(ok,msg)=>{if(!ok)throw new Error(msg)};
const [ui,jnt,index,entry,financials,wrangler]=await Promise.all([
  read('public/v2/modules-v59-shipping-sheet-import.js'),
  read('public/v2/modules-v60-jnt-sheet.js'),
  read('public/v2/index.html'),
  read('src/index-commerce-v36.js'),
  read('src/carrier-financials.js'),
  read('wrangler.preview.toml')
]);
new Function(ui);new Function(jnt);
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

for(const marker of ['Waybill','Waybill status','Client Order No.','COD amount','COD Service Fee','Reference delivery fees','Insurance Fee','Fuel Surcharge','Box price','Abnormal parcel description','Sign Time','Returning parcel sign-in time','Sender name'])must(jnt.includes(marker),`Dedicated J&T importer missing real sheet field: ${marker}`);
for(const marker of ["['delivered','شيت تم التسليم (Signed)']","['returned','شيت المرتجع (Returned)']",'اكتشاف تلقائي / اختر النوع'])must(jnt.includes(marker),`Dedicated J&T sheet type UX missing: ${marker}`);
must(jnt.includes('window.KunShippingSheetV59?.parseFile'),'J&T importer must reuse the governed XLSX/CSV parser');
must(jnt.includes('indexes.awb.get')&&jnt.includes('indexes.ids.get')&&!/phone\).*match|match.*phone/i.test(jnt),'J&T matching must prefer Waybill then Client Order No/reference, never phone');
must(jnt.includes('Waybill مختلف عن البوليصة المسجلة'),'J&T order-number fallback must block an AWB mismatch');
must(jnt.includes("item.kind==='finance-only'")&&jnt.includes("base==='returned'")&&jnt.includes("['signed','collected'].includes(base)"),'Historical Signed/Returned rows must support finance-only reconciliation without state downgrade');
must(jnt.includes('/carrier-financials')&&jnt.includes("provider:'jnt'")&&jnt.includes("carrierName:'J&T Express'"),'J&T rows must persist carrier financials before state settlement');
must(jnt.includes('COD Service Fee')&&jnt.includes('عمولة تحصيل منفصلة')&&jnt.includes('الاتنين بيتخصموا من الربح'),'J&T UX must explain shipping fee and COD collection commission are separate expenses');
must(jnt.includes('item.returnReason?`مرتجع حسب شيت J&T — ${item.returnReason}`'),'J&T return must preserve Abnormal parcel description as the governed return reason');
must(jnt.includes("type==='returned'?r2(-totalCarrierFees):r2(codAmount-totalCarrierFees)"),'J&T preview must not treat return COD as receivable and must show delivered net after fees');
must(jnt.includes('concurrency=Math.min(4')&&jnt.includes('const fresh=await buildPreview()'),'J&T bulk apply must be bounded and revalidate immediately before mutation');
must(jnt.includes('option[value="jnt"]')&&jnt.includes('option.remove()'),'Generic importer must hand J&T to its dedicated real-sheet flow');

for(const marker of ['carrierFinancialMath',"type:'carrier_financials'",'previousAncillary','baseOther','nextOther','codServiceFee','order.carrier_financials'])must(financials.includes(marker),`Carrier financial reconciliation missing: ${marker}`);
must(financials.includes("sheetType==='returned'?r2(-totalCarrierFees):r2(cod-totalCarrierFees)"),'Backend carrier math must treat return rows as a cost only');
must(financials.includes('baseOther=r2(n(row.other_cost)-previousAncillary)')&&financials.includes('nextOther=r2(baseOther+financials.ancillaryFee)'),'Repeated sheet imports must replace prior carrier ancillary charges without erasing manual other costs');
must(entry.includes("from './carrier-financials.js'")&&entry.includes('/carrier-financials')&&entry.includes('carrierFinancials:true'),'Active Preview entrypoint must expose carrier financial reconciliation');

must(index.includes('modules-v59-shipping-sheet-import.js?v=59.0'),'Generic shipping sheet importer asset is not loaded');
must(index.includes('modules-v60-jnt-sheet.js?v=60.0'),'Dedicated J&T Signed/Returned importer asset is not loaded');
must(index.indexOf('modules-v59-shipping-sheet-import.js')<index.indexOf('modules-v60-jnt-sheet.js'),'J&T importer must load after the shared XLSX parser');
must(wrangler.includes('main = "src/index-commerce-v36.js"'),'Preview must use the v36 stock guard wrapper');
for(const marker of ['returned','restocked=0','explicitInventoryLinks','restoreLegacyReturnFlagIfStillReturned','SyncEntrypoint'])must(entry.includes(marker),`Returned-order reconfirmation guard missing: ${marker}`);
const {carrierFinancialMath}=await import('../src/carrier-financials.js');
const signed=carrierFinancialMath({sheetType:'delivered',codAmount:690,shippingCost:106.59,codServiceFee:7.87});
must(signed.totalCarrierFees===114.46&&signed.expectedNet===575.54,`Real J&T Signed math mismatch: ${JSON.stringify(signed)}`);
const returned=carrierFinancialMath({sheetType:'returned',codAmount:490,shippingCost:95.93,codServiceFee:0});
must(returned.totalCarrierFees===95.93&&returned.expectedNet===-95.93,`Real J&T Returned math mismatch: ${JSON.stringify(returned)}`);
console.log('Post-shipping carrier sheet contract passed: generic carriers remain supported, while J&T uses its real Signed/Returned columns, separate delivery/COD fees, finance-only reconciliation, return reasons and idempotent accounting.');
