# General release: serialized inventory activation deferred

Protected read-only run40244362754 found one existing duplicate allocation group in canonical D1: two delivered allocations for one physical unit. The tenant and store have QA labels, but order IDs/names/phones did not independently prove synthetic provenance. This release does not repair, delete or reclassify those rows, and does not waive the inventory activation invariant.

The release scope excludes new Preview serialized inventory activation. `src/index.js` and `src/inventory-fifo.js` remain byte-identical to published Preview4bb415ef. Its original return regression tests are retained. The outer Preview entrypoint does not import/execute tracking routes, after-response unit synchronization or global coverage reconciliation; its shell does not load new tracking controls. A mandatory SHA256 baseline proof guards these facts. No workflow path applies migrations, including manual dispatch. New warehouse module SQL/rollback tests remain runnable in isolation; passing them does not mean activation.

Growth planning, wallet integrity, COD verification, read-only FAOS and residual admin/team/supplier/order UI remain the general publication scope. Main's already-published inventory implementation is unchanged by its general release candidate. Protected schema and wallet checks remain mandatory. A fresh paired runtime QA additionally proves the deferred canonical tracking route is unavailable.

Future activation requires resolving the allocation provenance/conflict without guessing ownership, passing all existing inventory invariants, isolated lifecycle acceptance and a separate reviewed publication. Physical scanner/printer, carrier and bank acceptance remain unproven.
