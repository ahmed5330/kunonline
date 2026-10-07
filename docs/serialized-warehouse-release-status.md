# Serialized warehouse release status

Implemented: unit identities, scoped unique codes, counted/backfill guards, SERIALIZED activation snapshots, atomic receipts and unreserve, label/reprint audit, context scanners, packing sessions, independent official J&T partial waybills, signed printing/cancellation with retry recovery, physical handover manifests, partial returns/inspection, exchanges, approved scrap and stocktake, partial transfers, search/timeline and backend permissions.

Migrations: 0092, 0093 and 0094 are additive and replay-safe. The release applies only these files to the canonical Preview D1 store used by Production. It never targets the historical Production D1 database and does not change stock quantities. Serialization/backfill is an explicit scoped operation, not a global automatic rewrite. The direct schema runner does not mark the D1 migration ledger; future replay remains safe.

Validation: complete npm regression, SQLite transaction/rollback/concurrency suites and isolated Chrome scanner/workbench fixtures; 1000-piece identity/label/reprint regression. J&T uses the existing signed integration; carrier tests are mocked to avoid live customer shipments. Preview and Production dry builds are required before release.

Release: source review is PR #89 on codex/serialized-warehouse-operations. Live schema application and deployment are not yet verified. Preview deployment must precede the matching Production runtime because commerce mutations are delegated there.

Remaining acceptance: authenticated live warehouse validation, real camera/hardware scanner/thermal printer, native Android and actual J&T shipment lifecycle. No real shipment or financial transaction has been created for tests.
