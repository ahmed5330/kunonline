/* Production Android update feed for Kun Online. No database access or mutation. */
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});

const RELEASE_APK='https://github.com/ahmed5330/kunonline/releases/download/android-latest/Kun-Online-Mobile-v2.5.0.apk';
const UPDATE={
  versionCode:109,
  versionName:'2.5.0',
  minSupportedVersionCode:106,
  required:false,
  apkUrl:'https://app.kun-online.com/api/mobile/app-update/apk',
  notes:[
    'واجهة تطبيق أحدث وأوضح مع تنقل أسرع بين الرئيسية والطلبات وخدمة العملاء والإعدادات.',
    'تصميم جديد لكروت الطلبات مع بيانات العميل والمنتج والعنوان والإجمالي وأزرار اتصال وواتساب مباشرة.',
    'إضافة قسم جاري التواصل لإظهار الأوردرات المرتبطة بالمكالمات والمتابعة الحالية.',
    'مزامنة تلقائية للطلبات أثناء فتح التطبيق، ومزامنة دورية في الخلفية، وتحديث فوري عند فحص المكالمات.',
    'تحسين ربط أي أوردر جديد ببيانات Caller ID والمكالمات بأسرع وقت متاح.'
  ]
};

async function directApkDownload(request){
  try{
    const upstream=await fetch(RELEASE_APK,{redirect:'follow',headers:{'User-Agent':'Kun-Online-Android-Updater/1.0'}});
    if(!upstream.ok)return json({ok:false,error:'تعذر تحميل ملف التطبيق من مصدر الإصدار.'},502);

    const headers=new Headers(upstream.headers);
    headers.set('Content-Type','application/vnd.android.package-archive');
    headers.set('Content-Disposition','attachment; filename="Kun-Online-Mobile-v2.5.0.apk"');
    headers.set('Cache-Control','public, max-age=300, must-revalidate');
    headers.set('X-Kun-Online-Android-Version',String(UPDATE.versionCode));
    headers.delete('Content-Security-Policy');
    headers.delete('Content-Encoding');

    return new Response(upstream.body,{status:200,headers});
  }catch(error){
    return json({ok:false,error:'تعذر تجهيز تحميل التطبيق حاليًا.'},502);
  }
}

export function handleMobileAppUpdate(request){
  const url=new URL(request.url);
  if(request.method!=='GET')return null;
  if(url.pathname==='/api/mobile/app-update')return json({ok:true,...UPDATE});
  if(url.pathname==='/api/mobile/app-update/apk'||url.pathname==='/download/android')return directApkDownload(request);
  return null;
}
