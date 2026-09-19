# ADR-0007: Money is isolated and recognised only on CEO approval

- **Status:** accepted
- **Date:** 2026-09-20

## Context
Financial data is CEO-only. Revenue must be reconstructable (planned value, allocation, approval, override), and must count only after the CEO approves the work item. v2's allocation rules (explicit values, or an even split) are kept and applied to project cycles and one-time projects.

## Decision
- Amounts live only in `project_billing`, `item_billing`, `cycle_billing` and `revenue_overrides`, all with a single policy `has_permission('finance.view')`.
- Billing category is a column on `projects` (not an amount), but only the CEO can change it (transition function).
- Calculation is done by SQL views (security invoker): an item's value is its explicit value or an even split. Achieved = approved items, attributed to their origin cycle's period. Overrides are stored beside the calculated value, never replacing it.
- Only `modules/revenue` may query money. Others render its exported components.

## Consequences
- Admins and Staff can't see money through any path (API, Realtime, exports, search), and pgTAP proves it.
- Changing an allocation rule later means changing a view definition, while closed months stay frozen in snapshots.
