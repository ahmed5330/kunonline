import {readFile} from 'node:fs/promises';
const migration=await readFile(new URL('../migrations/0007_pos.sql',import.meta.url),'utf8');
const guards=await readFile(new URL('../migrations/0009_pos_stock_guards.sql',import.meta.url),'utf8');
const consistency=await readFile(new URL('../migrations/0012_pos_inventory_consistency.sql',import.meta.url),'utf8');
const worker=await readFile(new URL('../src/index-commerce-v9.js',import.meta.url),'utf8');
const access=await readFile(new URL('../src/access-control.js',import.meta.url),'utf8');
const must=(ok,msg)=>{if(!ok)throw new Error(msg)};
const executableGuards=guards
  .split('\n')
  .filter(line=>!line.trimStart().startsWith('--'))
  .join('\n');
for(const t of ['pos_sessions','pos_sales','pos_sale_items'])must(migration.includes(`CREATE TABLE IF NOT EXISTS ${t}`),`Missing ${t}`);
for(const e of ['/api/pos/sessions','/api/pos/sales'])must(worker.includes(e),`Missing ${e}`);
must(worker.includes('المخزون غير كافٍ'),'POS must reject obvious insufficient stock before batch');
must(worker.includes("status='open'"),'POS sale must validate open session');
must(executableGuards.includes('SELECT 1'),'POS D1 compatibility migration missing');
must(!/\bCREATE\s+TRIGGER\b/i.test(executableGuards),'POS migration must remain free of D1-incompatible triggers');
must(consistency.includes('CHECK (qty_after >= 0)'),'POS consistency migration must reject negative stock inside the D1 batch');
must(!/\bCREATE\s+TRIGGER\b/i.test(consistency.split('\n').filter(line=>!line.trimStart().startsWith('--')).join('\n')),'POS consistency migration must remain free of D1-incompatible triggers');
must(worker.includes('INSERT INTO pos_stock_guards'),'POS sale must guard stock inside the same D1 batch');
must(worker.includes('UPDATE products SET stock=stock-?')&&worker.includes('UPDATE product_variants SET stock=stock-?'),'POS sale must decrement product and variant stock');
must(worker.includes('INSERT INTO stock_log'),'POS sale must write an inventory audit trail');
must(worker.includes('POS_STOCK_CONFLICT'),'POS must map stock race/conflict to 409');
must(worker.includes("'pos.sale.create'"),'POS writes must be audited');
must(access.includes("'pos.*'"),'POS permissions missing');
console.log('POS contract checks passed: sessions, D1-compatible stock validation, sale and audit.');
