-- 3c review (migration 20260929020230_owner_comp_leave_credit): the Owner's comp leave uses a
-- credit. attendance_decide(correct, 'comp_leave') and leave_owner_edit(…, 'comp_leave') draw the
-- member's free credits valid on that date, oldest first, and use them at once (kickoff 3b
-- decision 16); with none, or on a day off, the whole call is refused; an edit into comp leave is
-- one date. Roles, the refusals, the draw, oldest first, "the date counts", re-correction, a later
-- correction to Present, the Owner's cancellation, an edit of a member's own comp request, the
-- release on comp → plain leave, the holiday trigger on an Owner-set comp date, and month_summary.
begin;
create extension if not exists pgtap with schema extensions;
select plan(62);

-- Fixtures as 29: keep the organization, replace the people. Rolled back at the end.
delete from public.attendance_events;
delete from public.attendance_days;
delete from public.expense_claims;
delete from public.comp_leave_credit_uses;
delete from public.comp_leave_credits;
delete from public.extra_work_notes;
delete from public.leave_requests;
delete from public.session_events;
delete from public.activity_log;
delete from public.field_definitions;
delete from public.client_contacts;
delete from public.client_admin_assignments;
delete from public.client_brand;
delete from public.client_private;
delete from public.clients;
update public.organizations set logo_file_id = null;
delete from public.files;
-- 4A: task rows and coordinator rows reference members (a Playwright run leaves some behind).
delete from public.task_warnings;
delete from public.task_reviews;
delete from public.task_submissions;
delete from public.task_comments;
delete from public.task_stages;
delete from public.task_assignees;
delete from public.tasks;
delete from public.member_coordinators;
delete from public.members;
delete from auth.identities;
delete from auth.users;
delete from public.activity_log;

-- Two days ago is the weekly day off for this file (so is today + 5, the same weekday); today,
-- yesterday and the four days after today are working days, whatever the calendar says.
delete from public.holidays;
update public.org_settings set weekly_off_days = array[extract(dow from app.today_ist() - 2)::smallint];

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner',  '00000000-0000-4000-8000-000000000401'),
  ('admin',  '00000000-0000-4000-8000-000000000402'),
  ('staff',  '00000000-0000-4000-8000-000000000403'),
  ('past',   '00000000-0000-4000-8000-000000000404'),
  ('offday', '00000000-0000-4000-8000-000000000405'),
  ('edit',   '00000000-0000-4000-8000-000000000406'),
  ('comp',   '00000000-0000-4000-8000-000000000407');
insert into fx select 'org', id from public.organizations limit 1;
grant select on fx to authenticated, anon, service_role;

create function pg_temp.fx(k text) returns uuid language sql stable as $$
  select id from fx where key = k;
