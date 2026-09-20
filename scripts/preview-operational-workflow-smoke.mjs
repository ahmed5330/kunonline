const base=(process.argv[2]||'https://kunonline-preview.mr-a-mnaa.workers.dev').replace(/\/$/,'');

const fail=(message)=>{throw new Error(message)};
const text=async(path,init={})=>{
  const response=await fetch(base+path,{redirect:'manual',...init});
  const body=await response.text();
  return {response,body};
};
const expectStatus=(actual,allowed,label)=>{
  if(!allowed.includes(actual))fail(`${label}: expected ${allowed.join('/')} but got ${actual}`);
};
const expectIncludes=(body,needle,label)=>{
  if(!body.includes(needle))fail(`${label}: missing ${needle}`);
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
  const {response,body}=await text('/v2/');
  expectStatus(response.status,[200],'v2 shell');
  for(const asset of ['modules-v105-customer-service-claim.js','modules-v105-section-nav-actions.js','modules-v106-manual-jnt-order.js','modules-v75-customer-service-interactions-v753.js']){
    expectIncludes(body,asset,'v2 shell');
  }
  console.log('✓ v2 shell loads the new operational modules');
}

{
  const checks=[
    ['/v2/modules-v105-customer-service-claim.js',['/api/customer-service/claims','جاري الاتصال','قسم الشحن','data-state="contacting"','data-state="shipped"']],
    ['/v2/modules-v75-customer-service-interactions-v753.js',['claim-contact','kun:customer-service-contact-claimed','تم حجز الأوردر باسمك ونقله إلى «جاري الاتصال»']],
    ['/v2/modules-v105-section-nav-actions.js',['KunSectionNavActionsV105','kun-section-nav-actions']],
    ['/v2/modules-v106-manual-jnt-order.js',['/api/orders/manual-jnt','province','city','area','street','KunJntAddressesV80']]
  ];
  for(const [path,needles] of checks){
    const {response,body}=await text(path);
    expectStatus(response.status,[200],path);
    for(const needle of needles)expectIncludes(body,needle,path);
  }
  console.log('✓ Claim ownership, contacting board, Shipping presentation and manual J&T modules are served');
}

{
  const {response}=await text('/api/customer-service/claims');
  expectStatus(response.status,[400,401,403],'/api/customer-service/claims unauthenticated/invalid-scope guard');
  console.log('✓ جاري الاتصال API route exists and rejects an unauthenticated/invalid-scope request');
}

{
  const {response}=await text('/api/orders/manual-jnt',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:'{}'
  });
  expectStatus(response.status,[400,401,403],'/api/orders/manual-jnt unauthenticated/invalid-payload guard');
  console.log('✓ Manual J&T API route exists and rejects an unauthenticated/invalid request');
}

{
  const {response,body}=await text('/api/mobile/app-update');
  expectStatus(response.status,[200],'mobile app update feed');
  const data=JSON.parse(body);
  if(!Number.isInteger(data.versionCode)||data.versionCode<107||!data.apkUrl)fail(`mobile update feed invalid: ${body}`);
  console.log(`✓ Android update feed active: ${data.versionName} (${data.versionCode})`);
}

console.log('Operational Preview smoke passed without mutating order/customer data.');
