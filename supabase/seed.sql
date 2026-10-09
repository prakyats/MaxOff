-- LOCAL ONLY. PRODUCTION IS LIVE (https://app.maxoff.in, in daily use since 2026-10-01): never run
-- this seed, `db:reset` or any hand-written SQL against production or staging (CLAUDE.md).
-- Dev seed, loaded by `pnpm db:reset` after the migrations (config.toml [db.seed]).
-- Real data never goes into local or staging (ARCHITECTURE §2). The deploy workflow runs
-- `db push` only, so nothing here reaches a hosted project.
--
-- 1.1: the organization (org_settings follows by trigger).
-- 1.2: local sign-ins for development and Playwright (README → "Local sign-ins"). The
--      passwords below are development-only fixtures, never reused anywhere. A hosted Owner is
--      created by `pnpm bootstrap:owner`, which prints a one-time link and holds no password.
-- 1.3: one more sign-in for the deactivation test. The job titles are seeded by the migration
--      (trigger on organizations), not here. 1.4 adds the other Pixora lists.

insert into public.organizations (name)
select 'Pixora Clips'
where not exists (select 1 from public.organizations);

create temporary table seed_users (id uuid, email text, password text, full_name text, phone text,
  role public.member_role, status public.member_status) on commit drop;
insert into seed_users values
  ('10000000-0000-4000-8000-000000000001', 'owner@maxoff.local', 'owner-local-password', 'Prishit Shetty', '9000000001', 'owner', 'active'),
  ('10000000-0000-4000-8000-000000000002', 'admin@maxoff.local', 'admin-local-password', 'Local Admin', '9000000002', 'admin', 'active'),
  ('10000000-0000-4000-8000-000000000003', 'staff@maxoff.local', 'staff-local-password', 'Local Staff', null,         'staff', 'active'),
  ('10000000-0000-4000-8000-000000000004', 'gone@maxoff.local',  'gone-local-password',  'Gone Staff',  null,         'staff', 'deactivated'),
  -- Used only by the Playwright recovery-link test, which changes this password.
  ('10000000-0000-4000-8000-000000000005', 'reset@maxoff.local', 'reset-local-password', 'Reset Staff', null,         'staff', 'active'),
  -- Used only by the Playwright team test, which deactivates this person (1.3).
  ('10000000-0000-4000-8000-000000000006', 'leaver@maxoff.local', 'leaver-local-password', 'Leaver Staff', null,       'staff', 'active'),
  -- 2.2: the day gate spec (e2e/day-gate.spec.ts). One person has one attendance day per date,
  -- so every Playwright project gets its own people: gate-<kind>-<project>@maxoff.local. Named
  -- "Test …" so People (sorted by name, 10 cards on a phone) still opens on the dev accounts.
  ('20000000-0000-4000-8000-000000000001', 'gate-staff-desktop@maxoff.local', 'gate-local-password', 'Test Gate Staff (desktop)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000002', 'gate-admin-desktop@maxoff.local', 'gate-local-password', 'Test Gate Admin (desktop)', null, 'admin', 'active'),
  ('20000000-0000-4000-8000-000000000003', 'gate-leave-desktop@maxoff.local', 'gate-local-password', 'Test On Leave (desktop)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000004', 'gate-half-desktop@maxoff.local', 'gate-local-password', 'Test Half Day (desktop)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000005', 'gate-staff-mobile@maxoff.local', 'gate-local-password', 'Test Gate Staff (mobile)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000006', 'gate-admin-mobile@maxoff.local', 'gate-local-password', 'Test Gate Admin (mobile)', null, 'admin', 'active'),
  ('20000000-0000-4000-8000-000000000007', 'gate-leave-mobile@maxoff.local', 'gate-local-password', 'Test On Leave (mobile)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000008', 'gate-half-mobile@maxoff.local', 'gate-local-password', 'Test Half Day (mobile)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000009', 'gate-staff-mobile-lg@maxoff.local', 'gate-local-password', 'Test Gate Staff (mobile-lg)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000010', 'gate-admin-mobile-lg@maxoff.local', 'gate-local-password', 'Test Gate Admin (mobile-lg)', null, 'admin', 'active'),
  ('20000000-0000-4000-8000-000000000011', 'gate-leave-mobile-lg@maxoff.local', 'gate-local-password', 'Test On Leave (mobile-lg)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000012', 'gate-half-mobile-lg@maxoff.local', 'gate-local-password', 'Test Half Day (mobile-lg)', null, 'staff', 'active'),
  -- 2.3: e2e/leave.spec.ts, one per Playwright project. The spec clears this person's leave
  -- and attendance itself at the start, so it re-runs without db:reset.
  ('20000000-0000-4000-8000-000000000013', 'leave-self-desktop@maxoff.local', 'leave-local-password', 'Test Leave (desktop)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000014', 'leave-self-mobile@maxoff.local', 'leave-local-password', 'Test Leave (mobile)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000015', 'leave-self-mobile-lg@maxoff.local', 'leave-local-password', 'Test Leave (mobile-lg)', null, 'admin', 'active'),
  -- §14.2 e (the back-stack fix): sign-in, the gate and recovery leave nothing under home. One
  -- person per phone project; the spec clears their day and puts their password back itself.
  ('20000000-0000-4000-8000-000000000016', 'back-mobile@maxoff.local', 'back-local-password', 'Test Back (mobile)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000017', 'back-mobile-lg@maxoff.local', 'back-local-password', 'Test Back (mobile-lg)', null, 'staff', 'active'),
  -- 2.4: e2e/owner-review.spec.ts, three people per Playwright project whose days and leave the
  -- Owner decides (the spec clears and arranges them itself), and two for the bulk spec, which
  -- runs after the others (e2e/owner-bulk.spec.ts).
  ('20000000-0000-4000-8000-000000000018', 'review-day-desktop@maxoff.local', 'review-local-password', 'Test Review Day (desktop)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000019', 'review-fix-desktop@maxoff.local', 'review-local-password', 'Test Review Fix (desktop)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000020', 'review-leave-desktop@maxoff.local', 'review-local-password', 'Test Review Leave (desktop)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000021', 'review-day-mobile@maxoff.local', 'review-local-password', 'Test Review Day (mobile)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000022', 'review-fix-mobile@maxoff.local', 'review-local-password', 'Test Review Fix (mobile)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000023', 'review-leave-mobile@maxoff.local', 'review-local-password', 'Test Review Leave (mobile)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000024', 'review-day-mobile-lg@maxoff.local', 'review-local-password', 'Test Review Day (mobile-lg)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000025', 'review-fix-mobile-lg@maxoff.local', 'review-local-password', 'Test Review Fix (mobile-lg)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000026', 'review-leave-mobile-lg@maxoff.local', 'review-local-password', 'Test Review Leave (mobile-lg)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000027', 'review-bulk-a@maxoff.local', 'review-local-password', 'Test Review Bulk A', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000028', 'review-bulk-b@maxoff.local', 'review-local-password', 'Test Review Bulk B', null, 'staff', 'active'),
  -- 2.5: the nightly job's proposed absence, reviewed in e2e/owner-review.spec.ts (one per project).
  ('20000000-0000-4000-8000-000000000029', 'review-absent-desktop@maxoff.local', 'review-local-password', 'Test Review Absent (desktop)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000030', 'review-absent-mobile@maxoff.local', 'review-local-password', 'Test Review Absent (mobile)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000031', 'review-absent-mobile-lg@maxoff.local', 'review-local-password', 'Test Review Absent (mobile-lg)', null, 'staff', 'active'),
  -- 2.7b: refresh on return (e2e/refresh.spec.ts). The person renames themselves while the Owner
  -- has their page open; the spec puts the name back itself, so it re-runs without db:reset.
  ('20000000-0000-4000-8000-000000000032', 'refresh-desktop@maxoff.local', 'refresh-local-password', 'Test Refresh (desktop)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000033', 'refresh-mobile@maxoff.local', 'refresh-local-password', 'Test Refresh (mobile)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000034', 'refresh-mobile-lg@maxoff.local', 'refresh-local-password', 'Test Refresh (mobile-lg)', null, 'staff', 'active'),
  -- 2.9: the edit pattern (e2e/edit-pattern.spec.ts). "Profile" people edit their own profile on
  -- /me; the Owner edits "Member Edit" people through the People dialog. One per project; the
  -- spec puts every value back itself, so it re-runs without db:reset.
  ('20000000-0000-4000-8000-000000000035', 'profile-desktop@maxoff.local', 'profile-local-password', 'Test Profile (desktop)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000036', 'profile-mobile@maxoff.local', 'profile-local-password', 'Test Profile (mobile)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000037', 'profile-mobile-lg@maxoff.local', 'profile-local-password', 'Test Profile (mobile-lg)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000038', 'memberedit-desktop@maxoff.local', 'profile-local-password', 'Test Member Edit (desktop)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000039', 'memberedit-mobile@maxoff.local', 'profile-local-password', 'Test Member Edit (mobile)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000040', 'memberedit-mobile-lg@maxoff.local', 'profile-local-password', 'Test Member Edit (mobile-lg)', null, 'staff', 'active'),
  -- 3.3: file storage (e2e/storage.spec.ts). Each project's person sets and removes their own
  -- photo; the spec clears it first, so it re-runs without db:reset.
  ('20000000-0000-4000-8000-000000000041', 'avatar-desktop@maxoff.local', 'avatar-local-password', 'Test Avatar (desktop)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000042', 'avatar-mobile@maxoff.local', 'avatar-local-password', 'Test Avatar (mobile)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000043', 'avatar-mobile-lg@maxoff.local', 'avatar-local-password', 'Test Avatar (mobile-lg)', null, 'staff', 'active'),
  -- Phase 3 review: the client hand-over before a demotion or deactivation (e2e/handover.spec.ts).
  -- One Admin per project; the spec gives them clients, then puts the role and status back itself.
  ('20000000-0000-4000-8000-000000000044', 'handover-desktop@maxoff.local', 'handover-local-password', 'Test Handover (desktop)', null, 'admin', 'active'),
  ('20000000-0000-4000-8000-000000000045', 'handover-mobile@maxoff.local', 'handover-local-password', 'Test Handover (mobile)', null, 'admin', 'active'),
  ('20000000-0000-4000-8000-000000000046', 'handover-mobile-lg@maxoff.local', 'handover-local-password', 'Test Handover (mobile-lg)', null, 'admin', 'active'),
  -- 3b.2: extra work and comp leave (e2e/extra-work.spec.ts). One Staff member per project; the spec
  -- clears their notes, credits, leave and days itself, so it re-runs without db:reset.
  ('20000000-0000-4000-8000-000000000047', 'extra-desktop@maxoff.local', 'extra-local-password', 'Test Extra Work (desktop)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000048', 'extra-mobile@maxoff.local', 'extra-local-password', 'Test Extra Work (mobile)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000049', 'extra-mobile-lg@maxoff.local', 'extra-local-password', 'Test Extra Work (mobile-lg)', null, 'staff', 'active'),
  -- 3b.3: expense claims (e2e/expenses.spec.ts). One Staff member per project; the spec clears their
  -- claims, days and leave itself, so it re-runs without db:reset.
  ('20000000-0000-4000-8000-000000000050', 'expense-desktop@maxoff.local', 'expense-local-password', 'Test Expenses (desktop)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000051', 'expense-mobile@maxoff.local', 'expense-local-password', 'Test Expenses (mobile)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000052', 'expense-mobile-lg@maxoff.local', 'expense-local-password', 'Test Expenses (mobile-lg)', null, 'staff', 'active'),
  -- 3b.4: the month summary (e2e/month-summary.spec.ts). One Staff member per project whose days the
  -- spec arranges itself.
  ('20000000-0000-4000-8000-000000000053', 'month-desktop@maxoff.local', 'month-local-password', 'Test Month (desktop)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000054', 'month-mobile@maxoff.local', 'month-local-password', 'Test Month (mobile)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000055', 'month-mobile-lg@maxoff.local', 'month-local-password', 'Test Month (mobile-lg)', null, 'staff', 'active'),
  -- 3cB review: the Continue page a one-time link lands on (e2e/auth-link.spec.ts). One Staff member
  -- per project; the spec only issues recovery links for them (GoTrue keeps one per person, so no
  -- other spec may) and changes nothing else.
  ('20000000-0000-4000-8000-000000000056', 'link-desktop@maxoff.local', 'link-local-password', 'Test Link (desktop)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000057', 'link-mobile@maxoff.local', 'link-local-password', 'Test Link (mobile)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000058', 'link-mobile-lg@maxoff.local', 'link-local-password', 'Test Link (mobile-lg)', null, 'staff', 'active'),
  -- 4B: staff tasks (e2e/tasks.spec.ts). Per project: the primary assignee, a second one whose
  -- day the spec loads for the workload warning, one with a pending leave request, a coordinator
  -- (whose freelancer is below) and an Admin who checks and creates tasks. The spec removes the
  -- tasks it made (and the away person's leave) first, so it re-runs without db:reset.
  ('20000000-0000-4000-8000-000000000059', 'task-staff-desktop@maxoff.local', 'task-local-password', 'Test Task Staff (desktop)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000060', 'task-helper-desktop@maxoff.local', 'task-local-password', 'Test Task Helper (desktop)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000061', 'task-away-desktop@maxoff.local', 'task-local-password', 'Test Task Away (desktop)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000062', 'task-coord-desktop@maxoff.local', 'task-local-password', 'Test Task Coordinator (desktop)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000063', 'task-admin-desktop@maxoff.local', 'task-local-password', 'Test Task Admin (desktop)', null, 'admin', 'active'),
  ('20000000-0000-4000-8000-000000000064', 'task-staff-mobile@maxoff.local', 'task-local-password', 'Test Task Staff (mobile)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000065', 'task-helper-mobile@maxoff.local', 'task-local-password', 'Test Task Helper (mobile)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000066', 'task-away-mobile@maxoff.local', 'task-local-password', 'Test Task Away (mobile)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000067', 'task-coord-mobile@maxoff.local', 'task-local-password', 'Test Task Coordinator (mobile)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000068', 'task-admin-mobile@maxoff.local', 'task-local-password', 'Test Task Admin (mobile)', null, 'admin', 'active'),
  ('20000000-0000-4000-8000-000000000069', 'task-staff-mobile-lg@maxoff.local', 'task-local-password', 'Test Task Staff (mobile-lg)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000070', 'task-helper-mobile-lg@maxoff.local', 'task-local-password', 'Test Task Helper (mobile-lg)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000071', 'task-away-mobile-lg@maxoff.local', 'task-local-password', 'Test Task Away (mobile-lg)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000072', 'task-coord-mobile-lg@maxoff.local', 'task-local-password', 'Test Task Coordinator (mobile-lg)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000073', 'task-admin-mobile-lg@maxoff.local', 'task-local-password', 'Test Task Admin (mobile-lg)', null, 'admin', 'active'),
  -- Pull-to-refresh (e2e/pull-to-refresh.spec.ts): renamed behind the Owner's back while the
  -- People list is open, one per phone project; the spec puts the name back itself.
  ('20000000-0000-4000-8000-000000000074', 'pull-mobile@maxoff.local', 'pull-local-password', 'Aa Pull (mobile)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000075', 'pull-mobile-lg@maxoff.local', 'pull-local-password', 'Aa Pull (mobile-lg)', null, 'staff', 'active'),
  -- Tap feedback (e2e/tap-feedback.spec.ts): each edits their own profile on /me through a slow
  -- or failing connection, one per project; the spec puts the name back itself.
  ('20000000-0000-4000-8000-000000000076', 'tap-desktop@maxoff.local', 'tap-local-password', 'Test Tap (desktop)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000077', 'tap-mobile@maxoff.local', 'tap-local-password', 'Test Tap (mobile)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000078', 'tap-mobile-lg@maxoff.local', 'tap-local-password', 'Test Tap (mobile-lg)', null, 'staff', 'active'),
  -- 4C: the task lists, Approvals and the badges (e2e/task-lists.spec.ts). Per project: a Staff
  -- member whose "My tasks" the spec fills, a coordinator (their freelancer is below) and an Admin
  -- who gives out and checks tasks. The spec removes the tasks it made first.
  ('20000000-0000-4000-8000-000000000079', 'list-staff-desktop@maxoff.local', 'list-local-password', 'Test List Staff (desktop)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000080', 'list-coord-desktop@maxoff.local', 'list-local-password', 'Test List Coordinator (desktop)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000081', 'list-admin-desktop@maxoff.local', 'list-local-password', 'Test List Admin (desktop)', null, 'admin', 'active'),
  ('20000000-0000-4000-8000-000000000082', 'list-staff-mobile@maxoff.local', 'list-local-password', 'Test List Staff (mobile)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000083', 'list-coord-mobile@maxoff.local', 'list-local-password', 'Test List Coordinator (mobile)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000084', 'list-admin-mobile@maxoff.local', 'list-local-password', 'Test List Admin (mobile)', null, 'admin', 'active'),
  ('20000000-0000-4000-8000-000000000085', 'list-staff-mobile-lg@maxoff.local', 'list-local-password', 'Test List Staff (mobile-lg)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000086', 'list-coord-mobile-lg@maxoff.local', 'list-local-password', 'Test List Coordinator (mobile-lg)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000087', 'list-admin-mobile-lg@maxoff.local', 'list-local-password', 'Test List Admin (mobile-lg)', null, 'admin', 'active'),
  -- 4C: freelancers around People (e2e/freelancers.spec.ts). Per project: two Staff coordinators
  -- (the spec adds freelancers to the first and moves them to the second) and a Staff member who
  -- suggests tasks (e2e/task-requests.spec.ts). The specs remove what they made and put a
  -- deactivated coordinator back.
  ('20000000-0000-4000-8000-000000000088', 'people-coord-desktop@maxoff.local', 'people-local-password', 'Test People Coordinator (desktop)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000089', 'people-coord2-desktop@maxoff.local', 'people-local-password', 'Test People Coordinator B (desktop)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000090', 'req-staff-desktop@maxoff.local', 'req-local-password', 'Test Request Staff (desktop)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000091', 'people-coord-mobile@maxoff.local', 'people-local-password', 'Test People Coordinator (mobile)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000092', 'people-coord2-mobile@maxoff.local', 'people-local-password', 'Test People Coordinator B (mobile)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000093', 'req-staff-mobile@maxoff.local', 'req-local-password', 'Test Request Staff (mobile)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000094', 'people-coord-mobile-lg@maxoff.local', 'people-local-password', 'Test People Coordinator (mobile-lg)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000095', 'people-coord2-mobile-lg@maxoff.local', 'people-local-password', 'Test People Coordinator B (mobile-lg)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000096', 'req-staff-mobile-lg@maxoff.local', 'req-local-password', 'Test Request Staff (mobile-lg)', null, 'staff', 'active'),
  -- 5.2: Web Push (e2e/push.spec.ts), one person per project: the banner is judged per member,
  -- so the projects running side by side must never share a person's subscriptions.
  ('20000000-0000-4000-8000-000000000097', 'push-desktop@maxoff.local', 'push-local-password', 'Test Push (desktop)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000098', 'push-mobile@maxoff.local', 'push-local-password', 'Test Push (mobile)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000099', 'push-mobile-lg@maxoff.local', 'push-local-password', 'Test Push (mobile-lg)', null, 'staff', 'active'),
  -- 5.1: the bell and Alerts (e2e/notifications.spec.ts), a Staff member and an Admin per
  -- project: the counts and Mark all read are per person, so the projects never share one.
  ('20000000-0000-4000-8000-000000000100', 'alerts-staff-desktop@maxoff.local', 'alerts-local-password', 'Test Alerts Staff (desktop)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000101', 'alerts-admin-desktop@maxoff.local', 'alerts-local-password', 'Test Alerts Admin (desktop)', null, 'admin', 'active'),
  ('20000000-0000-4000-8000-000000000102', 'alerts-staff-mobile@maxoff.local', 'alerts-local-password', 'Test Alerts Staff (mobile)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000103', 'alerts-admin-mobile@maxoff.local', 'alerts-local-password', 'Test Alerts Admin (mobile)', null, 'admin', 'active'),
  ('20000000-0000-4000-8000-000000000104', 'alerts-staff-mobile-lg@maxoff.local', 'alerts-local-password', 'Test Alerts Staff (mobile-lg)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000105', 'alerts-admin-mobile-lg@maxoff.local', 'alerts-local-password', 'Test Alerts Admin (mobile-lg)', null, 'admin', 'active'),
  -- 5.4: Settings → Notifications and the app's report (e2e/reachability.spec.ts), an Admin and a
  -- Staff member per project: the Admin's list is the people on their own open tasks, so the
  -- projects never share one.
  ('20000000-0000-4000-8000-000000000106', 'reach-admin-desktop@maxoff.local', 'reach-local-password', 'Test Reach Admin (desktop)', null, 'admin', 'active'),
  ('20000000-0000-4000-8000-000000000107', 'reach-staff-desktop@maxoff.local', 'reach-local-password', 'Test Reach Staff (desktop)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000108', 'reach-admin-mobile@maxoff.local', 'reach-local-password', 'Test Reach Admin (mobile)', null, 'admin', 'active'),
  ('20000000-0000-4000-8000-000000000109', 'reach-staff-mobile@maxoff.local', 'reach-local-password', 'Test Reach Staff (mobile)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000110', 'reach-admin-mobile-lg@maxoff.local', 'reach-local-password', 'Test Reach Admin (mobile-lg)', null, 'admin', 'active'),
  ('20000000-0000-4000-8000-000000000111', 'reach-staff-mobile-lg@maxoff.local', 'reach-local-password', 'Test Reach Staff (mobile-lg)', null, 'staff', 'active'),
  -- 6A: My Day, the Admin's Today and the work report (e2e/dashboards.spec.ts), a Crew member
  -- and an Admin per project: My Day and the Admin's screens read their own tasks, so the
  -- projects never share one.
  ('20000000-0000-4000-8000-000000000112', 'day-staff-desktop@maxoff.local', 'day-local-password', 'Test Day Crew (desktop)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000113', 'day-admin-desktop@maxoff.local', 'day-local-password', 'Test Day Admin (desktop)', null, 'admin', 'active'),
  ('20000000-0000-4000-8000-000000000114', 'day-staff-mobile@maxoff.local', 'day-local-password', 'Test Day Crew (mobile)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000115', 'day-admin-mobile@maxoff.local', 'day-local-password', 'Test Day Admin (mobile)', null, 'admin', 'active'),
  ('20000000-0000-4000-8000-000000000116', 'day-staff-mobile-lg@maxoff.local', 'day-local-password', 'Test Day Crew (mobile-lg)', null, 'staff', 'active'),
  ('20000000-0000-4000-8000-000000000117', 'day-admin-mobile-lg@maxoff.local', 'day-local-password', 'Test Day Admin (mobile-lg)', null, 'admin', 'active'),
  -- Phase 7: client work (e2e/client-work.spec.ts), an Admin per project whose screens no other
  -- test touches. The seeded Admin is the recipient of every parallel test's sent-back items, and
  -- each notification re-reads that Admin's open screen (5.1's live bell): a project page mid-edit
  -- re-rendered under a stage being added, and the add took seconds (the phase 7 flake).
  ('20000000-0000-4000-8000-000000000118', 'cw-admin-desktop@maxoff.local', 'cw-local-password', 'Test Client Work Admin (desktop)', null, 'admin', 'active'),
  ('20000000-0000-4000-8000-000000000119', 'cw-admin-mobile@maxoff.local', 'cw-local-password', 'Test Client Work Admin (mobile)', null, 'admin', 'active'),
  ('20000000-0000-4000-8000-000000000120', 'cw-admin-mobile-lg@maxoff.local', 'cw-local-password', 'Test Client Work Admin (mobile-lg)', null, 'admin', 'active');

-- What GoTrue writes for a confirmed email + password user (`auth.users` + one identity).
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change, is_sso_user, is_anonymous)
select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', email,
  extensions.crypt(password, extensions.gen_salt('bf')), now(),
  '{"provider": "email", "providers": ["email"]}'::jsonb, '{}'::jsonb, now(), now(),
  '', '', '', '', false, false
from seed_users
on conflict (id) do nothing;

insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), id, id::text, 'email',
  jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true, 'phone_verified', false),
  now(), now(), now()
