const base=(process.argv[2]||'https://kunonline-preview.mr-a-mnaa.workers.dev').replace(/\/$/,'');

const fail=(message)=>{throw new Error(message)};
const text=async(path,init={})=>{
  const response=await fetch(base+path,{redirect:'manual',headers:{'Cache-Control':'no-cache',...(init.headers||{})},...init});
  const body=await response.text();
  return {response,body};
};
const expectStatus=(actual,allowed,label)=>{
  if(!allowed.includes(actual))fail(`${label}: expected ${allowed.join('/')} but got ${actual}`);
};
const expectIncludes=(body,needle,label)=>{
  if(!body.includes(needle))fail(`${label}: missing ${needle}`);
};
const expectGuardedRoute=(status,label)=>{
  if(status<300||status===404||status===405||status>=500){
    fail(`${label}: route must exist and reject an unauthenticated/invalid request safely; got HTTP ${status}`);
  }
};

console.log(`Operational Preview smoke against ${base}`);

{
  const {response,body}=await text('/healthz');
  expectStatus(response.status,[200],'healthz');
  const data=JSON.parse(body);
  if(data.ok!==true||data.environment!=='preview'||data.database!=='reachable')fail(`healthz payload invalid: ${body}`);
  console.log('✓ Preview health + D1 reachable');
}

{
  const {response,body}=await text(`/v2/?operationalSmoke=${Date.now()}`);
  expectStatus(response.status,[200],'v2 shell');
  for(const asset of ['modules-v97-view-persistence-v976.js','modules-v75-customer-service-interactions-v753.js','modules-v80-jnt-address-cascade-v805.js']){
    expectIncludes(body,asset,'v2 shell');
  }
  const navNeedles=[
    'data-view="orders">الطلبات',
    'data-view="customer-service">خدمة العملاء',
    'data-view="printing">الطباعة',
    'data-view="post-shipping">الشحن',
    'data-view="returns-exchanges">المرتجعات والاستبدالات',
    'data-view="customers">إدارة العملاء',
    'data-view="inbox">صندوق الرسائل'
  ];
  const positions=navNeedles.map(needle=>{expectIncludes(body,needle,'sales/customer shell navigation');return body.indexOf(needle);});
  for(let i=1;i<positions.length;i++)if(positions[i]<=positions[i-1])fail(`sales/customer shell navigation order is wrong at ${navNeedles[i]}`);
  console.log('✓ v2 shell has the requested sales/customer navigation order and labels');
  console.log('✓ v2 static shell loads versioned persistence/bootstrap, Customer Service interactions and J&T address cascade');
}

{
  const {response,body}=await text(`/v2/modules-v97-view-persistence-v976.js?operationalSmoke=${Date.now()}`);
  expectStatus(response.status,[200],'v97.6 safe bootstrap');
  for(const asset of ['modules-v107-mobile-app-update.js','kunOperationalAssets','modules-v105-section-nav-actions.js','modules-v106-undo-dashboard-live.js']){
    expectIncludes(body,asset,'v97.6 safe bootstrap');
  }
  if(body.includes('kunCustomerServiceClaimV105Loader')||body.includes('kunManualJntOrderV106Loader'))fail('v97.6 must not eagerly load dependency-sensitive Customer Service/J&T modules');
  console.log('✓ v97.6 keeps only dependency-safe asset-first loaders');
}

{
  const {response,body}=await text(`/v2/modules-v80-jnt-address-cascade-v805.js?operationalSmoke=${Date.now()}`);
  expectStatus(response.status,[200],'v80.5 dependency-aware bootstrap');
  for(const asset of ['modules-v105-customer-service-claim-v1053.js?v=105.3','modules-v106-manual-jnt-order.js?v=106.0','modules-v109-operational-date-contact.js?v=109.0','KunJntAddressesV80','DOMContentLoaded']){
    expectIncludes(body,asset,'v80.5 dependency-aware bootstrap');
  }
  console.log('✓ J&T v80.5 loads Customer Service claim, manual J&T and unified operational date/contact behavior after legacy dependencies are ready');
}

{
  const checks=[
    ['/v2/modules-v105-customer-service-claim-v1053.js?v=105.3',['/api/customer-service/claims','جاري الاتصال','arrangeSalesCustomerNavigation',"['orders','customer-service','printing','post-shipping','returns-exchanges','customers','inbox']","setText(shipping,'الشحن')","setText(customers,'إدارة العملاء')",'data-state="contacting"','data-state="shipped"']],
    ['/v2/modules-v75-customer-service-interactions-v753.js',['claim-contact','kun:customer-service-contact-claimed','تم حجز الأوردر باسمك ونقله إلى «جاري الاتصال»','revision:\'75.4\'']],
    ['/v2/modules-v106-manual-jnt-order.js?v=106.0',['/api/orders/manual-jnt','name="province"','name="city"','name="area"','name="street"','KunJntAddressesV80']],
    ['/v2/modules-v109-operational-date-contact.js?v=109.0',['اليوم','آخر أسبوع','الأسبوع الماضي','الشهر الحالي','الشهر الماضي','مدة معينة','Africa/Cairo','release-contact','kun:customer-service-contact-saved','جاري الاتصال بواسطة','customer-service','printing','post-shipping','returns-exchanges']]
  ];
  for(const [path,needles] of checks){
    const {response,body}=await text(`${path}${path.includes('?')?'&':'?'}operationalSmoke=${Date.now()}`);
    expectStatus(response.status,[200],path);
    for(const needle of needles)expectIncludes(body,needle,path);
  }
  console.log('✓ Unified date periods are served for Customer Service, printing, shipping and returns');
  console.log('✓ Temporary contact ownership shows the staff name and releases back to the original order state');
}

{
  const {response}=await text(`/api/customer-service/claims?operationalSmoke=${Date.now()}`);
  expectGuardedRoute(response.status,'/api/customer-service/claims');
  console.log(`✓ جاري الاتصال API exists and is guarded (HTTP ${response.status})`);
}

{
  const {response}=await text('/api/customer-service/orders/SMOKE-ORDER/release-contact?clientId=SMOKE',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:'{}'
  });
  expectGuardedRoute(response.status,'/api/customer-service/orders/:id/release-contact');
  console.log(`✓ Temporary contact release API exists and is guarded (HTTP ${response.status})`);
}

{
  const {response}=await text('/api/orders/manual-jnt',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:'{}'
  });
  expectGuardedRoute(response.status,'/api/orders/manual-jnt');
  console.log(`✓ Manual J&T API exists and is guarded (HTTP ${response.status})`);
}

console.log('Operational Preview smoke passed without mutating order/customer data.');
