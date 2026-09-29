-- scripts/measure-seed.sql: a year of realistic VOLUME on the LOCAL database, for measuring screens
-- and EXPLAINing queries. Never for staging or production, never loaded by `pnpm db:reset`.
--
-- What it adds (a studio of ~25 people after a year of use), all beside supabase/seed.sql's rows,
-- never touching them (the e2e specs rely on those people):
--   * 22 active members (3 Admins, 19 Staff) with job titles from the org's list, each with an
--     auth.users + auth.identities row like seed.sql's. Sign-in: measure-NN@maxoff.local /
--     measure-local-password (NN = 01..22; 01-03 are the Admins).
--   * Leave requests in every month of the last year and the next one (mixed states, a few
--     pending), comp leave earned on worked days off and spent on later dates.
--   * Attendance days for the last ~180 IST days (working days only, org weekly offs honoured),
--     shaped like the transition functions write them (started/ended/approved, leave-derived,
--     proposed absences, corrections), with their attendance_events. The last few days and today
--     are partly pending, as the Owner would find them.
--   * Extra-work notes (overtime, worked a day off) and comp-leave credits + uses.
--   * Expense claims (≤ ₹500 each, so no receipt is needed; mixed states, a few pending).
--   * 40 clients (3 draft, 4 paused, 3 inactive = closed, the rest active) run by the 3 new Admins,
--     1-4 contacts each, brand data on most, client-scoped custom fields with values on ten.
--   activity_log rows come from the audit triggers (action 'insert', actor null).
--   No notifications table exists yet (5.1), so none are written.
--
-- Ids are fixed and recognisable: 3000000K-0000-4000-8000-<hex n>, K = 0 members, 1 clients,
-- 2 contacts, 3 leave requests, 4 attendance days, 5 extra-work notes, 6 comp-leave credits,
-- 7 credit uses, 8 expense claims, 9 field definitions. Deterministic: every "random" choice is
-- an md5 of the row's key, so two runs on the same IST date give the same data.
--
-- How to run (after `pnpm db:reset`, from the repo root, Git Bash):
--   docker exec -i supabase_db_maxoff psql -U postgres -d postgres -v ON_ERROR_STOP=1 < scripts/measure-seed.sql
-- Dry run (everything inside one transaction, rolled back, counts printed):
--   docker exec -i supabase_db_maxoff psql -U postgres -d postgres -v ON_ERROR_STOP=1 -v dry_run=1 < scripts/measure-seed.sql
-- It refuses to run twice: `pnpm db:reset` first. Reset again before a Playwright run.
--
-- It writes as the migration owner (postgres), where app.in_transition() is true, the same way
-- seed.sql and the pgTAP fixtures write: the state guards let a history be written directly,
-- and every CHECK constraint still applies.

\set ON_ERROR_STOP on
begin;

-- Guard: the local stack only -------------------------------------------------------------------
-- The seeded Owner exists only where supabase/seed.sql ran (local; the deploy runs `db push`
-- only), and a hosted project has real people whose email is not @maxoff.local.
do $$
begin
  if not exists (select 1 from auth.users
                 where id = '10000000-0000-4000-8000-000000000001' and email = 'owner@maxoff.local') then
    raise exception 'measure-seed: owner@maxoff.local (seed.sql) is missing: this is not the local database. Nothing written.';
  end if;
  if exists (select 1 from public.members where email not ilike '%@maxoff.local') then
    raise exception 'measure-seed: a member without an @maxoff.local email exists: this is not the local database. Nothing written.';
  end if;
  if inet_server_addr() is not null and not (inet_server_addr() << '127.0.0.0/8'::inet
     or inet_server_addr() << '10.0.0.0/8'::inet or inet_server_addr() << '172.16.0.0/12'::inet
     or inet_server_addr() << '192.168.0.0/16'::inet or inet_server_addr() = '::1'::inet) then
    raise exception 'measure-seed: connected to a non-local address (%). Nothing written.', inet_server_addr();
  end if;
  if (select count(*) from public.organizations) <> 1 then
    raise exception 'measure-seed: expected exactly one organization.';
  end if;
  if exists (select 1 from public.members where id = '30000000-0000-4000-8000-000000000001') then
    raise exception 'measure-seed: already applied. Run `pnpm db:reset` first.';
  end if;
end;
$$;

-- Helpers (session-only, gone at disconnect) -----------------------------------------------------
-- A deterministic number 0..9999 from any key.
create function pg_temp.rnd(k text) returns int language sql immutable as
$$ select ((('x' || substr(md5(k), 1, 8))::bit(32)::bigint) % 10000)::int $$;

create function pg_temp.uid(kind int, n bigint) returns uuid language sql immutable as
$$ select format('3%s-0000-4000-8000-%s', lpad(kind::text, 7, '0'), lpad(to_hex(n), 12, '0'))::uuid $$;

-- An IST wall-clock time on a business date.
create function pg_temp.ist(d date, t interval) returns timestamptz language sql immutable as
$$ select (d + t) at time zone 'Asia/Kolkata' $$;

