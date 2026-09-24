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
  ('20000000-0000-4000-8000-000000000017', 'back-mobile-lg@maxoff.local', 'back-local-password', 'Test Back (mobile-lg)', null, 'staff', 'active');

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