from seed_users
on conflict (provider_id, provider) do nothing;

-- Written by the migration owner: in_transition() is true here, so active and deactivated pass
-- the members insert guard (the same way pgTAP fixtures do).
insert into public.members (id, org_id, full_name, email, phone, role, status, joined_at, deactivated_at)
select u.id, (select id from public.organizations limit 1), u.full_name, u.email, u.phone, u.role, u.status,
  -- 2.2: attendance starts the IST day after joined_at, so a seeded person who "joined" at
  -- db:reset would never meet the gate that day. 40 days, not 30 (2.3): more than any month,
  -- so the attendance history always has a previous month for the back-gesture spec to page to.
  now() - interval '40 days', case when u.status = 'deactivated' then now() end
from seed_users u
on conflict (id) do nothing;

-- 4B: one freelancer per Playwright project (ADR-0013): a person with no login and no email,
-- looked after by that project's "Test Task Coordinator". Written as the migration owner, like
-- the members above (the insert guard lets `engagement` through only inside a transition).
-- Ids 40000000-…: scripts/measure-seed.sql owns 3000000K-… (its members are 30000000-…-<n>).
insert into public.members (id, org_id, full_name, email, role, status, engagement, joined_at)
select f.id, (select id from public.organizations limit 1), f.full_name, null, 'staff', 'active',
  'freelance', now() - interval '40 days'
