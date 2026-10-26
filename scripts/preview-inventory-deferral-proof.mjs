// Exact published inventory transition code is retained; no customer data repair.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const pins={"src/index.js": "e604d6c30c0dc31ec8b2cf8b999b308b149e9290e07afe58c1ca2600d456e648", "src/inventory-fifo.js": "ab2145c8253540d4437e0b92701c5626868b6a612d64cfdfacd4d38e26d1b088"};
for(const [file,digest] of Object.entries(pins))assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'),digest,'Existing Preview inventory transitions must stay byte-identical: '+file);
const source=readFileSync('src/index-commerce-v38.js','utf8'),html=readFileSync('public/v2/index.html','utf8');
for(const token of ['handleInventoryUnitTracking','syncInventoryTrackingAfterResponse','reconcileTrackedOrderLifecycles','reconcileAllClientsUnitCoverage','inventory-unit-tracking.js'])assert.ok(!source.includes(token),'Deferred activation path forbidden: '+token);
assert.ok(!html.includes('/v2/modules-v128-unit-tracking.js'),'Deferred Preview UI must not advertise inactive tracking');
const workflow=readFileSync('.github/workflows/preview.yml','utf8');
assert.ok(workflow.includes('node scripts/preview-inventory-deferral-proof.mjs'),'Deferral proof must precede publication');
assert.ok(!workflow.includes('run: npm run db:migrate:preview'),'Deferred release must not enable any migration path');
console.log(JSON.stringify({kind:'PREVIEW_INVENTORY_ACTIVATION_DEFERRED',publishedBaseline:'4bb415efc89a4d9bf84b0e0aa377ea284ec69105',inventoryTransitionsByteIdentical:true,newTrackingRoutesActivated:false,newAutomaticUnitSynchronization:false,inventoryConflictResolved:false,customerRowsModified:false}));
