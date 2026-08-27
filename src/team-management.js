import {requirePermission} from './access-control.js';
import {resolveStoreScope} from './store-scope.js';

const BUSINESS_ROLES={
  ops:{label:'مدير / تشغيل',description:'إدارة الطلبات والمنتجات والمخزون والتشغيل داخل الفروع المسموحة.'},
  support:{label:'خدمة العملاء',description:'متابعة الطلبات والعملاء والرسائل دون صلاحيات مالية أو إدارية.'},
  marketing:{label:'تسويق',description:'الحملات والتحليلات وAd Studio والقراءة التشغيلية.'},
  accountant:{label:'محاسب',description:'المالية وCOD والربحية والتقارير المرتبطة.'},
  viewer:{label:'مشاهدة فقط',description:'قراءة البيانات المسموحة بدون أي كتابة.'}
};
const STORE_ROLES={
  manager:{label:'مدير فرع',description:'قراءة وكتابة داخل الفرع وفق الدور الوظيفي.'},
  member:{label:'عضو',description:'قراءة وكتابة داخل الفرع وفق الدور الوظيفي.'},
  viewer:{label:'مشاهدة فقط',description:'قراءة فقط داخل الفرع.'}
};
const PBKDF2_ITERATIONS=100000;
const now=()=>new Date().toISOString();
const rid=p=>`${p}-${crypto.randomUUID().slice(0,10).toUpperCase()}`;
const clean=v=>String(v??'').trim();
const emailOf=v=>clean(v).toLowerCase();
const toB64=bytes=>btoa(String.fromCharCode(...bytes));

async function hashPassword(password){
  const salt=crypto.getRandomValues(new Uint8Array(16));
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:PBKDF2_ITERATIONS,hash:'SHA-256'},key,256);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toB64(salt)}$${toB64(new Uint8Array(bits))}`;
}

export function teamRoleCatalog(){
  return {
    businessRoles:Object.entries(BUSINESS_ROLES).map(([id,v])=>({id,...v})),
    storeRoles:Object.entries(STORE_ROLES).map(([id,v])=>({id,...v})),
    mapping:{
      platformAdmin:'admin',tenantOwner:'client',managerOps:'ops',customerService:'support',marketing:'marketing',accountant:'accountant',viewer:'viewer',
      branchManager:{businessRole:'ops',storeRole:'manager'},member:{storeRole:'member'}
    }
  };
}

export function requireTeamManager(me={}){
  if(me.role==='admin'||me.role==='client')return true;
  requirePermission(me,'settings','write');
  return true;
}

export function resolveTeamClient(me={},requested){
  if(me.clientId){
    if(requested&&String(requested)!==String(me.clientId))throw Object.assign(new Error('مش مسموح إدارة فريق حساب آخر'),{status:403,code:'TENANT_ISOLATION'});
    return String(me.clientId);
  }
  if(me.role!=='admin')throw Object.assign(new Error('الحساب غير مربوط بعميل'),{status:403,code:'TENANT_MISSING'});
  if(!requested)throw Object.assign(new Error('محتاج clientId'),{status:400,code:'CLIENT_ID_REQUIRED'});
  return String(requested);
}

async function audit(env,actor,clientId,action,entityId,metadata={}){
  try{await env.DB.prepare(`INSERT INTO audit_log (id,client_id,actor_user_id,actor_email,action,entity_type,entity_id,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
    .bind(rid('AUD'),clientId,actor?.uid||null,actor?.email||actor?.role||'system',action,'team_member',entityId||null,JSON.stringify(metadata),now()).run();}catch{}
}

async function userForClient(env,clientId,userId){
  const user=await env.DB.prepare('SELECT id,email,name,role,client_id,status,created_at,last_login FROM users WHERE id=? AND client_id=?').bind(userId,clientId).first();
  if(!user)throw Object.assign(new Error('عضو الفريق غير موجود'),{status:404,code:'TEAM_MEMBER_NOT_FOUND'});
  return user;
}

async function validateStores(env,clientId,assignments=[]){
  const normalized=[];
  const seen=new Set();
  for(const raw of assignments||[]){
    const storeId=clean(raw?.storeId||raw?.store_id);if(!storeId||seen.has(storeId))continue;seen.add(storeId);
    const store=await env.DB.prepare("SELECT id,name,status FROM stores WHERE id=? AND client_id=? AND status='active'").bind(storeId,clientId).first();
    if(!store)throw Object.assign(new Error('أحد الفروع غير تابع للحساب أو غير نشط'),{status:400,code:'STORE_INVALID',storeId});
    const role=STORE_ROLES[raw?.role]?String(raw.role):'member';normalized.push({storeId,role,storeName:store.name});
  }
  return normalized;
}

function editableRole(role){return Object.prototype.hasOwnProperty.call(BUSINESS_ROLES,role);}

