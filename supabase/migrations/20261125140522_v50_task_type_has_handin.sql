-- v5.0 "Has hand-in" (owner 25 Nov 2026, option b, via the advisor on #89): a per-task-type setting
-- in Settings → Task types (Owner-managed, like the type's other fields). Only a task whose type has
-- it on shows the Hand-in card and takes files; files stay optional for Mark done. Existing types
-- start ON (the column's default fills every existing row) and new types default ON too; the Owner
-- switches it off for meetings, calls and site visits.
--
-- Expand-only: one column with a default, one helper, and two functions re-created with one more
-- check (20261125131800 is pushed and applied to staging, so it is never edited). The column is
-- edited through the existing task_types policies and owner guard (settings.manage) and audited by
-- the table's audit_row_change trigger.

alter table public.task_types add column has_handin boolean not null default true;
comment on column public.task_types.has_handin is
  'v5.0: tasks of this type take hand-in files (the Hand-in card, handin_file_start). Default on; '
  'the Owner turns it off for types with nothing to hand in (meetings, calls, site visits). Files '
  'are never required for Mark done.';
-- Edited like the type's other fields: a column grant (authenticated holds UPDATE per column only);
-- the update policy and app.task_types_owner_guard still require settings.manage (the Owner).
grant update (has_handin) on public.task_types to authenticated;

-- The task's type takes a hand-in (false for a task that does not exist).
create function app.task_type_has_handin(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select tt.has_handin from public.tasks t join public.task_types tt on tt.id = t.task_type_id
    where t.id = p_task_id), false);
$$;
revoke all on function app.task_type_has_handin(uuid) from public, anon;
grant execute on function app.task_type_has_handin(uuid) to authenticated, service_role;
comment on function app.task_type_has_handin(uuid) is
  'v5.0: the task''s type has has_handin on. Read by app.handin_can_add and handin_file_start.';

-- handin_can_add: as 20261125131800, and the type must take a hand-in.
create or replace function app.handin_can_add(p_task_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me public.members;
begin
  select m.* into v_me from app.current_member() m;
  if v_me.id is null or v_me.engagement <> 'permanent' or not app.has_permission('tasks.work') then
    return false;
  end if;
  if not app.task_type_has_handin(p_task_id) then
    return false;
  end if;
  return app.is_task_assignee(p_task_id, v_me.id) or exists (
    select 1 from public.task_assignees a join public.members f on f.id = a.member_id
    where a.task_id = p_task_id and a.removed_at is null and f.engagement = 'freelance'
      and f.status = 'active' and app.coordinator_of(f.id) = v_me.id);
end;
$$;
revoke all on function app.handin_can_add(uuid) from public, anon;
grant execute on function app.handin_can_add(uuid) to authenticated, service_role;

-- handin_file_start: as 20261125131800, refusing a task whose type takes no hand-in.
create or replace function public.handin_file_start(
  p_task_id uuid, p_name text, p_relative_path text, p_size_bytes bigint,
  p_mime_hint text default null, p_on_behalf_of uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_subject uuid;
  v_org uuid;
  v_task public.tasks;
  v_drive public.drive_account;
  v_name text := app.handin_clean_name(p_name);
  v_path text := app.handin_clean_path(p_relative_path);
  v_mime text := nullif(left(btrim(coalesce(p_mime_hint, '')), 100), '');
  v_version integer;
  v_row public.handin_files;
  v_free bigint;
  v_owner uuid;
begin
  select a.actor_id, a.subject_id, a.org_id into v_actor, v_subject, v_org
  from app.task_actor(p_task_id, p_on_behalf_of) a;
  v_task := app.task_lock(p_task_id, v_org);
  if v_task.state not in ('todo', 'in_progress', 'changes_requested') or v_task.archived_at is not null then
    perform app.fail('INVALID_STATE', 'Files can be added only while the task is open.');
  end if;
  -- v5.0 "Has hand-in" (owner 25 Nov 2026): only a task whose type takes a hand-in takes files.
  if not app.task_type_has_handin(p_task_id) then
    perform app.fail('INVALID_STATE', 'This type of task takes no hand-in files.');
  end if;
  select d.* into v_drive from public.drive_account d where d.org_id = v_org;
  if v_drive.org_id is null or v_drive.state <> 'connected' then
    perform app.fail('INVALID_STATE', 'Handing in files is off until the Owner reconnects Google Drive.');
  end if;
  if v_name is null then
    perform app.fail('VALIDATION', 'This file has no usable name.');
  end if;
  if p_size_bytes is null or p_size_bytes < 0 then
    perform app.fail('VALIDATION', 'This file''s size is unknown.');
  end if;
  v_version := app.handin_open_version(v_task.id);

  -- Already added (any adder): the same folder, name and size in this version.
  select h.* into v_row from public.handin_files h
  where h.task_id = v_task.id and h.version = v_version and h.state = 'done'
    and h.relative_path = v_path and h.name = v_name and h.size_bytes = p_size_bytes
  limit 1;
  if v_row.id is not null then
    return jsonb_build_object('outcome', 'already_added', 'file_id', v_row.id, 'version', v_version);
  end if;

  -- The same person's earlier try of this file, still on its way or failed: carry on with it.
  select h.* into v_row from public.handin_files h
  where h.task_id = v_task.id and h.version = v_version and h.added_by = v_actor
    and h.on_behalf_of is not distinct from p_on_behalf_of and h.state in ('uploading', 'failed')
    and h.relative_path = v_path and h.name = v_name and h.size_bytes = p_size_bytes
    and h.account_sub = v_drive.google_sub
  order by h.created_at desc limit 1
  for update;
  if v_row.id is not null then
    update public.handin_files
    set state = 'uploading', failed_reason = null, updated_at = now()
    where id = v_row.id;
    return jsonb_build_object('outcome', 'resume', 'file_id', v_row.id, 'version', v_version,
      'has_session', v_row.session_uri_encrypted is not null, 'name', v_name, 'relative_path', v_path,
      'size', p_size_bytes);
  end if;

  if (select count(*) from public.handin_files h
      where h.task_id = v_task.id and h.added_by = v_actor and h.state = 'uploading') >= 6 then
    return jsonb_build_object('outcome', 'wait', 'seconds', 5, 'version', v_version);
  end if;
  if (select count(*) from public.handin_files h
      where h.task_id = v_task.id and h.version = v_version and h.state <> 'left_out') >= 2000 then
    perform app.fail('VALIDATION', 'A hand-in holds at most 2,000 files.');
  end if;

  -- The space guard (v4.5 Q11): 10 GB kept free, and what is still on its way counts.
  if v_drive.quota_total_bytes is not null and v_drive.quota_used_bytes is not null then
    v_free := v_drive.quota_total_bytes - v_drive.quota_used_bytes - 10::bigint * 1024 * 1024 * 1024
      - coalesce((select sum(greatest(h.size_bytes - h.bytes_at_google, 0)) from public.handin_files h
                  where h.org_id = v_org and h.state = 'uploading'), 0);
    if p_size_bytes > v_free then
      v_owner := app.org_owner_id(v_org);
      if not exists (select 1 from public.notifications n
                     where n.recipient_id = v_owner and n.kind = 'handin_space_held'
                       and n.created_at >= (app.today_ist()::timestamp at time zone 'Asia/Kolkata')) then
        perform app.notify(array[v_owner], 'handin_space_held', 'Studio Drive too full for a hand-in',
          format('%s couldn''t add a file to %s. Free up space in the studio''s Google Drive.',
                 app.member_name(v_subject), v_task.title),
          '/tasks/' || v_task.id, 'tasks', v_task.id, jsonb_build_object('task_id', v_task.id), v_actor);
      end if;
      return jsonb_build_object('outcome', 'space_full', 'version', v_version);
    end if;
  end if;

  insert into public.handin_files (org_id, task_id, version, added_by, on_behalf_of, name, relative_path,
                                   size_bytes, mime_hint, state, account_sub)
  values (v_org, v_task.id, v_version, v_actor, p_on_behalf_of, v_name, v_path, p_size_bytes, v_mime,
          'uploading', v_drive.google_sub)
  returning * into v_row;
  return jsonb_build_object('outcome', 'start', 'file_id', v_row.id, 'version', v_version, 'has_session', false,
    'name', v_name, 'relative_path', v_path, 'size', p_size_bytes);
end;
$$;
revoke all on function public.handin_file_start(uuid, text, text, bigint, text, uuid) from public, anon;
grant execute on function public.handin_file_start(uuid, text, text, bigint, text, uuid) to authenticated, service_role;
comment on function public.handin_file_start(uuid, text, text, bigint, text, uuid) is
  'v5.0: the caller (app.task_actor: an assignee, or a freelancer assignee''s coordinator) adds one file '
  'to the task''s open version while the task is open and Drive is connected. Outcomes: already_added '
  '(the same path, name and size is in Drive for this version, whoever added it), resume (the caller''s '
  'own earlier try), wait (6 already uploading), space_full (the Owner told once a IST day), start. The '
  'Worker then makes the folders and opens the Google session (service role).';
