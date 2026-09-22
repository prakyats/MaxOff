-- Dev seed, loaded by `pnpm db:reset` after the migrations (config.toml [db.seed]).
-- Real data never goes into local or staging (ARCHITECTURE §2). The deploy workflow runs
-- `db push` only, so nothing here reaches a hosted project.
--
-- 1.1: the organization (org_settings follows by trigger).
-- 1.2: five local sign-ins for development and Playwright (README → "Local sign-ins"). The
--      passwords below are development-only fixtures, never reused anywhere. A hosted CEO is
--      created by `pnpm bootstrap:ceo`, which prints a one-time link and holds no password.
-- 1.3/1.4 add the Pixora lists.

insert into public.organizations (name)
select 'Pixora Clips'
where not exists (select 1 from public.organizations);

create temporary table seed_users (id uuid, email text, password text, full_name text, phone text,
  role public.member_role, status public.member_status) on commit drop;
insert into seed_users values
  ('10000000-0000-4000-8000-000000000001', 'ceo@maxoff.local',   'ceo-local-password',   'Local CEO',   '9000000001', 'ceo',   'active'),
  ('10000000-0000-4000-8000-000000000002', 'admin@maxoff.local', 'admin-local-password', 'Local Admin', '9000000002', 'admin', 'active'),
  ('10000000-0000-4000-8000-000000000003', 'staff@maxoff.local', 'staff-local-password', 'Local Staff', null,         'staff', 'active'),
  ('10000000-0000-4000-8000-000000000004', 'gone@maxoff.local',  'gone-local-password',  'Gone Staff',  null,         'staff', 'deactivated'),
  -- Used only by the Playwright recovery-link test, which changes this password.
  ('10000000-0000-4000-8000-000000000005', 'reset@maxoff.local', 'reset-local-password', 'Reset Staff', null,         'staff', 'active');

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
  now(), case when u.status = 'deactivated' then now() end
from seed_users u
on conflict (id) do nothing;
