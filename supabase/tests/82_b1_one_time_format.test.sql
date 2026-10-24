-- B1 (UX review 2026-10-21, v1.8 unit V0; migration b1_one_time_format): every time MaxOff writes
-- into a notification body or a message reads `6:00 pm` (lower-case, 12-hour, IST), as core/time's
-- formatTime does on screen. The two helpers, notify_when (every "due …" body), the end-of-day
-- reminder's body, and that the two refusals with a time use the helpers; API roles cannot call
-- the helpers directly. Neutral names only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

-- The helpers -----------------------------------------------------------------------------------
select is(app.ist_time('2026-10-19 12:30:00+00'), '6:00 pm', 'ist_time: 12:30 UTC is 6:00 pm IST');
select is(app.ist_time('2026-10-19 04:21:00+00'), '9:51 am', 'a morning time, no leading zero');
select is(app.ist_time('2026-10-19 18:30:00+00'), '12:00 am', 'IST midnight is 12:00 am');
select is(app.ist_time('2026-10-19 06:30:00+00'), '12:00 pm', 'IST noon is 12:00 pm');
select is(app.wall_time('05:00'), '5:00 am', 'wall_time: the default cutoff');
select is(app.wall_time('20:30'), '8:30 pm', 'an evening reminder time');
select is(app.notify_when('2026-10-19 12:30:00+00'), '19 Oct, 6:00 pm', 'notify_when: "19 Oct, 6:00 pm", never "18:00"');
select is(app.notify_when('2026-10-19 19:00:00+00'), '20 Oct, 12:30 am', 'the IST date across UTC midnight');

-- Reach: like notify_when, for the security-definer functions only ------------------------------
select ok(not has_function_privilege('authenticated', 'app.ist_time(timestamptz)', 'execute'), 'authenticated cannot call ist_time');
select ok(not has_function_privilege('anon', 'app.wall_time(time)', 'execute'), 'nor anon wall_time');

-- The end-of-day reminder's body ----------------------------------------------------------------
delete from public.notifications where kind = 'end_day_reminder';
delete from public.attendance_events;
delete from public.attendance_days;
update public.org_settings set logout_reminder_time = '20:30';
insert into public.attendance_days (member_id, work_date, started_at, is_day_off)
values ('10000000-0000-4000-8000-000000000003', app.today_ist(),
        app.ist_day_start(app.today_ist()) + interval '9 hours 51 minutes', false);
select is(app.end_day_reminder(app.ist_day_start(app.today_ist()) + interval '20 hours 30 minutes'), 1, 'the reminder goes');
select is((select body from public.notifications where kind = 'end_day_reminder'),
  'Started at 9:51 am. If you''re done, end it; if you''re working late, carry on.',
  'its body says "Started at 9:51 am"');

-- The two refusals that name a time -------------------------------------------------------------
select ok((select prosrc from pg_proc where oid = 'public.task_remind(uuid)'::regprocedure) ~ 'app\.ist_time\(v_last\)'
  and (select prosrc from pg_proc where oid = 'public.task_remind(uuid)'::regprocedure) !~ 'HH12',
  'Remind''s "a reminder went at …" refusal uses ist_time');
select ok((select prosrc from pg_proc where oid = 'public.attendance_end_day(text, integer)'::regprocedure) ~ 'app\.wall_time\(v_cutoff\)',
  'End day''s cutoff refusal uses wall_time');

select * from finish();
rollback;
