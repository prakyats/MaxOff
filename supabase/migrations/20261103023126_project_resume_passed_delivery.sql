-- v1.9 (owner 2026-11-03, W7 Q5): resuming a ONE-TIME project whose delivery date has passed (before today,
-- IST) requires a new delivery date from today on; without one the resume is refused (VALIDATION, in plain
-- words) and nothing changes. A date not yet passed, or none, stays optional; recurring projects are
-- unaffected. Expand-only: project_resume re-created from its latest definition (20261102171704_on_hold),
-- the only change being that check (after the deliverables' checks, before the delivery date's own).
-- WORKFLOWS §5.5. The sheet already reads the project's delivery date and today, and mirrors the rule
-- (client-work/domain/hold.ts resumeProblems).

create or replace function public.project_resume(project_id uuid, items jsonb default '[]'::jsonb,
                                      new_delivery_date date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_project public.projects;
  v_client public.clients;
  v_today date := app.today_ist();
  v_items jsonb := coalesce(project_resume.items, '[]'::jsonb);
  v_map jsonb := '{}'::jsonb;
  v_el jsonb;
  v_e jsonb;
  v_id uuid;
  v_date date;
  v_decision text;
  v_key text;
  v_row record;
  v_group record;
  v_res jsonb;
  v_bad jsonb;
  v_x jsonb;
  v_dates integer := 0;
  v_carried integer := 0;
  v_closed integer := 0;
  v_pending integer := 0;
begin
  v_caller := app.client_work_caller('projects.complete', 'You cannot resume projects.');
  v_project := app.project_lock(project_resume.project_id);
  if v_project.held_at is null then
    perform app.fail('INVALID_STATE', 'This project is not on hold.');
  end if;
  if jsonb_typeof(v_items) <> 'array' then
    perform app.fail('VALIDATION', 'Send the deliverables as a list.');
  end if;
  if jsonb_array_length(v_items) > 500 then
    perform app.fail('VALIDATION', 'A resume settles at most 500 deliverables.');
  end if;

  -- The entries: {item_id, planned_date?, decision?, reason?, close_kind?}, each deliverable once.
  for v_el in select e from jsonb_array_elements(v_items) e loop
    if jsonb_typeof(v_el) <> 'object' then
      perform app.fail('VALIDATION', 'Each deliverable is an object with its id.');
    end if;
    begin
      v_id := (v_el ->> 'item_id')::uuid;
      v_date := (v_el ->> 'planned_date')::date;
    exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
      perform app.fail('VALIDATION', 'Each deliverable needs its id, and a date like 2026-11-04.');
    end;
    if v_id is null then
      perform app.fail('VALIDATION', 'Each deliverable needs its id.');
    end if;
    if v_map ? v_id::text then
      perform app.fail('VALIDATION', 'A deliverable is listed twice.');
    end if;
    v_decision := nullif(btrim(coalesce(v_el ->> 'decision', '')), '');
    if v_decision is not null and v_decision not in ('carry_forward', 'close', 'leave_pending') then
      perform app.fail('VALIDATION', 'Choose carry forward, close or leave pending.');
    end if;
    v_map := v_map || jsonb_build_object(v_id::text, jsonb_build_object(
      'planned_date', v_date, 'decision', v_decision,
      'reason', nullif(btrim(coalesce(v_el ->> 'reason', '')), ''),
      'close_kind', nullif(btrim(coalesce(v_el ->> 'close_kind', '')), '')));
  end loop;

  -- Only the deliverables the resume settles take an entry.
  for v_key in select jsonb_object_keys(v_map) loop
    if not exists (select 1 from app.project_resume_items(v_project.id, v_today) r where r.item_id = v_key::uuid) then
      perform app.fail('VALIDATION', 'Only the deliverables listed for the resume take a new date or a choice.');
    end if;
  end loop;

  -- Every one of them is settled: the transaction never resumes with a passed date or an ended month left
  -- undecided (owner 2026-10-29).
  for v_row in
    select r.* from app.project_resume_items(v_project.id, v_today) r
    order by r.period_start nulls last, r.planned_date nulls last, r.item_position collate "C", r.item_id
  loop
    v_e := coalesce(v_map -> v_row.item_id::text, '{}'::jsonb);
    v_decision := v_e ->> 'decision';
    v_date := (v_e ->> 'planned_date')::date;
    if v_date is not null and v_date < v_today then
      perform app.fail('VALIDATION', format('%s: choose a date from today on.', v_row.title));
    end if;
    if v_row.month_ended then
      if v_decision is null then
        perform app.fail('VALIDATION', format('%s: %s has ended. Choose carry forward, close or leave pending.',
          v_row.title, v_row.cycle_label));
      end if;
      if v_decision = 'close' then
        if v_date is not null then
          perform app.fail('VALIDATION', format('%s: a closed deliverable takes no new date.', v_row.title));
        end if;
        if v_e ->> 'reason' is null then
          perform app.fail('REASON_REQUIRED', format('Say why %s is closed.', v_row.title));
        end if;
      elsif v_decision = 'leave_pending' and v_row.date_passed and v_date is null then
        perform app.fail('VALIDATION', format('%s was planned for %s: give it a new date.',
          v_row.title, app.notify_date(v_row.planned_date)));
      end if;
    else
      if v_decision is not null then
        perform app.fail('VALIDATION', format('%s: %s has not ended, so it takes a new date only.',
          v_row.title, coalesce(v_row.cycle_label, 'its cycle')));
      end if;
      if v_date is null then
        perform app.fail('VALIDATION', format('%s was planned for %s: give it a new date.',
          v_row.title, app.notify_date(v_row.planned_date)));
      end if;
    end if;
  end loop;
  -- A one-time project whose delivery date passed while it was held takes a new one (owner 2026-11-03,
  -- W7 Q5); a date not yet passed, or none, stays optional.
  if v_project.recurrence = 'one_time' and v_project.delivery_date < v_today
     and project_resume.new_delivery_date is null then
    perform app.fail('VALIDATION', format('The delivery date (%s) has passed: choose a new one from today on.',
      app.notify_date(v_project.delivery_date)));
  end if;
  if project_resume.new_delivery_date is not null then
    if v_project.recurrence <> 'one_time' then
      perform app.fail('VALIDATION', 'Only a one-time project has a delivery date.');
    end if;
    if project_resume.new_delivery_date < v_today then
      perform app.fail('VALIDATION', 'Choose a delivery date from today on.');
    end if;
  end if;

  -- 1. The project resumes: one history entry with the hold it ends; its diff keeps an old and new
  --    delivery date.
  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'resumed', 'meta', jsonb_build_object(
      'reason', v_project.hold_reason, 'held_at', v_project.held_at, 'held_by', v_project.held_by,
      'settled', (select count(*) from jsonb_object_keys(v_map))))::text, true);
  update public.projects
  set held_at = null, held_by = null, hold_reason = null, resumed_at = now(),
      delivery_date = coalesce(project_resume.new_delivery_date, delivery_date)
  where id = v_project.id;

  -- 2. New dates on the running deliverables (each audited with its old and new date).
  for v_row in
    select r.item_id, (v_map -> r.item_id::text ->> 'planned_date')::date as d
    from app.project_resume_items(v_project.id, v_today) r
    where not r.month_ended
    order by r.item_id
  loop
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'update', 'meta', jsonb_build_object('resumed', true))::text, true);
    update public.project_items set planned_date = v_row.d where id = v_row.item_id;
    v_dates := v_dates + 1;
  end loop;

  -- 3. The ended months' choices, by cycle_carry_decide's own rules (carry forward and leave pending a
  --    cycle at a time, close one at a time with its reason and kind). Any refusal refuses the resume.
  for v_group in
    select r.cycle_id, x.d as decision, array_agg(r.item_id order by r.item_id) as ids
    from app.project_resume_items(v_project.id, v_today) r
    cross join lateral (select v_map -> r.item_id::text ->> 'decision' as d) x
    where r.month_ended and x.d in ('carry_forward', 'leave_pending')
    group by r.cycle_id, x.d
    order by r.cycle_id, x.d
  loop
    v_res := public.cycle_carry_decide(v_group.ids, v_group.decision::public.carry_decision);
    select x into v_bad from jsonb_array_elements(v_res) x where not coalesce((x ->> 'ok')::boolean, false) limit 1;
    if v_bad is not null then
      perform app.fail(v_bad ->> 'code', v_bad ->> 'message');
    end if;
    for v_x in select x from jsonb_array_elements(v_res) x loop
      v_date := (v_map -> (v_x ->> 'id') ->> 'planned_date')::date;
      if v_date is not null then
        perform set_config('app.audit_override', jsonb_build_object(
          'action', 'update', 'meta', jsonb_build_object('resumed', true))::text, true);
        update public.project_items set planned_date = v_date
        where id = case when v_group.decision = 'carry_forward' then (v_x ->> 'new_item_id')::uuid
                        else (v_x ->> 'id')::uuid end;
        v_dates := v_dates + 1;
      end if;
    end loop;
    if v_group.decision = 'carry_forward' then
      v_carried := v_carried + cardinality(v_group.ids);
    else
      v_pending := v_pending + cardinality(v_group.ids);
    end if;
  end loop;
  for v_row in
    select r.item_id from app.project_resume_items(v_project.id, v_today) r
    where r.month_ended and v_map -> r.item_id::text ->> 'decision' = 'close'
    order by r.item_id
  loop
    v_e := v_map -> v_row.item_id::text;
    v_res := public.cycle_carry_decide(array[v_row.item_id], 'close', v_e ->> 'reason', v_e ->> 'close_kind');
    select x into v_bad from jsonb_array_elements(v_res) x where not coalesce((x ->> 'ok')::boolean, false) limit 1;
    if v_bad is not null then
      perform app.fail(v_bad ->> 'code', v_bad ->> 'message');
    end if;
    v_closed := v_closed + 1;
  end loop;

  -- 4. WORKFLOWS §9 "Project resumed": the Owner's resume tells the client's Admin; an Admin's own tells
  --    nobody. (The carry decisions above notify as the carry screen's do.)
  v_client := app.project_client(v_project);
  if v_caller.role = 'owner' then
    perform app.notify(array[v_client.admin_id], 'project_resumed',
      format('%s resumed %s', v_caller.full_name, v_project.name),
      v_client.name || case when v_dates > 0
        then format('. %s %s a new date.', v_dates, case when v_dates = 1 then 'deliverable has' else 'deliverables have' end)
        else '.' end,
      app.project_link(v_project), 'projects', v_project.id,
      jsonb_build_object('project_id', v_project.id, 'client_id', v_project.client_id), v_caller.id);
  end if;
  return jsonb_build_object('resumed_at', now(), 'dates', v_dates, 'carried', v_carried, 'closed', v_closed,
                            'left_pending', v_pending);
end;
$$;
comment on function public.project_resume(uuid, jsonb, date) is
  'v1.9 W7 (WORKFLOWS §5.5): projects.complete on the caller''s clients resumes a held project in one '
  'transaction. items = [{item_id, planned_date?, decision?, reason?, close_kind?}], one per deliverable of '
  'project_resume_list and nothing else (VALIDATION): a running cycle''s deliverable planned before today '
  'takes a new date (from today on); an ended cycle''s open deliverable takes carry_forward (an optional '
  'date for the new deliverable), close (reason required, an optional close kind) or leave_pending (a new '
  'date when its date passed), done by cycle_carry_decide''s rules (any refusal refuses the resume). A '
  'resume leaving any of them out is refused. new_delivery_date moves a one-time project''s delivery date '
  '(from today on); it is required when that date has passed (VALIDATION; owner 2026-11-03), optional '
  'otherwise. Audited ''resumed'' (meta: the hold''s reason, held_at, held_by), each new '
  'date an update. The Owner''s resume notifies the client''s Admin (project_resumed). Returns {resumed_at, '
  'dates, carried, closed, left_pending}.';
revoke all on function public.project_resume(uuid, jsonb, date) from public, anon;
grant execute on function public.project_resume(uuid, jsonb, date) to authenticated, service_role;