from (values
  ('40000000-0000-4000-8000-000000000001'::uuid, 'Test Task Freelancer (desktop)'),
  ('40000000-0000-4000-8000-000000000002'::uuid, 'Test Task Freelancer (mobile)'),
  ('40000000-0000-4000-8000-000000000003'::uuid, 'Test Task Freelancer (mobile-lg)'),
  -- 4C: the list coordinator's freelancer, per project (e2e/task-lists.spec.ts).
  ('40000000-0000-4000-8000-000000000004'::uuid, 'Test List Freelancer (desktop)'),
  ('40000000-0000-4000-8000-000000000005'::uuid, 'Test List Freelancer (mobile)'),
  ('40000000-0000-4000-8000-000000000006'::uuid, 'Test List Freelancer (mobile-lg)')
) f(id, full_name)
on conflict (id) do nothing;

insert into public.member_coordinators (member_id, coordinator_id, set_by)
select c.member_id, c.coordinator_id, '10000000-0000-4000-8000-000000000001'
from (values
  ('40000000-0000-4000-8000-000000000001'::uuid, '20000000-0000-4000-8000-000000000062'::uuid),
  ('40000000-0000-4000-8000-000000000002'::uuid, '20000000-0000-4000-8000-000000000067'::uuid),
  ('40000000-0000-4000-8000-000000000003'::uuid, '20000000-0000-4000-8000-000000000072'::uuid),
  ('40000000-0000-4000-8000-000000000004'::uuid, '20000000-0000-4000-8000-000000000080'::uuid),
  ('40000000-0000-4000-8000-000000000005'::uuid, '20000000-0000-4000-8000-000000000083'::uuid),
  ('40000000-0000-4000-8000-000000000006'::uuid, '20000000-0000-4000-8000-000000000086'::uuid)
) c(member_id, coordinator_id)
where not exists (
  select 1 from public.member_coordinators mc where mc.member_id = c.member_id and mc.to_at is null
);

-- 5A review fixes (M2): the local and CI database lets push_subscription_upsert take http
-- endpoints on the loopback host, where the e2e fake push service runs. Only the seed writes
-- this, and no hosted project runs the seed: staging and production take https only.
insert into app.local_flags (flag) values ('push_loopback_endpoints') on conflict do nothing;

-- 5.4: every seeded person joined 40 days ago with no push device, so the hourly
-- reachability_check would alert the local Owner (one always-emailed notification each) the first
-- time it runs, in the middle of an e2e run. The seed records each of them as already alerted
-- now: nothing is alerted for 7 days after a reset. Settings → Notifications reads the state
-- live, so it is unaffected. No hosted project runs the seed.
insert into public.member_reachability (member_id, org_id, state, since, alerted_at)
select m.id, m.org_id, app.reachability_state(m.id), now(), now()
from public.members m
where m.status = 'active' and m.engagement = 'permanent' and m.joined_at is not null
on conflict (member_id) do nothing;
