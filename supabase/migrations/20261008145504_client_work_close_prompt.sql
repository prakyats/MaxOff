-- 7A (7.2) The unfinished-items prompt, cycle_close_prompt (WORKFLOWS §8 / §9; kickoff 7 decision 17
--   as answered by the owner on issue #56, Q2, 2026-10-08: "Kickoff 7 amendment C answers").
--
-- Every night at 00:05 IST, after cycle_generate: the cycles whose period has ended and that were not
-- prompted yet, holding open items nobody has decided, are announced to the client's Admin ONLY (the
-- Owner gets no prompt): one items_to_decide row per Admin per run (actionable: the email fallback),
-- listing their projects and, again, the items they left pending. project_cycles.prompted_at records
-- the prompt, so a cycle is announced once; the run is idempotent and catches up any night it missed.
--
-- EXPAND-ONLY: one nullable column, one notification kind, functions and one pg_cron job. Append-only:
-- never edit once applied.

alter table public.project_cycles add column prompted_at timestamptz null;
comment on column public.project_cycles.prompted_at is
  '7.2 (cycle_close_prompt): when the client''s Admin was told this ended cycle has unfinished items '
  'to decide; null until then. Written by the job only.';

insert into public.notification_kinds (kind, actionable, always_email, in_app, description) values
  ('items_to_decide', true, false, true, 'Unfinished items of ended cycles to decide (the client''s Admin; issue #56 Q2)');

-- THE RECIPIENT (issue #56 Q2, owner 2026-10-08): the client's current Admin, never the Owner. The one
-- place that decides who is prompted.
create function app.cycle_close_prompt_recipient(p_client public.clients)
returns uuid
language sql
stable
set search_path = ''
as $$
  select p_client.admin_id;
$$;

revoke all on function app.cycle_close_prompt_recipient(public.clients) from public, authenticated;
grant execute on function app.cycle_close_prompt_recipient(public.clients) to service_role;

comment on function app.cycle_close_prompt_recipient(public.clients) is
  'Internal (7.2, issue #56 Q2 answered 2026-10-08): who gets the unfinished-items prompt for a '
  'client''s cycles: the client''s current Admin only (null: nobody). The Owner gets none.';

create function app.cycle_close_prompt(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_today date := app.to_ist_date(p_now);
  v_rows jsonb;
  v_cycle record;
  v_admin record;
  v_count integer := 0;
begin
  for v_org in select o.id from public.organizations o order by o.id loop
    perform pg_advisory_xact_lock(hashtext('cycle_close_prompt:' || v_org::text));
    v_rows := '[]'::jsonb;
    -- What each Admin is told: every ended cycle of their clients' open or in-progress projects that
    -- holds undecided open items and was not prompted (new), and every item left pending (again).
    for v_cycle in
      select c.id, c.label, c.prompted_at, p.id as project_id, p.client_id, p.name as project,
             cl.name as client, app.cycle_close_prompt_recipient(cl) as recipient,
             count(*) filter (where i.carry_decision is null) as undecided,
             count(*) filter (where i.carry_decision = 'leave_pending') as pending
      from public.project_cycles c
      join public.projects p on p.id = c.project_id
      join public.clients cl on cl.id = p.client_id
      join public.project_items i on i.cycle_id = c.id and i.state = 'open'
      where c.org_id = v_org and c.period_end is not null and c.period_end < v_today
        and p.state in ('open', 'in_progress')
      group by c.id, c.label, c.prompted_at, p.id, p.client_id, p.name, cl.id, cl.name
      order by c.id
    loop
      continue when v_cycle.recipient is null;
      v_rows := v_rows || jsonb_build_object(
        'recipient', v_cycle.recipient, 'cycle_id', v_cycle.id,
        'new', v_cycle.prompted_at is null and v_cycle.undecided > 0,
        'undecided', case when v_cycle.prompted_at is null then v_cycle.undecided else 0 end,
        'pending', v_cycle.pending,
        'line', format('%s (%s) · %s', v_cycle.project, v_cycle.client, v_cycle.label),
        'link', '/clients/' || v_cycle.client_id || '/projects/' || v_cycle.project_id,
        'project_id', v_cycle.project_id);
    end loop;

    -- One prompt per Admin with something new; their pending items ride along (listed again).
    for v_admin in
      select (x ->> 'recipient')::uuid as recipient,
             sum((x ->> 'undecided')::integer + (x ->> 'pending')::integer) as items,
             sum((x ->> 'pending')::integer) as pending,
             count(distinct x ->> 'project_id') as projects,
             string_agg((x ->> 'line') || ': ' || ((x ->> 'undecided')::integer + (x ->> 'pending')::integer),
                        '; ' order by x ->> 'line') as lines,
             min(x ->> 'link') as link, min(x ->> 'project_id') as project_id
      from jsonb_array_elements(v_rows) x
      group by 1
      having bool_or((x ->> 'new')::boolean)
    loop
      perform app.notify(array[v_admin.recipient], 'items_to_decide',
        format('%s unfinished %s to decide', v_admin.items, case when v_admin.items = 1 then 'item' else 'items' end),
        v_admin.lines || case when v_admin.pending > 0
          then format('. %s left pending, listed again.', v_admin.pending) else '.' end,
        case when v_admin.projects = 1 then v_admin.link else '/today' end,
        case when v_admin.projects = 1 then 'projects' end,
        case when v_admin.projects = 1 then v_admin.project_id::uuid end,
        jsonb_build_object('items', v_admin.items, 'pending', v_admin.pending), null);
      v_count := v_count + 1;
    end loop;

    -- Each newly announced cycle is marked, so it is announced once.
    for v_cycle in
      select (x ->> 'cycle_id')::uuid as id from jsonb_array_elements(v_rows) x
      where (x ->> 'new')::boolean
      order by 1
    loop
      perform set_config('app.audit_override', jsonb_build_object('action', 'prompted')::text, true);
      update public.project_cycles set prompted_at = p_now where id = v_cycle.id;
    end loop;
  end loop;
  return v_count;
end;
$$;

revoke all on function app.cycle_close_prompt(timestamptz) from public, anon, authenticated;
grant execute on function app.cycle_close_prompt(timestamptz) to service_role;

comment on function app.cycle_close_prompt(timestamptz) is
  '7.2 (WORKFLOWS §8 / §9; issue #56 Q2, owner 2026-10-08): pg_cron at 00:05 IST (18:35 UTC) every '
  'night. Per organisation under an advisory lock: the cycles of open or in-progress projects whose '
  'period ended before the run''s IST date, that hold open items with no carry decision and were not '
  'prompted yet, are announced to the client''s Admin only (app.cycle_close_prompt_recipient): one '
  'items_to_decide row per Admin per run (actionable, no actor), listing each project and cycle with '
  'its count, the items they left pending listed again; the cycles are marked prompted_at (audited '
  '''prompted''). Done items are not counted (they wait for approval). Returns the rows written. '
  'Idempotent: a re-run announces nothing new.';

select cron.schedule('cycle_close_prompt', '35 18 * * *', $$select app.cycle_close_prompt()$$);
