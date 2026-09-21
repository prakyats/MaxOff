# ADR-0007: Money is isolated and recognised only on CEO approval

- **Status:** accepted, amended 2026-09-21 (Potential keeps closed items; template categories are CEO-only; column guard)
- **Date:** 2026-09-20

## Context
Financial data is CEO-only. Revenue must be reconstructable (planned value, allocation, approval, override), and must count only after the CEO approves the work item. v2's allocation rules (explicit values, or an even split) are kept and applied to project cycles and one-time projects.

## Decision
- Amounts live only in `project_billing`, `item_billing`, `cycle_billing` and `revenue_overrides`, all with a single policy `has_permission('finance.view')`.
- Billing category is a column on `projects` (not an amount), but only the CEO can change it (transition function, plus a guard trigger on `billing_category`, `client_id` and `recurrence`). An Admin-created project takes the category from its recurrence; a template's default category applies only when the CEO creates the project.
- Calculation is done by SQL views (security invoker): an item's value is its explicit value or an even split. Achieved = approved items, attributed to their origin cycle's period. An item closed at the carry decision **keeps its value in Potential** and is reported as *closed, not achieved*; only items cancelled before their cycle started are excluded. Overrides are stored beside the calculated value, never replacing it.
- `eod_reports` and `month_snapshots` contain revenue, so they're CEO-only tables. Admin scoped reports are computed live without money.
- Only `modules/revenue` may query money. Others render its exported components.

## Consequences
- Admins and Staff can't see money through any path (API, Realtime, exports, search), and pgTAP proves it.
- Changing an allocation rule later means changing a view definition, while closed months stay frozen in snapshots.
