import {can,requirePermission,resolveTenant} from './access-control.js';
import {resolveStoreScope} from './store-scope.js';
import {defaultDocumentSettings,normalizeDocumentSettings} from '../public/v2/document-print-model.js';

const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const fail=(message,status=400,code='DOCUMENT_SETTINGS_INVALID')=>{throw Object.assign(new Error(message),{status,code});};
const enabled=env=>env.APP_ENV==='sandbox'&&env.DOCUMENT_SETTINGS_WRITE_ENABLED==='1';
const clean=v=>String(v??'').trim();
export async function handleDocumentSettings({request,env,ctx,delegate}){
  const url=new URL(request.url),path=url.pathname;
  if(!['/api/document-settings','/api/document-settings/print-events'].includes(path))return null;
  try{
    const method=request.method.toUpperCase();if(!['GET','PUT','POST'].includes(method)||(method==='PUT'&&path.endsWith('print-events'))||(method==='POST'&&!path.endsWith('print-events')))fail('الطريقة غير متاحة',405);
    const auth=new URL(url);auth.pathname='/api/me';auth.search='';
    const r=await delegate.fetch(new Request(auth,{headers:request.headers}),env,ctx),me=await r.json().catch(()=>({}));
    if(!r.ok||!me.role)fail('مطلوب تسجيل الدخول',401,'AUTH_REQUIRED');
    if(!['admin','client','ops','support'].includes(me.role))fail('المستندات غير متاحة لهذا الدور',403,'DOCUMENT_ROLE_DENIED');
    const write=method!=='GET',isEvent=path.endsWith('print-events');
    requirePermission(me,write&&!isEvent?'settings':'orders',write&&!isEvent?'write':'read');
    let body=null;
    if(write){if(Number(request.headers.get('content-length')||0)>220000)fail('الإعدادات أكبر من الحد المسموح',413);const raw=await request.text();if(raw.length>220000)fail('الإعدادات أكبر من الحد المسموح',413);try{body=JSON.parse(raw);}catch{fail('محتوى الطلب غير صحيح');}if(!body||typeof body!=='object'||Array.isArray(body))fail('محتوى الطلب غير صحيح');}
    const clientId=resolveTenant(me,clean(url.searchParams.get('clientId'))||null),requested=clean(url.searchParams.get('storeId'));
    if(!requested)fail('اختار متجرًا محددًا',400,'STORE_SELECTION_REQUIRED');
    if((body?.clientId&&body.clientId!==clientId)||(body?.storeId&&body.storeId!==requested))fail('نطاق الحفظ لا يطابق المتجر',403,'STORE_ISOLATION');
    const scope=await resolveStoreScope(env,me,clientId,requested,{write});
    if(write&&!enabled(env))fail('حفظ إعدادات المستندات مغلق حتى اعتماد بيئة معزولة',403,'DOCUMENT_WRITES_DISABLED');
    const storeId=scope.storeId,actor=clean(me.uid||me.email||me.role),stamp=new Date().toISOString();
    if(isEvent){
      if(method==='GET'){
        const orderId=clean(url.searchParams.get('orderId'));if(!orderId)fail('رقم الطلب مطلوب');
        const order=await env.DB.prepare('SELECT id FROM orders WHERE id=? AND client_id=? AND store_id=?').bind(orderId,clientId,storeId).first();if(!order)fail('الطلب غير موجود',404);
        const data=await env.DB.prepare('SELECT id,order_id,template_id,paper_size,actor,created_at FROM document_print_events WHERE client_id=? AND store_id=? AND order_id=? ORDER BY created_at DESC,id DESC LIMIT 100').bind(clientId,storeId,orderId).all();
        return json({events:data.results||[],statusMeaning:'print_requested_not_confirmed',writeEnabled:enabled(env)});
      }
      const id=clean(body.id),orderId=clean(body.orderId);
      if(!/^[a-zA-Z0-9_-]{8,80}$/.test(id)||!orderId)fail('معرف طلب الطباعة غير صحيح');
      const config=normalizeDocumentSettings({...defaultDocumentSettings(),profiles:[{id:'event',name:'event',size:body.size,template:body.template}],defaultProfile:'event'});
      const order=await env.DB.prepare('SELECT id FROM orders WHERE id=? AND client_id=? AND store_id=?').bind(orderId,clientId,storeId).first();if(!order)fail('الطلب غير موجود',404);
      const prior=await env.DB.prepare('SELECT order_id,template_id,paper_size FROM document_print_events WHERE id=? AND client_id=? AND store_id=?').bind(id,clientId,storeId).first();
      if(prior&&(prior.order_id!==orderId||prior.template_id!==body.template||prior.paper_size!==body.size))fail('معرف الطباعة مستخدم لطلب مختلف',409);
      await env.DB.prepare('INSERT INTO document_print_events(id,client_id,store_id,order_id,template_id,paper_size,actor,created_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(client_id,store_id,id) DO NOTHING').bind(id,clientId,storeId,orderId,config.profiles[0].template,config.profiles[0].size,actor,stamp).run();
      const saved=await env.DB.prepare('SELECT order_id,template_id,paper_size FROM document_print_events WHERE id=? AND client_id=? AND store_id=?').bind(id,clientId,storeId).first();
      if(!saved||saved.order_id!==orderId||saved.template_id!==body.template||saved.paper_size!==body.size)fail('معرف الطباعة مستخدم لطلب مختلف',409);
      return json({ok:true,status:'print_requested_not_confirmed'});
    }
    if(method==='GET'){
      const record=await env.DB.prepare('SELECT revision,config_json FROM document_settings WHERE client_id=? AND store_id=?').bind(clientId,storeId).first();
      return json({config:record?normalizeDocumentSettings(JSON.parse(record.config_json)):defaultDocumentSettings(),revision:record?.revision||0,writeEnabled:enabled(env)&&can(me,'settings','write'),printEventsWriteEnabled:enabled(env),storageReady:true});
    }
    const config=normalizeDocumentSettings(body.config),revision=body.revision;
    if(!Number.isSafeInteger(revision)||revision<0||revision>=1e9)fail('رقم المراجعة غير صحيح');
    const token=crypto.randomUUID(),payload=JSON.stringify(config),next=revision+1;
    const update=revision===0?env.DB.prepare('INSERT INTO document_settings(client_id,store_id,revision,config_json,update_token,updated_at,updated_by) VALUES(?,?,?,?,?,?,?) ON CONFLICT(client_id,store_id) DO NOTHING').bind(clientId,storeId,next,payload,token,stamp,actor):env.DB.prepare('UPDATE document_settings SET revision=?,config_json=?,update_token=?,updated_at=?,updated_by=? WHERE client_id=? AND store_id=? AND revision=?').bind(next,payload,token,stamp,actor,clientId,storeId,revision);
    const audit=env.DB.prepare('INSERT INTO document_settings_audit(id,client_id,store_id,revision,config_json,actor,created_at) SELECT ?,client_id,store_id,revision,config_json,?,? FROM document_settings WHERE client_id=? AND store_id=? AND update_token=?').bind(token,actor,stamp,clientId,storeId,token);
    const result=await env.DB.batch([update,audit]);if(!result[0]?.meta?.changes)fail('الإعدادات تغيرت لدى مستخدم آخر؛ أعد التحميل قبل الحفظ',409,'DOCUMENT_SETTINGS_CONFLICT');
    return json({ok:true,revision:next,config});
  }catch(error){
    if(/no such table: document_/.test(String(error.message))){
      if(request.method==='GET'&&path==='/api/document-settings')return json({config:defaultDocumentSettings(),revision:0,writeEnabled:false,storageReady:false});
      return json({error:'تخزين المستندات غير مفعل؛ يحتاج مراجعة مخطط واعتمادًا مستقلًا',code:'DOCUMENT_SCHEMA_REQUIRED'},503);
    }
    return json({error:error.status?error.message:'تعذر معالجة المستند',code:error.code||'DOCUMENT_SETTINGS_ERROR'},error.status||500);
  }
}
