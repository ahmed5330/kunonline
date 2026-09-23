/* Production Android update feed for Kun Online. No database access or mutation. */
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});

const RELEASE_MANIFEST_URL='https://github.com/ahmed5330/kunonline/releases/download/android-latest/Kun-Online-Mobile-latest.json';
const RELEASE_DOWNLOAD_ROOT='https://github.com/ahmed5330/kunonline/releases/download/android-latest';
const APK_ENDPOINT='https://app.kun-online.com/api/mobile/app-update/apk';
const FALLBACK_RELEASE={
  versionCode:111,
  versionName:'2.6.1',
  downloadUrl:`${RELEASE_DOWNLOAD_ROOT}/Kun-Online-Mobile-v2.6.1-c111.apk`,
  sha256:''
};
const MIN_SUPPORTED_VERSION_CODE=106;
const RELEASE_CACHE_MS=300_000;
let cachedRelease=null;
let cachedReleaseUntil=0;

function normalizeDigest(value){
  const digest=String(value||'').trim().replace(/^sha256:/i,'').toLowerCase();
  return /^[0-9a-f]{64}$/.test(digest)?digest:'';
}

function safeVersionName(value){
  const name=String(value||'').trim();
  return /^[0-9A-Za-z._-]{1,64}$/.test(name)?name:'';
}

function normalizeRelease(value){
  const versionCode=Number(value?.versionCode);
  const versionName=safeVersionName(value?.versionName);
  const sha256=normalizeDigest(value?.sha256);
  if(!Number.isInteger(versionCode)||versionCode<=0||!versionName)return null;
  const canonicalUrl=`${RELEASE_DOWNLOAD_ROOT}/Kun-Online-Mobile-v${encodeURIComponent(versionName)}-c${versionCode}.apk`;
  return {versionCode,versionName,downloadUrl:canonicalUrl,sha256};
}

async function resolveRelease(){
  if(cachedRelease&&Date.now()<cachedReleaseUntil)return cachedRelease;
  try{
    const response=await fetch(RELEASE_MANIFEST_URL,{
      redirect:'follow',
      headers:{
        'Accept':'application/json, text/plain;q=0.9, */*;q=0.8',
        'Cache-Control':'no-cache',
        'User-Agent':'Kun-Online-Android-Release-Resolver/2.0'
      }
    });
    if(response.ok){
      const release=normalizeRelease(await response.json());
      if(release){
        cachedRelease=release;
        cachedReleaseUntil=Date.now()+RELEASE_CACHE_MS;
        return release;
      }
    }
  }catch(_error){
    // A known-good bridge release keeps the app installable if release metadata is temporarily unavailable.
  }
  cachedRelease=FALLBACK_RELEASE;
  cachedReleaseUntil=Date.now()+30_000;
  return cachedRelease;
}

function pinnedRelease(versionCodeValue,versionNameValue){
  return normalizeRelease({versionCode:versionCodeValue,versionName:versionNameValue,sha256:''});
}

function updateMetadata(release){
  const query=new URLSearchParams({
    versionCode:String(release.versionCode),
    versionName:release.versionName
  });
  return {
    versionCode:release.versionCode,
    versionName:release.versionName,
    minSupportedVersionCode:MIN_SUPPORTED_VERSION_CODE,
    required:false,
    // The file URL is pinned to the exact advertised version. That makes the
    // update atomic even while a newer release is being published.
    apkUrl:`${APK_ENDPOINT}?${query.toString()}`,
    sha256:release.sha256||'',
    notes:[
      'تنزيل تحديثات كن أونلاين تلقائيًا بعد السماح بالتثبيت من التطبيق مرة واحدة.',
      'فتح شاشة تثبيت Android تلقائيًا فور اكتمال التنزيل.',
      'التحقق من سلامة ملف APK قبل تمريره إلى شاشة التثبيت.',
      'ربط الإصدارات القادمة تلقائيًا بأحدث نسخة منشورة دون تغيير رابط التحديث.'
    ]
  };
}

async function directApkDownload(release){
  try{
    const upstream=await fetch(release.downloadUrl,{
      redirect:'follow',
      headers:{
        'Accept':'application/octet-stream',
        'Accept-Encoding':'identity',
        'User-Agent':'Kun-Online-Android-Updater/3.0'
      }
    });
    if(!upstream.ok)return json({ok:false,error:'تعذر تحميل ملف التطبيق من مصدر الإصدار.'},502);

    const headers=new Headers();
    headers.set('Content-Type','application/vnd.android.package-archive');
    headers.set('Content-Disposition',`attachment; filename="Kun-Online-Mobile-v${release.versionName}.apk"`);
    headers.set('Cache-Control','private, no-store');
    headers.set('X-Kun-Online-Android-Version',String(release.versionCode));
    if(release.sha256)headers.set('X-Kun-Online-Android-Sha256',release.sha256);

    return new Response(upstream.body,{status:200,headers});
  }catch(_error){
    return json({ok:false,error:'تعذر تجهيز تحميل التطبيق حاليًا.'},502);
  }
}

export async function handleMobileAppUpdate(request){
  const url=new URL(request.url);
  if(request.method!=='GET')return null;
  if(url.pathname!=='/api/mobile/app-update'&&url.pathname!=='/api/mobile/app-update/apk'&&url.pathname!=='/download/android')return null;

  if(url.pathname==='/api/mobile/app-update'){
    const release=await resolveRelease();
    return json({ok:true,...updateMetadata(release)});
  }

  const requestedCode=url.searchParams.get('versionCode');
  const requestedName=url.searchParams.get('versionName');
  const release=(requestedCode&&requestedName)
    ? pinnedRelease(requestedCode,requestedName)
    : await resolveRelease();
  if(!release){
    return json({ok:false,error:'إصدار التطبيق المطلوب غير صالح.'},400);
  }
  return directApkDownload(release);
}
