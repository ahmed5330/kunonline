import assert from 'node:assert/strict';
import {classifyRecoveryError,summarizeRecoveryRows,validateQuery} from './easyorders-protected-safe-error-categories.mjs';
const t=(error,category)=>assert.equal(classifyRecoveryError(error),category);
t('Easy Orders HTTP 503: record not found','UPSTREAM_SERVER_ERROR');
t('HTTP 429 too many requests','UPSTREAM_RATE_LIMIT');
t('SQLITE_CONSTRAINT: UNIQUE key','DATABASE_SCHEMA_OR_WRITE');
t('External store identity not bound','EXTERNAL_STORE_BINDING');
t('Easy Orders HTTP 400 bad request','UPSTREAM_REQUEST_REJECTED');
t('Webhook returned 409: payload invalid','UPSTREAM_REQUEST_REJECTED');
t('fetch failed from network','NETWORK_OR_TIMEOUT');
t('Failed to decrypt key','SECRET_DECRYPT_OR_MISSING');
t('','NO_ERROR_TEXT');
t('private customer phone + orders','OTHER_UNCLASSIFIED');
const now=Date.parse('2026-10-26T18:00:00Z');
const data=[
{recovery_status:'error',last_run_at:'2026-10-26T17:55:00Z',recovery_error:'SQLITE_ERROR: no such column PRIVATE_CLIENT_ID'},
{recovery_status:'error',last_run_at:'2026-10-26T17:57:00Z',recovery_error:'Error: HTTP 503 with PRIVATE_PHONE'},
];
const summary=summarizeRecoveryRows(data,now);
assert.equal(summary.connections,2);
assert.deepEqual(summary.byStatus,{error:2});
assert.deepEqual(summary.byCategory,{DATABASE_SCHEMA_OR_WRITE:1,UPSTREAM_SERVER_ERROR:1});
assert.equal(summary.checked.within20Minutes,2);
assert.equal(summary.d1Writes,false);
assert.equal(summary.wefaqHistoricalCompletenessProven,false);
assert.ok(!JSON.stringify(summary).includes('PRIVATE_CLIENT_ID'));
assert.ok(!JSON.stringify(summary).includes('PRIVATE_PHONE'));
assert.ok(!JSON.stringify(summary).includes('recovery_error'));
assert.throws(()=>validateQuery('DELETE FROM orders'),/ONLY_CONSTANT_SELECT_IS_ALLOWED/);
assert.throws(()=>validateQuery('SELECT * FROM orders; DROP TABLE orders'),/ONLY_CONSTANT_SELECT_IS_ALLOWED/);
assert.match(validateQuery(),/^SELECT/);
console.log('PASS: protected Easy Orders D1 read-only classifier, safely aggregated error types, no PII/credentials, no writes.');