export async function listTeamMembers(env,clientId){
  const {results:users=[]}=await env.DB.prepare(`SELECT id,email,name,role,status,created_at,last_login FROM users WHERE client_id=? ORDER BY CASE WHEN role='client' THEN 0 ELSE 1 END,name,email`).bind(clientId).all();
  const {results:access=[]}=await env.DB.prepare(`SELECT a.id,a.user_id,a.store_id,a.role,s.name store_name,s.code store_code FROM user_store_access a JOIN stores s ON s.id=a.store_id AND s.client_id=a.client_id WHERE a.client_id=? ORDER BY s.is_default DESC,s.name`).bind(clientId).all();
  const byUser=new Map();for(const row of access){if(!byUser.has(row.user_id))byUser.set(row.user_id,[]);byUser.get(row.user_id).push({id:row.id,storeId:row.store_id,storeName:row.store_name,storeCode:row.store_code,role:row.role||'member'});}
  return users.map(u=>({id:u.id,email:u.email,name:u.name||u.email,role:u.role,status:u.status||'active',createdAt:u.created_at,lastLogin:u.last_login,isOwner:u.role==='client',editable:editableRole(u.role),storeAccess:byUser.get(u.id)||[]}));
}

export async function createTeamMember(env,clientId,body={},actor={}){
  const name=clean(body.name),email=emailOf(body.email),password=String(body.password||''),role=String(body.role||'support');
  if(!name)throw Object.assign(new Error('اسم عضو الفريق مطلوب'),{status:400,code:'NAME_REQUIRED'});
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw Object.assign(new Error('اكتب بريد إلكتروني صحيح'),{status:400,code:'EMAIL_INVALID'});
  if(!editableRole(role))throw Object.assign(new Error('الدور الوظيفي غير مدعوم'),{status:400,code:'ROLE_INVALID'});
  if(password.length<8)throw Object.assign(new Error('كلمة المرور لازم تكون 8 حروف على الأقل'),{status:400,code:'PASSWORD_TOO_SHORT'});
  const collision=await env.DB.prepare('SELECT id FROM users WHERE email=?').bind(email).first();if(collision)throw Object.assign(new Error('البريد الإلكتروني مستخدم بالفعل'),{status:409,code:'EMAIL_EXISTS'});
  let assignments=await validateStores(env,clientId,body.storeAccess||[]);if(role==='viewer')assignments=assignments.map(x=>({...x,role:'viewer'}));
  if(!assignments.length)throw Object.assign(new Error('اختار فرعًا واحدًا على الأقل لعضو الفريق'),{status:400,code:'STORE_ACCESS_REQUIRED'});
  const id=crypto.randomUUID(),ts=now(),hash=await hashPassword(password),actorName=actor?.email||actor?.uid||'owner';
  const statements=[env.DB.prepare('INSERT INTO users (id,email,name,password,role,client_id,status,created_at,last_login) VALUES (?,?,?,?,?,?,?,?,NULL)').bind(id,email,name,hash,role,clientId,'active',ts)];
  for(const a of assignments)statements.push(env.DB.prepare('INSERT INTO user_store_access (id,client_id,user_id,store_id,role,created_at) VALUES (?,?,?,?,?,?)').bind(rid('USA'),clientId,id,a.storeId,a.role,ts));
  statements.push(env.DB.prepare(`INSERT INTO audit_log (id,client_id,actor_user_id,actor_email,action,entity_type,entity_id,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)`).bind(rid('AUD'),clientId,actor?.uid||null,actorName,'team.member.create','team_member',id,JSON.stringify({email,role,stores:assignments.map(x=>({storeId:x.storeId,role:x.role}))}),ts));
  await env.DB.batch(statements);
  return {ok:true,id,email,name,role,status:'active',storeAccess:assignments};
}

