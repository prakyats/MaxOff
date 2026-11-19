-- 9.2 (v2.1 "Money in"): the project page's Billing section in one read (ARCHITECTURE §19: one trip, after
-- the page). Owner only: FORBIDDEN without finance.view, so the section's read can never answer an Admin.
-- Security invoker over the 9.1 tables and views, whose own policies and gate apply as well.
-- EXPAND-ONLY: one new function. Append-only: never edit once applied.
create function public.project_billing_read(project_id uuid, cycle_id uuid default null)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_project public.projects;
  v_cycle_id uuid;
  v_out jsonb;
begin
  if not (select app.has_permission('finance.view')) then
    perform app.fail('FORBIDDEN', 'Only the Owner sees billing.');
  end if;
  select p.* into v_project from public.projects p where p.id = project_billing_read.project_id;
  if v_project.id is null then
    perform app.fail('NOT_FOUND', 'This project is not one of yours.');
  end if;

  v_out := jsonb_build_object(
    'project_id', v_project.id,
    'recurrence', v_project.recurrence,
    'billing', (
      select jsonb_build_object(
        'category', coalesce(b.billing_category::text,
          case when v_project.recurrence = 'one_time' then 'project' else 'retainer' end),
        'category_is_default', b.billing_category is null,
        'cycle_amount', b.cycle_amount,
        'fixed_amount', b.fixed_amount,
        'priced_from', b.priced_from)
      from (select 1) one
      left join public.project_billing b on b.project_id = v_project.id));

  if v_project.recurrence = 'one_time' then
    return v_out || jsonb_build_object(
      'line', (
        select jsonb_build_object(
          'month', l.month, 'amount', l.amount, 'potential', l.potential, 'achieved', l.achieved,
          'closed_not_achieved', l.closed_not_achieved, 'was_due', l.was_due,
          'ready_to_complete', l.ready_to_complete, 'state', l.state, 'delivery_date', l.delivery_date,
          'advances_kept', l.advances_kept, 'advances_returned', l.advances_returned)
        from public.revenue_project_lines_v l where l.project_id = v_project.id),
      'advances', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', a.id, 'amount', a.amount, 'received_on', a.received_on, 'note', a.note,
          'returned_on', a.returned_on, 'return_note', a.return_note)
          order by a.received_on, a.recorded_at), '[]'::jsonb)
        from public.project_advances a where a.project_id = v_project.id));
  end if;

  -- A retainer: the cycle asked for (when it is this project's), else nothing cycle-shaped.
  select c.id into v_cycle_id from public.project_cycles c
  where c.id = project_billing_read.cycle_id and c.project_id = v_project.id;
  return v_out || jsonb_build_object(
    'cycle', (
      select jsonb_build_object(
        'cycle_id', c.cycle_id, 'label', c.label, 'month', c.month, 'amount', c.amount,
        'potential', c.potential, 'achieved', c.achieved, 'remaining', c.remaining,
        'closed_not_achieved', c.closed_not_achieved, 'added_value', c.added_value,
        'added_count', c.added_count, 'not_priced_count', c.not_priced_count, 'plan_count', c.plan_count)
      from public.revenue_by_cycle_v c where c.cycle_id = v_cycle_id),
    'added', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'item_id', v.item_id, 'title', v.title, 'method', v.method, 'value', v.value,
        'achieved', v.achieved, 'closed', v.closed_not_achieved)
        order by v.position collate "C", v.item_id), '[]'::jsonb)
      from public.item_values_v v
      where v.cycle_id = v_cycle_id and v.kind = 'added' and v.in_potential));
end;
$$;
revoke all on function public.project_billing_read(uuid, uuid) from public, anon;
grant execute on function public.project_billing_read(uuid, uuid) to authenticated, service_role;
comment on function public.project_billing_read(uuid, uuid) is
  '9.2 (finance.view, security invoker): the project page''s Billing section in one read: category and amount, a retainer cycle''s figures and its added deliverables, or a one-time project''s line and advances.';