$$;
create function pg_temp.as_member(k text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', pg_temp.fx(k)::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.fx(k), 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
create function pg_temp.as_system() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;
create function pg_temp.today() returns date language sql stable as $$ select app.today_ist() $$;
create function pg_temp.day(k text, d date default app.today_ist()) returns uuid language sql stable as $$
  select a.id from public.attendance_days a where a.member_id = pg_temp.fx(k) and a.work_date = d;
$$;
-- The member's one comp leave request on a date (the approved or the newest row there).
create function pg_temp.request_on(k text, d date) returns public.leave_requests language sql stable as $$
  select r.* from public.leave_requests r
  where r.member_id = pg_temp.fx(k) and r.start_date = d
  order by (r.state = 'approved') desc, r.id desc limit 1;
$$;
-- The member's one comp leave request (credit_days set), whatever its state.
create function pg_temp.comp_of(k text) returns public.leave_requests language sql stable as $$
  select r.* from public.leave_requests r where r.member_id = pg_temp.fx(k) and r.type = 'comp_leave' order by r.start_date limit 1;
$$;
create function pg_temp.credit(k text, n integer default 1) returns public.comp_leave_credits language sql stable as $$
  select c.* from public.comp_leave_credits c where c.member_id = pg_temp.fx(k) order by c.granted_at, c.id offset n - 1 limit 1;
$$;
-- The states of a request's credit uses, in the order they were written.
create function pg_temp.uses_of(req uuid) returns text[] language sql stable as $$
  select coalesce(array_agg(u.state order by u.created_at, u.id), '{}') from public.comp_leave_credit_uses u where u.leave_request_id = req;
$$;
create function pg_temp.balance(k text) returns numeric language plpgsql as $$
declare v numeric;
begin
  perform pg_temp.as_member(k);
  select available_days into v from public.comp_leave_balance();
  perform pg_temp.as_system();
  return v;
end;
$$;
create function pg_temp.audit_actions(tbl text, row_id uuid) returns text[] language sql stable as $$
  select coalesce(array_agg(a.action order by a.id), '{}')
  from public.activity_log a where a.entity = tbl and a.entity_id = row_id;
$$;
create function pg_temp.fail_detail(q text) returns text language plpgsql as $$
declare v text;
begin
  execute q;
  return null;
exception when others then
  get stacked diagnostics v = pg_exception_detail;
  return v;
end;
$$;

insert into auth.users (id, email) select id, key || '@example.com' from fx where key <> 'org';
insert into public.members (id, org_id, full_name, email, role, status, joined_at)
select pg_temp.fx(k), pg_temp.fx('org'), k, k || '@example.com', r::public.member_role, 'active', now() - interval '60 days'
from (values ('owner', 'owner'), ('admin', 'admin'), ('staff', 'staff'), ('past', 'staff'),
             ('offday', 'staff'), ('edit', 'staff'), ('comp', 'staff')) as v(k, r);
delete from public.activity_log;

-- The days the corrections act on: today for staff and admin, yesterday for staff too, last month
-- for past, and the weekly day off (two days ago) for offday, as its row records it.
insert into public.attendance_days (member_id, work_date, state, is_day_off) values
  (pg_temp.fx('staff'), pg_temp.today(), 'awaiting_choice', false),
  (pg_temp.fx('staff'), pg_temp.today() - 1, 'awaiting_choice', false),
  (pg_temp.fx('admin'), pg_temp.today(), 'awaiting_choice', false),
  (pg_temp.fx('past'), pg_temp.today() - 35, 'awaiting_choice', false),
  (pg_temp.fx('offday'), pg_temp.today() - 2, 'awaiting_choice', true);

-- attendance_decide(correct, 'comp_leave'): roles and the refusal with no credit -----------------------
select pg_temp.as_member('staff');
select throws_ok(format($$ select public.attendance_decide(%L, 'correct', 'comp_leave', 'Took the day') $$, pg_temp.day('staff')),
  'P0001', 'FORBIDDEN', 'Staff cannot correct a day');
select pg_temp.as_member('admin');
select throws_ok(format($$ select public.attendance_decide(%L, 'correct', 'comp_leave', 'Took the day') $$, pg_temp.day('staff')),
  'P0001', 'FORBIDDEN', 'an Admin cannot correct a day');
select pg_temp.as_member('owner');
select throws_ok(format($$ select public.attendance_decide(%L, 'correct', 'comp_leave', 'Took the day') $$, pg_temp.day('staff')),
  'P0001', 'VALIDATION', 'the Owner cannot set comp leave for a member with no credit');
select is(pg_temp.fail_detail(format('select public.attendance_decide(%L, ''correct'', ''comp_leave'', ''Took the day'')', pg_temp.day('staff'))),
  'Comp leave needs an earned credit valid on that date. Grant one first from their Leave tab.', 'and the refusal says to grant one first');
select pg_temp.as_system();
select is((select count(*) from public.leave_requests where member_id = pg_temp.fx('staff')), 0::bigint, 'no leave request was written');
select is((select count(*) from public.comp_leave_credit_uses), 0::bigint, 'and no credit use');
select is((select state::text from public.attendance_days where id = pg_temp.day('staff')), 'awaiting_choice', 'the day is unchanged');

-- With a credit: the correction draws it and uses it at once ----------------------------------------
select pg_temp.as_member('owner');
select isnt(public.comp_leave_grant(pg_temp.fx('staff'), 1.0, 'Worked Sunday'), null, 'the Owner grants Staff one day of comp leave');
select is(public.attendance_decide(pg_temp.day('staff'), 'correct', 'comp_leave', 'Took the Monday'), 'corrected',
  'the Owner corrects the day to comp leave');
select pg_temp.as_system();
select results_eq(
  $$ select d.final_status::text, r.type::text, r.state::text, r.source, r.credit_days, r.start_date, r.end_date, r.decided_by
     from public.attendance_days d join public.leave_requests r on r.id = d.leave_request_id where d.id = pg_temp.day('staff') $$,
  $$ select 'comp_leave', 'comp_leave', 'approved', 'owner', 1.0::numeric(2,1), pg_temp.today(), pg_temp.today(), pg_temp.fx('owner') $$,
  'the linked request is approved, source owner, credit_days 1.0');
select results_eq(
  $$ select u.state, u.days from public.comp_leave_credit_uses u where u.leave_request_id = (pg_temp.request_on('staff', pg_temp.today())).id $$,
  $$ values ('used', 1.0::numeric(2,1)) $$,
  'one credit use, used, for the whole day');
select results_eq(
  $$ select used_days, reserved_days from public.comp_leave_credits where member_id = pg_temp.fx('staff') $$,
  $$ values (1.0::numeric(2,1), 0.0::numeric(2,1)) $$,
  'the credit is used, nothing left reserved');
select is(pg_temp.balance('staff'), 0::numeric, 'the balance is 0');
select is(array_remove(pg_temp.audit_actions('comp_leave_credits', (pg_temp.credit('staff')).id), 'granted'),
  array['reserved', 'used'], 'the credit is audited reserved, then used');
select is((select meta ->> 'comp' from public.activity_log
           where entity = 'leave_requests' and entity_id = (pg_temp.request_on('staff', pg_temp.today())).id and action = 'approved'),
  'true', 'the request''s audit says it is comp leave on a credit');

-- Re-correcting to comp leave creates nothing and needs no credit; Present leaves the credit used.
select pg_temp.as_member('owner');
select is(public.attendance_decide(pg_temp.day('staff'), 'correct', 'comp_leave', 'Same again'), 'corrected',
  'the same day is corrected to comp leave again with no credit left');
select pg_temp.as_system();
select is((select count(*) from public.leave_requests where member_id = pg_temp.fx('staff')), 1::bigint, 'no second request');
select is((select count(*) from public.comp_leave_credit_uses), 1::bigint, 'and no second credit use');
select pg_temp.as_member('owner');
select is(public.attendance_decide(pg_temp.day('staff'), 'correct', 'present', 'Came in after all'), 'corrected',
  'the Owner corrects the comp leave day to Present');
select pg_temp.as_system();
select results_eq(
  $$ select d.worked_on_leave, r.state::text from public.attendance_days d join public.leave_requests r on r.id = d.leave_request_id
     where d.id = pg_temp.day('staff') $$,
  $$ values (true, 'approved') $$,
  'the day counts as worked and the comp request stays approved (owner decision 2026-09-26)');
select is(pg_temp.balance('staff'), 0::numeric, 'the credit stays used until the Owner cancels the leave');
select pg_temp.as_member('owner');
select is(public.leave_owner_cancel((pg_temp.request_on('staff', pg_temp.today())).id, 'Worked that day'), 'cancelled',
  'the Owner cancels the comp leave from the Leave tab');
select pg_temp.as_system();
select is(pg_temp.uses_of((pg_temp.request_on('staff', pg_temp.today())).id), array['released'], 'the use is released');
select is(pg_temp.balance('staff'), 1::numeric, 'and the day is back on the balance');

-- Half day draws nothing (the half comp day stays leave_submit_comp's).
select pg_temp.as_member('owner');
select is(public.attendance_decide(pg_temp.day('staff', pg_temp.today() - 1), 'correct', 'half_day', 'Left at two'), 'corrected',
  'a correction to a half day, with a credit on the balance');
select pg_temp.as_system();
select is((pg_temp.request_on('staff', pg_temp.today() - 1)).credit_days, null, 'its Owner request carries no credit_days');
select is(pg_temp.balance('staff'), 1::numeric, 'and the credit is untouched');

-- Oldest first over ½ + 1 (decision 16, as pgTAP 25 proves for leave_submit_comp) ---------------------
insert into public.comp_leave_credits (member_id, days, granted_by, granted_at, granted_on, expires_on)
values (pg_temp.fx('admin'), 0.5, pg_temp.fx('owner'), now() - interval '2 days', pg_temp.today(), pg_temp.today() + 60),
       (pg_temp.fx('admin'), 1.0, pg_temp.fx('owner'), now() - interval '1 day', pg_temp.today(), pg_temp.today() + 60);
select pg_temp.as_member('owner');
select is(public.attendance_decide(pg_temp.day('admin'), 'correct', 'comp_leave', 'Took the day'), 'corrected',
  'the Owner corrects the Admin''s day to comp leave over two credits');
select pg_temp.as_system();
select results_eq(
  $$ select c.days, u.days, c.used_days, c.reserved_days from public.comp_leave_credit_uses u
     join public.comp_leave_credits c on c.id = u.credit_id where c.member_id = pg_temp.fx('admin') order by c.granted_at $$,
  $$ values (0.5::numeric(2,1), 0.5::numeric(2,1), 0.5::numeric(2,1), 0.0::numeric(2,1)),
            (1.0::numeric(2,1), 0.5::numeric(2,1), 0.5::numeric(2,1), 0.0::numeric(2,1)) $$,
  'the older half-day credit is used whole, then half of the newer one');
select is(pg_temp.balance('admin'), 0.5::numeric, 'half a day is left on the newer credit');

-- The date counts, not the decision: a day in the credit's month is covered after the month ended.
insert into public.comp_leave_credits (member_id, days, granted_by, granted_at, granted_on, expires_on)
values (pg_temp.fx('past'), 1.0, pg_temp.fx('owner'), now() - interval '35 days', pg_temp.today() - 35, app.ist_month_end(pg_temp.today() - 35));
select is(pg_temp.balance('past'), 0::numeric, 'today''s balance shows nothing: the credit''s month is over');
select pg_temp.as_member('owner');
select is(public.attendance_decide(pg_temp.day('past', pg_temp.today() - 35), 'correct', 'comp_leave', 'Was owed that day'), 'corrected',
  'a day inside the credit''s month is still corrected to comp leave');
select pg_temp.as_system();
select results_eq(
  $$ select u.state, u.days, c.used_days from public.comp_leave_credit_uses u join public.comp_leave_credits c on c.id = u.credit_id
     where c.member_id = pg_temp.fx('past') $$,
  $$ values ('used', 1.0::numeric(2,1), 1.0::numeric(2,1)) $$,
  'the expired credit is the one used');

-- A day off is refused, credit or not.
select pg_temp.as_member('owner');
select isnt(public.comp_leave_grant(pg_temp.fx('offday'), 1.0), null, 'offday holds a credit');
select throws_ok(format($$ select public.attendance_decide(%L, 'correct', 'comp_leave', 'Took the day') $$, pg_temp.day('offday', pg_temp.today() - 2)),
  'P0001', 'VALIDATION', 'a day off cannot become comp leave');
select is(pg_temp.fail_detail(format('select public.attendance_decide(%L, ''correct'', ''comp_leave'', ''Took the day'')', pg_temp.day('offday', pg_temp.today() - 2))),
  'That date is a day off. Comp leave is for a working day.', 'with the message that says why');
select is(pg_temp.balance('offday'), 1::numeric, 'and the credit is untouched');

-- leave_owner_edit(…, 'comp_leave', d, d) ----------------------------------------------------------
-- edit holds approved plain leave tomorrow and, to start with, no credit.
select pg_temp.as_system();
insert into public.leave_requests (member_id, type, start_date, end_date, state, source, decided_by, decided_at)
values (pg_temp.fx('edit'), 'leave', pg_temp.today() + 1, pg_temp.today() + 1, 'approved', 'form', pg_temp.fx('owner'), now());
select pg_temp.as_member('staff');
select throws_ok(format($$ select * from public.leave_owner_edit(%L, 'comp_leave', pg_temp.today() + 1, pg_temp.today() + 1, 'Owed') $$,
                        (pg_temp.request_on('edit', pg_temp.today() + 1)).id),
  'P0001', 'FORBIDDEN', 'Staff cannot edit leave');
select pg_temp.as_member('admin');
select throws_ok(format($$ select * from public.leave_owner_edit(%L, 'comp_leave', pg_temp.today() + 1, pg_temp.today() + 1, 'Owed') $$,
                        (pg_temp.request_on('edit', pg_temp.today() + 1)).id),
  'P0001', 'FORBIDDEN', 'an Admin cannot edit leave');
select pg_temp.as_member('owner');
select throws_ok(format($$ select * from public.leave_owner_edit(%L, 'comp_leave', pg_temp.today() + 1, pg_temp.today() + 1, 'Owed') $$,
                        (pg_temp.request_on('edit', pg_temp.today() + 1)).id),
  'P0001', 'VALIDATION', 'an edit into comp leave with no credit is refused');
select pg_temp.as_system();
select is((pg_temp.request_on('edit', pg_temp.today() + 1)).state::text, 'approved', 'the original leave is still approved');
select is((select count(*) from public.leave_requests where member_id = pg_temp.fx('edit')), 1::bigint, 'and nothing else was written');
insert into public.comp_leave_credits (member_id, days, granted_by, granted_on, expires_on)
values (pg_temp.fx('edit'), 1.0, pg_temp.fx('owner'), pg_temp.today(), pg_temp.today() + 60);
select pg_temp.as_member('owner');
select throws_ok(format($$ select * from public.leave_owner_edit(%L, 'comp_leave', pg_temp.today() + 1, pg_temp.today() + 2, 'Owed') $$,
                        (pg_temp.request_on('edit', pg_temp.today() + 1)).id),
  'P0001', 'VALIDATION', 'comp leave over two dates is refused');
select is(pg_temp.fail_detail(format('select * from public.leave_owner_edit(%L, ''comp_leave'', pg_temp.today() + 1, pg_temp.today() + 2, ''Owed'')',
                                     (pg_temp.request_on('edit', pg_temp.today() + 1)).id)),
  'Comp leave is one day at a time. Edit it to a single date.', 'with the message that says so');
select throws_ok(format($$ select * from public.leave_owner_edit(%L, 'comp_leave', pg_temp.today() + 5, pg_temp.today() + 5, 'Owed') $$,
                        (pg_temp.request_on('edit', pg_temp.today() + 1)).id),
  'P0001', 'VALIDATION', 'comp leave on the weekly day off is refused');
select is((select kept_dates from public.leave_owner_edit((pg_temp.request_on('edit', pg_temp.today() + 1)).id, 'comp_leave',
                                                          pg_temp.today() + 1, pg_temp.today() + 1, 'Owed a day')),
  '{}'::date[], 'with a credit the edit goes through and returns kept_dates (none: no day was decided)');
select pg_temp.as_system();
select results_eq(
  $$ select r.state::text, r.source, r.credit_days, r.supersedes_id is not null
     from public.leave_requests r where r.member_id = pg_temp.fx('edit') and r.type = 'comp_leave' $$,
  $$ values ('approved', 'owner', 1.0::numeric(2,1), true) $$,
  'the new row is approved Owner comp leave with credit_days 1.0, superseding the original');
select is((select state::text from public.leave_requests where member_id = pg_temp.fx('edit') and type = 'leave'), 'superseded',
  'the original is superseded');
select is(pg_temp.uses_of((pg_temp.request_on('edit', pg_temp.today() + 1)).id), array['used'], 'the credit use is used');
select is(pg_temp.balance('edit'), 0::numeric, 'the balance is 0');

-- A member's own comp leave moved by the Owner keeps using its credit; back to plain leave frees it.
insert into public.comp_leave_credits (member_id, days, granted_by, granted_on, expires_on)
values (pg_temp.fx('comp'), 1.0, pg_temp.fx('owner'), pg_temp.today(), pg_temp.today() + 60);
select pg_temp.as_member('comp');
select isnt(public.leave_submit_comp(pg_temp.today() + 1, false, 'Family visit'), null, 'comp requests comp leave tomorrow from the credit');
select pg_temp.as_member('owner');
select lives_ok(format($$ select * from public.leave_decide(%L, 'approve') $$, (pg_temp.request_on('comp', pg_temp.today() + 1)).id),
  'the Owner approves it');
select lives_ok(format($$ select * from public.leave_owner_edit(%L, 'comp_leave', pg_temp.today() + 2, pg_temp.today() + 2, 'Shoot moved') $$,
                       (pg_temp.request_on('comp', pg_temp.today() + 1)).id),
  'the Owner moves the comp leave to the day after, still comp leave');
select pg_temp.as_system();
select results_eq(
  $$ select r.start_date, r.state::text, u.state from public.comp_leave_credit_uses u
     join public.leave_requests r on r.id = u.leave_request_id where r.member_id = pg_temp.fx('comp') order by r.start_date $$,
  $$ values (pg_temp.today() + 1, 'superseded', 'released'), (pg_temp.today() + 2, 'approved', 'used') $$,
  'the old use is released and the new one used: the same credit');
select is(pg_temp.balance('comp'), 0::numeric, 'the balance is unchanged');
select pg_temp.as_member('owner');
select lives_ok(format($$ select * from public.leave_owner_edit(%L, 'leave', pg_temp.today() + 2, pg_temp.today() + 2, 'Plain leave') $$,
                       (pg_temp.request_on('comp', pg_temp.today() + 2)).id),
  'the Owner turns it into plain leave');
select is(pg_temp.balance('comp'), 1::numeric, 'which gives the credit back');

-- Interplay: a holiday on the Owner-set comp date gives the credit back (app.holiday_release_comp) ---
select pg_temp.as_member('owner');
select lives_ok($$ insert into public.holidays (date, name) values (app.today_ist() + 1, 'Test holiday') $$,
  'the Owner adds a holiday on edit''s comp leave date');
select pg_temp.as_system();
select is((pg_temp.comp_of('edit')).state::text, 'cancelled', 'the Owner-set comp leave is cancelled by the holiday');
select is(pg_temp.uses_of((pg_temp.comp_of('edit')).id), array['released'], 'and its credit use is released');
select is(pg_temp.balance('edit'), 1::numeric, 'the day is back on edit''s balance');

-- month_summary: the Owner's comp leave is a comp leave day and a credit used, in step ---------------
select pg_temp.as_member('owner');
select results_eq(
  format($$ select comp_leave_days, credits_used from public.month_summary(%L, %L) $$, pg_temp.today(), pg_temp.fx('admin')),
  $$ values (1::numeric, 1.0::numeric) $$,
  'the Admin''s month: one comp leave day, one credit day used');

select * from finish();
rollback;