export async function updateTeamMember(env,clientId,userId,body={},actor={}){
  const current=await userForClient(env,clientId,userId);
  if(current.role==='client')throw Object.assign(new Error('حساب مالك المتجر يُدار من إعدادات الحساب وليس من أعضاء الفريق'),{status:403,code:'OWNER_PROTECTED'});
  if(!editableRole(current.role))throw Object.assign(new Error('هذا الحساب ليس عضو فريق قابل للتعديل'),{status:403,code:'TEAM_MEMBER_PROTECTED'});
  const name=body.name!==undefined?clean(body.name):current.name,email=body.email!==undefined?emailOf(body.email):current.email,role=body.role!==undefined?String(body.role):current.role;
  const status=body.status!==undefined?String(body.status):current.status;
  if(!name)throw Object.assign(new Error('اسم عضو الفريق مطلوب'),{status:400,code:'NAME_REQUIRED'});
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw Object.assign(new Error('اكتب بريد إلكتروني صحيح'),{status:400,code:'EMAIL_INVALID'});
  if(!editableRole(role))throw Object.assign(new Error('الدور الوظيفي غير مدعوم'),{status:400,code:'ROLE_INVALID'});
  if(!['active','disabled','tenant_suspended'].includes(status))throw Object.assign(new Error('حالة الحساب غير صحيحة'),{status:400,code:'STATUS_INVALID'});
  if(email!==current.email){const collision=await env.DB.prepare('SELECT id FROM users WHERE email=? AND id<>?').bind(email,userId).first();if(collision)throw Object.assign(new Error('البريد الإلكتروني مستخدم بالفعل'),{status:409,code:'EMAIL_EXISTS'});}
  await env.DB.prepare('UPDATE users SET name=?,email=?,role=?,status=? WHERE id=? AND client_id=?').bind(name,email,role,status,userId,clientId).run();
  if(role==='viewer')await env.DB.prepare("UPDATE user_store_access SET role='viewer' WHERE user_id=? AND client_id=?").bind(userId,clientId).run();
  await audit(env,actor,clientId,'team.member.update',userId,{before:{email:current.email,name:current.name,role:current.role,status:current.status},after:{email,name,role,status}});
  return {ok:true,id:userId,email,name,role,status};
}

export async function resetTeamMemberPassword(env,clientId,userId,body={},actor={}){
  const current=await userForClient(env,clientId,userId);if(current.role==='client')throw Object.assign(new Error('استخدم إدارة حساب العميل لتغيير كلمة مرور المالك'),{status:403,code:'OWNER_PROTECTED'});
  const password=String(body.password||'');if(password.length<8)throw Object.assign(new Error('كلمة المرور لازم تكون 8 حروف على الأقل'),{status:400,code:'PASSWORD_TOO_SHORT'});
  const hash=await hashPassword(password);await env.DB.prepare('UPDATE users SET password=? WHERE id=? AND client_id=?').bind(hash,userId,clientId).run();
  await env.DB.prepare('DELETE FROM login_attempts WHERE email=?').bind(current.email).run();
  await audit(env,actor,clientId,'team.member.password_reset',userId,{email:current.email});return {ok:true};
}

export async function replaceTeamMemberStoreAccess(env,clientId,userId,body={},actor={}){
  const current=await userForClient(env,clientId,userId);if(current.role==='client')throw Object.assign(new Error('مالك المتجر لديه صلاحية جميع الفروع تلقائيًا'),{status:403,code:'OWNER_PROTECTED'});
  let assignments=await validateStores(env,clientId,body.storeAccess||body.assignments||[]);if(current.role==='viewer')assignments=assignments.map(x=>({...x,role:'viewer'}));
  if(!assignments.length)throw Object.assign(new Error('عضو الفريق لازم يكون له فرع واحد على الأقل'),{status:400,code:'STORE_ACCESS_REQUIRED'});
  const ts=now(),statements=[env.DB.prepare('DELETE FROM user_store_access WHERE user_id=? AND client_id=?').bind(userId,clientId)];
  for(const a of assignments)statements.push(env.DB.prepare('INSERT INTO user_store_access (id,client_id,user_id,store_id,role,created_at) VALUES (?,?,?,?,?,?)').bind(rid('USA'),clientId,userId,a.storeId,a.role,ts));
  await env.DB.batch(statements);await audit(env,actor,clientId,'team.member.store_access.replace',userId,{stores:assignments.map(x=>({storeId:x.storeId,role:x.role}))});
  return {ok:true,userId,storeAccess:assignments};
}

export async function deleteTeamMember(env,clientId,userId,actor={}){
  const current=await userForClient(env,clientId,userId);if(current.role==='client')throw Object.assign(new Error('لا يمكن حذف مالك الحساب من أعضاء الفريق'),{status:403,code:'OWNER_PROTECTED'});
  if(!editableRole(current.role))throw Object.assign(new Error('هذا الحساب محمي من الحذف'),{status:403,code:'TEAM_MEMBER_PROTECTED'});
  await env.DB.batch([env.DB.prepare('DELETE FROM user_store_access WHERE user_id=? AND client_id=?').bind(userId,clientId),env.DB.prepare('DELETE FROM login_attempts WHERE email=?').bind(current.email),env.DB.prepare('DELETE FROM users WHERE id=? AND client_id=?').bind(userId,clientId)]);
  await audit(env,actor,clientId,'team.member.delete',userId,{email:current.email,role:current.role});return {ok:true,deleted:true,id:userId};
}

export async function teamStaffCount(env,clientId){
  const row=await env.DB.prepare("SELECT COUNT(*) count FROM users WHERE client_id=? AND status='active' AND role IN ('ops','support','marketing','accountant','viewer')").bind(clientId).first();return Number(row?.count||0);
}

export async function assertTeamStoreScope(env,me,clientId,storeId,{write=false}={}){return resolveStoreScope(env,me,clientId,storeId,{write});}
