import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyAction, validateWorkflowDefinition, evaluateConditions, planWorkflowRun } from './src/workflow-engine.js';

const workflowApiSource = readFileSync(new URL('./src/index-commerce.js', import.meta.url), 'utf8');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`✓ ${name}`); }
  catch (error) { console.error(`✗ ${name}`); throw error; }
}

test('classifies safe/external/sensitive actions', () => {
  assert.equal(classifyAction('add_tag'), 'safe');
  assert.equal(classifyAction('send_whatsapp'), 'external');
  assert.equal(classifyAction('refund'), 'sensitive');
  assert.equal(classifyAction('does_not_exist'), 'unknown');
});

test('rejects workflows with no actions', () => {
  const result = validateWorkflowDefinition({ conditions: [], actions: [] });
  assert.equal(result.ok, false);
  assert.ok(result.errors.length > 0);
});

test('rejects incomplete and unsupported workflow definitions', () => {
  const result = validateWorkflowDefinition({
    conditions: [{ field: 'order.total' }],
    actions: [{ type: 'launch_missiles' }]
  });
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 2);
});

test('evaluates nested conditions correctly', () => {
  const result = evaluateConditions([
    { field: 'order.total', operator: 'gte', value: 1000 },
    { field: 'customer.tags', operator: 'contains', value: 'VIP' },
    { field: 'order.phone', operator: 'exists' }
  ], { order: { total: 1200, phone: '01000000000' }, customer: { tags: ['VIP'] } });
  assert.equal(result.passed, true);
  assert.equal(result.details.every(x => x.passed), true);
});

test('skips workflow when conditions do not match', () => {
  const result = planWorkflowRun({ definition: {
    conditions: [{ field: 'order.total', operator: 'gt', value: 5000 }],
    actions: [{ type: 'add_tag', payload: { tag: 'high-value' } }]
  } }, { order: { total: 1000 } }, { perms: [] });
  assert.equal(result.status, 'skipped');
  assert.equal(result.steps.length, 0);
});

test('safe actions can be planned without elevated permission', () => {
  const result = planWorkflowRun({ definition: {
    conditions: [], actions: [{ type: 'add_note', payload: { note: 'ok' } }]
  } }, {}, { perms: [] });
  assert.equal(result.status, 'ready');
  assert.equal(result.steps[0].allowed, true);
  assert.equal(result.steps[0].requiresConfirmation, false);
});

test('sensitive actions are blocked without explicit permission', () => {
  const result = planWorkflowRun({ definition: {
    conditions: [], actions: [{ type: 'refund', permission: 'refunds' }]
  } }, {}, { perms: ['orders'] });
  assert.equal(result.status, 'blocked');
  assert.equal(result.steps[0].allowed, false);
  assert.equal(result.steps[0].reason, 'missing_permission:refunds');
});

test('sensitive actions require confirmation even with permission', () => {
  const result = planWorkflowRun({ definition: {
    conditions: [], actions: [{ type: 'stock_adjustment', permission: 'inventory_adjust' }]
  } }, {}, { perms: ['inventory_adjust'] });
  assert.equal(result.status, 'awaiting_confirmation');
  assert.equal(result.steps[0].allowed, true);
  assert.equal(result.steps[0].requiresConfirmation, true);
});

test('settings permission is an admin override for sensitive planning', () => {
  const result = planWorkflowRun({ definition: {
    conditions: [], actions: [{ type: 'financial_write', permission: 'finance_write' }]
  } }, {}, { perms: ['settings'] });
  assert.equal(result.status, 'awaiting_confirmation');
  assert.equal(result.steps[0].allowed, true);
});

test('workflow API resolves Admin tenant from body and prevents duplicate names', () => {
  assert.match(workflowApiSource, /b\.clientId\|\|b\.client_id\|\|url\.searchParams\.get\('clientId'\)/);
  assert.match(workflowApiSource, /DUPLICATE_WORKFLOW/);
});

console.log(`Workflow engine tests passed: ${passed}`);