create function pg_temp.is_work(d date) returns boolean language sql stable as
$$
  select not (extract(dow from d)::smallint = any (s.weekly_off_days))
     and not exists (select 1 from public.holidays h where h.org_id = s.org_id and h.date = d)
  from public.org_settings s
$$;

create function pg_temp.next_work(d date) returns date language sql stable as
$$ select min(x::date) from generate_series(d, d + 14, interval '1 day') x where pg_temp.is_work(x::date) $$;

create temporary table ctx on commit drop as
select o.id as org, m.id as owner, app.today_ist() as today, now() as at_now
from public.organizations o
join public.members m on m.org_id = o.id and m.role = 'owner';

-- 1. Members --------------------------------------------------------------------------------------
create temporary table mm on commit drop as
select n,
       pg_temp.uid(0, n) as id,
       format('measure-%s@maxoff.local', lpad(n::text, 2, '0')) as email,
       (array['Ananya Rao', 'Vikram Hegde', 'Meera Kulkarni', 'Rohan Shetty', 'Divya Nair',
              'Karthik Bhat', 'Sneha Pai', 'Arjun Menon', 'Pooja Kamath', 'Nikhil Acharya',
              'Shruti Iyer', 'Aditya Prabhu', 'Kavya Reddy', 'Siddharth Joshi', 'Nandini Rao',
              'Varun Shenoy', 'Ishita Das', 'Manish Poojary', 'Ritika Salian', 'Harsha Gowda',
              'Tanvi Mallya', 'Yash Kotian'])[n] as full_name,
       case when n <= 3 then 'admin' else 'staff' end::public.member_role as role,
       case when n <= 3 then '98450' || lpad((10000 + n * 137)::text, 5, '0') end as phone,
       -- Most joined over a year ago; the last two joined 60 and 25 days ago.
       (select at_now from ctx) - case n when 21 then interval '60 days' when 22 then interval '25 days'
                                         else make_interval(days => 380 + n * 3) end as joined_at
from generate_series(1, 22) n;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change, is_sso_user, is_anonymous)
select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', email,
  extensions.crypt('measure-local-password', extensions.gen_salt('bf')), joined_at,
  '{"provider": "email", "providers": ["email"]}'::jsonb, '{}'::jsonb, joined_at, joined_at,
  '', '', '', '', false, false
from mm;

insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), id, id::text, 'email',
  jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true, 'phone_verified', false),
  joined_at, joined_at, joined_at
from mm;

insert into public.members (id, org_id, full_name, email, phone, role, status, invited_at, joined_at,
  job_title_id, created_at)
select mm.id, ctx.org, mm.full_name, mm.email, mm.phone, mm.role, 'active',
  mm.joined_at - interval '1 day', mm.joined_at,
  (select li.id from public.list_items li
   where li.org_id = ctx.org and li.list_key = 'job_title' and li.archived_at is null
   order by li.position, li.id
   offset (mm.n % (select count(*) from public.list_items l2
                   where l2.org_id = ctx.org and l2.list_key = 'job_title' and l2.archived_at is null))
   limit 1),
  mm.joined_at - interval '1 day'
from mm, ctx;

-- The first IST date each member's attendance counts (the day after joining, as the gate).
create temporary table mstart on commit drop as
select mm.n, mm.id, app.to_ist_date(mm.joined_at) + 1 as first_day from mm;

-- 2. Leave requests (planned in a temp table first; days and credits read it) ------------------
create temporary table lr (
  id uuid, member_id uuid, type public.leave_type, start_date date, end_date date, reason text,
  state public.leave_state, credit_days numeric(2,1), created_at timestamptz,
  decided_by uuid, decided_at timestamptz, decision_reason text,
  src_work_date date -- comp leave only: the worked day off whose credit it spends
) on commit drop;

