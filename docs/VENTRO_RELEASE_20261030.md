# Release candidate - 30 October 2026

User requested continuing implementation and publishing the remainder. This authorizes the existing code-only protected release path, not database changes. Main rechecked at 87b24de871c92794c44ee0d271013ebc1a71eb47. Preview compatibility preflight passes. Production workflow deploys Worker/assets with --keep-vars, no migrations, captures previous Worker version, verifies ownership and restores that version on smoke failure. Protected environment approvals must remain intact.

Integration #342 includes #336-343. Latest exact inventory: 23 implemented/improved, 6 existing verified within test limits, 11 partial, 4 unimplemented. Directory and PDF acceptance are documented separately. Earlier stage summaries and CI for d04f6d8 are historical, not evidence for this new candidate. Latest-head CI must pass before merge.

Release scope: customer statement preview/direct raster PDF, read-only document settings defaults, warehouse operation-specific UI, existing FAOS coded chart/multiline UI under unchanged posting gates, and order-linked follow-up UI using the existing scoped task service. PDF does not reproduce every HTML decoration or create invoice/payment proof.

HR and shared document storage writes remain sandbox-only. Proposed schemas remain in docs/sql outside migrations. No schema application, payment, payroll posting, stock operation, carrier action or real customer test is authorized by this release. HR schema absence returns an explicit unavailable error rather than creating tables. Document reads return preview defaults when storage is absent. The release must not claim these storage-dependent features usable live.

Remaining original acceptance: #6 complete server order-board assignee filter; #73 additional carrier templates; #75-77 authoritative itemized invoice/receipt fields and physical printers; #83 physical print completion cannot be inferred from print-dialog requests; #115 independent warehouse register; #204 evidence-backed smart reconciliation; #325 trusted server collection/refund adapter and employee attribution; #326 approved adjustment persistence; #327-330 salary history/month close/advance payment/register with existing FAOS and independent approval; #331 full financial history. Do not invent account mappings or trust client verified flags. Commission basis remains net actual cash after returns.

Post-release proof must separate merge, successful deployment, public asset/unauthenticated route checks, and authenticated synthetic acceptance. No scheduled continuation is configured.
