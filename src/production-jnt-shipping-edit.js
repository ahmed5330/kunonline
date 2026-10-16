import {resolveTenant} from './access-control.js';
import {resolveStoreScope} from './store-scope.js';

const respond=(payload,status=200)=>new Response(JSON.stringify(payload),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const clean=(value,max=200)=>String(value??'').trim().slice(0,max);
const error=(message,status,code)=>Object.assign(new Error(message),{status,code});
const parseHistory=value=>{try{const v=JSON.parse(value||'[]');return Array.isArray(v)?v:[];}catch{return [];}};
const blocked=new Set(['shipped','shipping','in_shipping','signed','collected','delivered','returned','cancelled','completed']);
const dataRoot='https://app.kun-online.com/v2/data/jnt-addresses';
async function validatedAddress(source,fetcher){
  const value=source&&typeof source==='object'&&!Array.isArray(source)?source:{};
  const province=clean(value.province,120),provinceCode=clean(value.provinceCode,40),city=clean(value.city,120),cityCode=clean(value.cityCode,40),cityKey=clean(value.cityKey,180),area=clean(value.area,160),areaCode=clean(value.areaCode||value.districtCode,40);
  const street=clean(value.street,1000),phone2=clean(value.phone2,80);
  const weight=Number(value.weight);
  if(!province||!provinceCode||!city||!cityCode||!area||!areaCode||!street)
    throw error('اختر محافظة ومدينة ومنطقة من دليل J&T واكتب عنوان العميل بالتفصيل',400,'JNT_ADDRESS_REQUIRED');
  if(!Number.isFinite(weight)||weight<=0||weight>1000)throw error('اكتب وزن الشحنة بالكيلو بصورة صحيحة',400,'JNT_WEIGHT_INVALID');
  try{
    const manifestResponse=await fetcher(`${dataRoot}/index.json?v=2026-09-09`);
    if(!manifestResponse.ok)throw Error('J&T manifest unavailable');
    const manifest=await manifestResponse.json();
    const p=(manifest.provinces||[]).find(x=>x.name===province&&String(x.code)===provinceCode);
    if(!p||!/^(p\d{2}\.json)$/.test(p.file))throw error('المحافظة أو الكود غير موجودين بدليل J&T',400,'JNT_PROVINCE_INVALID');
    const cityResponse=await fetcher(`${dataRoot}/${p.file}?v=2026-09-09`);
    if(!cityResponse.ok)throw Error('J&T cities unavailable');
    const choices=await cityResponse.json();
    const c=(choices.cities||[]).find(x=>x.name===city&&String(x.code)===cityCode&&(!cityKey||x.key===cityKey));
    if(!c)throw error('المدينة لا تتبع المحافظة المحددة في دليل J&T',400,'JNT_CITY_INVALID');
    const a=(c.areas||[]).find(x=>x.name===area&&String(x.code)===areaCode);
    if(!a)throw error('المنطقة لا تتبع المدينة المحددة في دليل J&T',400,'JNT_AREA_INVALID');
    return {country:'Egypt',countryCode:String(manifest.countryCode||'100000'),province,provinceCode,city,cityCode,cityKey:c.key,area,areaCode,street,phone2,weight};
  }catch(e){
    if(e.code)throw e;
    throw error('دليل مناطق J&T غير متاح الآن؛ لم يتم حفظ تعديل غير متحقق منه',503,'JNT_DIRECTORY_UNAVAILABLE');
  }
}

export async function handleProductionJntShippingEdit({request,env,ctx,delegate,fetcher=null}){
  const url=new URL(request.url),match=url.pathname.match(/^\/api\/orders\/([^/]+)\/shipping-jnt$/);
  if(!match)return null;
  if(request.method!=='PATCH')return respond({error:'الطريقة غير مدعومة'},405);
  try{
    const identityUrl=new URL(request.url);identityUrl.pathname='/api/me';identityUrl.search='';
    const identity=await delegate.fetch(new Request(identityUrl,{method:'GET',headers:request.headers}),env,ctx);
    const me=await identity.json().catch(()=>({}));
    if(!identity.ok||!me?.role)throw error('سجّل الدخول أولًا',401,'AUTH_REQUIRED');
    const body=await request.clone().json().catch(()=>({}));
    const clientId=resolveTenant(me,body.clientId||url.searchParams.get('clientId')||me.clientId||null);
    const storeId=clean(body.storeId||url.searchParams.get('storeId'),180);
    if(!storeId)throw error('حدد المتجر قبل تعديل عنوان شحن الطلب',400,'STORE_SELECTION_REQUIRED');
    await resolveStoreScope(env,me,clientId,storeId,{write:true});
    const orderId=decodeURIComponent(match[1]);
    const row=await env.DB.prepare('SELECT id,client_id,store_id,name,phone,gov,address,awb,state,history FROM orders WHERE id=? AND client_id=? AND store_id=?').bind(orderId,clientId,storeId).first();
    if(!row)throw error('الطلب غير موجود في المتجر المحدد',404,'ORDER_NOT_FOUND');
    if(clean(row.awb)||blocked.has(clean(row.state).toLowerCase()))
      throw error('الطلب دخل مرحلة الشحن أو له بوليصة؛ تعديل بيانات J&T يجب أن يتم لدى شركة الشحن ولا يكفي تغييرها محليًا',409,'JNT_SHIPMENT_ALREADY_ISSUED');
    const name=clean(body.name,220),phone=clean(body.phone,80);
    if(!name||!phone)throw error('اسم المستلم ورقم هاتفه مطلوبان',400,'JNT_RECEIVER_REQUIRED');
    // Read the verified J&T directory via Cloudflare static assets, not a self-fetch
    // of the running Worker (which may fail or recurse on a same-zone hostname).
    const assetFetch=fetcher||((u)=>env.ASSETS.fetch(new Request(u)));
    if(!fetcher&&!env.ASSETS)throw error('ملفات دليل عناوين J&T غير متاحة على هذا النشر',503,'JNT_DIRECTORY_UNAVAILABLE');
    const jtAddress=await validatedAddress(body.jntAddress,assetFetch);
    const fullAddress=[jtAddress.street,jtAddress.area,jtAddress.city,jtAddress.province].join('، ');
    const history=parseHistory(row.history),prior=history.filter(x=>x?.type==='order_edit'&&x?.event==='jnt_shipping_edit').at(-1);
    if(body.expectedLastEditAt!==undefined&&clean(body.expectedLastEditAt,60)!==String(prior?.at||''))
      throw error('بيانات الشحن تغيرت بواسطة مستخدم آخر، حدّث الطلب قبل الحفظ',409,'ORDER_EDIT_CONFLICT');
    const before={name:row.name,phone:row.phone,gov:row.gov,address:row.address,jntAddress:prior?.jtAddress||null};
    const after={name,phone,gov:jtAddress.province,address:fullAddress,jntAddress:jtAddress};
    if(before.name===after.name&&before.phone===after.phone&&before.address===after.address&&JSON.stringify(before.jntAddress)===JSON.stringify(after.jntAddress))
      throw error('لم يتم تغيير بيانات الشحن',400,'ORDER_EDIT_NO_CHANGES');
    const at=new Date().toISOString(),byName=clean(me.name||me.email||me.role,180),by=clean(me.email||me.name||me.role,180),byUserId=me.uid||me.id||null;
    const event={type:'order_edit',event:'jnt_shipping_edit',source:'kun-jnt-shipping',at,by,byName,byUserId,
      fields:[{key:'jntAddress',label:'بيانات شحن J&T'}],before,after,jtAddress,
      note:'تم تعديل بيانات شحن J&T بواسطة '+byName};
    const pendingShipment=[...history].reverse().find(x=>x?.type==='jt_print_queued'&&x?.shipment);
    if(pendingShipment)Object.assign(pendingShipment.shipment,{
      receiverName:name,receiverPhone:phone,receiverPhone2:jtAddress.phone2,
      addressCountryCode:jtAddress.countryCode,province:jtAddress.province,
      provinceCode:jtAddress.provinceCode,city:jtAddress.city,cityCode:jtAddress.cityCode,
      area:jtAddress.area,districtCode:jtAddress.areaCode,street:jtAddress.street,
      weight:jtAddress.weight
    });
    history.push(event);
    const updated=await env.DB.prepare("UPDATE orders SET name=?,phone=?,gov=?,address=?,history=? WHERE id=? AND client_id=? AND store_id=? AND COALESCE(awb,'')='' AND state=? AND COALESCE(history,'')=COALESCE(?,'')")
      .bind(name,phone,jtAddress.province,fullAddress,JSON.stringify(history),orderId,clientId,storeId,row.state,row.history||'').run();
    if(!updated.meta?.changes)throw error('الطلب تغير أثناء التعديل؛ حدثه وحاول مرة أخرى',409,'ORDER_EDIT_CONFLICT');
    try{await env.DB.prepare('INSERT INTO audit_log (id,client_id,store_id,actor_user_id,actor_email,action,entity_type,entity_id,before_json,after_json,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind('AUD-'+crypto.randomUUID().slice(0,10).toUpperCase(),clientId,storeId,byUserId,by,'order.shipping_jnt_edit','order',orderId,JSON.stringify(before),JSON.stringify(after),JSON.stringify({source:'kun-jnt-shipping'}),at).run();}catch{}
    return respond({ok:true,orderId,storeId,editedBy:byName,editedAt:at,jntAddress:jtAddress,message:'تم حفظ بيانات الشحن بواسطة '+byName});
  }catch(e){return respond({error:e.message||'تعذر تعديل الشحن',code:e.code||'JNT_EDIT_FAILED'},e.status||500);}
}
