-- 5B decision 12 (owner, 2026-10-01): the email policy. A task assignment is no longer always
-- emailed: it goes by push and in-app, and by email only as the fallback for a member with no
-- working push (`actionable` stays true; email_claim reads both flags when it runs).
--
-- Expand-only (ARCHITECTURE §18): one row's flag changes, nothing is dropped or renamed, and the
-- released code (v1.3.x) reads the flag at run time. Every other 5.1 kind already matches the
-- decision: fallback only for changes requested, the leave / attendance / extra-work decisions,
-- comp leave granted or taken back and an expense decided (actionable); push and in-app only for
-- the rest (comments, task changed, suggestions, approvals, the end-day reminder, information
-- rows). The always-emailed kinds of decision 12 (the 1-day-before and overdue reminders, the
-- escalations, the Owner digest, the "can't be reached" alert) arrive as new rows with 5.3 / 5.4.
update public.notification_kinds
set always_email = false
where kind = 'task_assigned';
