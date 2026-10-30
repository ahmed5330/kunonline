import {can,requirePermission,resolveTenant} from './access-control.js';
import {resolveStoreScope} from './store-scope.js';
import {normalizeHREmployee} from './hr-payroll-core.js';
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const fail=(message,status=400,code='HR_INVALID_REQUEST')=>{throw Object.assign(new Error(message),{status,code});};
const clean=v=>String(v??'').trim(),month=v=>/^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const writes=env=>env.APP_ENV==='sandbox'&&env.HR_DIRECTORY_WRITE_ENABLED==='1';
export const hrCsvCell=value=>{let s=String(value??'');if(/^[\s]*[=+\-@]|^[\t\r\n]/u.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
const policyMap=r=>({...r,policy:JSON.parse(r.config_json),config_json:undefined});
export async function hrEmployeePolicyAt(env,{clientId,storeId,employeeId,period}){
 if(!month(period))fail('شهر السياسة غير صحيح');
 const row=await env.DB.prepare('SELECT revision,effective_month,config_json FROM hr_employee_policies WHERE client_id=? AND store_id=? AND employee_id=? AND effective_month<=? ORDER BY effective_month DESC,revision DESC LIMIT 1').bind(clientId,storeId,employeeId,period).first();
 if(!row)fail('لا توجد سياسة راتب نافذة لهذا الشهر',409,'HR_POLICY_NOT_EFFECTIVE');return policyMap(row);
}
function filter(url,clientId,storeId){
 const q=clean(url.searchParams.get('q')).slice(0,120),status=clean(url.searchParams.get('status'));
 if(status&&!['active','inactive'].includes(status))fail('حالة الموظف غير صحيحة');
 let where='e.client_id=? AND e.store_id=?',bind=[clientId,storeId];
 if(q){where+=" AND (e.name LIKE ? ESCAPE '\\' OR e.code LIKE ? ESCAPE '\\')";const term='%'+q.replace(/[\\%_]/g,c=>'\\'+c)+'%';bind.push(term,term);}
 if(status){where+=' AND e.status=?';bind.push(status);}return {where,bind};
}
export async function handleHRDirectory({request,env,ctx,delegate}){
 const url=new URL(request.url),path=url.pathname;
 if(!path.startsWith('/api/hr/'))return null;
 try{
   const method=request.method.toUpperCase(),auth=new URL(url);auth.pathname='/api/me';auth.search='';
   const r=await delegate.fetch(new Request(auth,{headers:request.headers}),env,ctx),me=await r.json().catch(()=>({}));
   if(!r.ok||!me.role)fail('مطلوب تسجيل الدخول',401,'AUTH_REQUIRED');
   const write=!['GET','HEAD'].includes(method);requirePermission(me,'hr',write?'write':'read');
   const clientId=resolveTenant(me,clean(url.searchParams.get('clientId'))||null),storeId=clean(url.searchParams.get('storeId'));
   if(!storeId)fail('اختر متجرًا محددًا',400,'STORE_SELECTION_REQUIRED');
   await resolveStoreScope(env,me,clientId,storeId,{write});
   if(write&&!writes(env))fail('حفظ سجل الموظفين مغلق خارج البيئة المعزولة',403,'HR_WRITES_DISABLED');
   const capability={writeEnabled:writes(env)&&can(me,'hr','write'),exportEnabled:can(me,'hr','export'),financialPostingEnabled:false,paymentEnabled:false};
   const employeeMatch=path.match(/^\/api\/hr\/employees\/([a-zA-Z0-9_-]{8,80})(\/history)?$/);
   if((path==='/api/hr/employees'||path==='/api/hr/employees.csv')&&method==='GET'){
     const exportCsv=path.endsWith('.csv');if(exportCsv)requirePermission(me,'hr','export');
     const {where,bind}=filter(url,clientId,storeId),limit=exportCsv?10001:Math.min(100,Math.max(1,Number(url.searchParams.get('limit'))||25)),offset=exportCsv?0:Math.max(0,Math.min(1e6,Number(url.searchParams.get('offset'))||0));
     const total=Number((await env.DB.prepare('SELECT COUNT(*) total FROM hr_employees e WHERE '+where).bind(...bind).first())?.total||0);
     const data=await env.DB.prepare(`SELECT e.*,p.effective_month,p.config_json FROM hr_employees e JOIN hr_employee_policies p ON p.client_id=e.client_id AND p.store_id=e.store_id AND p.employee_id=e.id AND p.revision=e.revision WHERE ${where} ORDER BY e.name,e.id LIMIT ? OFFSET ?`).bind(...bind,Math.floor(limit),Math.floor(offset)).all();
     const employees=(data.results||[]).map(policyMap);
     if(exportCsv){
       if(total>10000)fail('ضيّق الفلتر لتصدير حتى 10000 موظف',413,'HR_EXPORT_LIMIT');
       const fields=[['كود الموظف','الاسم','الحالة','سريان السياسة','الراتب الأساسي (جنيه)','العمولة مفعلة','نسبة العمولة %'],...employees.map(e=>[e.code,e.name,e.status,e.effective_month,(e.policy.baseSalaryMinor/100).toFixed(2),e.policy.commissionEnabled?'نعم':'لا',(e.policy.commissionRateBps/100).toFixed(2)])];
       return new Response('\ufeff'+fields.map(row=>row.map(hrCsvCell).join(',')).join('\r\n'),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="hr-employees.csv"','Cache-Control':'no-store'}});
     }
     return json({employees,total,limit:Math.floor(limit),offset:Math.floor(offset),hasMore:offset+limit<total,...capability});
   }
   if(employeeMatch&&method==='GET'){
     const id=employeeMatch[1],employee=await env.DB.prepare('SELECT * FROM hr_employees WHERE client_id=? AND store_id=? AND id=?').bind(clientId,storeId,id).first();if(!employee)fail('الموظف غير موجود',404,'HR_EMPLOYEE_NOT_FOUND');
     const data=await env.DB.prepare('SELECT revision,effective_month,config_json,created_by,created_at FROM hr_employee_policies WHERE client_id=? AND store_id=? AND employee_id=? ORDER BY revision DESC').bind(clientId,storeId,id).all();
     return json({employee,policies:(data.results||[]).map(policyMap),...capability});
   }
   if((path==='/api/hr/employees'&&method==='POST')||(employeeMatch&&!employeeMatch[2]&&method==='PUT')){
     const raw=await request.text();if(raw.length>8000)fail('بيانات الموظف أكبر من الحد المسموح',413);
     let body;try{body=JSON.parse(raw);}catch{fail('محتوى الطلب غير صحيح');}
     if(!body||typeof body!=='object'||Array.isArray(body))fail('محتوى الطلب غير صحيح');
     if((body.clientId&&body.clientId!==clientId)||(body.storeId&&body.storeId!==storeId))fail('نطاق الحفظ مختلف',403,'HR_SCOPE_MISMATCH');
     let config;try{config=normalizeHREmployee(body.employee);}catch(error){fail('بيانات الموظف أو المبالغ أو العمولة غير صحيحة',400,error.code);}
     if(!month(body.effectiveMonth))fail('شهر سريان السياسة غير صحيح');
     const id=employeeMatch?.[1]||clean(body.id);if(!/^[a-zA-Z0-9_-]{8,80}$/.test(id))fail('معرف الموظف غير صحيح');
     const revision=method==='POST'?0:body.revision;if(!Number.isSafeInteger(revision)||revision<0||revision>1e9)fail('مراجعة الموظف غير صحيحة');
     const old=await env.DB.prepare('SELECT id,revision FROM hr_employees WHERE client_id=? AND store_id=? AND id=?').bind(clientId,storeId,id).first();
     if(method==='PUT'&&!old)fail('الموظف غير موجود',404);
     const next=revision+1,stamp=new Date().toISOString(),token=crypto.randomUUID(),actor=clean(me.uid||me.id||me.email||me.role),payload=JSON.stringify(config);
     const writeStatement=revision===0?env.DB.prepare('INSERT INTO hr_employees(id,client_id,store_id,code,name,status,revision,update_token,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(client_id,store_id,id) DO NOTHING').bind(id,clientId,storeId,config.code,config.name,config.status,next,token,stamp,stamp):env.DB.prepare('UPDATE hr_employees SET code=?,name=?,status=?,revision=?,update_token=?,updated_at=? WHERE id=? AND client_id=? AND store_id=? AND revision=?').bind(config.code,config.name,config.status,next,token,stamp,id,clientId,storeId,revision);
     const policy=env.DB.prepare('INSERT INTO hr_employee_policies(client_id,store_id,employee_id,revision,effective_month,config_json,created_by,created_at) SELECT client_id,store_id,id,revision,?,?,?,? FROM hr_employees WHERE client_id=? AND store_id=? AND id=? AND update_token=?').bind(body.effectiveMonth,payload,actor,stamp,clientId,storeId,id,token);
     const audit=env.DB.prepare('INSERT INTO hr_directory_audit(id,client_id,store_id,employee_id,revision,actor,created_at,snapshot_json) SELECT ?,client_id,store_id,id,revision,?,?,? FROM hr_employees WHERE client_id=? AND store_id=? AND id=? AND update_token=?').bind(token,actor,stamp,JSON.stringify({employee:config,effectiveMonth:body.effectiveMonth}),clientId,storeId,id,token);
     const result=await env.DB.batch([writeStatement,policy,audit]);
     if(!result[0]?.meta?.changes){
       if(method==='POST'){
         const prior=await env.DB.prepare('SELECT e.revision,p.config_json,p.effective_month FROM hr_employees e JOIN hr_employee_policies p ON p.client_id=e.client_id AND p.store_id=e.store_id AND p.employee_id=e.id AND p.revision=e.revision WHERE e.client_id=? AND e.store_id=? AND e.id=?').bind(clientId,storeId,id).first();
         if(prior?.revision===1&&prior.config_json===payload&&prior.effective_month===body.effectiveMonth)return json({ok:true,id,revision:1,deduplicated:true});
       }
       fail('تغير السجل لدى مستخدم آخر؛ أعد تحميله قبل الحفظ',409,'HR_REVISION_CONFLICT');
     }
     return json({ok:true,id,revision:next},method==='POST'?201:200);
   }
   fail('المسار أو الطريقة غير متاحين',405,'HR_METHOD_NOT_ALLOWED');
 }catch(error){
   if(/no such table: hr_/.test(String(error.message)))return json({error:'سجل الموظفين غير مفعل؛ يحتاج مخططًا معتمدًا على بيئة معزولة',code:'HR_SCHEMA_REQUIRED'},503);
   if(/UNIQUE constraint failed: hr_employees/.test(String(error.message)))return json({error:'كود الموظف مستخدم في هذا المتجر',code:'HR_CODE_CONFLICT'},409);
   return json({error:error.status?error.message:'تعذر معالجة سجل الموظفين',code:error.code||'HR_DIRECTORY_ERROR'},error.status||500);
 }
}
