// Shared store checks and atomic operation guards for unit workflows.
export function assertUnitStore(row,storeId){
  if(!row|| (storeId && String(row.store_id||'')!==String(storeId)))
    throw Object.assign(new Error('غير موجود في الفرع المحدد'),{status:404,code:'UNIT_STORE_NOT_FOUND'});
  return row;
}
export function decodeUnitCode(raw){
  let value=String(raw||'').trim();try{const u=new URL(value);value=u.searchParams.get('unit')||u.searchParams.get('code')||value;}catch{}
  return value.replace(/^KUN:UNIT:/i,'').trim().toUpperCase();
}
export function operationGuard(env,condition,bindings=[]){
  return env.DB.prepare(`INSERT INTO inventory_operation_guards(id,valid) SELECT ?,CASE WHEN ${condition} THEN 1 ELSE 0 END`).bind(crypto.randomUUID(),...bindings);
}
export const UNIT_SAFETY_SCHEMA=[
  `CREATE TABLE IF NOT EXISTS inventory_serialization_snapshots(entity_key TEXT PRIMARY KEY,client_id TEXT NOT NULL,store_id TEXT,product_id TEXT NOT NULL,variant_id TEXT,before_qty INTEGER NOT NULL,after_qty INTEGER,tracking_mode TEXT NOT NULL DEFAULT 'QUANTITY',actor TEXT NOT NULL,created_at TEXT NOT NULL,completed_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS inventory_operation_guards(id TEXT PRIMARY KEY,valid INTEGER NOT NULL CHECK(valid=1))`,
  `CREATE TABLE IF NOT EXISTS inventory_label_jobs(id TEXT PRIMARY KEY,client_id TEXT NOT NULL,store_id TEXT,actor TEXT NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS inventory_label_job_units(job_id TEXT NOT NULL,client_id TEXT NOT NULL,unit_id TEXT NOT NULL,unit_code TEXT NOT NULL,is_reprint INTEGER NOT NULL,PRIMARY KEY(job_id,unit_id))`,
  `CREATE INDEX IF NOT EXISTS idx_label_unit_history ON inventory_label_job_units(client_id,unit_id)`,
  `CREATE TABLE IF NOT EXISTS inventory_handover_batches(id TEXT PRIMARY KEY,client_id TEXT NOT NULL,store_id TEXT,carrier TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open',actor TEXT NOT NULL,courier TEXT,created_at TEXT NOT NULL,completed_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS inventory_handover_orders(batch_id TEXT NOT NULL,client_id TEXT NOT NULL,order_id TEXT NOT NULL,awb TEXT NOT NULL,PRIMARY KEY(batch_id,order_id))`,
  `CREATE TABLE IF NOT EXISTS inventory_handover_units(batch_id TEXT NOT NULL,client_id TEXT NOT NULL,order_id TEXT NOT NULL,unit_id TEXT NOT NULL,awb TEXT NOT NULL,PRIMARY KEY(batch_id,unit_id))`,
  `CREATE INDEX IF NOT EXISTS idx_handover_order ON inventory_handover_orders(client_id,order_id)`,
  `CREATE TABLE IF NOT EXISTS inventory_unit_locations(unit_id TEXT PRIMARY KEY,client_id TEXT NOT NULL,store_id TEXT,warehouse TEXT NOT NULL DEFAULT 'Main',location TEXT NOT NULL DEFAULT '')`,
  `CREATE TABLE IF NOT EXISTS inventory_operation_sessions(id TEXT PRIMARY KEY,client_id TEXT NOT NULL,store_id TEXT,kind TEXT NOT NULL CHECK(kind IN ('stocktake','transfer')),status TEXT NOT NULL DEFAULT 'open',source_warehouse TEXT NOT NULL,source_location TEXT NOT NULL DEFAULT '',target_warehouse TEXT,target_location TEXT,actor TEXT NOT NULL,created_at TEXT NOT NULL,completed_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS inventory_operation_units(session_id TEXT NOT NULL,unit_id TEXT NOT NULL,expected INTEGER NOT NULL DEFAULT 0,scanned INTEGER NOT NULL DEFAULT 0,received INTEGER NOT NULL DEFAULT 0,wrong_location INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(session_id,unit_id))`,
  `CREATE TABLE IF NOT EXISTS inventory_count_baselines(session_id TEXT NOT NULL,unit_id TEXT NOT NULL,status TEXT NOT NULL,updated_at TEXT NOT NULL,warehouse TEXT NOT NULL,location TEXT NOT NULL,PRIMARY KEY(session_id,unit_id))`,
  `CREATE TABLE IF NOT EXISTS inventory_count_approvals(session_id TEXT PRIMARY KEY,client_id TEXT NOT NULL,actor TEXT NOT NULL,reason TEXT NOT NULL,adjust_missing INTEGER NOT NULL,correct_locations INTEGER NOT NULL,created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS inventory_return_cases(id TEXT PRIMARY KEY,client_id TEXT NOT NULL,store_id TEXT,unit_id TEXT NOT NULL,order_id TEXT NOT NULL,awb TEXT,allocation_id TEXT,cycle_token TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'received',commercial_reason TEXT NOT NULL,condition TEXT,inspection_reason TEXT,actor TEXT NOT NULL,created_at TEXT NOT NULL,inspected_at TEXT)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS inventory_return_cycle_unique ON inventory_return_cases(client_id,unit_id,cycle_token)`,
  `CREATE INDEX IF NOT EXISTS inventory_return_order ON inventory_return_cases(client_id,order_id,status)`,
  `CREATE TABLE IF NOT EXISTS inventory_exchange_cases(id TEXT PRIMARY KEY,client_id TEXT NOT NULL,store_id TEXT,return_case_id TEXT NOT NULL,original_unit_id TEXT NOT NULL,original_order_id TEXT NOT NULL,replacement_order_id TEXT NOT NULL,replacement_product_id TEXT NOT NULL,replacement_variant_id TEXT,replacement_unit_id TEXT,status TEXT NOT NULL DEFAULT 'awaiting_replacement',reason TEXT NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL,completed_at TEXT)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS inventory_exchange_return_unique ON inventory_exchange_cases(client_id,return_case_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS inventory_exchange_replacement_unique ON inventory_exchange_cases(client_id,replacement_order_id,replacement_unit_id) WHERE replacement_unit_id IS NOT NULL`,
  `CREATE TRIGGER IF NOT EXISTS inventory_exchange_same_unit BEFORE UPDATE OF current_order_id ON inventory_units WHEN NEW.current_order_id IS NOT NULL AND EXISTS(SELECT 1 FROM inventory_exchange_cases WHERE client_id=NEW.client_id AND original_unit_id=NEW.id AND replacement_order_id=NEW.current_order_id AND status<>'cancelled') BEGIN SELECT RAISE(ABORT,'EXCHANGE_REPLACEMENT_SAME_UNIT'); END`,
  `CREATE TABLE IF NOT EXISTS inventory_scrap_requests(id TEXT PRIMARY KEY,client_id TEXT NOT NULL,store_id TEXT,unit_id TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',reason TEXT NOT NULL,requested_by TEXT NOT NULL,approved_by TEXT,created_at TEXT NOT NULL,approved_at TEXT)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_scrap_pending ON inventory_scrap_requests(client_id,unit_id) WHERE status='pending'`
  ,`CREATE TRIGGER IF NOT EXISTS unit_active_allocation_insert BEFORE INSERT ON order_unit_allocations WHEN NEW.status IN ('reserved','packed','shipped','delivered','return_pending') AND EXISTS(SELECT 1 FROM order_unit_allocations WHERE client_id=NEW.client_id AND unit_id=NEW.unit_id AND status IN ('reserved','packed','shipped','delivered','return_pending') AND id<>NEW.id) BEGIN SELECT RAISE(ABORT,'UNIT_ACTIVE_ALLOCATION_CONFLICT'); END`
  ,`CREATE TRIGGER IF NOT EXISTS unit_active_allocation_update BEFORE UPDATE OF unit_id,status ON order_unit_allocations WHEN NEW.status IN ('reserved','packed','shipped','delivered','return_pending') AND EXISTS(SELECT 1 FROM order_unit_allocations WHERE client_id=NEW.client_id AND unit_id=NEW.unit_id AND status IN ('reserved','packed','shipped','delivered','return_pending') AND id<>NEW.id) BEGIN SELECT RAISE(ABORT,'UNIT_ACTIVE_ALLOCATION_CONFLICT'); END`
];
