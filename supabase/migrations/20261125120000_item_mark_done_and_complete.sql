-- v2.1 (kickoff 9 R1, owner 14 Nov 2026; WORKFLOWS §6 "One-time projects"): marking the LAST open deliverable
-- of a one-time project done offers "Mark done and complete project" beside "Mark done only". This is the
-- first choice, as one transition: the deliverable is marked done (item_mark_done, which approves it, D3)
-- and the project is completed (project_complete), in one transaction, each keeping its own checks, history
-- entry and notifications. If the project cannot be completed (another deliverable is still open), nothing
-- is marked. No money: completing is what makes a one-time project's lump sum count (invariant 3), and
-- neither function reads or shows an amount (invariant 2).
-- EXPAND-ONLY: one new function. Append-only: never edit once applied.
create function public.item_mark_done_and_complete(item_id uuid)
returns public.project_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_item public.project_items;
  v_project public.projects;
begin
  v_caller := app.client_work_caller('items.tick', 'You cannot mark items done.');
  if not app.has_permission('projects.complete') then
    perform app.fail('FORBIDDEN', 'You cannot complete projects.');
  end if;
  v_item := app.item_lock(item_mark_done_and_complete.item_id);
  select p.* into v_project from public.projects p where p.id = v_item.project_id;
  if v_project.recurrence <> 'one_time' then
    perform app.fail('VALIDATION', 'Only a one-time project is completed with its last deliverable.');
  end if;
  perform public.item_mark_done(v_item.id);
  return public.project_complete(v_project.id);
end;
$$;
revoke all on function public.item_mark_done_and_complete(uuid) from public, anon;
grant execute on function public.item_mark_done_and_complete(uuid) to authenticated, service_role;
comment on function public.item_mark_done_and_complete(uuid) is
  'v2.1 (R1): marks a one-time project''s last open deliverable done and completes the project in one transaction (items.tick and projects.complete; the Owner or the client''s Admin). Nothing is marked if the project cannot be completed.';
