# kun online — Commerce OS execution plan

## Current branch
`develop/ux-system-upgrade`

Production `main` remains unchanged until review and preview deployment.

## Build order
1. Foundation: design system, app shell, dashboard, help UX.
2. Commerce: orders, customers CRM, products, inventory.
3. Operations: suppliers, procurement, shipping, returns and fulfillment.
4. Finance: revenue, COGS, shipping, ads, expenses, reconciliation and Profit Intelligence.
5. Growth: marketing attribution, campaigns, retention and customer segments.
6. Intelligence: executive analytics, drill-down reports, alerts and forecasting.
7. Automation: workflow definitions, runs, logs, retries, approvals and sensitive-action confirmation.
8. AI: tenant-scoped context, explain/recommend/act flow, permission-aware tools and auditability.
9. SaaS control plane: stores, users, teams, roles, billing, usage, support and platform admin.

## Release gates
A module is not considered complete until it has:
- UX states: loading / empty / error / success.
- Tenant isolation by `client_id`.
- Role and permission checks.
- API validation.
- Audit logging for writes and sensitive actions.
- Mobile/responsive behavior.
- Help tooltip or contextual explanation for non-obvious metrics.
- Tests for core business rules.

## Procurement target flow
Purchase Request → Purchase Order → Approval → Sent → Partial Receiving / Receiving → Stock Update → Supplier Invoice → Payment → Purchase Return.

## Shipping target flow
Order → Ready to Ship → AWB → Pickup → In Transit → Delivered / Failed Attempt / Returned → COD Reconciliation.

## Profit Intelligence equation
Revenue
− Discounts / Refunds
− COGS
− Shipping & return shipping
− Payment fees
− Ad spend attribution
− Operational expenses
= Contribution / Net Profit

Profit should be drillable by Company → Store → Channel → Campaign → Product → Order.

## Automation safety
Every workflow action has three classes:
- Safe: tag, assign, notify, add note.
- External: WhatsApp/email/webhook; logged and retryable.
- Sensitive: refunds, financial writes, destructive changes; permission + confirmation + audit required.

## AI safety and tenancy
AI context must be assembled server-side and always scoped to the authenticated tenant/store. Secret tokens are never sent to the browser or AI context. AI can explain and recommend by default; execution requires mapped permissions and confirmation for sensitive actions.

## Before merge to main
- Create Cloudflare preview from `develop/ux-system-upgrade`.
- Smoke-test login, `/api/state`, Orders, CRM, Products, Inventory and v2 navigation.
- Apply additive D1 migrations to preview database only first.
- Run automated tests.
- Review responsive UI.
- Only then mark PR ready and merge to `main`.