-- About half the months of the last year (and the next month) hold one ordinary request per
-- person: 70% leave of 1-3 days, 30% a half day. Past: mostly approved, some rejected, withdrawn or
-- cancelled. Future: pending or already approved.
with plan as (
  select ms.id as member_id, ms.first_day, k,
         pg_temp.rnd('leave:' || ms.id || ':' || k) as r,
         (date_trunc('month', ctx.today) + make_interval(months => k))::date as month_start,
         ctx.today, ctx.owner, ctx.at_now
  from mstart ms, ctx, generate_series(-11, 1) k
), picked as (
  select p.*,
         pg_temp.next_work(p.month_start + 2 + p.r % 10) as start_date,
         case when (p.r / 100) % 100 < 30 then 'half_day' else 'leave' end::public.leave_type as type
  from plan p
  where p.r % 100 < 50
), shaped as (
  select pk.*,
         case when pk.type = 'half_day' then pk.start_date else pk.start_date + (pk.r / 1000) % 3 end as end_date,
         least(pg_temp.ist(pk.start_date - (2 + pk.r % 9), interval '10 hours 30 minutes'),
               pk.at_now - interval '2 hours') as created_at,
         case
           when pk.start_date > pk.today then case when (pk.r / 7) % 100 < 60 then 'submitted' else 'approved' end
           when (pk.r / 7) % 100 < 78 then 'approved'
           when (pk.r / 7) % 100 < 88 then 'rejected'
           when (pk.r / 7) % 100 < 94 then 'withdrawn'
           else 'cancelled'
         end::public.leave_state as state
  from picked pk
  where pk.start_date > pk.first_day
)
insert into lr
select null, s.member_id, s.type, s.start_date, s.end_date,
       (array['Family function', 'Doctor''s appointment', 'Travelling home', 'Personal work',
              'Not feeling well', 'Sister''s wedding', 'Bank and paperwork', null])[1 + s.r % 8],
       s.state, null, s.created_at,
       case when s.state in ('approved', 'rejected', 'cancelled') then s.owner end,
       case when s.state in ('approved', 'rejected', 'cancelled')
            then least(s.created_at + interval '1 day 3 hours', s.at_now - interval '1 hour') end,
       case s.state when 'rejected' then 'Shoot week for two clients. Please pick other dates.'
                    when 'cancelled' then 'Cancelled at the member''s request.' end,
       null
from shaped s;

-- 3. Extra work: a worked day off (weekly off) in about a quarter of the months --------------
create temporary table ew (
  id uuid, member_id uuid, work_date date, kind text, duration_minutes int, note text, state text,
  decision text, day_marked_worked boolean, decided_by uuid, decided_at timestamptz,
  created_at timestamptz, credit_days numeric(2,1)
) on commit drop;

with plan as (
  select ms.id as member_id, ms.first_day, k, pg_temp.rnd('dayoff:' || ms.id || ':' || k) as r,
         (date_trunc('month', ctx.today) + make_interval(months => k))::date as month_start,
         ctx.today, ctx.owner, ctx.at_now
  from mstart ms, ctx, generate_series(-11, 0) k
), dated as (
  select p.*,
         (select min(x::date) from generate_series(p.month_start + p.r % 14, p.month_start + p.r % 14 + 6,
                                                   interval '1 day') x
          where not pg_temp.is_work(x::date)) as work_date
  from plan p
  where p.r % 100 < 25
)
insert into ew
select null, d.member_id, d.work_date, 'day_off', null,
       (array['Came in for the client shoot', 'Finished the festival reels', 'Event coverage',
              'Delivered the launch edits'])[1 + d.r % 4],
       case when d.work_date >= d.today - 6 then 'submitted' else 'reviewed' end,
       case when d.work_date >= d.today - 6 then null
            when (d.r / 100) % 100 < 75 then 'granted' else 'no_comp_leave' end,
       d.work_date < d.today - 6 and (d.r / 100) % 100 < 75 and (d.r / 1000) % 2 = 0,
       case when d.work_date < d.today - 6 then d.owner end,
       case when d.work_date < d.today - 6 then least(pg_temp.ist(d.work_date + 1, interval '11 hours'), d.at_now) end,
       least(pg_temp.ist(d.work_date, interval '19 hours'), d.at_now - interval '1 hour'),
       case when d.work_date < d.today - 6 and (d.r / 100) % 100 < 75 then 1.0 end
from dated d
where d.work_date is not null and d.work_date > d.first_day and d.work_date < d.today;

-- 4. Attendance days -------------------------------------------------------------------------------
-- The ordinary leave requests get their ids now, so a day can point at the one covering it.
update lr set id = pg_temp.uid(3, s.rn)
from (select ctid as c, row_number() over (order by member_id, start_date) as rn from lr) s
where lr.ctid = s.c;

-- Comp leave spent from a worked day off's credit, on a working day before the credit expires
-- (month end), never on a date another request already holds. The id range starts at 5000 so the
-- ordinary requests keep theirs.
insert into lr
select pg_temp.uid(3, 5000 + row_number() over (order by e.member_id, e.work_date)),
       e.member_id, 'comp_leave', c.use_date, c.use_date, 'Comp off for the weekend shoot',
       case when c.use_date < ctx.today then 'approved' else 'submitted' end::public.leave_state,
       1.0, least(e.decided_at + interval '2 hours', ctx.at_now - interval '1 hour'),
       case when c.use_date < ctx.today then ctx.owner end,
       case when c.use_date < ctx.today then least(e.decided_at + interval '1 day', ctx.at_now - interval '30 minutes') end,
       null, e.work_date
from ew e
cross join ctx
cross join lateral (select pg_temp.next_work(app.to_ist_date(e.decided_at) + 2 + pg_temp.rnd('use:' || e.member_id || e.work_date) % 5) as use_date) c
where e.decision = 'granted'
  and pg_temp.rnd('spend:' || e.member_id || e.work_date) % 100 < 60
  and c.use_date <= app.ist_month_end(app.to_ist_date(e.decided_at))
  and not exists (select 1 from lr o where o.member_id = e.member_id
                  and o.start_date <= c.use_date and o.end_date >= c.use_date);

