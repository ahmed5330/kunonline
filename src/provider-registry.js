export const PROVIDERS=[
  {id:'shopify',category:'commerce',name:'Shopify',requiredSecrets:['access_token'],capabilities:['orders.read','products.read','inventory.read','webhooks']},
  {id:'woocommerce',category:'commerce',name:'WooCommerce',requiredSecrets:['consumer_key','consumer_secret'],capabilities:['orders.read','orders.write','products.read','inventory.read','webhooks']},
  {id:'easyorders',category:'commerce',name:'Easy Orders',requiredSecrets:['api_key'],capabilities:['orders.read','products.read','webhooks']},
  {id:'meta_whatsapp',category:'social',name:'WhatsApp Business',requiredSecrets:['access_token','verify_token'],capabilities:['messages.read','messages.write','webhooks']},
  {id:'meta_messenger',category:'social',name:'Facebook Messenger',requiredSecrets:['page_access_token','verify_token'],capabilities:['messages.read','messages.write','webhooks']},
  {id:'instagram',category:'social',name:'Instagram Messaging',requiredSecrets:['access_token'],capabilities:['messages.read','messages.write','webhooks']},
  {id:'tiktok_messaging',category:'social',name:'TikTok Messaging',requiredSecrets:['access_token'],capabilities:['messages.read','messages.write','webhooks'],activationNote:'يتطلب صلاحيات/API متاحة للحساب من TikTok.'},
  {id:'meta_ads',category:'marketing',name:'Meta Ads',requiredSecrets:['access_token'],capabilities:['campaigns.read','metrics.read','campaigns.write','ads.write','budgets.write']},
  {id:'google_ads',category:'marketing',name:'Google Ads',requiredSecrets:['developer_token','refresh_token','client_id','client_secret'],capabilities:['campaigns.read','metrics.read','campaigns.write','ads.write','budgets.write']},
  {id:'tiktok_ads',category:'marketing',name:'TikTok Ads',requiredSecrets:['access_token'],capabilities:['campaigns.read','metrics.read','campaigns.write','ads.write','budgets.write']},
  {id:'jt',category:'shipping',name:'J&T Express',requiredSecrets:['api_key'],capabilities:['shipments.create','tracking.read']},
  {id:'bosta',category:'shipping',name:'Bosta',requiredSecrets:['api_key'],capabilities:['shipments.create','tracking.read','webhooks']},
  {id:'mylerz',category:'shipping',name:'Mylerz',requiredSecrets:['api_key'],capabilities:['shipments.create','tracking.read','webhooks']},
  {id:'aramex',category:'shipping',name:'Aramex',requiredSecrets:['api_key'],capabilities:['shipments.create','tracking.read','webhooks']},
  {id:'track123',category:'shipping',name:'Track123',requiredSecrets:['api_key'],capabilities:['tracking.read']},
  {id:'custom_shipping',category:'shipping',name:'Custom Shipping Webhook',requiredSecrets:['api_key'],capabilities:['shipments.create','tracking.read','webhooks'],activationNote:'Adapter قابل للتوسعة لشركات الشحن الأخرى بدون تخزين أسرار في المتصفح.'}
];
export const providerById=id=>PROVIDERS.find(p=>p.id===id)||null;
export function publicProvider(p){return {id:p.id,category:p.category,name:p.name,capabilities:[...p.capabilities],requiredSecrets:[...p.requiredSecrets],activationNote:p.activationNote||null};}
