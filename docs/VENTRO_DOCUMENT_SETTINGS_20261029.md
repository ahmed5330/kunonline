# Ventro inventory #69–85: customer documents

Stacked on printing PR #336. Exact source: `ventro_kun_all_gaps_and_727_controls_ar.xlsx`, sheet **الفروق التفصيلية**, Excel rows 70–86; source item IDs 69–85. These are preliminary candidates, not proof of absence or exhaustive competitor acceptance.

Implemented: independent settings dialog (#69), brand/profile/rule/carrier tabs (#70–73), 11 original Kun designs (#74), A4/A5/80mm previews (#75–77), store-bound branding persistence (#78), text/color/PNG or JPEG logo (#79), ordered first-match state/amount rules with explicit default (#80), preview without a shipment (#81), independent customer document and official J&T label (#82), append-only print-request timestamps/history (#83), browser print/save-PDF dialog (#84), repeat customer printing without AWB creation (#85).

## Precise limits

- These are order statements, not fiscal invoices or payment receipts. They preserve recorded order description, quantity and total; they do not invent itemized prices, deposits, tax or paid balances. Therefore the invoice equivalence of #75–77 remains **partial**.
- #73 shows the currently supported official J&T carrier path. Other carrier templates are **not implemented**. Customer designs never replace carrier labels.
- #83 records **print requested**, not physical print success or a saved PDF. The browser cannot prove the user completed the print dialog.
- #84 uses the browser's save-PDF option; a one-click generated PDF download is **not implemented**.
- The designs are original variations with distinct palettes/layouts, not visual copies of 11 competitor templates.

## Storage and release gate

No automatic CREATE/ALTER, migrations, fixture insertion, deployment or live carrier operation. Review-only SQL is in `docs/sql/document-settings-sandbox.sql`, outside the migration queue. Missing settings schema returns explicit default-preview mode with saving disabled. Missing event schema returns an unavailable-history error, not a fabricated empty history.

PUT settings and POST print requests require **both** `APP_ENV=sandbox` and `DOCUMENT_SETTINGS_WRITE_ENABLED=1`, plus authenticated permissions and a validated exact store. Production and customer-backed Preview reject writes even if the flag is set. No environment configuration was changed. Persistence is implemented/tested but **not activated or deployed**; any remote schema application or release requires separately approved isolated resources and a safe migration/release plan.

Settings use compare-and-swap revisions plus a transactional audit insert: conflicts do not overwrite and audit failures roll back the settings. Audit and print-request rows are immutable. Event IDs are idempotent and tied to the original same-store order. Logos accept only bounded embedded PNG/JPEG data; remote URLs, SVG, CSS and arbitrary templates are rejected. All user text is escaped in a script-disabled/CSP-restricted preview frame. Internal order notes and cost are excluded.

## Acceptance

In-memory SQLite: permissions/authentication, cross-tenant/store denial, missing-schema fallback, Production/Preview writes denied, profile/rule validation, concurrent stale revisions, atomic audit failure rollback, immutable/idempotent print requests, same-store order linkage.

Real local Chromium with synthetic responses: write-disabled policy, brand escaping, profile creation, rules and auto-selection, config save/conflict, scope change rejection, all 11 previews, nested modal focus/escape, explicit print-request history, no carrier or financial calls. Original read-only preview and J&T handoff/integration regressions also pass. Physical printers/scanners, authenticated live UI, actual persisted live settings and PDF file download remain untested or unimplemented as stated above.
