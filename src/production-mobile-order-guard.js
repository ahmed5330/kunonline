/*
 * Production guard for manual orders created from the native Android app.
 *
 * Purpose:
 * - accept only J&T Egypt province/city/area combinations that exist in the
 *   authoritative static directory bundled with Kun Online;
 * - keep validation server-side as a second line of defence in addition to the
 *   native cascading selectors;
 * - make no database/schema changes and never mutate an order itself.
 */

const json=(data,status=200)=>new Response(JSON.stringify(data),{
  status,
  headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}
});

const clean=v=>String(v??'').trim();

async function assetJson(env,request,path){
  if(!env.ASSETS?.fetch)throw new Error('ASSETS_UNAVAILABLE');
  const url=new URL(path,request.url);
  const response=await env.ASSETS.fetch(url.toString());
  if(!response.ok)throw new Error(`ASSET_HTTP_${response.status}`);
  return response.json();
}

function isNativeManualOrder(request,payload){
  const mobile=clean(request.headers.get('X-Kun-Mobile')).toLowerCase();
  if(!mobile.startsWith('native-android/'))return false;
  return clean(payload?.source)==='تطبيق كن أونلاين' ||
    Boolean(payload?.province||payload?.provinceCode||payload?.city||payload?.cityCode||payload?.area||payload?.areaCode||payload?.districtCode);
}

function invalid(message,details={}){
  return json({
    ok:false,
    error:message,
    code:'JNT_ADDRESS_INVALID',
    ...details
  },400);
}

/**
 * Returns a Response only when a native manual order must be rejected.
 * Returns null when the request should continue to the normal production app.
 */
export async function handleProductionMobileOrderGuard({request,env}){
  const url=new URL(request.url);
  if(request.method!=='POST'||url.pathname!=='/api/orders')return null;

  let payload;
  try{
    payload=await request.clone().json();
  }catch{
    return null; // preserve the normal API's own JSON/body error behaviour
  }

  if(!isNativeManualOrder(request,payload))return null;

  const countryCode=clean(payload.addressCountryCode||payload.countryCode||'100000');
  const provinceName=clean(payload.province||payload.gov);
  const provinceCode=clean(payload.provinceCode);
  const cityName=clean(payload.city);
  const cityCode=clean(payload.cityCode);
  const areaName=clean(payload.area);
  const areaCode=clean(payload.areaCode||payload.districtCode);
  const street=clean(payload.street);

  if(countryCode!=='100000')return invalid('كود دولة J&T غير صحيح.');
  if(!provinceName||!provinceCode)return invalid('اختر محافظة J&T من القائمة المعتمدة.');
  if(!cityName||!cityCode)return invalid('اختر المدينة / الحي من قائمة J&T المعتمدة.');
  if(!areaName||!areaCode)return invalid('اختر المنطقة من قائمة J&T المعتمدة.');
  if(!street)return invalid('اكتب الشارع / العنوان التفصيلي.');

  try{
    const manifest=await assetJson(env,request,'/v2/data/jnt-addresses/index.json');
    if(clean(manifest.countryCode||'100000')!=='100000'){
      return json({ok:false,error:'دليل عناوين J&T غير متاح بصورة صحيحة حاليًا.',code:'JNT_DIRECTORY_INVALID'},503);
    }

    const provinces=Array.isArray(manifest.provinces)?manifest.provinces:[];
    const province=provinces.find(p=>clean(p.name)===provinceName&&clean(p.code)===provinceCode);
    if(!province)return invalid('المحافظة أو كود المحافظة لا يطابق دليل J&T الحالي.',{field:'province'});

    const provinceData=await assetJson(env,request,`/v2/data/jnt-addresses/${encodeURIComponent(clean(province.file))}`);
    const cities=Array.isArray(provinceData.cities)?provinceData.cities:[];
    const city=cities.find(c=>clean(c.name)===cityName&&clean(c.code)===cityCode);
    if(!city)return invalid('المدينة / الحي أو الكود لا يطابق المحافظة المختارة في J&T.',{field:'city'});

    const areas=Array.isArray(city.areas)?city.areas:[];
    const area=areas.find(a=>clean(a.name)===areaName&&clean(a.code)===areaCode);
    if(!area)return invalid('المنطقة أو كود المنطقة لا يطابق المدينة المختارة في J&T.',{field:'area'});

    return null;
  }catch(error){
    console.warn('J&T Android manual-order validation unavailable',String(error?.message||error));
    return json({
      ok:false,
      error:'تعذر التحقق من دليل عناوين J&T حاليًا. حاول مرة أخرى بعد لحظات.',
      code:'JNT_DIRECTORY_UNAVAILABLE'
    },503);
  }
}
