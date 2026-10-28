# Ventro inventory #242 / #243 — FAOS entry composer

Source: original `ventro_kun_all_gaps_and_727_controls_ar.xlsx`, sheet `الجرد الوظيفي`, rows 243–244 (item IDs 242 and 243). Preserve existing coded chart (#240), quick two-line entry (#242), trial balance (#245), permission checks, posting gate, journal limits and immutable ledger.

Added a 2–50-line journal form alongside the existing quick entry. Integer minor-unit validation rejects invalid precision, negative/ambiguous input, invalid accounts, empty or two-sided lines, unsafe totals and imbalance. Summary shows debit, credit and difference. Retries reuse the key for an identical payload; edited entries rotate it. The form and request are bound to the loaded tenant/store, rejecting a scope change before sending.

No backend posting changes, migrations, live writes or deployments. Production financial posting remains disabled; the UI is unavailable unless the existing server capability explicitly enables it. Do not change `FAOS_WRITE_ENABLED` to demonstrate the UI on customer-backed Preview.

Acceptance passed in local Chromium using synthetic fetch responses: closed write gate; three balanced lines; precision/imbalance rejection with zero writes; identical retry and changed-payload keys; stale-store denial. Existing FAOS in-memory database tests passed posting/replay/conflicting payload, period close, reversal and cross-tenant denial. Live accounting UI and real posting are untested and not authorized. #243 is implemented and synthetically tested, not deployed; #242 is preserved and covered by regression, not newly invented.
