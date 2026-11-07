import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const scheduler=readFileSync(new URL('../src/index-commerce-v34.js',import.meta.url),'utf8');
const recovery=readFileSync(new URL('../src/easyorders-order-reconciliation.js',import.meta.url),'utf8');
const config=readFileSync(new URL('../src/easyorders-connection-config.js',import.meta.url),'utf8');

// The HTTP 400 exception is intentionally disabled for interactive clients.
assert.match(scheduler,/const result=await reconcileEasyOrdersOrders\(env,\{maxRequests:30,lookback:80,trigger:'cron'\}\);/,
  'five-minute scheduled task must explicitly identify itself as a Cron run');
assert.match(scheduler,/reconcileEasyOrdersOrders\(env,\{clientId,storeId:scope\.storeId\|\|null,connectionId:body\.connectionId\|\|body\.connection_id\|\|null,maxRequests:body\.maxRequests\|\|30,lookback:body\.lookback\|\|80\}\)/,
  'user-initiated recovery remains conservative; cannot opt into Cron proof');
assert.match(recovery,/trigger='manual'/,'new requests default to manual mode');
assert.match(recovery,/cronRun:trigger==='cron'/,'Cron proof must be controlled by trusted scheduler argument');
assert.match(recovery,/!cronRun\|\|Number\(error\?\.status\)!==400/,'HTTP 400 handling fail-closed outside Cron');
assert.match(recovery,/positiveControlVerified/,'same-store positive control required before missing 400');
assert.match(recovery,/easyOrdersRecoveryPendingAdd/,'provider holes must be durably queued');
assert.match(config,/easyOrdersRecoveryPendingShortIds/,'missing-id queue must persist across retries');
console.log('PASS Easy Orders Cron/manual boundary, verified-400 and durable pending retry contract');
