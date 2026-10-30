# Source items #6 and #42 — order follow-ups

Original workbook sheet `الفروق التفصيلية`, rows 7 and 43, item IDs 6 (responsible-person filter) and 42 (create a follow-up inside an order).

Adds “جدولة متابعة” on Customer Service order cards and a scoped “متابعات الطلبات” panel. Reuses existing collaboration tasks and member visibility, not a parallel follow-up database. The original exact order/store is fixed by the card snapshot; responsible person, reason, priority and Cairo due time are explicit. Cairo winter/summer conversion uses Intl; invalid or ambiguous local times are rejected rather than guessed. Creation does not send a message, change order state, reserve inventory or post accounting.

Queue filters cover assignee, mine, unassigned, overdue, today, unscheduled and resolved. Labels disclose that the view uses the latest 250 visible collaboration tasks; it is not an exhaustive all-time queue or a server-wide order-board assignee filter. Therefore **#6 remains partial** if it requires filtering the entire order board; task-level responsible-person filtering is implemented and tested. #42 is implemented against the existing task service.

Acceptance: local Chromium fixture covers create/link/assign, Cairo winter and summer, invalid dates, double-click suppression, queue filters and stale-store denial. The actual existing backend handler was exercised using in-memory SQLite: auth, cross-tenant/store/order/assignee denial, read-only store denial, persisted exact order and due time, original orders unchanged and zero collaboration messages.

No new schema, migrations, live tasks/messages, release or environment changes. Existing collaboration schema availability is a prerequisite; errors remain visible. The existing task service does not provide creation idempotency after an uncertain network response; the UI blocks concurrent clicks but does not claim durable replay protection. Complete/reassign/reschedule operations remain in the existing team-task interface.
