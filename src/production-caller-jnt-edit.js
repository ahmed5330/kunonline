const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const clean=value=>String(value??'').trim();
const num=value=>Number.isFinite(Number(value))?Number(value):0;
const array=value=>{try{const parsed=JSON.parse(value||'[]');return Array.isArray(parsed)?parsed:[]}catch{return []}};

async function delegatedJson(delegate,request,env,ctx,path){
  const url=new URL(request.url);
  url.pathname=path;
  url.search='';
  const response=await delegate.fetch(new Request(url,{method:'GET',headers:request.headers}),env,ctx);
  return {response,data:await response.clone().json().catch(()=>({}))};
}

async function currentUser(delegate,request,env,ctx){
  const {response,data}=await delegatedJson(delegate,request,env,ctx,'/api/me');
  if(!response.ok||!data?.role)throw Object.assign(new Error(data?.error||'محتاج تسجّل دخول'),{status:response.status===200?401:response.status||401,code:'AUTH_REQUIRED'});
  if(!['admin','client','ops','support'].includes(data.role))throw Object.assign(new Error('تعديل الطلب غير متاح لهذا الدور'),{status:403,code:'CALLER_JNT_ROLE_DENIED'});
  return data;
}

function clientIdFor(me,body){
  const requested=clean(body.clientId||body.client_id||me.clientId);
  if(me.role==='client'){
    if(requested&&requested!==clean(me.clientId))throw Object.assign(new Error('مش مسموح تعديل بيانات متجر آخر'),{status:403,code:'TENANT_ISOLATION'});
    return clean(me.clientId);
  }
  if(!requested)throw Object.assign(new Error('تعذر تحديد حساب المتجر'),{status:400,code:'CLIENT_ID_REQUIRED'});
  return requested;
}

function normalizeJntAddress(raw){
  const source=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};
  const province=clean(source.province);
  const city=clean(source.city);
  const area=clean(source.area);
  const street=clean(source.street);
  if(!province||!city||!area||!street)throw Object.assign(new Error('اختر المحافظة والمدينة والمنطقة واكتب الشارع من دليل J&T'),{status:400,code:'JNT_ADDRESS_REQUIRED'});
  return {
    country:'Egypt',
    countryCode:clean(source.countryCode)||'100000',
    province,
    provinceCode:clean(source.provinceCode),
    city,
    cityCode:clean(source.cityCode),
    cityKey:clean(source.cityKey),
    area,
    areaCode:clean(source.areaCode||source.districtCode),
    street,
    phone2:clean(source.phone2),
    weight:Math.max(0.01,num(source.weight)||1)
  };
}

export async function handleProductionCallerJntEdit({request,env,ctx,delegate}){
  const url=new URL(request.url);
  const match=url.pathname.match(/^\/api\/caller-jnt\/orders\/([^/]+)$/);
  if(!match)return null;
  if(request.method.toUpperCase()!=='PATCH')return json({error:'الطريقة غير مدعومة',code:'METHOD_NOT_ALLOWED'},405);
  try{
    const body=await request.clone().json().catch(()=>({}));
    const me=await currentUser(delegate,request,env,ctx);
    const clientId=clientIdFor(me,body);
    const orderId=decodeURIComponent(match[1]);
    const row=await env.DB.prepare('SELECT id,client_id,name,phone,product,product_id,variant_id,product_note,qty,unit_price,total,note,history FROM orders WHERE id=? AND client_id=? LIMIT 1').bind(orderId,clientId).first();
    if(!row)return json({error:'الأوردر غير موجود',code:'ORDER_NOT_FOUND'},404);

    const name=clean(body.name);
    const phone=clean(body.phone);
    const product=clean(body.product);
    if(!name||!phone||!product)return json({error:'اسم العميل ورقم الهاتف والمنتج مطلوبة',code:'CALLER_JNT_REQUIRED_FIELDS'},400);

    const jtAddress=normalizeJntAddress(body.jntAddress);
    const qty=Math.max(1,Math.trunc(num(body.quantity)||1));
    const total=Math.max(0,num(body.total));
    const unitPrice=qty>0?total/qty:total;
    const note=clean(body.customerNote||body.note);
    const fullAddress=[jtAddress.street,jtAddress.area,jtAddress.city,jtAddress.province].filter(Boolean).join('، ');
    const productChanged=product!==clean(row.product);
    const history=array(row.history);
    const actor=me.name||me.email||me.role;
    history.push({
      type:'order_edit',
      event:'caller_jnt_edit',
      source:'android-caller-jnt',
      at:new Date().toISOString(),
      by:actor,
      byName:actor,
      byUserId:me.uid||null,
      jtAddress,
      phone2:jtAddress.phone2,
      weight:jtAddress.weight
    });

    await env.DB.prepare(`UPDATE orders SET
      name=?,phone=?,gov=?,address=?,product=?,product_id=?,variant_id=?,product_note=?,qty=?,unit_price=?,total=?,note=?,history=?
      WHERE id=? AND client_id=?`)
      .bind(
        name,
        phone,
        jtAddress.province,
        fullAddress,
        product,
        productChanged?null:row.product_id,
        productChanged?null:row.variant_id,
        productChanged?'':row.product_note,
        qty,
        unitPrice,
        total,
        note,
        JSON.stringify(history),
        orderId,
        clientId
      ).run();

    return json({ok:true,orderId,clientId,name,phone,gov:jtAddress.province,address:fullAddress,product,quantity:qty,total,jntAddress:jtAddress});
  }catch(error){
    return json({error:error?.message||'تعذر حفظ تعديلات J&T',code:error?.code||'CALLER_JNT_EDIT_ERROR'},Number(error?.status)>=400&&Number(error?.status)<600?Number(error.status):500);
  }
}
