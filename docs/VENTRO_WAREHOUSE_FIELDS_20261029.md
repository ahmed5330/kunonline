# Warehouse operation fields — 29 October 2026

Based independently on main `87b24de871c92794c44ee0d271013ebc1a71eb47`; does not include or require printing PR #336.

The original Ventro/Kun report identifies mixed transfer, scrap, return and packing inputs as a UX problem. `modules-v128-unit-tracking.js` confirmed it: all fields and a generic completion action were rendered for all 18 operations. Existing workflows, serialized inventory and approval controls already exist and must be preserved.

## Acceptance and result

- Each of the 18 existing modes exposes only relevant fields, help, action buttons and scan controls. Unsupported completion/report actions are hidden.
- CSS display and disabled controls agree with visibility. Source/destination companion fields follow their containing label.
- Switching modes clears prior operation/shipment/return identifiers, reason, destination, replacement order, scans and financial/inspection selections. Missing-stock adjustment and location correction always reset unchecked; disposition resets to quarantine.
- The mode selector is disabled during an in-flight action. Existing server-side permissions, independent approver rule, API payloads and stock/accounting logic are preserved.
- All canonical shells load v128.5 to avoid stale UI assets.

Tested: real local Chromium fixture for all 18 field profiles, zero API requests on mode changes, stale identifier/adjustment reset, and existing packing/return/partial-shipment interactions. Existing in-memory SQLite warehouse regression passes isolation, concurrent scans, audit rollback, independent stocktake approval, exact-unit stock, partial returns, official carrier-label ownership, cancellation retries and no duplicate stock changes.

Not tested: authenticated live UI, physical scanners, live carrier handover and real warehouse operations. Not deployed. This is a UX improvement, not completion of a new preparation-batch system. Exact original 44-row workbook mapping is pending owner attachment; do not invent a source-row ID.

No Production/Preview database access, migrations or live deployment. Draft PR only; merging main would deploy and requires separate approval.
