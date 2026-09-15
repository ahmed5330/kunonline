import {loadOrderDetails} from './order-details.js';

const parseArray=value=>{try{const data=JSON.parse(value||'[]');return Array.isArray(data)?data:[];}catch{return [];}};
const number=value=>Number.isFinite(Number(value))?Number(value):0;

export async function loadEditableOrderDetails(env,{clientId,orderId,fetcher=fetch}){
  const row=await env.DB.prepare('SELECT * FROM orders WHERE id=? AND client_id=?').bind(orderId,clientId).first();
  if(!row)throw Object.assign(new Error('الأوردر غير موجود'),{status:404,code:'ORDER_NOT_FOUND'});
  const history=parseArray(row.history),lastEdit=[...history].reverse().find(x=>x?.type==='order_edit');
  const details=await loadOrderDetails(env,{clientId,orderId,fetcher});
  if(!lastEdit)return details;
  const {results=[]}=await env.DB.prepare('SELECT id,product_id,variant_id,sku,product_name,variant_label,qty,unit_price,line_total FROM order_items WHERE order_id=? AND client_id=? ORDER BY created_at,id').bind(orderId,clientId).all().catch(()=>({results:[]}));
  const items=results.length?results.map((item,index)=>({id:item.id||String(index+1),productId:item.product_id||null,variantId:item.variant_id||null,name:item.product_name||'منتج',sku:item.sku||null,variantSku:null,quantity:Math.max(1,number(item.qty)),price:number(item.unit_price),lineTotal:number(item.line_total)||number(item.unit_price)*Math.max(1,number(item.qty)),image:null,options:[],note:item.variant_label||null,variantName:item.variant_label||null})):[{id:'1',productId:row.product_id||null,variantId:row.variant_id||null,name:row.product||'منتج',sku:null,variantSku:null,quantity:Math.max(1,number(row.qty)),price:number(row.unit_price),lineTotal:number(row.total),image:null,options:[],note:row.product_note||null,variantName:row.product_note||null}];
  const subtotal=items.reduce((sum,item)=>sum+number(item.lineTotal),0),shippingCost=number(details.summary?.shippingCost),discountAmount=number(details.summary?.discountAmount);
  return {...details,
    order:{...details.order,id:row.id,ref:row.ref||null,date:row.date||row.created_at||null,state:row.state||'pending',source:row.source||'',storeId:row.store_id||null,awb:row.awb||'',couponCode:row.coupon_code||'',customerNote:row.note||'',productNote:row.product_note||'',locallyEdited:true,lastEditedAt:lastEdit.at||null},
    items,
    customer:{...details.customer,name:row.name||'',phone:row.phone||'',government:row.gov||'',address:row.address||''},
    address:{government:row.gov||'',city:'',area:'',street:'',address:row.address||'',building:'',floor:'',apartment:'',landmark:'',postalCode:''},
    summary:{...details.summary,subtotal,shippingCost,discountAmount,total:number(row.total),quantity:items.reduce((sum,item)=>sum+Math.max(1,number(item.quantity)),0)},
    history,
    provider:{...(details.provider||{}),enriched:false,localEdit:true,warning:'يتم عرض آخر نسخة عدّلها فريق خدمة العملاء داخل Kun Online.'}
  };
}
