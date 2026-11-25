-- v2.0.1 "Flexible comp leave" (migration split_leave_days; #89 7105109291, plan 7162082104):
-- two half days on one date when their halves differ, in any mix of comp and ordinary leave; one
-- request for a split day (leave_submit_split, decided together); the day of a split date
-- (leave / comp_leave with both links, leave_covering as a whole day, the hours rules off,
-- month_summary by its halves); cancelling either half (the day back to the half that stands, the
-- comp credit back); the Owner's edit and correction with halves and ½ comp; a change keeping its
-- half; holiday release; who may do each. Neutral names only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(94);

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner', '10000000-0000-4000-8000-000000000001'),
  ('admin', '10000000-0000-4000-8000-000000000002'),
  ('sa',    '00000000-0000-4000-8000-000000015001'),
  ('sb',    '00000000-0000-4000-8000-000000015002'),
  ('sc',    '00000000-0000-4000-8000-000000015003'),
  ('sd',    '00000000-0000-4000-8000-000000015004');
insert into fx select 'org', id from public.organizations limit 1;
grant select, insert on fx to authenticated, anon;

create function pg_temp.fx(k text) returns uuid language sql stable as $$ select id from fx where key = k; $$;
create function pg_temp.as_member(k text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', pg_temp.fx(k)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.fx(k), 'role', 'authenticated')::text, true);
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
-- 'ok', or the refusal as "CODE: detail".
create function pg_temp.err(q text) returns text language plpgsql as $$
declare v_msg text; v_detail text;
begin
  execute q;
  return 'ok';
exception when others then
  get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail;
  return v_msg || ': ' || coalesce(v_detail, '');
end;
$$;
grant execute on function pg_temp.err(text) to authenticated, anon;
create function pg_temp.d(n integer) returns date language sql stable as $$ select app.today_ist() + n; $$;
create function pg_temp.day_label(n integer) returns text language sql stable as $$
  select to_char(app.today_ist() + n, 'FMDD Mon');
$$;
-- The member's request on a date and half (newest), as the system sees it.
create function pg_temp.req(k text, n integer, h text) returns public.leave_requests language sql stable as $$
  select r.* from public.leave_requests r
  where r.member_id = pg_temp.fx(k) and r.start_date = app.today_ist() + n and r.half is not distinct from h
  order by r.created_at desc limit 1;
$$;
create function pg_temp.credit(k text) returns text language sql stable as $$
  select 'reserved ' || coalesce(sum(c.reserved_days), 0)::numeric(3,1) || ' used ' || coalesce(sum(c.used_days), 0)::numeric(3,1)
  from public.comp_leave_credits c where c.member_id = pg_temp.fx(k);
$$;
create function pg_temp.today_day(k text) returns public.attendance_days language sql stable as $$
  select d.* from public.attendance_days d where d.member_id = pg_temp.fx(k) and d.work_date = app.today_ist();
$$;
create function pg_temp.summary(k text) returns text language sql stable as $$
  select 'worked ' || s.days_worked::numeric(4,1) || ' leave ' || s.leave_days || ' half ' || s.half_days
         || ' comp ' || s.comp_leave_days::numeric(4,1) || ' additional ' || s.additional_leave::numeric(4,1)
  from public.month_summary(app.today_ist(), pg_temp.fx(k)) s;
$$;

-- Fixtures: four Crew members who joined a month ago; every day a working day for the next six
-- weeks; comp credits (three days for sa, one each for sb, sc and sd; none for the Admin).
insert into auth.users (id, email) select id, key || '-150@example.com' from fx where key in ('sa', 'sb', 'sc', 'sd');
insert into public.members (id, org_id, full_name, email, role, status, joined_at)
select pg_temp.fx(k), pg_temp.fx('org'), 'Split ' || k, k || '-150@example.com', 'staff', 'active', now() - interval '30 days'
from unnest(array['sa', 'sb', 'sc', 'sd']) k;
update public.org_settings set weekly_off_days = '{}' where org_id = pg_temp.fx('org');
delete from public.holidays where date between app.today_ist() and app.today_ist() + 45;
insert into public.comp_leave_credits (member_id, days, granted_by, granted_on, expires_on, note)
select pg_temp.fx(k), 1, pg_temp.fx('owner'), app.today_ist() - 1, app.today_ist() + 45, 'Worked a Sunday 150'
from (values ('sa'), ('sa'), ('sa'), ('sb'), ('sc'), ('sd')) v(k);
select pg_temp.as_member('owner');
insert into fx select 'free', public.member_add_freelancer('Free 150', null, null, pg_temp.fx('admin'));
select pg_temp.as_system();

-- 1. The surface ------------------------------------------------------------------------------------
select has_column('public', 'leave_requests', 'pair_id', 'leave_requests.pair_id exists');
select has_column('public', 'attendance_days', 'second_leave_request_id', 'attendance_days.second_leave_request_id exists');
select ok(has_function_privilege('authenticated', 'public.leave_submit_split(date, text, text)', 'execute'),
  'leave_submit_split: authenticated may call it');
select ok(not has_function_privilege('anon', 'public.leave_submit_split(date, text, text)', 'execute'),
  'leave_submit_split: anon may not');
select is((select prosecdef from pg_proc where oid = 'public.leave_submit_split(date, text, text)'::regprocedure), true,
  'leave_submit_split: security definer');
select throws_ok(format($$ insert into public.leave_requests (member_id, type, start_date, end_date, state, source, pair_id)
                          values (%L, 'half_day', app.today_ist() + 30, app.today_ist() + 30, 'submitted', 'form', gen_random_uuid()) $$,
                        pg_temp.fx('sa')),
  '23514', null, 'a paired row names its half (leave_requests_pair_half)');

-- 2. Conflicts are per half (waiting requests), with the words the person reads -----------------------
select pg_temp.as_member('sa');
select is(pg_temp.err($$ select public.leave_submit('half_day', app.today_ist() + 5, app.today_ist() + 5, 'Morning 150', 'morning') $$),
  'ok', 'a morning half day');
select is(pg_temp.err($$ select public.leave_submit('half_day', app.today_ist() + 5, app.today_ist() + 5, 'Again 150', 'morning') $$),
  format('CONFLICT: You''ve already asked for the morning off on %s. Request the afternoon instead.', pg_temp.day_label(5)),
  'the same half again: refused, naming the other half');
select is(pg_temp.err($$ select public.leave_submit('leave', app.today_ist() + 5, app.today_ist() + 5, 'Whole 150') $$),
  format('CONFLICT: You''ve already asked for the morning off on %s. Request the afternoon as a half day instead.', pg_temp.day_label(5)),
  'a full day over a waiting half: refused, pointing at the free half');
select is(pg_temp.err($$ select public.leave_submit_comp(app.today_ist() + 5, true, 'Comp pm 150', 'afternoon') $$),
  'ok', 'a ½ comp afternoon beside an ordinary morning (leave + comp)');
select is(pg_temp.err($$ select public.leave_submit('half_day', app.today_ist() + 5, app.today_ist() + 5, 'Third 150', 'afternoon') $$),
  format('CONFLICT: You already have %s off. Request a change to one of those requests instead.', pg_temp.day_label(5)),
  'both halves taken: refused, the whole date named');
select is(pg_temp.err($$ select public.leave_submit('half_day', app.today_ist() + 6, app.today_ist() + 6, 'Old kind 150', null) $$),
  'ok', 'a half day with no half (the older kind)');
select is(pg_temp.err($$ select public.leave_submit('half_day', app.today_ist() + 6, app.today_ist() + 6, 'Pm 150', 'afternoon') $$),
  'CONFLICT: You already have a request for these dates. Request a change to it instead.',
  'a half day with no half counts as the whole day');
select is(pg_temp.err($$ select public.leave_submit('leave', app.today_ist() + 7, app.today_ist() + 7, 'Full 150') $$),
  'ok', 'a full day');
select is(pg_temp.err($$ select public.leave_submit_comp(app.today_ist() + 7, true, 'Comp am 150', 'morning') $$),
  'CONFLICT: You already have a request for this date. Request a change to it instead.',
  'a half beside a full day: refused, as before');
select is(pg_temp.err($$ select public.leave_submit_comp(app.today_ist() + 8, true, 'Comp am 150', 'morning') $$),
  'ok', 'a ½ comp morning');
select is(pg_temp.err($$ select public.leave_submit_comp(app.today_ist() + 8, true, 'Comp pm 150', 'afternoon') $$),
  'ok', 'and a ½ comp afternoon on the same date (comp + comp)');
select is(pg_temp.credit('sa'), 'reserved 1.5 used 0.0', 'three comp halves reserve 1½ days');

-- 3. leave_submit_split: "Full day: ½ comp + ½ leave" ---------------------------------------------------
insert into fx select 'pair9', public.leave_submit_split(app.today_ist() + 9, 'afternoon', 'Split 150');
select is((select count(*)::integer from public.leave_requests r where r.pair_id = pg_temp.fx('pair9') and r.state = 'submitted'),
  2, 'two waiting rows share the pair');
select is((select row(r.type, r.half, r.credit_days)::text from public.leave_requests r
           where r.pair_id = pg_temp.fx('pair9') and r.credit_days is not null),
  '(half_day,afternoon,0.5)', 'the comp half is the afternoon, with ½ credit');
select is((select row(r.type, r.half, r.credit_days)::text from public.leave_requests r
           where r.pair_id = pg_temp.fx('pair9') and r.credit_days is null),
  '(half_day,morning,)', 'the other half is ordinary leave in the morning');
select is(pg_temp.credit('sa'), 'reserved 2.0 used 0.0', 'the split reserves ½ day more');
select pg_temp.as_system();
select is((select count(*)::integer from public.notifications n
           where n.kind = 'leave_requested' and n.payload ->> 'pair_id' = pg_temp.fx('pair9')::text
             and n.recipient_id = pg_temp.fx('owner')),
  1, 'the Owner is told once for the pair');
select is((select n.title from public.notifications n where n.payload ->> 'pair_id' = pg_temp.fx('pair9')::text),
  'Split sa requested a full day: ½ comp + ½ leave', 'in plain words, without an amount');
select pg_temp.as_member('sa');
select is(pg_temp.err($$ select public.leave_submit_split(app.today_ist() + 9, 'morning', 'Again 150') $$),
  format('CONFLICT: You already have %s off. Request a change to one of those requests instead.', pg_temp.day_label(9)),
  'a second split on the date: refused');
select is(pg_temp.err($$ select public.leave_submit_split(app.today_ist() + 6, 'morning', 'Over old 150') $$),
  'CONFLICT: You already have a request for this date. Request a change to it instead.',
  'a split over a half day with no half: refused');
select is(pg_temp.err($$ select public.leave_submit_split(app.today_ist() + 10, 'evening', 'Bad 150') $$),
  'VALIDATION: Choose which half is comp leave: Morning or Afternoon.', 'the comp half must be a half');
select is(pg_temp.err($$ select public.leave_submit_split(app.today_ist() - 1, 'morning', 'Past 150') $$),
  'VALIDATION: Leave cannot start in the past.', 'never in the past');
select pg_temp.as_system();
insert into public.holidays (org_id, date, name) values (pg_temp.fx('org'), app.today_ist() + 11, 'Holiday 150');
select pg_temp.as_member('sa');
select is(pg_temp.err($$ select public.leave_submit_split(app.today_ist() + 11, 'morning', 'Off 150') $$),
  'VALIDATION: That date is a day off. Comp leave is for a working day.', 'never on a day off');
select pg_temp.as_member('admin');
select is(pg_temp.err($$ select public.leave_submit_split(app.today_ist() + 9, 'morning', 'No credit 150') $$),
  'VALIDATION: You don''t have enough comp leave for that date.', 'an Admin with no credit: refused');
select pg_temp.as_member('owner');
select is(pg_temp.err($$ select public.leave_submit_split(app.today_ist() + 9, 'morning', 'Owner 150') $$),
  'FORBIDDEN: The Owner does not mark attendance.', 'the Owner has no leave of their own');
select pg_temp.as_member('free');
select is(pg_temp.err($$ select public.leave_submit_split(app.today_ist() + 9, 'morning', 'Free 150') $$),
  'UNAUTHENTICATED: Your account is not active.', 'a freelancer (who never signs in): refused');
select pg_temp.as_member('admin');
select is((select count(*)::integer from public.leave_requests r where r.pair_id = pg_temp.fx('pair9')), 0,
  'an Admin reads none of a Crew member''s pair');
select pg_temp.as_member('sa');
select is((select count(*)::integer from public.leave_requests r where r.pair_id = pg_temp.fx('pair9')), 2,
  'the member reads both halves');

-- 4. Deciding: a waiting pair together; halves on their own ----------------------------------------
select pg_temp.as_member('admin');
select is(pg_temp.err(format($$ select * from public.leave_decide(%L, 'approve') $$, (pg_temp.req('sa', 9, 'morning')).id)),
  'FORBIDDEN: Only the Owner decides attendance and leave.', 'an Admin can''t decide it');
select pg_temp.as_member('owner');
select is((select d.state::text from public.leave_decide((pg_temp.req('sa', 9, 'morning')).id, 'approve') d), 'approved',
  'the Owner approves the pair from one half');
select is((select string_agg(r.state::text, ',' order by r.half) from public.leave_requests r where r.pair_id = pg_temp.fx('pair9')),
  'approved,approved', 'both halves are approved');
select is(pg_temp.credit('sa'), 'reserved 1.5 used 0.5', 'the comp half uses its ½ credit');
select is((select d.state::text from public.leave_decide((pg_temp.req('sa', 5, 'morning')).id, 'approve') d), 'approved',
  'an ordinary morning');
select is((select d.state::text from public.leave_decide((pg_temp.req('sa', 5, 'afternoon')).id, 'approve') d), 'approved',
  'and a comp afternoon beside it, each on its own');
select is((select d.state::text from public.leave_decide((pg_temp.req('sa', 8, 'morning')).id, 'approve') d)
          || ',' || (select d.state::text from public.leave_decide((pg_temp.req('sa', 8, 'afternoon')).id, 'approve') d),
  'approved,approved', 'two comp halves of one date');
select is(pg_temp.credit('sa'), 'reserved 0.0 used 2.0', 'all four comp halves use their credit');

select pg_temp.as_member('sb');
insert into fx select 'pair12', public.leave_submit_split(app.today_ist() + 12, 'morning', 'Withdraw me 150');
select is(public.leave_withdraw((pg_temp.req('sb', 12, 'afternoon')).id)::text, 'withdrawn', 'withdrawing one half of a waiting pair');
select is((select string_agg(r.state::text, ',') from public.leave_requests r where r.pair_id = pg_temp.fx('pair12')),
  'withdrawn,withdrawn', 'withdraws both');
select is(pg_temp.credit('sb'), 'reserved 0.0 used 0.0', 'and the ½ credit is back');
insert into fx select 'pair13', public.leave_submit_split(app.today_ist() + 13, 'morning', 'Reject me 150');
select pg_temp.as_member('owner');
select is(pg_temp.err(format($$ select * from public.leave_decide(%L, 'reject') $$, (pg_temp.req('sb', 13, 'morning')).id)),
  'REASON_REQUIRED: A rejection needs a reason.', 'a rejection needs a reason');
select is((select d.state::text from public.leave_decide((pg_temp.req('sb', 13, 'morning')).id, 'reject', 'Busy week 150') d),
  'rejected', 'the Owner rejects the pair');
select is((select string_agg(r.state::text || ':' || r.decision_reason, ',') from public.leave_requests r
           where r.pair_id = pg_temp.fx('pair13')),
  'rejected:Busy week 150,rejected:Busy week 150', 'both halves, with the one reason');
select is(pg_temp.credit('sb'), 'reserved 0.0 used 0.0', 'the credit is back');

-- 5. Today, a split day: the day, leave_covering, the hours rules, the month --------------------------
select pg_temp.as_member('sb');
insert into fx select 'pair0', public.leave_submit_split(app.today_ist(), 'morning', 'Today split 150');
select pg_temp.as_member('owner');
select is((select d.state::text from public.leave_decide((pg_temp.req('sb', 0, 'morning')).id, 'approve') d), 'approved',
  'today''s split approved');
select pg_temp.as_system();
select is((app.attendance_open_day(pg_temp.fx('sb'), app.today_ist())).final_status::text, 'leave',
  'the day opens as a day off');
select is((select row(d.leave_request_id = (pg_temp.req('sb', 0, 'morning')).id,
                      d.second_leave_request_id = (pg_temp.req('sb', 0, 'afternoon')).id)::text
           from public.attendance_days d where d.id = (pg_temp.today_day('sb')).id),
  '(t,t)', 'linking the morning''s request first and the afternoon''s second');
select is((select row(c.type, c.half, c.id = (pg_temp.req('sb', 0, 'morning')).id)::text
           from app.leave_covering(pg_temp.fx('sb'), app.today_ist()) c),
  '(leave,,t)', 'leave_covering: one whole day, no half');
select is((select row(h.late_applies, h.early_applies, h.half)::text from app.attendance_hours(pg_temp.fx('sb'), app.today_ist()) h),
  '(f,f,)', 'no late-start or leaving-early rule on a day off');
select pg_temp.as_member('owner');
select is(pg_temp.summary('sb'), 'worked 0.0 leave 0 half 1 comp 0.5 additional 0.5',
  'the month: ½ comp and ½ additional leave, nothing worked');
select is(public.leave_owner_cancel((pg_temp.req('sb', 0, 'afternoon')).id, 'Came in after lunch 150')::text, 'cancelled',
  'the Owner cancels the leave half');
select pg_temp.as_system();
select is((select row(d.final_status, d.leave_request_id = (pg_temp.req('sb', 0, 'morning')).id, d.second_leave_request_id)::text
           from public.attendance_days d where d.id = (pg_temp.today_day('sb')).id),
  '(half_day,t,)', 'the day is the comp morning that stands');
select pg_temp.as_member('owner');
select is(pg_temp.summary('sb'), 'worked 0.5 leave 0 half 0 comp 0.5 additional 0.0',
  'the month: ½ comp, ½ worked');
select is(pg_temp.credit('sb'), 'reserved 0.0 used 0.5', 'the comp half keeps its credit');
select is(public.leave_owner_cancel((pg_temp.req('sb', 0, 'morning')).id, 'Worked all day 150')::text, 'cancelled',
  'then the comp half');
select pg_temp.as_system();
select is((pg_temp.today_day('sb')).state::text, 'awaiting_choice', 'the day asks again');
select is(pg_temp.credit('sb'), 'reserved 0.0 used 0.0', 'and the ½ credit is back');

-- 6. Today, two comp halves ----------------------------------------------------------------------------
select pg_temp.as_member('sc');
insert into fx select 'sc_am', public.leave_submit_comp(app.today_ist(), true, 'Comp am 150', 'morning');
insert into fx select 'sc_pm', public.leave_submit_comp(app.today_ist(), true, 'Comp pm 150', 'afternoon');
select pg_temp.as_member('owner');
select is((select d.state::text from public.leave_decide((pg_temp.req('sc', 0, 'morning')).id, 'approve') d)
          || ',' || (select d.state::text from public.leave_decide((pg_temp.req('sc', 0, 'afternoon')).id, 'approve') d),
  'approved,approved', 'both comp halves approved');
select pg_temp.as_system();
select is((app.attendance_open_day(pg_temp.fx('sc'), app.today_ist())).final_status::text, 'comp_leave',
  'the day is a comp leave day');
select pg_temp.as_member('owner');
select is(pg_temp.summary('sc'), 'worked 0.0 leave 0 half 0 comp 1.0 additional 0.0', 'the month: one comp day');
select is(public.leave_owner_cancel((pg_temp.req('sc', 0, 'morning')).id, 'Morning worked 150')::text, 'cancelled',
  'the Owner cancels the morning');
select pg_temp.as_system();
select is((select row(d.final_status, d.leave_request_id = (pg_temp.req('sc', 0, 'afternoon')).id, d.second_leave_request_id)::text
           from public.attendance_days d where d.id = (pg_temp.today_day('sc')).id),
  '(half_day,t,)', 'the day is the afternoon that stands');

-- 7. The Owner's edit keeps the half and the ½ comp ----------------------------------------------------
select pg_temp.as_member('owner');
insert into fx select 'edit1', e.new_id
from public.leave_owner_edit((pg_temp.req('sa', 8, 'morning')).id, 'half_day', app.today_ist() + 14, app.today_ist() + 14, 'Moved 150') e;
select is((select row(r.half, r.credit_days, r.state)::text from public.leave_requests r where r.id = pg_temp.fx('edit1')),
  '(morning,0.5,approved)', 'an edit keeps the morning and the ½ comp');
select is(pg_temp.credit('sa'), 'reserved 0.0 used 2.0', 'the credit moves with it (released, drawn again)');
insert into fx select 'edit2', e.new_id
from public.leave_owner_edit(pg_temp.fx('edit1'), 'half_day', app.today_ist() + 14, app.today_ist() + 14, 'Ordinary 150', null, false) e;
select is((select row(r.half, r.credit_days)::text from public.leave_requests r where r.id = pg_temp.fx('edit2')),
  '(morning,)', 'comp => false makes it ordinary leave');
select is(pg_temp.credit('sa'), 'reserved 0.0 used 1.5', 'and gives the ½ credit back');
insert into fx select 'edit3', e.new_id
from public.leave_owner_edit(pg_temp.fx('edit2'), 'half_day', app.today_ist() + 14, app.today_ist() + 14, 'Afternoon 150', 'afternoon') e;
select is((select r.half from public.leave_requests r where r.id = pg_temp.fx('edit3')), 'afternoon', 'or another half');
select pg_temp.as_system();
select is((select n.body from public.notifications n
           where n.recipient_id = pg_temp.fx('sa') and n.kind = 'leave_decided' and n.entity_id = pg_temp.fx('edit3')),
  format('Now a half day (afternoon off), %s · Afternoon 150', app.notify_span(app.today_ist() + 14, app.today_ist() + 14)),
  'the member reads which half');
select pg_temp.as_member('sa');
select is(pg_temp.err(format($$ select * from public.leave_owner_edit(%L, 'half_day', app.today_ist() + 14, app.today_ist() + 14, 'Self 150', 'morning', true) $$,
                             pg_temp.fx('edit3'))),
  'FORBIDDEN: Only the Owner decides attendance and leave.', 'a member can''t edit their own leave');

-- 8. The Owner's correction: a split day, a ½ comp day -------------------------------------------------
select pg_temp.as_system();
insert into fx select 'dayd', (app.attendance_open_day(pg_temp.fx('sd'), app.today_ist())).id;
select pg_temp.as_member('owner');
select is(pg_temp.err(format($$ select public.attendance_decide(%L, 'correct', 'present', 'Bad 150', null, 'morning') $$, pg_temp.fx('dayd'))),
  'VALIDATION: A comp half is for a half day or a split day.', 'a comp half with Present: refused');
select is(pg_temp.err(format($$ select public.attendance_decide(%L, 'correct', 'leave', 'Bad 150', 'morning') $$, pg_temp.fx('dayd'))),
  'VALIDATION: Morning or Afternoon is only for a half day.', 'a half with Leave: refused');
select is(pg_temp.err(format($$ select public.attendance_decide(%L, 'correct', 'half_day', 'Bad 150', 'morning', 'afternoon') $$, pg_temp.fx('dayd'))),
  'VALIDATION: A ½ comp day is comp leave in the half that is off.', 'a ½ comp day in the other half: refused');
select is(public.attendance_decide(pg_temp.fx('dayd'), 'correct', 'leave', 'Split by the Owner 150', null, 'afternoon')::text,
  'corrected', 'the Owner corrects the day to ½ comp + ½ leave');
select is((select row(d.final_status, d.state,
                      d.leave_request_id = (pg_temp.req('sd', 0, 'morning')).id,
                      d.second_leave_request_id = (pg_temp.req('sd', 0, 'afternoon')).id)::text
           from public.attendance_days d where d.id = pg_temp.fx('dayd')),
  '(leave,corrected,t,t)', 'a leave day linking both halves');
select is((select string_agg(r.half || ':' || coalesce(r.credit_days::text, '-') || ':' || r.state, ',' order by r.half)
           from public.leave_requests r where r.member_id = pg_temp.fx('sd') and r.pair_id is not null),
  'afternoon:0.5:approved,morning:-:approved', 'two approved halves born together, the comp in the afternoon');
select is(pg_temp.credit('sd'), 'reserved 0.0 used 0.5', 'the ½ credit is used at once');
select is(pg_temp.summary('sd'), 'worked 0.0 leave 0 half 1 comp 0.5 additional 0.5', 'the month counts it by its halves');
select pg_temp.as_system();
select is((select string_agg(n.title, ' | ') from public.notifications n where n.recipient_id = pg_temp.fx('sd') and n.kind = 'attendance_decided'),
  format('%s: corrected to Full day: ½ comp + ½ leave', app.notify_date(app.today_ist())), 'the member reads it');
select pg_temp.as_member('owner');
select is(public.attendance_decide(pg_temp.fx('dayd'), 'correct', 'half_day', 'Half comp 150', 'morning', 'morning')::text,
  'corrected', 'then to a ½ comp morning');
select is((select row(d.final_status, d.second_leave_request_id, r.half, r.credit_days)::text
           from public.attendance_days d join public.leave_requests r on r.id = d.leave_request_id
           where d.id = pg_temp.fx('dayd')),
  '(half_day,,morning,0.5)', 'the day links the new ½ comp morning only');

-- 9. Asking to change or cancel keeps the half -----------------------------------------------------------
select pg_temp.as_member('sa');
insert into fx select 'chg', public.leave_request_change((pg_temp.req('sa', 5, 'morning')).id, 'half_day',
                                                         app.today_ist() + 15, app.today_ist() + 15, 'Move it 150');
select is((select r.half from public.leave_requests r where r.id = pg_temp.fx('chg')), 'morning',
  'a change of a morning half day stays a morning');
insert into fx select 'cnl', public.leave_request_change((pg_temp.req('sa', 5, 'afternoon')).id, cancel => true,
                                                         reason => 'Not needed 150');
select is((select row(r.half, r.requests_cancellation)::text from public.leave_requests r where r.id = pg_temp.fx('cnl')),
  '(afternoon,t)', 'a cancellation carries the half');
select is(pg_temp.err(format($$ select public.leave_request_change(%L, 'half_day', app.today_ist() + 8, app.today_ist() + 8, 'Onto comp 150', half => 'morning') $$,
                             (pg_temp.req('sa', 6, null)).id)),
  'INVALID_STATE: Only approved leave can be changed or cancelled.', 'only approved leave can be changed');

-- 10. A holiday on a split date gives the comp half back; the leave half stays ------------------------
select pg_temp.as_system();
insert into public.holidays (org_id, date, name) values (pg_temp.fx('org'), app.today_ist() + 9, 'Moved holiday 150');
select is((select string_agg(r.half || ':' || r.state, ',' order by r.half) from public.leave_requests r
           where r.pair_id = pg_temp.fx('pair9')),
  'afternoon:cancelled,morning:approved', 'the comp afternoon is cancelled, the morning stays');
select is(pg_temp.credit('sa'), 'reserved 0.0 used 1.0', 'its ½ credit is back');

-- 11. The label the Owner reads in a clash ----------------------------------------------------------------
select is(app.leave_label(pg_temp.req('sa', 8, 'afternoon')),
  'Half day (comp, afternoon), ' || to_char(app.today_ist() + 8, 'FMDD Mon YYYY'), 'a comp half named with its half');
select is(app.leave_label(pg_temp.req('sa', 6, null)),
  'Half day, ' || to_char(app.today_ist() + 6, 'FMDD Mon YYYY'), 'a half day with no half reads as before');

-- 12. Older paths unchanged ----------------------------------------------------------------------------------
select is((select row(c.type, c.half)::text from app.leave_covering(pg_temp.fx('sc'), app.today_ist()) c),
  '(half_day,afternoon)', 'one half covering a date is still that half day');
select ok((app.leave_conflict(pg_temp.fx('sa'), app.today_ist() + 20, app.today_ist() + 20, 'leave', null, null, false)).id is null,
  'no request on a free date: no conflict');

select * from finish();
rollback;
