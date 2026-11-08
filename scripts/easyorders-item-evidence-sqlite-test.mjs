import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {easyOrdersItemsSnapshot,easyOrdersItemsFromHistory,appendEasyOrdersItemsSnapshot} from '../src/easyorders-item-evidence.js';
const db=new DatabaseSync(':memory:');
try{
  db.exec("CREATE TABLE orders(id TEXT PRIMARY KEY,client_id TEXT NOT NULL,history TEXT)");
  const fake={prepare(sql){return {bind(...params){return {async run(){
    const value=db.prepare(sql).run(...params);
    return {success:true,meta:{changes:Number(value.changes)}};
  }};}}};
  const provider={
    updated_at:'2026-11-08T16:10:00Z',
    status:'paid',
    cart_items:[
      {product:{name:'جيبة بليسيه'},variant:{sku:'SKU-PLEAT-L',variation_props:[
        {variation:'اللون',variation_prop:'بترولي'},
        {variation:'المقاس',variation_prop:'L'},
        {variation:'النوع',variation_prop:'روزالين'}
      ]},quantity:2,price:499},
      {product:{name:'جيبة دابل كلوش'},variant:{variation_props:[
        {variation:'اللون',variation_prop:'برجندي'},
        {variation:'المقاس',variation_prop:'XL'}
      ]},quantity:1,price:599}
    ]
  };
  const snap=await easyOrdersItemsSnapshot(provider);
  assert(snap);
  assert.equal(snap.source,'easyorders-webhook');
  assert.equal(snap.type,'easyorders_items_snapshot');
  assert.equal(snap.items.length,2);
  assert.equal(snap.items[0].quantity,2);
  assert.deepEqual(snap.items[0].options.map(x=>x.value),['بترولي','L','روزالين']);
  assert.equal(snap.items[0].sku,'SKU-PLEAT-L');
  assert.equal(snap.items[1].quantity,1);
  assert(!('paymentStatus' in snap),'item snapshot may not forge verified payment evidence');
  db.prepare('INSERT INTO orders VALUES (?,?,?)').run('order1','tenant1','[]');
  assert.equal(await appendEasyOrdersItemsSnapshot(fake,{orderId:'order1',clientId:'tenant1',snapshot:snap}),true);
  assert.equal(easyOrdersItemsFromHistory(db.prepare('SELECT history FROM orders WHERE id=?').get('order1').history).length,2);
  assert.equal(await appendEasyOrdersItemsSnapshot(fake,{orderId:'order1',clientId:'tenant1',snapshot:snap}),false,'retry is idempotent');
  assert.equal(await appendEasyOrdersItemsSnapshot(fake,{orderId:'order1',clientId:'tenant2',snapshot:snap}),false,'cross-tenant update must fail');
  const updated=await easyOrdersItemsSnapshot({...provider,updated_at:'2026-11-08T17:10:00Z',
    cart_items:[{...provider.cart_items[0],quantity:3},provider.cart_items[1]]});
  assert.equal(await appendEasyOrdersItemsSnapshot(fake,{orderId:'order1',clientId:'tenant1',snapshot:updated}),true,'new verified revision updates product lines');
  assert.equal(await appendEasyOrdersItemsSnapshot(fake,{orderId:'order1',clientId:'tenant1',snapshot:snap}),false,'stale provider replay must not revert quantities');
  const stored=db.prepare('SELECT history FROM orders WHERE id=?').get('order1').history;
  const events=JSON.parse(stored);
  assert.equal(events.length,2,'only newer item revisions must append');
  assert.equal(easyOrdersItemsFromHistory(stored)[0].quantity,3);
  const noTimestamp=await easyOrdersItemsSnapshot({...provider,updated_at:'',cart_items:[{...provider.cart_items[0],quantity:4}]});
  assert.equal(await appendEasyOrdersItemsSnapshot(fake,{orderId:'order1',clientId:'tenant1',snapshot:noTimestamp}),false,'unsequenced replay never overwrites newer revision');
  assert.deepEqual(easyOrdersItemsFromHistory('{}'),[],'non-array history is ignored');
  assert.deepEqual(easyOrdersItemsFromHistory('[{"type":"internal_note","note":"safe"}]'),[]);
  db.prepare("INSERT INTO orders VALUES (?,?,?)").run('order2','tenant1','not-json');
  assert.equal(await appendEasyOrdersItemsSnapshot(fake,{orderId:'order2',clientId:'tenant1',snapshot:snap}),true,'malformed legacy history recovers safely');
  assert.equal(easyOrdersItemsFromHistory(db.prepare('SELECT history FROM orders WHERE id=?').get('order2').history).length,2);
  assert.equal(await appendEasyOrdersItemsSnapshot(fake,{orderId:'order2',clientId:'tenant1',snapshot:snap}),false);
  const empty=await easyOrdersItemsSnapshot({cart_items:[]});
  assert.equal(empty,null,'empty carts cannot fabricate lines');
  console.log('PASS Easy Orders structured items: color/model/type, quantity, revisions, replay, tenant isolation, legacy history');
}finally{
  db.close();
}