insert into public.leave_requests (id, member_id, type, start_date, end_date, reason, state, source,
  credit_days, decided_by, decided_at, decision_reason, created_at, updated_at)
select id, member_id, type, start_date, end_date, reason, state, 'form', credit_days, decided_by,
       decided_at, decision_reason, created_at, coalesce(decided_at, created_at)
from lr;

create temporary table ad (
  id uuid, member_id uuid, work_date date, opened_at timestamptz, is_day_off boolean,
  state public.attendance_state, submitted_choice public.attendance_choice, submitted_at timestamptz,
  proposed_by_system boolean, final_status public.day_status, decided_by uuid, decided_at timestamptz,
  decision_reason text, leave_request_id uuid,
  started_at timestamptz, ended_at timestamptz, end_not_recorded boolean, kind text
) on commit drop;

with days as (
  select ms.id as member_id, x::date as d, ctx.today, ctx.owner, ctx.at_now,
         pg_temp.rnd('day:' || ms.id || ':' || x::date) as r
  from mstart ms
  cross join ctx
  cross join generate_series(greatest(ctx.today - 180, ms.first_day), ctx.today, interval '1 day') x
  where pg_temp.is_work(x::date)
), covered as (
  select dy.*, l.id as leave_id, l.type as leave_type,
         pg_temp.ist(dy.d, make_interval(mins => 540 + dy.r % 90)) as login
  from days dy
  left join lateral (
    select l.id, l.type from lr l
    where l.member_id = dy.member_id and l.state = 'approved'
      and l.start_date <= dy.d and l.end_date >= dy.d
    limit 1
  ) l on true
), classified as (
  select c.*,
         case
           when c.leave_type in ('leave', 'comp_leave') then case when c.d < c.today then 'leave' end
           when c.leave_type = 'half_day' then case when c.d < c.today or c.login + interval '4 hours' < c.at_now then 'half' end
           when c.d = c.today then case when c.r % 100 < 75 and c.login + interval '5 minutes' < c.at_now then 'today' end
           when c.r % 1000 < 15 then case when c.d >= c.today - 2 then 'absent_pending' else 'absent' end
           when (c.d = c.today - 1 and c.r % 100 < 60) or (c.d = c.today - 2 and c.r % 100 < 25)
                or (c.d = c.today - 3 and c.r % 100 < 10) then 'pending'
           when c.r % 1000 < 25 and c.d < c.today - 3 then 'corrected'
           else 'present'
         end as kind
  from covered c
)
insert into ad
select null, k.member_id, k.d,
       -- opened_at: when the person opened the day (for created_at); none on a day that was
       -- only derived or proposed.
       case when k.kind in ('leave', 'absent', 'absent_pending') then null else k.login end,
       false,
       case k.kind when 'leave' then 'approved' when 'half' then 'approved'
                   when 'today' then 'pending_review' when 'pending' then 'pending_review'
                   when 'absent_pending' then 'pending_review' when 'absent' then 'approved'
                   when 'corrected' then 'corrected' else 'approved' end::public.attendance_state,
       case when k.kind in ('today', 'pending', 'present', 'corrected') then 'present' end::public.attendance_choice,
       case when k.kind in ('today', 'pending', 'present', 'corrected') then k.login + make_interval(mins => k.r % 7) end,
       k.kind in ('leave', 'half', 'absent', 'absent_pending'),
       case k.kind when 'leave' then k.leave_type::text when 'half' then 'half_day'
                   when 'absent' then 'absent' when 'absent_pending' then 'absent'
                   when 'corrected' then 'half_day' when 'present' then 'present' end::public.day_status,
       case when k.kind in ('absent', 'corrected', 'present') then k.owner end,
       case k.kind
         when 'leave' then pg_temp.ist(k.d, interval '23 hours 59 minutes')
         when 'half' then k.login
         when 'absent' then pg_temp.ist(k.d + 1, interval '10 hours')
         when 'corrected' then pg_temp.ist(k.d + 1, make_interval(mins => 600 + k.r % 60))
         when 'present' then least(pg_temp.ist(k.d + 1, make_interval(mins => 600 + k.r % 60)), k.at_now)
       end,
       case when k.kind = 'corrected' then 'Left at lunch for a family emergency: half day.' end,
       case when k.kind in ('leave', 'half') then k.leave_id end,
       case when k.kind in ('today', 'pending', 'present', 'corrected', 'half') then k.login + make_interval(mins => k.r % 7) end,
       case
         when k.kind = 'half' and k.d < k.today then k.login + interval '4 hours 10 minutes'
         when k.kind in ('pending', 'present', 'corrected') and (k.r / 10) % 100 >= 2
           then k.login + make_interval(mins => k.r % 7 + 480 + (k.r / 7) % 150)
       end,
       k.kind in ('pending', 'present', 'corrected') and (k.r / 10) % 100 < 2,
       k.kind
from classified k
where k.kind is not null;

