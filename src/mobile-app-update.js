/* Production Android update feed for Kun Online. No database access or mutation. */
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});

const RELEASE_API='https://api.github.com/repos/ahmed5330/kunonline/releases/tags/android-latest';
const FALLBACK_RELEASE={
  versionCode:110,
  versionName:'2.6.0',
  downloadUrl:'https://github.com/ahmed5330/kunonline/releases/download/android-latest/Kun-Online-Mobile-v2.6.0.apk',
  sha256:'808bd40319df70764e30ff2ded6a0202b78337473c7fbce9df97ca1a09c63fb2'
};
const MIN_SUPPORTED_VERSION_CODE=106;
const RELEASE_CACHE_MS=60_000;
let cachedRelease=null;
let cachedReleaseUntil=0;

function normalizeDigest(value){
  const digest=String(value||'').trim().replace(/^sha256:/i,'').toLowerCase();
  return /^[0-9a-f]{64}$/.test(digest)?digest:'';
}

function releaseFromGithub(payload){
  const assets=Array.isArray(payload?.assets)?payload.assets:[];
  const candidates=[];
  for(const asset of assets){
    const name=String(asset?.name||'');
    const match=name.match(/^Kun-Online-Mobile-v(.+)-c(\d+)\.apk$/i);
    if(!match)continue;
    const versionCode=Number(match[2]);
    const downloadUrl=String(asset?.browser_download_url||'');
    if(!Number.isInteger(versionCode)||versionCode<=0||!downloadUrl)continue;
    candidates.push({
      versionCode,
      versionName:match[1],
      downloadUrl,
      sha256:normalizeDigest(asset?.digest)
    });
  }
  candidates.sort((a,b)=>b.versionCode-a.versionCode);
  return candidates[0]||null;
}

async function resolveRelease(){
  if(cachedRelease&&Date.now()<cachedReleaseUntil)return cachedRelease;
  try{
    const response=await fetch(RELEASE_API,{
      redirect:'follow',
      headers:{
        'Accept':'application/vnd.github+json',
        'User-Agent':'Kun-Online-Android-Release-Resolver/1.0',
        'X-GitHub-Api-Version':'2022-11-28'
      }
    });
    if(response.ok){
      const resolved=releaseFromGithub(await response.json());
      if(resolved){
        cachedRelease=resolved;
        cachedReleaseUntil=Date.now()+RELEASE_CACHE_MS;
        return resolved;
      }
    }
  }catch(_error){
    // The last known-good release below keeps updates available if GitHub metadata is temporarily unavailable.
  }
  cachedRelease=FALLBACK_RELEASE;
  cachedReleaseUntil=Date.now()+15_000;
  return cachedRelease;
}

function updateMetadata(release){
  return {
    versionCode:release.versionCode,
    versionName:release.versionName,
    minSupportedVersionCode:MIN_SUPPORTED_VERSION_CODE,
    required:false,
    apkUrl:'https://app.kun-online.com/api/mobile/app-update/apk',
    sha256:release.sha256||'',
    notes:[
      'تنزيل تحديثات كن أونلاين تلقائيًا بعد السماح بالتثبيت من التطبيق مرة واحدة.',
      'فتح شاشة تثبيت Android تلقائيًا فور اكتمال التنزيل.',
      'التحقق من سلامة ملف APK وتوقيعه قبل تمريره إلى شاشة التثبيت.',
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
        'User-Agent':'Kun-Online-Android-Updater/2.0'
      }
    });
    if(!upstream.ok)return json({ok:false,error:'تعذر تحميل ملف التطبيق من مصدر الإصدار.'},502);

    const headers=new Headers();
    headers.set('Content-Type','application/vnd.android.package-archive');
    headers.set('Content-Disposition',`attachment; filename="Kun-Online-Mobile-v${release.versionName}.apk"`);
    headers.set('Cache-Control','public, max-age=120, must-revalidate');
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

  const release=await resolveRelease();
  if(url.pathname==='/api/mobile/app-update')return json({ok:true,...updateMetadata(release)});
  return directApkDownload(release);
}
