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
  if(status<400||status===404||status===405||status>=500){
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
  for(const asset of ['modules-v105-customer-service-claim.js','modules-v106-manual-jnt-order.js','modules-v75-customer-service-interactions-v753.js']){
    expectIncludes(body,asset,'v2 shell');
  }
  console.log('✓ v2 shell loads Customer Service claim + interaction + manual J&T modules');
}

{
  const checks=[
    ['/v2/modules-v105-customer-service-claim.js?v=105.2',['/api/customer-service/claims','جاري الاتصال','قسم الشحن','data-state="contacting"','data-state="shipped"']],
    ['/v2/modules-v75-customer-service-interactions-v753.js',['claim-contact','kun:customer-service-contact-claimed','تم حجز الأوردر باسمك ونقله إلى «جاري الاتصال»']],
    ['/v2/modules-v106-manual-jnt-order.js?v=106.0',['/api/orders/manual-jnt','name="province"','name="city"','name="area"','name="street"','KunJntAddressesV80']]
  ];
  for(const [path,needles] of checks){
    const {response,body}=await text(`${path}${path.includes('?')?'&':'?'}operationalSmoke=${Date.now()}`);
    expectStatus(response.status,[200],path);
    for(const needle of needles)expectIncludes(body,needle,path);
  }
  console.log('✓ Contact ownership, جاري الاتصال, قسم الشحن and J&T address cascade code are served');
}

{
  const {response}=await text(`/api/customer-service/claims?operationalSmoke=${Date.now()}`);
  expectGuardedRoute(response.status,'/api/customer-service/claims');
  console.log(`✓ جاري الاتصال API exists and is guarded (HTTP ${response.status})`);
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
