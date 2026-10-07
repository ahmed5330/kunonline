# Serialized warehouse implementation — draft, not deployable

This branch extends the existing unit ledger and keeps official J&T waybill printing separate from physical handover.

Implemented and locally verified:

- Idempotent migration 0094, additive schema only. Counted/concurrent backfill gives 100 identities for 100 current pieces, without modifying stock.
- Explicit SERIALIZED activation snapshots, variant checks, and legacy stock/POS/import/clear mutation guards.
- Named-batch receipts combine stock, generated unit identities and audit entries in one transaction, with integer quantity and transaction-size validation.
- Atomic allocation claims, packing scan substitution, duplicate/wrong-variant rejection, completion and audited undo. Injected audit failures roll back the whole operation.
- Bulk/single print jobs and reasoned reprint audits using existing unit barcodes.
- Official J&T carrier-record verification, packed-unit manifest batches and physical dispatch only at batch closure.
- Partial unit returns preserving original order/AWB and sibling units; condition inspection adds sellable stock once. Exchanges link a separate replacement order and record replacement handover while blocking reuse of the returned original unit.
- Stocktake baseline, variance report, separate-approver adjustments, stale snapshot rejection and ledger entries. Transfers support partial receipt. Scrap requires a separate approver.
- Tenant/store-scoped serial/order/tracking search and unit history; Arabic warehouse workbench for keyboard scanners and supported BarcodeDetector cameras.

Remaining release gates:

- Multiple real J&T waybills per order and line-specific partial shipping/packing.
- Full transactional integration and regression of existing FIFO quantity reservations, whole-order cancellation/unreserve and partial-return interactions across every order/import path.
- Authenticated deployed end-to-end verification, native Android compatibility, real camera/hardware scanner and thermal label checks.
- Live safe migration/backfill, merge and deployment. None have occurred.

Validation: the complete existing npm test suite passed with Windows Chrome support. Focused SQLite warehouse integrations passed, including concurrent backfill, migration replay, stocktake, returns, exchanges, atomic packing and receipt rollback. An isolated Chrome warehouse fixture passed waybill-first form scanning, wrong-scan feedback, tenant/store scoping and context switching. Production Worker dry build passed. Browser fixtures use fake APIs and do not replace authenticated end-to-end acceptance.
