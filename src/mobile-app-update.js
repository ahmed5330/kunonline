const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});

const RELEASE_APK='https://github.com/ahmed5330/kunonline/releases/download/android-latest/Kun-Online-Mobile.apk';
const UPDATE={
  versionCode:4,
  versionName:'0.1.3',
  minSupportedVersionCode:3,
  required:false,
  apkUrl:'https://app.kun-online.com/api/mobile/app-update/apk',
  notes:[
    'مزامنة بيانات العميل مع كل المتاجر المسموح بها.',
    'إظهار بيانات العميل في المكالمات الواردة والصادرة.',
    'إضافة تنزيل تحديثات التطبيق من داخل كن أونلاين.'
  ]
};

export function handleMobileAppUpdate(request){
  const url=new URL(request.url);
  if(request.method!=='GET')return null;
  if(url.pathname==='/api/mobile/app-update')return json({ok:true,...UPDATE});
  if(url.pathname==='/api/mobile/app-update/apk'){
    return Response.redirect(RELEASE_APK,302);
  }
  return null;
}