-- A worked weekly off the Owner marked as worked (extra_work_note_decide's corrected day).
insert into ad
select null, e.member_id, e.work_date, null, true, 'corrected', null, null, false, 'present',
       e.decided_by, e.decided_at, 'worked on a day off', null, null, null, false, 'day_off_worked'
from ew e
where e.day_marked_worked;

update ad set id = pg_temp.uid(4, s.rn)
from (select ctid as c, row_number() over (order by member_id, work_date) as rn from ad) s
where ad.ctid = s.c;

insert into public.attendance_days (id, member_id, work_date, is_day_off, state,
  submitted_choice, submitted_at, proposed_by_system, final_status, decided_by, decided_at,
  decision_reason, leave_request_id, started_at, ended_at, end_not_recorded, created_at, updated_at)
select id, member_id, work_date, is_day_off, state, submitted_choice, submitted_at,
       proposed_by_system, final_status, decided_by, decided_at, decision_reason,
       leave_request_id, started_at, ended_at, end_not_recorded,
       coalesce(opened_at, decided_at, pg_temp.ist(work_date, interval '23 hours 59 minutes')),
       greatest(coalesce(opened_at, decided_at), decided_at, ended_at, started_at,
                pg_temp.ist(work_date, interval '0 hours'))
from ad;

-- The events each writer adds (attendance_open_day, start/end day, absent_check, decide).
insert into public.attendance_events (attendance_day_id, action, from_status, to_status, reason, actor_id, at)
select a.id, e.action, e.from_status::public.day_status, e.to_status::public.day_status, e.reason, e.actor_id, e.at
from ad a
cross join lateral (values
  ('derived_from_leave', null, a.final_status::text, null, null::uuid, a.decided_at, a.kind in ('leave', 'half')),
  ('proposed_absent', null, 'absent', null, null, pg_temp.ist(a.work_date, interval '23 hours 59 minutes'),
   a.kind in ('absent', 'absent_pending')),
  ('started', null, case when a.kind = 'half' then null else 'present' end, null, a.member_id, a.started_at,
   a.started_at is not null),
  ('ended', null, null, null, a.member_id, a.ended_at, a.ended_at is not null),
  ('approved', case when a.kind = 'absent' then 'absent' end, a.final_status::text, null, a.decided_by, a.decided_at,
   a.kind in ('present', 'absent')),
  ('corrected', null, a.final_status::text, a.decision_reason, a.decided_by, a.decided_at,
   a.kind in ('corrected', 'day_off_worked'))
) as e(action, from_status, to_status, reason, actor_id, at, keep)
where e.keep;

-- 5. Overtime notes on ~4% of worked days; the Owner reviews all but the last few days ---------
insert into ew
select null, a.member_id, a.work_date, 'overtime', 60 + 30 * (pg_temp.rnd('ot:' || a.id) % 7),
       (array['Client asked for last-minute changes', 'Rendering the final cut', 'Extra reel for the launch',
              'Colour grading ran late', 'Stayed back for the evening shoot'])[1 + pg_temp.rnd('otn:' || a.id) % 5],
       case when a.work_date >= ctx.today - 6 then 'submitted' else 'reviewed' end,
       case when a.work_date >= ctx.today - 6 then null
            when pg_temp.rnd('otd:' || a.id) % 100 < 30 then 'granted' else 'no_comp_leave' end,
       false,
       case when a.work_date < ctx.today - 6 then ctx.owner end,
       case when a.work_date < ctx.today - 6 then least(pg_temp.ist(a.work_date + 1, interval '12 hours'), ctx.at_now) end,
       least(coalesce(a.ended_at, a.started_at) + interval '5 minutes', ctx.at_now - interval '10 minutes'),
       case when a.work_date < ctx.today - 6 and pg_temp.rnd('otd:' || a.id) % 100 < 30 then 0.5 end
from ad a cross join ctx
where a.kind in ('present', 'pending') and pg_temp.rnd('ot?:' || a.id) % 100 < 4;

update ew set id = pg_temp.uid(5, s.rn)
from (select ctid as c, row_number() over (order by member_id, work_date, kind) as rn from ew) s
where ew.ctid = s.c;

insert into public.extra_work_notes (id, member_id, work_date, kind, duration_minutes, note, state,
  decision, day_marked_worked, decided_by, decided_at, created_at, updated_at)
select id, member_id, work_date, kind, duration_minutes, note, state, decision, day_marked_worked,
       decided_by, decided_at, created_at, coalesce(decided_at, created_at)
from ew;

-- 6. Comp leave credits (one per granted note, expiring at the grant month's end) and uses -----
create temporary table cc on commit drop as
select pg_temp.uid(6, row_number() over (order by e.member_id, e.work_date, e.kind)) as id,
       e.id as note_id, e.member_id, e.credit_days as days, e.decided_by as granted_by,
       e.decided_at as granted_at, app.to_ist_date(e.decided_at) as granted_on,
       app.ist_month_end(app.to_ist_date(e.decided_at)) as expires_on, e.kind, e.work_date
from ew e
where e.decision = 'granted';

create temporary table cu on commit drop as
select pg_temp.uid(7, row_number() over (order by c.id)) as id, c.id as credit_id, l.id as leave_request_id,
       l.credit_days as days, case l.state when 'approved' then 'used' else 'reserved' end as state,
       l.created_at
from cc c
join lr l on l.type = 'comp_leave' and l.member_id = c.member_id and l.src_work_date = c.work_date
where c.kind = 'day_off';

insert into public.comp_leave_credits (id, member_id, days, used_days, reserved_days, granted_by,
  granted_at, granted_on, expires_on, note_id, created_at, updated_at)
select c.id, c.member_id, c.days,
       coalesce((select sum(u.days) from cu u where u.credit_id = c.id and u.state = 'used'), 0),
       coalesce((select sum(u.days) from cu u where u.credit_id = c.id and u.state = 'reserved'), 0),
       c.granted_by, c.granted_at, c.granted_on, c.expires_on, c.note_id, c.granted_at, c.granted_at
from cc c;

insert into public.comp_leave_credit_uses (id, credit_id, leave_request_id, days, state, created_at, updated_at)
select id, credit_id, leave_request_id, days, state, created_at, created_at from cu;

-- 7. Expense claims: 6-10 per person over the year, all ≤ ₹500 (no receipt needed) -----------
with plan as (
  select ms.id as member_id, ms.first_day, k, pg_temp.rnd('exp:' || ms.id || ':' || k) as r,
         ctx.today, ctx.owner, ctx.at_now, ctx.org
  from mstart ms cross join ctx cross join generate_series(1, 10) k
  where k <= 6 + pg_temp.rnd('expn:' || ms.id) % 5
), dated as (
  select p.*, p.today - (p.r % 365) as expense_date,
         (p.r / 10) % 100 as s
  from plan p
), shaped as (
  select d.*,
         case
           when d.expense_date >= d.today - 10 then case when d.s < 70 then 'submitted' else 'approved' end
           when d.s < 65 then 'paid' when d.s < 77 then 'approved' when d.s < 87 then 'rejected'
           else 'withdrawn'
         end as state,
         least(pg_temp.ist(d.expense_date + d.r % 3, interval '19 hours'), d.at_now - interval '2 hours') as created_at
  from dated d
  where d.expense_date >= d.first_day
)
insert into public.expense_claims (id, member_id, expense_date, amount, category_id, note, state,
  decided_by, decided_at, decision_reason, paid_on, paid_by, paid_at, created_at, updated_at)
select pg_temp.uid(8, row_number() over (order by s.member_id, s.expense_date, s.k)),
       s.member_id, s.expense_date, (80 + s.r % 420) + case when s.r % 2 = 0 then 0.5 else 0 end,
       (select li.id from public.list_items li
        where li.org_id = s.org and li.list_key = 'expense_category' and li.archived_at is null
        order by li.position, li.id
        offset (s.r / 3) % (select count(*) from public.list_items l2
                            where l2.org_id = s.org and l2.list_key = 'expense_category' and l2.archived_at is null)
        limit 1),
       (array['Auto to the client office', 'Lunch during the outdoor shoot', 'Props for the product shoot',
              'Printouts for the pitch', 'Cab back after the late edit', 'Memory card for the camera',
              'Courier of the hard drive', 'Tea and snacks for the crew'])[1 + s.r % 8],
       s.state,
       case when s.state in ('approved', 'rejected', 'paid') then s.owner end,
       case when s.state in ('approved', 'rejected', 'paid') then least(s.created_at + interval '1 day', s.at_now - interval '1 hour') end,
       case when s.state = 'rejected' then 'Personal expense, not a work one.' end,
       case when s.state = 'paid' then least(app.to_ist_date(s.created_at + interval '1 day') + s.r % 7, s.today) end,
       case when s.state = 'paid' then s.owner end,
       case when s.state = 'paid'
            then least(pg_temp.ist(least(app.to_ist_date(s.created_at + interval '1 day') + s.r % 7, s.today), interval '12 hours'),
                       s.at_now - interval '30 minutes') end,
       s.created_at, s.created_at
from shaped s;

-- 8. Clients, contacts, brand, custom fields -----------------------------------------------------
create temporary table cl on commit drop as
select n, pg_temp.uid(1, n) as id,
       (array['Coastal Brew Co', 'Mangalore Spice House', 'Udupi Silks', 'Karavali Motors', 'Bluewave Dental',
              'Nirmal Jewellers', 'Tulu Nadu Tours', 'Greenleaf Organics', 'Sahyadri Fitness', 'Pai Furniture',
              'Kudla Bakes', 'Seaside Realty', 'Anchor Paints', 'Ocean Pearl Hotel', 'Kamath Opticals',
              'Mithra Hospital', 'Vihaan Electronics', 'Shree Durga Caterers', 'Laxmi Textiles', 'Nexa Coaching',
              'Harbour Cafe', 'Coral Skin Clinic', 'Bharat Tiles', 'Riverbend School', 'Swadesh Foods',
              'Urban Nest Interiors', 'Zest Juice Bar', 'Konkan Cashews', 'Pristine Salon', 'Trident Logistics',
              'Aroma Coffee Works', 'Mahalasa Gold', 'Sunrise Hyundai', 'Kadri Park Residency', 'Veda Ayurveda',
              'Nova Fintech', 'Beachside Resort', 'Ganesh Sweets', 'Pioneer Cycles', 'Skyline Builders'])[n] as name,
       (array['Mangaluru', 'Udupi', 'Manipal', 'Bengaluru', 'Kundapura', 'Puttur', 'Karkala', 'Surathkal'])[1 + n % 8] as city,
       case when n <= 3 then 'draft' when n <= 7 then 'paused' when n <= 10 then 'inactive' else 'active' end::public.client_state as state,
       case when g.n = 1 then null else (select m2.id from mm m2 where m2.n = 1 + g.n % 3) end as admin_id,
       (select at_now from ctx) - make_interval(days => 400 - n * 8) as created_at,
       lower(regexp_replace((array['Coastal Brew Co', 'Mangalore Spice House', 'Udupi Silks', 'Karavali Motors', 'Bluewave Dental',
              'Nirmal Jewellers', 'Tulu Nadu Tours', 'Greenleaf Organics', 'Sahyadri Fitness', 'Pai Furniture',
              'Kudla Bakes', 'Seaside Realty', 'Anchor Paints', 'Ocean Pearl Hotel', 'Kamath Opticals',
              'Mithra Hospital', 'Vihaan Electronics', 'Shree Durga Caterers', 'Laxmi Textiles', 'Nexa Coaching',
              'Harbour Cafe', 'Coral Skin Clinic', 'Bharat Tiles', 'Riverbend School', 'Swadesh Foods',
              'Urban Nest Interiors', 'Zest Juice Bar', 'Konkan Cashews', 'Pristine Salon', 'Trident Logistics',
              'Aroma Coffee Works', 'Mahalasa Gold', 'Sunrise Hyundai', 'Kadri Park Residency', 'Veda Ayurveda',
              'Nova Fintech', 'Beachside Resort', 'Ganesh Sweets', 'Pioneer Cycles', 'Skyline Builders'])[n], '[^A-Za-z]', '', 'g')) as slug
from generate_series(1, 40) as g(n);

insert into public.clients (id, org_id, name, legal_name, state, admin_id, gstin, address, city, phone,
  email, website, drive_url, requirements, notes, activated_at, created_by, created_at, updated_at)
select c.id, ctx.org, c.name,
       case when c.n % 2 = 0 then c.name || ' Private Limited' end,
       c.state, c.admin_id,
       case when c.n % 2 = 0 then '29' || upper(translate(substr(md5(c.slug), 1, 5), '0123456789', 'ghijklmnop'))
                                  || lpad((1000 + c.n * 71)::text, 4, '0') || 'P1Z' || (c.n % 10)::text end,
       format('%s, %s Main Road', 10 + c.n * 3, (array['Hampankatta', 'Kadri', 'Bejai', 'Falnir', 'Kankanady'])[1 + c.n % 5]),
       c.city, '0824' || lpad((2400000 + c.n * 1373)::text, 7, '0'),
       'hello@' || c.slug || '.in', 'https://' || c.slug || '.in',
       case when c.n % 3 <> 0 then 'https://drive.google.com/drive/folders/measure-' || c.slug end,
       case when c.n % 4 <> 0 then (array['12 reels and 20 posts a month, festival campaigns on top.',
                                          'Product photography every quarter; a launch film for each new line.',
                                          'Weekly Instagram content and a monthly YouTube vlog.',
                                          'Event coverage and same-day highlight edits.'])[1 + c.n % 4] end,
       case when c.n % 5 = 0 then 'Prefers WhatsApp for approvals. Invoices to the accounts contact.' end,
       case when c.state <> 'draft' then c.created_at + interval '2 days' end,
       ctx.owner, c.created_at, c.created_at
from cl c cross join ctx;

insert into public.client_contacts (id, org_id, client_id, name, designation, email, phone, is_primary,
  created_at, updated_at)
select pg_temp.uid(2, row_number() over (order by c.n, k)), ctx.org, c.id,
       (array['Ramesh', 'Suma', 'Prakash', 'Lavanya', 'Deepak', 'Asha', 'Girish', 'Reshma', 'Naveen', 'Vidya'])[1 + (c.n + k) % 10]
         || ' ' || (array['Shetty', 'Pai', 'Rao', 'D''Souza', 'Bhandary', 'Kamath', 'Hegde', 'Nayak'])[1 + (c.n * 3 + k) % 8],
       (array['Owner', 'Marketing Manager', 'Accounts', 'Brand Lead'])[k],
       format('contact%s@%s.in', k, c.slug),
       '98' || lpad((44000000 + c.n * 1000 + k * 17)::text, 8, '0'),
       k = 1, c.created_at + make_interval(days => k), c.created_at + make_interval(days => k)
from cl c
cross join ctx
cross join generate_series(1, 4) k
where k <= 1 + pg_temp.rnd('contacts:' || c.id) % 4
order by c.n, k;

-- The insert trigger made each client's brand and private rows; fill most of them.
update public.client_brand b
set colors = jsonb_build_array(
      jsonb_build_object('name', 'Primary', 'hex', '#' || substr(md5(c.slug), 1, 6)),
      jsonb_build_object('name', 'Accent', 'hex', '#' || substr(md5(c.slug), 7, 6)),
      jsonb_build_object('name', 'Ink', 'hex', '#1A1A1A')),
    fonts = jsonb_build_array(
      jsonb_build_object('family', (array['Poppins', 'Montserrat', 'Playfair Display', 'Inter'])[1 + c.n % 4], 'usage', 'Headings'),
      jsonb_build_object('family', 'Noto Sans', 'usage', 'Body')),
    tone_of_voice = (array['Warm and local, a little playful.', 'Premium and calm; no slang.',
                           'Energetic, youth-first, short captions.', 'Trustworthy and clear, doctor-approved.'])[1 + c.n % 4],
    brand_notes = case when c.n % 2 = 0 then 'Logo always on a light background. Kannada and English captions.' end
from cl c
where b.client_id = c.id and c.n % 5 <> 0;

update public.client_private p
set owner_notes = 'Pays on time. Renewal talk due before the festive season.'
from cl c
where p.client_id = c.id and c.n % 4 = 0;

-- Client-scoped fields (the Owner's per-client extras) with values on ten active clients.
insert into public.field_definitions (id, org_id, entity, client_id, key, label, type, options, required, section, position)
select pg_temp.uid(9, row_number() over (order by c.n, f.pos)), ctx.org, 'client', c.id, f.key, f.label,
       f.type::public.field_type, f.options, false, 'Content plan', f.pos
from cl c
cross join ctx
cross join (values
  ('posting_days', 'Posting days', 'multi_select',
   '[{"key":"mon","label":"Monday"},{"key":"wed","label":"Wednesday"},{"key":"fri","label":"Friday"},{"key":"sat","label":"Saturday"}]'::jsonb, 'a0'),
  ('reels_per_month', 'Reels per month', 'number', '[]'::jsonb, 'a1'),
  ('approval_contact', 'Approves content', 'text', '[]'::jsonb, 'a2')
) as f(key, label, type, options, pos)
where c.n between 11 and 20;

update public.clients cli
set custom_fields = jsonb_build_object(
      'posting_days', case when c.n % 2 = 0 then '["mon","fri"]'::jsonb else '["wed","sat"]'::jsonb end,
      'reels_per_month', 4 + c.n % 12,
      'approval_contact', 'Marketing Manager')
from cl c
where cli.id = c.id and c.n between 11 and 20;

-- Summary ------------------------------------------------------------------------------------------
select 'members (new)' as rows_for, count(*) from public.members where id in (select id from mm)
union all select 'auth.users (new)', count(*) from auth.users where id in (select id from mm)
union all select 'leave_requests', count(*) from public.leave_requests where member_id in (select id from mm)
union all select '  of which submitted', count(*) from public.leave_requests where member_id in (select id from mm) and state = 'submitted'
union all select 'attendance_days', count(*) from public.attendance_days where member_id in (select id from mm)
union all select '  of which pending_review', count(*) from public.attendance_days where member_id in (select id from mm) and state = 'pending_review'
union all select 'attendance_events', count(*) from public.attendance_events e join public.attendance_days d on d.id = e.attendance_day_id where d.member_id in (select id from mm)
union all select 'extra_work_notes', count(*) from public.extra_work_notes where member_id in (select id from mm)
union all select '  of which submitted', count(*) from public.extra_work_notes where member_id in (select id from mm) and state = 'submitted'
union all select 'comp_leave_credits', count(*) from public.comp_leave_credits where member_id in (select id from mm)
union all select 'comp_leave_credit_uses', count(*) from public.comp_leave_credit_uses where id in (select id from cu)
union all select 'expense_claims', count(*) from public.expense_claims where member_id in (select id from mm)
union all select '  of which submitted', count(*) from public.expense_claims where member_id in (select id from mm) and state = 'submitted'
union all select 'clients', count(*) from public.clients where id in (select id from cl)
union all select 'client_contacts', count(*) from public.client_contacts where client_id in (select id from cl)
union all select 'client_admin_assignments', count(*) from public.client_admin_assignments where client_id in (select id from cl)
union all select 'client_brand (filled)', count(*) from public.client_brand where client_id in (select id from cl) and tone_of_voice is not null
union all select 'field_definitions', count(*) from public.field_definitions where client_id in (select id from cl)
union all select 'activity_log (total, all rows)', count(*) from public.activity_log;

\if :{?dry_run}
rollback;
\echo 'measure-seed: dry run, rolled back.'
\else
commit;
\echo 'measure-seed: committed.'
\endif
