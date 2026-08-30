// Kun Online — granular access control v27.
// Tenant owners (role=client) own their workspace; platform admins are global.
const ROLE_RULES={
  admin:['*'],
  ops:['orders.*','customers.*','products.*','inventory.*','procurement.*','shipping.*','automation.*','audit.read','finance.read','support.*','integrations.*','inbox.*','campaigns.*','pos.*','ai.read','ads.read'],
  marketing:['orders.read','customers.read','products.read','inventory.read','campaigns.*','analytics.read','profit.read','ai.read','ads.*','integrations.read','inbox.read'],
  accountant:['finance.*','profit.read','cod.*','audit.read','billing.read','usage.read','wallet.read','campaigns.read','analytics.read','pos.read','ai.read'],
  support:['orders.read','orders.update','customers.read','products.read','customers.update','shipping.read','support.*','integrations.read','inbox.*','pos.read'],
  viewer:['orders.read','customers.read','products.read','inventory.read','analytics.read','usage.read','campaigns.read','inbox.read','pos.read','ads.read']
};
const LEGACY={
  settings:['*'],
  entries:['orders.*','customers.*','products.*','inventory.*','procurement.*','shipping.*','automation.*','inbox.*','campaigns.*','pos.*'],
  finance:['finance.*','profit.read','cod.*','audit.read','billing.read','usage.read','wallet.read','campaigns.read','pos.read']
};
function match(rule,resource,action){if(rule==='*')return true;const target=`${resource}.${action}`;return rule===target||rule===`${resource}.*`;}
export function effectivePermissions(me={}){if(me.role==='client')return ['tenant:*'];const result=new Set(ROLE_RULES[me.role]||[]);for(const p of me.perms||[]){result.add(p);for(const mapped of LEGACY[p]||[])result.add(mapped);}return [...result];}
export function can(me,resource,action){if(me?.role==='client')return true;return effectivePermissions(me).some(rule=>match(rule,resource,action));}
export function requirePermission(me,resource,action){if(!can(me,resource,action))throw Object.assign(new Error('مش مسموح'),{status:403,code:'PERMISSION_DENIED',resource,action});}
export function resolveTenant(me,requested){if(me?.role==='client'){if(requested&&String(requested)!==String(me.clientId))throw Object.assign(new Error('مش مسموح الوصول لبيانات متجر آخر'),{status:403,code:'TENANT_ISOLATION'});if(!me.clientId)throw Object.assign(new Error('الحساب غير مربوط بمتجر'),{status:403,code:'TENANT_MISSING'});return me.clientId;}if(!requested)throw Object.assign(new Error('محتاج clientId'),{status:400,code:'CLIENT_ID_REQUIRED'});return requested;}
export function permissionSnapshot(me={}){return {role:me.role||null,clientId:me.clientId||null,permissions:effectivePermissions(me)};}
