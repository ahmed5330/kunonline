/* Read-only group notes for Customer Service order cards.
 * A message is an order note only when sent with an explicit order_id.
 * Private conversations and groups the signed-in employee isn't a member of
 * are not copied to a widely visible operational board.
 */
export async function attachVisibleGroupOrderNotes(env,clientId,me,orders){
  if(!Array.isArray(orders)||!orders.length)return orders;
  const uid=String(me?.uid||me?.id||me?.email||'').trim();
  if(!uid)return orders;
  const byId=new Map(orders.map(o=>[String(o.id),o]));
  const ids=[...byId.keys()];
  // D1's json_each takes one bound array, avoiding variable-count limits.
  // Filter by both client and group store and enforce exact membership.
  for(let start=0;start<ids.length;start+=350){
    const batch=ids.slice(start,start+350);
    try{
      const sql=`SELECT id,order_id,store_id,body,sender_name,created_at FROM (
         SELECT m.id,m.order_id,m.store_id,m.body,m.sender_name,m.created_at,
           ROW_NUMBER() OVER (PARTITION BY m.order_id ORDER BY m.created_at DESC,m.id DESC) AS rn
         FROM collab_messages m
         JOIN collab_conversations c ON c.id=m.conversation_id AND c.client_id=m.client_id AND c.store_id=m.store_id
         JOIN collab_members member ON member.conversation_id=c.id AND member.user_id=?
         WHERE m.client_id=? AND c.type='group'
           AND m.order_id IN (SELECT value FROM json_each(?))
           AND TRIM(COALESCE(m.body,''))<>''
       ) WHERE rn<=5 ORDER BY created_at DESC,id DESC`;
      const {results=[]}=await env.DB.prepare(sql).bind(uid,clientId,JSON.stringify(batch)).all();
      for(const entry of results){
        const order=byId.get(String(entry.order_id));
        // Also guard at the mapped-order level if old messages had inconsistent store metadata.
        if(!order||String(order.storeId||'')!==String(entry.store_id||''))continue;
        if(!order.groupNotes)order.groupNotes=[];
        order.groupNotes.push({
          id:String(entry.id),note:String(entry.body||''),byName:String(entry.sender_name||'عضو الفريق'),
          at:String(entry.created_at||'')
        });
      }
    }catch(error){
      // Legacy stores with no collaboration schema must keep normal order loading.
      console.warn('Order-linked collaboration notes unavailable:',String(error?.message||error));
      break;
    }
  }
  return orders;
}
