# kun online — UX Phase 1

Branch: `develop/ux-system-upgrade`

This branch is the safe UX/UI modernization track for kun online. It does not change the production `main` branch.

## Phase 1 direction

- Keep the current Cloudflare Workers + D1 backend and existing APIs intact.
- Introduce a scalable application shell: sidebar, top bar, global actions and contextual help.
- Arabic-first RTL experience with progressive disclosure for beginners and power features for advanced users.
- Add contextual `i` help for metrics and terminology.
- Reserve a first-class entry point for `kun AI` as the future business copilot.
- Reuse current modules and refactor gradually instead of rebuilding the whole platform from scratch.

## Implementation order

1. App shell + design system
2. Dashboard
3. Orders
4. CRM / Customer 360
5. Products + Inventory + Warehouses + Purchasing
6. Shipping
7. Marketing + Attribution
8. Finance + Profit Intelligence
9. Analytics
10. Automation
11. kun AI
12. Team + Permissions
13. Integrations
14. Settings + SaaS Admin

## UX rules

- Every important metric should have a simple explanation.
- Every complex screen should support contextual help.
- Default views stay simple; advanced controls appear when needed.
- Tables support filtering, sorting, saved views and bulk actions.
- Mobile focuses on monitoring, approvals, inbox, orders and AI rather than squeezing the full ERP into a small screen.

## Safety

All development is tested on this branch first. Production deployment should happen only after review and merge into `main`.
