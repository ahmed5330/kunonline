// Original Kun designs; not copies of competitor artwork. Shared browser/server validation.
export const DOCUMENT_TEMPLATES=Object.freeze([
  ['classic','كلاسيكي','#0f766e','line'],['navy','رسمي كحلي','#1e3a8a','double'],
  ['minimal','بسيط','#334155','none'],['boxed','إطار كامل','#475569','box'],
  ['emerald','أخضر','#047857','band'],['violet','بنفسجي','#6d28d9','band'],
  ['sand','رملي','#92400e','double'],['mono','أبيض وأسود','#111111','line'],
  ['receipt','إيصال مختصر','#172b3a','dashed'],['compact','جدول مختصر','#0369a1','box'],
  ['spacious','واسع','#be185d','line']
].map(([id,name,color,decoration])=>Object.freeze({id,name,color,decoration})));
const text=(v,max)=>String(v??'').trim().slice(0,max);
const error=m=>{throw Object.assign(new Error(m),{status:400,code:'DOCUMENT_SETTINGS_INVALID'});};
export function defaultDocumentSettings(){return {brand:{name:'',address:'',phone:'',footer:'',color:'#0f766e',logo:''},profiles:[{id:'default',name:'ملف الطباعة الأساسي',size:'A4',template:'classic'}],defaultProfile:'default',rules:[]};}
export function normalizeDocumentSettings(value){
  if(!value||typeof value!=='object'||Array.isArray(value))error('إعدادات المستند غير صحيحة');
  const brand=value.brand||{};
  if(!/^#[0-9a-f]{6}$/i.test(brand.color||''))error('اختر لونًا صحيحًا');
  const logo=String(brand.logo||'');
  if(logo.length>180000||(logo&&!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(logo)))error('الشعار يجب أن يكون صورة PNG أو JPEG صغيرة');
  if(!Array.isArray(value.profiles)||!value.profiles.length||value.profiles.length>20)error('حدد من ملف طباعة واحد إلى 20 ملفًا');
  const ids=new Set();const profiles=value.profiles.map(p=>{
    const id=text(p.id,60),name=text(p.name,80);
    if(!/^[a-zA-Z0-9_-]{1,60}$/.test(id)||ids.has(id)||!name)error('اسم أو معرف ملف الطباعة غير صحيح أو مكرر');ids.add(id);
    if(!['A4','A5','receipt'].includes(p.size)||!DOCUMENT_TEMPLATES.some(t=>t.id===p.template))error('مقاس أو قالب غير متاح');
    return {id,name,size:p.size,template:p.template};
  });
  if(!ids.has(value.defaultProfile))error('ملف الطباعة الأساسي غير موجود');
  if(!Array.isArray(value.rules)||value.rules.length>30)error('عدد قواعد الطباعة غير صحيح');
  const rules=value.rules.map(r=>{
    if(typeof r.enabled!=='boolean'||!ids.has(r.profileId))error('ملف القاعدة أو تفعيلها غير صحيح');
    const state=text(r.state,40);if(state&&!['pending','confirmed','preparing','shipped','signed','collected','returned','cancelled','deferred','no_answer'].includes(state))error('حالة القاعدة غير مدعومة');
    const numeric=v=>v===null||v===undefined||v===''?null:typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1e9?v:error('مبلغ شرط القاعدة غير صحيح');
    const minTotal=numeric(r.minTotal),maxTotal=numeric(r.maxTotal);if(minTotal!==null&&maxTotal!==null&&minTotal>maxTotal)error('الحد الأدنى أكبر من الأقصى');
    if(!state&&minTotal===null&&maxTotal===null)error('حدد شرطًا واحدًا على الأقل لكل قاعدة');
    return {enabled:r.enabled,state,minTotal,maxTotal,profileId:r.profileId};
  });
  return {brand:{name:text(brand.name,120),address:text(brand.address,300),phone:text(brand.phone,50),footer:text(brand.footer,500),color:brand.color,logo},profiles,defaultProfile:value.defaultProfile,rules};
}
export function selectDocumentProfile(settings,order){
  const config=normalizeDocumentSettings(settings);
  const total=order.total!==null&&order.total!==undefined&&order.total!==''&&Number.isFinite(Number(order.total))?Number(order.total):null;
  const rule=config.rules.find(r=>r.enabled&&(!r.state||r.state===order.state)&&(r.minTotal===null||(total!==null&&total>=r.minTotal))&&(r.maxTotal===null||(total!==null&&total<=r.maxTotal)));
  return config.profiles.find(p=>p.id===(rule?.profileId||config.defaultProfile));
}
