/* Microsoft Clarity's export is segmented dashboard data, not raw session-level attribution.
 * All aggregation is per individual snapshot; overlapping 24h snapshots must never be added.
 */
const safe=(v)=>String(v??'').trim();
const num=v=>{if(v===null||v===undefined||v==='')return null;const x=Number(v);return Number.isFinite(x)?x:null;};
const number=v=>num(v)??0;
const key=s=>safe(s).normalize('NFKC').toLocaleLowerCase('en').replace(/\s+/g,' ');
const META_SOURCE=/(facebook|instagram|(^|[^a-z])(?:fb|ig|meta)([^a-z]|$))/i;
/** Drop URL parameters and fragments BEFORE persisting export rows: links may contain phone numbers,
 * emails, ad click identifiers or checkout secrets. Existing snapshot contracts remain unchanged.
 */
export function sanitizeClarityExport(metrics){
  if(!Array.isArray(metrics))return [];
  return metrics.map(metric=>{
    const information=(Array.isArray(metric.information)?metric.information:[]).map(row=>{
      const safeRow={};
      for(const [field,value] of Object.entries(row||{})){
        const isUrl=/(url|uri|referrer|referer|href|link)/i.test(field);
        safeRow[field]=isUrl&&typeof value==='string'
          ?value.replace(/[?#].*$/,'').slice(0,500)
          :value;
      }
      return safeRow;
    });
    return {...metric,information};
  });
}

const TAXONOMY=Object.freeze({
  Campaign:{label:'الحملات',bucket:'campaign'},
  Source:{label:'المصادر',bucket:'campaign'},
  Device:{label:'الأجهزة',bucket:'campaign'},
  URL:{label:'الصفحات',bucket:'pages'},
  Medium:{label:'وسيط UTM',bucket:'pages'},
  Channel:{label:'قنوات الزيارات',bucket:'pages'},
  Browser:{label:'المتصفحات',bucket:'technology'},
  OS:{label:'أنظمة التشغيل',bucket:'technology'},
  'Country/Region':{label:'الدول والمناطق',bucket:'technology'},
});
const FRICTION=['RageClickCount','DeadClickCount','QuickbackClick','ScriptErrorCount','ErrorClickCount','ExcessiveScroll'];
export const METRIC_LABELS={
  Traffic:'الزيارات',ScrollDepth:'عمق التمرير',EngagementTime:'وقت التفاعل',PopularPages:'الصفحات الرائجة',
  Browser:'المتصفح',Device:'الجهاز',OS:'نظام التشغيل','Country/Region':'البلد',PageTitle:'عنوان الصفحة',
  ReferrerURL:'صفحة الإحالة',DeadClickCount:'النقرات غير الفعالة',ExcessiveScroll:'التمرير المفرط',
  RageClickCount:'النقرات الغاضبة',QuickbackClick:'العودة السريعة',ScriptErrorCount:'أخطاء الجافاسكربت',
  ErrorClickCount:'النقرات المرتبطة بأخطاء'
};
function items(raw,name){
  const n=key(name).replace(/[\s_-]/g,'');
  const metric=(Array.isArray(raw)?raw:[]).find(x=>key(x.metricName||x.name).replace(/[\s_-]/g,'')===n);
  return Array.isArray(metric?.information)?metric.information:[];
}
function urlLabel(v){
  const input=safe(v);
  if(!input)return 'غير محدد';
  try{const u=new URL(input,'https://privacy.invalid');return (u.hostname==='privacy.invalid'?'':u.hostname)+(u.pathname||'/');}
  catch{return input.replace(/[?#].*$/,'').slice(0,160);}
}
export function segmentTraffic(raw,dim,{limit=100}={}){
  if(!TAXONOMY[dim])return [];
  const map=new Map();
  for(const row of items(raw,'Traffic')){
    const label=dim==='URL'?urlLabel(row.URL):(safe(row[dim])||'غير محدد');
    const sessions=Math.max(0,number(row.totalSessionCount));
    const bots=Math.max(0,number(row.totalBotSessionCount));
    const old=map.get(label)||{name:label,sessions:0,botSessions:0};
    old.sessions+=sessions;old.botSessions+=bots;
    map.set(label,old);
  }
  return [...map.values()].sort((a,b)=>b.sessions-a.sessions).slice(0,Math.max(1,Math.min(300,limit)));
}
export function segmentMetric(raw,dim,metric){
  const map=new Map();
  for(const row of items(raw,metric)){
    const label=dim==='URL'?urlLabel(row.URL):safe(row[dim])||'غير محدد';
    const sessions=num(row.sessionsCount);
    const percent=num(row.sessionsWithMetricPercentage);
    if(!sessions||sessions<0||percent===null||percent<0||percent>100)continue;
    const old=map.get(label)||{name:label,count:0,weighted:0};
    old.count+=sessions;old.weighted+=sessions*percent;map.set(label,old);
  }
  return [...map.values()].map(r=>({name:r.name,sessions:r.count,rate:Number((r.weighted/r.count).toFixed(2))})).sort((a,b)=>b.sessions-a.sessions).slice(0,100);
}
export function segmentAverage(raw,dim,metric,field){
  const map=new Map();
  for(const row of items(raw,metric)){
    const label=dim==='URL'?urlLabel(row.URL):(safe(row[dim])||'غير محدد');
    const value=num(row[field]);
    if(value===null)continue;
    const sessions=num(row.sessionsCount);
    const weight=sessions!==null&&sessions>0?sessions:1;
    const state=map.get(label)||{name:label,total:0,weight:0,unweighted:0};
    state.total+=value*weight;
    state.weight+=weight;
    if(sessions===null)state.unweighted++;
    map.set(label,state);
  }
  return [...map.values()].map(r=>({name:r.name,average:r.unweighted>1?null:Math.round(r.total/r.weight*100)/100}));
}
const metricLimited=raw=>items(raw,'Traffic').length>=1000;
function catalog(capture){
  const result=[];
  for(const [bucket,data] of Object.entries(capture)){
    for(const metric of Array.isArray(data)?data:[]){
      const name=safe(metric.metricName||metric.name);
      if(!name)continue;
      const rows=Array.isArray(metric.information)?metric.information:[];
      result.push({metric:name,label:METRIC_LABELS[name]||name,scope:bucket,rows:rows.length,limited:rows.length>=1000,
        // Show a small diagnostic preview only; strip URL parameters and page data with possible PII.
        example:rows.slice(0,3).map(row=>Object.fromEntries(Object.entries(row).filter(([k])=>/^(Browser|Device|OS|Country\/Region|Source|Medium|Campaign|Channel|URL|totalSessionCount|totalBotSessionCount|sessionsCount|sessionsWithMetricPercentage|averageScrollDepth|averageEngagementTime|subTotal|totalTime|activeTime)$/i.test(k)).map(([k,v])=>[k,k==='URL'?urlLabel(v):typeof v==='string'?v.slice(0,160):v])))});
    }
  }
  return result;
}
export function reportFromCapture({campaign=[],pages=[],technology=[],legacyDevice=[],days=1}={}){
  const capture={campaign:Array.isArray(campaign)?campaign:[],pages:Array.isArray(pages)?pages:[],technology:Array.isArray(technology)?technology:[]};
  const legacy=Array.isArray(legacyDevice)?legacyDevice:[];
  const dimensions={};
  for(const [dim,{bucket}] of Object.entries(TAXONOMY)){
    const source=dim==='Device'&&legacy.length?legacy:capture[bucket];
    dimensions[dim]=segmentTraffic(source,dim,{limit:100});
  }
  const primary=items(capture.campaign,'Traffic'),legacyPrimary=legacy.length?items(legacy,'Traffic'):[];
  const count=primary.length?primary:legacyPrimary;
  const periodHours=([1,2,3].includes(Number(days))?Number(days):1)*24;
  const totals={sessions:count.reduce((a,b)=>a+number(b.totalSessionCount),0),botSessions:count.reduce((a,b)=>a+number(b.totalBotSessionCount),0),rowCount:count.length};
  const untagged=count.filter(x=>!safe(x.Campaign)||/^(غير محدد|\(not set\)|not set|undefined)$/i.test(safe(x.Campaign))).reduce((n,x)=>n+number(x.totalSessionCount),0);
  const facebook=count.filter(x=>META_SOURCE.test(safe(x.Source))).reduce((n,x)=>n+number(x.totalSessionCount),0);
  const unknownSource=count.filter(x=>!safe(x.Source)||/^(غير محدد|\(not set\)|not set|undefined)$/i.test(safe(x.Source))).reduce((n,x)=>n+number(x.totalSessionCount),0);
  const metaWithoutCampaign=count.filter(x=>META_SOURCE.test(safe(x.Source))&&(!safe(x.Campaign)||/^(غير محدد|\(not set\)|not set|undefined)$/i.test(safe(x.Campaign)))).reduce((n,x)=>n+number(x.totalSessionCount),0);
  const coverage={sessions:totals.sessions,untaggedSessions:untagged,taggedSessions:Math.max(0,totals.sessions-untagged),metaSourceSessions:facebook,metaWithoutCampaignSessions:metaWithoutCampaign,unknownSourceSessions:unknownSource,taggedRate:totals.sessions?Number((100*(totals.sessions-untagged)/totals.sessions).toFixed(2)):null,unknownSourceRate:totals.sessions?Number((100*unknownSource/totals.sessions).toFixed(2)):null,metaUntaggedRate:facebook?Number((100*metaWithoutCampaign/facebook).toFixed(2)):null};
  const depth=new Map(segmentAverage(capture.pages,'URL','ScrollDepth','averageScrollDepth').map(r=>[r.name,r.average]));
  const engagement=new Map(segmentAverage(capture.pages,'URL','EngagementTime','averageEngagementTime').map(r=>[r.name,r.average]));
  const pageRage=new Map(segmentMetric(capture.pages,'URL','RageClickCount').map(r=>[r.name,r.rate]));
  const pageDead=new Map(segmentMetric(capture.pages,'URL','DeadClickCount').map(r=>[r.name,r.rate]));
  const pagesDetail=dimensions.URL.map(r=>({...r,scrollDepth:depth.get(r.name)??null,engagementTime:engagement.get(r.name)??null,rageRate:pageRage.get(r.name)??null,deadRate:pageDead.get(r.name)??null}));
  const campaigns=dimensions.Campaign.map(row=>{
    const metrics={};
    for(const m of FRICTION)metrics[m]=segmentMetric(capture.campaign,'Campaign',m).find(x=>x.name===row.name)?.rate??null;
    const matching=items(capture.campaign,'Traffic').filter(r=>safe(r.Campaign)===row.name);
    const paidSessions=matching.filter(r=>META_SOURCE.test(safe(r.Source))).reduce((n,r)=>n+number(r.totalSessionCount),0);
    const unknownSourceSessions=matching.filter(r=>!safe(r.Source)).reduce((n,r)=>n+number(r.totalSessionCount),0);
    return {...row,paidSessions,unknownSourceSessions,...metrics};
  });
  const limitations=[];
  if(Object.values(capture).some(metricLimited))limitations.push('بعض نتائج التقسيم وصلت إلى حد 1000 صف في Clarity، وقد تكون المجاميع أقل من الواقع.');
  if(legacy.length&&!capture.pages.length)limitations.push('العينات القديمة لا تحتوي على تصنيف الصفحات والبلدان والمتصفحات؛ سيظهر ذلك بعد أول مزامنة موسّعة.');
  limitations.push('جلسات كل صفحة URL تمثل الجلسات التي شاهدت الصفحة؛ الجلسة الواحدة قد تزور عدة صفحات، فلا تُجمع الصفحات كزوار فريدين.');
  limitations.push('كل عينة تمثل '+periodHours+' ساعة متحركة بتوقيت UTC؛ نوافذ العينات التاريخية قد تكون متداخلة، ولا يمكن جمعها لإنتاج إجمالي شهري دقيق.');
  limitations.push('التسجيلات والخرائط الحرارية والفانل التفصيلي غير متاحة من Data Export API؛ تُفتح مباشرة في Clarity.');
  return {totals,coverage,dimensions,pagesDetail,campaigns,diagnostics:FRICTION.map(name=>({metric:name,label:METRIC_LABELS[name],segments:segmentMetric(capture.campaign,'Campaign',name)})),catalog:catalog(capture),
    limitations,snapshotHours:periodHours,source:'clarity_export',rawDimensions:Object.keys(TAXONOMY)};
}
const round=v=>Number(number(v).toFixed(2));
export function mergeMetaWithClarity(report,meta){
  const campaigns=Array.isArray(meta?.campaigns?.rows)?meta.campaigns.rows:[];
  const lookup=new Map((report?.campaigns||[]).map(x=>[key(x.name),x]));
  const matchedNames=new Set();
  const rows=campaigns.map(m=>{
    const name=safe(m.name),c=lookup.get(key(name))||null;
    if(c)matchedNames.add(key(name));
    const label=!c?'utm_missing':c.paidSessions>0?'meta_source_detected':c.unknownSourceSessions>0?'source_missing':'source_not_meta';
    return {name,campaignId:safe(m.id),spend:round(m.spend),impressions:round(m.impressions),ctr:round(m.ctr),cpc:round(m.cpc),platformPurchases:round(m.platformPurchases),platformRoas:round(m.platformRoas),realOrders:round(m.realOrders),deliveredOrders:round(m.deliveredOrders),realRoas:round(m.realRoas),sourceStatus:label,
      claritySessions:c?.sessions??null,metaSourceSessions:c?.paidSessions??null,rageRate:c?.RageClickCount??null,deadRate:c?.DeadClickCount??null,scriptErrorRate:c?.ScriptErrorCount??null,quickbackRate:c?.QuickbackClick??null};
  });
  const recommendations=[];
  const cov=report?.coverage||{};
  if(cov.metaWithoutCampaignSessions>0)recommendations.push({priority:'high',category:'utm_health',title:'زيارات إعلانات Meta بلا اسم حملة واضح',detail:'ظهر '+cov.metaWithoutCampaignSessions+' جلسات من مصدر Facebook/Instagram دون utm_campaign محدد داخل Clarity. أصلح روابط الإعلان والتتبع قبل تفسير انخفاض جودة هذه الحملات.'});
  const significant=rows.filter(r=>r.spend>0).sort((a,b)=>b.spend-a.spend);
  if(!meta?.connected){recommendations.push({priority:'info',category:'connections',title:'إعلانات Meta غير متصلة',detail:'ربط Meta Ads في التكاملات يضيف الإنفاق وأداء الحملة إلى إشارات Clarity.'});}
  for(const r of significant.slice(0,25)){
    if(r.sourceStatus==='utm_missing')recommendations.push({priority:'high',category:'attribution',campaign:r.name,title:'راجع تسمية UTM للحملة',detail:'الحملة لها إنفاق في Meta ولكن اسمها غير ظاهر في تقسيم Clarity. افحص utm_campaign ومصدر الزيارات قبل تفسير الفجوة.'});
    if(r.sourceStatus==='source_missing'||r.sourceStatus==='source_not_meta')recommendations.push({priority:'medium',category:'attribution',campaign:r.name,title:'راجع utm_source للحملة',detail:'ظهر اسم الحملة في Clarity لكن المصدر غير مؤكد أنه Meta. لا تنسب الجلسات للإعلانات بدون التحقق.'});
    if(r.claritySessions!==null&&r.claritySessions>=30&&r.rageRate!==null&&r.rageRate>=15)recommendations.push({priority:'high',category:'landing',campaign:r.name,title:'احتكاك شديد بعد الدخول',detail:'نسبة Rage Clicks مرتفعة في جلسات هذه الحملة. راجع أزرار الشراء وملء البيانات وإتمام الطلب في تسجيلات Clarity.'});
    if(r.claritySessions!==null&&r.claritySessions>=30&&r.deadRate!==null&&r.deadRate>=20)recommendations.push({priority:'high',category:'landing',campaign:r.name,title:'نقرات لا تعطي استجابة',detail:'راجع العناصر التفاعلية وإشارات التحميل ووظائف زر الطلب على الجوال قبل توسيع الإنفاق.'});
    if(r.claritySessions!==null&&r.claritySessions>=30&&r.scriptErrorRate!==null&&r.scriptErrorRate>=5)recommendations.push({priority:'high',category:'errors',campaign:r.name,title:'أخطاء تقنية في رحلة الزيارة',detail:'مؤشر Script Errors مرتفع؛ راجع أخطاء صفحات المنتج والشراء على المتصفحات المستخدمة.'});
  }
  const metaRecommendations=(meta?.expert?.recommendations||[]).slice(0,8).map(x=>({priority:x.priority,category:'meta_expert',title:x.title,detail:x.reason,action:x.action,campaign:x.entity||null}));
  return {metaConnected:Boolean(meta?.connected),metaSyncAt:meta?.lastSyncAt||null,metaRange:{from:meta?.from||null,to:meta?.to||null},
    metaTotals:meta?.campaigns?.total||{},campaigns:rows,clarityOnly:(report?.campaigns||[]).filter(c=>!matchedNames.has(key(c.name))).slice(0,50),
    recommendations:[...recommendations,...metaRecommendations].slice(0,75),
    adsets:(meta?.adsets?.rows||[]).slice(0,100).map(x=>({name:x.name,campaignName:x.campaignName,spend:round(x.spend),purchases:round(x.purchases),cpp:round(x.cpp),roas:round(x.roas),ctr:round(x.ctr),diagnostics:x.flags||[]})),
    ads:(meta?.ads?.rows||[]).slice(0,100).map(x=>({name:x.name,campaignName:x.campaignName,adsetName:x.adsetName,spend:round(x.spend),purchases:round(x.purchases),cpp:round(x.cpp),roas:round(x.roas),ctr:round(x.ctr),diagnostics:x.flags||[]})),
    attributionWarning:'المقارنة بالاسم وإشارات UTM فقط. Clarity يقدم نافذة '+(Number(report?.snapshotHours)||24)+' ساعة متحركة UTC بينما Meta يحسب أيامًا تقويمية وفترات Attribution مختلفة؛ لا توجد مطابقة جلسة إلى طلب أو Creative.'};
}
