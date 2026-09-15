# Kun Online — Preview Release Candidate

This document describes the code-complete Preview release on `develop/ux-system-upgrade`.

## Included

- Responsive Commerce OS shell for desktop, tablet and mobile.
- Light, Gray and Dark themes with persistence and accessibility support.
- Dashboard, Orders, CRM, Products, Inventory, Suppliers and Procurement.
- Supplier invoices, payments, returns and supplier balances.
- Shipping operations and COD reconciliation.
- Finance, Profit Intelligence, marketing attribution and campaign analytics.
- POS sessions, sales and transactional stock guards.
- Workflow engine, approvals, retries, execution queue and dead-letter handling.
- kun AI governed insights, AI action history and human approval for sensitive actions.
- Audit Log, notifications, system health and operations center.
- SaaS control center, usage, subscriptions and support tickets.
- Multi-store foundation, store management and store-level team access.
- Onboarding readiness checklist.
- Integration provider registry and readiness for commerce, messaging, ads and shipping providers.
- Secure integration credential storage using AES-GCM; credentials are never returned to the browser.
- Governed integration connection creation/deletion and configuration validation.
- Contextual help center and explanations for non-obvious concepts.
- Isolated Preview CI/CD with migrations, deploy, smoke test and automatic code rollback.

## External activation required per provider

Provider credentials, OAuth applications, webhook URLs and vendor account approvals are environment/account configuration, not repository secrets. A provider stays `configured` until its real external API/webhook is activated and verified.

`INTEGRATION_ENCRYPTION_KEY` must be present in the Preview Worker before saving provider credentials. It must be a stable 32-byte value encoded as base64 and must never be committed to Git.

## Production safety

- Production D1 is not migrated automatically.
- Production deployment is approval gated.
- Preview resources are pinned to `kunonline-preview` only.
- Do not merge this PR or deploy Production without explicit approval.

## Final release gate

A release is considered ready to review only when the latest Preview CI/CD run passes: tests, isolation checks, dry-run, Preview D1 migrations, Worker deploy and deployed smoke tests.
