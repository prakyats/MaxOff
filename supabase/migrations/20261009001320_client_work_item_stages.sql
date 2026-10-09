-- Unit 7B rework, amendment D (owner 2026-10-09; PROGRESS "Kickoff 7 decisions", WORKFLOWS §5,
-- DATA-MODEL §5). EXPAND-ONLY: one new table, one new column, new functions and create or replace of
-- existing ones, one notification kind, one policy widened. Nothing is dropped or renamed; the old
-- tick table (`project_item_stages`) and the item_approve / item_reject / item_tick_stage functions
-- stay in place, unused by the app. Append-only: never edit once applied.
--
-- D1  Stages are optional: a project or an item may have none (as before: an item with none is
--     simply open or done).
-- D2  Stages are per item: `project_item_stage_list` holds each item's own stages (name, position,
--     archived_at, and the tick on the row: done_at / done_by). At most 12 active per item. A project's
--     `project_stages` are its DEFAULTS: what a new item starts with; changing them never touches an
--     existing item. A recurring project's item-list lines carry their own stages
--     (`project_item_blueprints.stages`), copied into each new cycle's items. A carry forward takes the
--     item's active stages with their ticks. Removing a stage from an item archives it (its tick stays
--     in the row and the history). Staging's existing items are backfilled from their project's
--     stages and ticks (production holds no phase-7 data).
-- D3  Done = approved: `item_mark_done` (items.tick: the Owner, the client's Admin) moves open ->
--     approved in one step, stamping done_* and approved_* (the `done` state is no longer entered; it
--     counts for revenue at once, invariant 3). `item_reopen` (items.approve: the Owner on any client,
--     the client's Admin on theirs) takes a done item back to open with a reason, an item_reviews
--     rejection row and the audit; the Owner's send-back tells the client's Admin (item_rejected,
--     actionable), the Admin's reopen tells the Owner (item_reopened, info). Ticks stay locked on a
--     done item; title and notes stay editable (Q5).
-- Activity panel: `project_activity` pages a project's (or one item's) history newest first by
-- keyset, under the caller's RLS, skipping entries that carry only internal keys.

-- 1. The item's own stages -------------------------------------------------------------------------------
create table public.project_item_stage_list (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id),
  project_id uuid not null references public.projects (id),
  item_id uuid not null references public.project_items (id),
  name text not null check (length(btrim(name)) between 1 and 120),
  position text not null check (position ~ '^[0-9a-z]{1,64}$'),
  archived_at timestamptz null,
  done_at timestamptz null,
  done_by uuid null references public.members (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_item_stage_list_done_pair check ((done_at is null) = (done_by is null))
);
comment on table public.project_item_stage_list is
  'Amendment D2 (owner 2026-10-09): an item''s own stages, in order, with the tick on the row '
  '(done_at / done_by; an untick clears them, the history keeps both). At most 12 active per item; a '
  'removed stage is archived (archived_at), its tick kept. A new item starts with its project''s '
  'default stages (project_stages) or, from an item list, its line''s stages; a carried item takes '
  'the original''s active stages and ticks. Written only by the item_stage_* functions and the '
  'functions that create items (no API write). Audited (entity_id = the item).';
create index project_item_stage_list_item_idx on public.project_item_stage_list (item_id, position);
create index project_item_stage_list_project_idx on public.project_item_stage_list (project_id);
create index project_item_stage_list_org_idx on public.project_item_stage_list (org_id);
create index project_item_stage_list_done_by_idx on public.project_item_stage_list (done_by);

create trigger set_updated_at before update on public.project_item_stage_list
  for each row execute function app.set_updated_at();

alter table public.project_item_stage_list enable row level security;
-- The item's own rule (7A review S3): whoever sees the item's project, under projects' own RLS.
create policy project_item_stage_list_select on public.project_item_stage_list for select to authenticated
  using (project_id in (select p.id from public.projects p));
revoke all on public.project_item_stage_list from anon;
revoke all on public.project_item_stage_list from authenticated;
grant select on public.project_item_stage_list to authenticated;

-- 2. The item list's lines carry their stages -------------------------------------------------------------
alter table public.project_item_blueprints add column stages text[] not null default '{}';
comment on column public.project_item_blueprints.stages is
  'Amendment D2: the stages each item made from this line starts with, in order (at most 12, each '
  '1..120 characters). A new line starts with the project''s default stages; edited through '
  'project_blueprint_update (changes.stages). Copied into each new cycle''s items; a change never '
  'touches an existing item.';

-- 3. Backfill (staging only: production has no phase-7 rows). Before the audit trigger exists, so the
-- history gains no invented entries; the blueprint backfill likewise runs with its audit trigger off.
alter table public.project_item_blueprints disable trigger audit_row_change;
update public.project_item_blueprints b
set stages = coalesce((
  select array_agg(s.name order by s.position collate "C")
  from public.project_stages s
  where s.project_id = b.project_id and s.archived_at is null), '{}');
alter table public.project_item_blueprints enable trigger audit_row_change;
alter table public.project_item_blueprints add constraint project_item_blueprints_stages_max
  check (cardinality(stages) <= 12);

-- Every item takes its project's stages as they stood: the active ones, plus a removed one the item
-- had a tick row for (archived with it, the tick kept).
insert into public.project_item_stage_list (org_id, project_id, item_id, name, position, archived_at, done_at, done_by)
select i.org_id, i.project_id, i.id, s.name, s.position,
       s.archived_at, t.done_at, t.done_by
from public.project_items i
join public.project_stages s on s.project_id = i.project_id
left join public.project_item_stages t on t.item_id = i.id and t.stage_id = s.id
where s.archived_at is null or t.item_id is not null;

create trigger audit_row_change after insert or update or delete on public.project_item_stage_list
  for each row execute function app.audit_row_change('item_id');

-- The history of an item's stages joins its item's (PERMISSIONS §2 "Activity log").
alter policy activity_log_select_client_work on public.activity_log
  using (org_id = (select m.org_id from app.current_member() m)
         and ((entity in ('projects', 'project_stages', 'project_item_blueprints', 'project_cycles')
               and entity_id in (select p.id from public.projects p))
              or (entity in ('project_items', 'project_item_stages', 'item_reviews', 'project_item_stage_list')
                  and entity_id in (select i.id from public.project_items i))));

-- 4. Notification kind (WORKFLOWS §9): the client's Admin reopened a done item -> the Owner (info).
insert into public.notification_kinds (kind, actionable, always_email, in_app, description) values
  ('item_reopened', false, false, true, 'The client''s Admin reopened a done item, with the reason (the Owner)');

-- 5. Helpers ------------------------------------------------------------------------------------------------
-- The project's default stages, in order (amendment D2: what a new item starts with).
create function app.project_default_stages(p_project_id uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(s.name order by s.position collate "C"), '{}')
  from public.project_stages s
  where s.project_id = p_project_id and s.archived_at is null;
$$;

-- A list of stage names, checked: at most 12, each 1..120 characters once trimmed.
create function app.client_work_stage_names(p_names text[])
returns text[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_name text;
  v_out text[] := '{}';
begin
  if cardinality(coalesce(p_names, '{}')) > 12 then
    perform app.fail('VALIDATION', 'An item has at most 12 stages.');
  end if;
  foreach v_name in array coalesce(p_names, '{}') loop
    v_out := v_out || app.client_work_text(v_name, 120, 'Each stage needs a name of up to 120 characters.');
  end loop;
  return v_out;
end;
$$;

-- A new item's stages, in the order given. Each row is audited 'initial' (the history shows the
-- item's creation, not each stage it started with).
create function app.item_stage_list_init(p_item_id uuid, p_names text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.project_items;
  v_name text;
  v_position text := null;
begin
  select i.* into v_item from public.project_items i where i.id = p_item_id;
  foreach v_name in array app.client_work_stage_names(p_names) loop
    v_position := app.client_work_next_position(v_position);
    perform set_config('app.audit_override', jsonb_build_object('action', 'initial')::text, true);
    insert into public.project_item_stage_list (org_id, project_id, item_id, name, position)
    values (v_item.org_id, v_item.project_id, v_item.id, v_name, v_position);
  end loop;
end;
$$;

-- A carried item's stages: the original's active ones with their ticks (decision 12, amendment D2).
create function app.item_stage_list_copy(p_from_item_id uuid, p_to_item_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_to public.project_items;
  v_stage public.project_item_stage_list;
begin
  select i.* into v_to from public.project_items i where i.id = p_to_item_id;
  for v_stage in
    select s.* from public.project_item_stage_list s
    where s.item_id = p_from_item_id and s.archived_at is null
    order by s.position collate "C"
  loop
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'initial', 'meta', jsonb_build_object('carried_from_item_id', p_from_item_id))::text, true);
    insert into public.project_item_stage_list (org_id, project_id, item_id, name, position, done_at, done_by)
    values (v_to.org_id, v_to.project_id, v_to.id, v_stage.name, v_stage.position, v_stage.done_at, v_stage.done_by);
  end loop;
end;
$$;

revoke all on function app.project_default_stages(uuid), app.client_work_stage_names(text[]),
  app.item_stage_list_init(uuid, text[]), app.item_stage_list_copy(uuid, uuid) from public, authenticated;
grant execute on function app.project_default_stages(uuid), app.client_work_stage_names(text[]),
  app.item_stage_list_init(uuid, text[]), app.item_stage_list_copy(uuid, uuid) to service_role;

comment on function app.project_default_stages(uuid) is
  'Internal (amendment D2): the project''s active default stages (project_stages), in order.';
comment on function app.client_work_stage_names(text[]) is
  'Internal (amendment D2): stage names checked (at most 12, each 1..120 characters trimmed), VALIDATION otherwise.';
comment on function app.item_stage_list_init(uuid, text[]) is
  'Internal (amendment D2): a new item''s own stages in the given order, each audited ''initial''.';
comment on function app.item_stage_list_copy(uuid, uuid) is
  'Internal (amendment D2, decision 12): a carried item takes the original''s active stages with '
  'their ticks (original times and people), audited ''initial'' with meta carried_from_item_id.';

-- 6. New items start with their stages -----------------------------------------------------------------------
create or replace function app.cycle_create(p_project public.projects, p_start date, p_generated_by text, p_actor uuid,
                                            p_copy_list boolean)
returns public.project_cycles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cycle public.project_cycles;
  v_earlier uuid;
  v_line public.project_item_blueprints;
  v_item_id uuid;
begin
  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'generated', 'meta', jsonb_build_object('generated_by', p_generated_by, 'item_list', p_copy_list))::text, true);
  insert into public.project_cycles (org_id, project_id, period_start, period_end, label, generated_by, created_by,
                                     item_list_copied)
  values (
    p_project.org_id, p_project.id, p_start,
    case when p_start is null then null else app.period_end(p_project.recurrence, p_start) end,
    case when p_start is null then null else app.cycle_label(p_project.recurrence, p_start) end,
    p_generated_by, p_actor, coalesce(p_copy_list, true))
  returning * into v_cycle;

  if coalesce(p_copy_list, true) then
    -- Amendment D2: each line's own stages go with its item.
    for v_line in
      select b.* from public.project_item_blueprints b
      where b.project_id = p_project.id and b.archived_at is null
      order by b.position collate "C"
    loop
      insert into public.project_items (org_id, project_id, cycle_id, title, position, origin_cycle_id, created_by)
      values (p_project.org_id, p_project.id, v_cycle.id, v_line.title, v_line.position, v_cycle.id, p_actor)
      returning id into v_item_id;
      perform app.item_stage_list_init(v_item_id, v_line.stages);
    end loop;
  end if;

  if p_start is not null then
    for v_earlier in
      select c.id from public.project_cycles c
      where c.project_id = p_project.id and c.period_start < p_start and c.state = 'open'
    loop
      perform app.cycle_refresh(v_earlier);
    end loop;
  end if;
  return v_cycle;
end;
$$;

create or replace function app.cycle_copy_item_list(p_project public.projects, p_cycle_id uuid, p_actor uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line public.project_item_blueprints;
  v_last text;
  v_room integer := 100 - app.cycle_live_items(p_cycle_id);
  v_count integer := 0;
  v_item_id uuid;
begin
  select max(i.position collate "C") into v_last from public.project_items i where i.cycle_id = p_cycle_id;
  for v_line in
    select b.* from public.project_item_blueprints b
    where b.project_id = p_project.id and b.archived_at is null
    order by b.position collate "C"
  loop
    exit when v_count >= v_room;
    v_last := app.client_work_next_position(v_last);
    insert into public.project_items (org_id, project_id, cycle_id, title, position, origin_cycle_id, created_by)
    values (p_project.org_id, p_project.id, p_cycle_id, v_line.title, v_last, p_cycle_id, p_actor)
    returning id into v_item_id;
    perform app.item_stage_list_init(v_item_id, v_line.stages);
    v_count := v_count + 1;
  end loop;
  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'item_list_added', 'meta', jsonb_build_object('items', v_count))::text, true);
  update public.project_cycles set item_list_copied = true where id = p_cycle_id;
  perform app.cycle_refresh(p_cycle_id);
  return v_count;
end;
$$;

comment on function app.cycle_create(public.projects, date, text, uuid, boolean) is
  'Internal (7.2; Q4 (a); amendment D2): a new cycle for a locked project (p_start null for '
  'one-time), its label, the active item list copied in as open items when p_copy_list, each item '
  'with its line''s stages (item_list_copied records it), and the earlier open cycles re-checked. '
  'Audited ''generated'' with meta generated_by and item_list.';
comment on function app.cycle_copy_item_list(public.projects, uuid, uuid) is
  'Internal (Q4 (a); amendment D2): the active item list into a cycle that holds none of it yet, '
  'after its items, in the list''s order, each with its line''s stages, up to 100 live items; '
  'item_list_copied set (audited ''item_list_added''), the cycle re-checked. Returns the items added.';

-- 7. project_create, item_add and the item list: new items and lines start with the defaults -----------------
create or replace function public.project_create(
  client_id uuid,
  name text,
  recurrence public.recurrence,
  description text default null,
  delivery_date date default null,
  stages text[] default '{}',
  items text[] default '{}',
  template_id uuid default null,
  custom_fields jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_client public.clients;
  v_name text;
  v_description text;
  v_project public.projects;
  v_cycle public.project_cycles;
  v_text text;
  v_position text := null;
  v_stages text[] := coalesce(project_create.stages, '{}');
  v_items text[] := coalesce(project_create.items, '{}');
  v_item_id uuid;
begin
  v_caller := app.client_work_caller('projects.manage', 'You cannot create projects.');
  select c.* into v_client from public.clients c
  where c.id = project_create.client_id and c.org_id = v_caller.org_id
  for share;
  if v_client.id is null or not app.client_visible(v_client.id) then
    perform app.fail('NOT_FOUND', 'This client is not one of yours.');
  end if;
  -- Decision 1: a Draft, Active or Paused client; an Inactive one takes no new projects (§4).
  if v_client.state = 'inactive' then
    perform app.fail('INVALID_STATE', format('%s is closed, so it takes no new projects.', v_client.name));
  end if;
  if project_create.recurrence is null then
    perform app.fail('VALIDATION', 'Choose how often this project repeats.');
  end if;
  v_name := app.client_work_text(project_create.name, 120, 'Give the project a name of up to 120 characters.');
  v_description := app.client_work_text(project_create.description, 5000, 'Keep the description under 5000 characters.', false);
  -- Amendment A: a one-time project needs its delivery date; a weekly or monthly one has none.
  if project_create.recurrence = 'one_time' and project_create.delivery_date is null then
    perform app.fail('VALIDATION', 'A one-time project needs a delivery date.');
  end if;
  if project_create.recurrence <> 'one_time' and project_create.delivery_date is not null then
    perform app.fail('VALIDATION', 'A weekly or monthly project has no delivery date.');
  end if;
  if cardinality(v_stages) > 12 then
    perform app.fail('VALIDATION', 'A project has at most 12 stages.');
  end if;
  if cardinality(v_items) > 100 then
    perform app.fail('VALIDATION', 'A cycle holds at most 100 items.');
  end if;
  if project_create.template_id is not null and not exists (
    select 1 from public.project_templates t
    where t.id = project_create.template_id and t.org_id = v_caller.org_id and t.archived_at is null
  ) then
    perform app.fail('VALIDATION', 'Choose a template from the list.');
  end if;

  begin
    insert into public.projects (
      org_id, client_id, name, description, recurrence, delivery_date, template_id, custom_fields, created_by)
    values (
      v_caller.org_id, v_client.id, v_name, v_description, project_create.recurrence,
      project_create.delivery_date, project_create.template_id,
      coalesce(project_create.custom_fields, '{}'::jsonb), v_caller.id)
    returning * into v_project;
  exception when unique_violation then
    perform app.fail('CONFLICT', format('%s already has an open project called %s.', v_client.name, v_name));
  end;

  foreach v_text in array v_stages loop
    v_position := app.client_work_next_position(v_position);
    insert into public.project_stages (org_id, project_id, name, position)
    values (v_caller.org_id, v_project.id,
            app.client_work_text(v_text, 120, 'Each stage needs a name of up to 120 characters.'), v_position);
  end loop;

  v_position := null;
  if v_project.recurrence = 'one_time' then
    -- A one-time project's single cycle, whatever the client's state (decision 1); its items go
    -- straight into it.
    v_cycle := app.cycle_create(v_project, null, 'create', v_caller.id);
    foreach v_text in array v_items loop
      v_position := app.client_work_next_position(v_position);
      insert into public.project_items (org_id, project_id, cycle_id, title, position, origin_cycle_id, created_by)
      values (v_caller.org_id, v_project.id, v_cycle.id,
              app.client_work_text(v_text, 200, 'Each item needs a title of up to 200 characters.'),
              v_position, v_cycle.id, v_caller.id)
      returning id into v_item_id;
      -- Amendment D2: each item starts with the project's default stages.
      perform app.item_stage_list_init(v_item_id, app.project_default_stages(v_project.id));
    end loop;
  else
    foreach v_text in array v_items loop
      v_position := app.client_work_next_position(v_position);
      -- Amendment D2: each line of the item list carries its own stages, the defaults to start.
      insert into public.project_item_blueprints (org_id, project_id, title, position, stages)
      values (v_caller.org_id, v_project.id,
              app.client_work_text(v_text, 200, 'Each item needs a title of up to 200 characters.'), v_position,
              app.project_default_stages(v_project.id));
    end loop;
    -- WORKFLOWS §5.2: the current period's cycle at once, while the client is Active (decision 1);
    -- otherwise from the first night it is (cycle_generate).
    if v_client.state = 'active' then
      perform app.cycle_create(v_project, app.period_start(v_project.recurrence, app.today_ist()), 'create', v_caller.id);
    end if;
  end if;

  -- WORKFLOWS §9 "Project created by an Admin": the Owner (info), never an amount. The Owner's own
  -- project tells nobody (the actor is dropped).
  perform app.notify(array[app.org_owner_id(v_caller.org_id)], 'project_created',
    format('%s added the project %s for %s', v_caller.full_name, v_name, v_client.name),
    'Set the amount and billing category.',
    app.project_link(v_project), 'projects', v_project.id,
    jsonb_build_object('project_id', v_project.id, 'client_id', v_client.id), v_caller.id);
  return v_project.id;
end;
$$;

comment on function public.project_create(uuid, text, public.recurrence, text, date, text[], text[], uuid, jsonb) is
  '7.2 (WORKFLOWS §5.2, §5.4 items 1, 4, 5, 19; amendments A, C, D): projects.manage on a client the '
  'caller may see, Draft, Active or Paused (Inactive: INVALID_STATE). The name is unique per client '
  'among open and in-progress projects (CONFLICT). stages are the project''s DEFAULT stages (none '
  'allowed, at most 12, D1/D2). One-time: delivery_date required, its single cycle created now with '
  'the items in it, each starting with the default stages. Weekly / monthly: no delivery date; items '
  'become the item list, each line carrying the default stages, and the current period''s cycle is '
  'created now when the client is Active. Items <= 100. Notifies the Owner when an Admin creates it '
  '(project_created, info).';

create or replace function public.item_add(
  cycle_id uuid,
  title text,
  planned_date date default null,
  notes text default null,
  custom_fields jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_cycle public.project_cycles;
  v_project public.projects;
  v_client public.clients;
  v_last text;
  v_id uuid;
begin
  v_caller := app.client_work_caller('projects.manage', 'You cannot add items.');
  select c.* into v_cycle from public.project_cycles c
  where c.id = item_add.cycle_id and c.org_id = v_caller.org_id;
  if v_cycle.id is null then
    perform app.fail('NOT_FOUND', 'This cycle is not one of yours.');
  end if;
  v_project := app.project_lock(v_cycle.project_id);
  perform app.project_check_writable(v_project);
  v_client := app.project_client(v_project);
  if v_client.state = 'inactive' then
    perform app.fail('INVALID_STATE', format('%s is closed, so it takes no new items.', v_client.name));
  end if;
  -- Decision 9: never into a past cycle (a one-time project's single cycle always takes them).
  if v_cycle.period_end is not null and v_cycle.period_end < app.today_ist() then
    perform app.fail('INVALID_STATE', format('%s has ended: add the item to the current cycle.', v_cycle.label));
  end if;
  if app.cycle_live_items(v_cycle.id) >= 100 then
    perform app.fail('VALIDATION', 'A cycle holds at most 100 items.');
  end if;
  select max(i.position collate "C") into v_last from public.project_items i where i.cycle_id = v_cycle.id;
  insert into public.project_items (
    org_id, project_id, cycle_id, title, position, planned_date, notes, custom_fields, origin_cycle_id, created_by)
  values (
    v_project.org_id, v_project.id, v_cycle.id,
    app.client_work_text(item_add.title, 200, 'Give the item a title of up to 200 characters.'),
    app.client_work_next_position(v_last), item_add.planned_date,
    app.client_work_text(item_add.notes, 5000, 'Keep the notes under 5000 characters.', false),
    coalesce(item_add.custom_fields, '{}'::jsonb), v_cycle.id, v_caller.id)
  returning id into v_id;
  -- Amendment D2: a new item starts with the project's default stages.
  perform app.item_stage_list_init(v_id, app.project_default_stages(v_project.id));
  perform app.cycle_refresh(v_cycle.id);
  return v_id;
end;
$$;

comment on function public.item_add(uuid, text, date, text, jsonb) is
  '7.2 (WORKFLOWS §5.4 items 9, 10; amendment D2): projects.manage on the caller''s clients; a new '
  'open item at the end of a cycle whose period has not ended (a one-time project''s single cycle '
  'always), the project open or in progress and the client not Inactive; at most 100 live items per '
  'cycle; it starts with the project''s default stages. planned_date any date. Returns its id.';

create or replace function public.project_blueprint_add(project_id uuid, title text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_project public.projects;
  v_last text;
  v_id uuid;
begin
  v_caller := app.client_work_caller('projects.manage', 'You cannot edit projects.');
  v_project := app.project_lock(project_blueprint_add.project_id);
  perform app.project_check_writable(v_project);
  if v_project.recurrence = 'one_time' then
    perform app.fail('VALIDATION', 'A one-time project has no item list: add the item to its cycle.');
  end if;
  if (select count(*) from public.project_item_blueprints b
      where b.project_id = v_project.id and b.archived_at is null) >= 100 then
    perform app.fail('VALIDATION', 'The item list holds at most 100 items.');
  end if;
  select max(b.position collate "C") into v_last from public.project_item_blueprints b where b.project_id = v_project.id;
  insert into public.project_item_blueprints (org_id, project_id, title, position, stages)
  values (v_project.org_id, v_project.id,
          app.client_work_text(project_blueprint_add.title, 200, 'Give the item a title of up to 200 characters.'),
          app.client_work_next_position(v_last), app.project_default_stages(v_project.id))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.project_blueprint_update(blueprint_id uuid, changes jsonb)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_row public.project_item_blueprints;
  v_project public.projects;
  v_key text;
  v_title text;
  v_position text;
  v_stages text[];
  v_changed text[] := '{}';
begin
  v_caller := app.client_work_caller('projects.manage', 'You cannot edit projects.');
  select b.* into v_row from public.project_item_blueprints b
  where b.id = project_blueprint_update.blueprint_id and b.org_id = v_caller.org_id;
  if v_row.id is null then
    perform app.fail('NOT_FOUND', 'This item is gone from the list.');
  end if;
  v_project := app.project_lock(v_row.project_id);
  perform app.project_check_writable(v_project);
  select b.* into v_row from public.project_item_blueprints b where b.id = v_row.id for update;
  if v_row.archived_at is not null then
    perform app.fail('INVALID_STATE', 'This item was removed from the list.');
  end if;
  if changes is null or jsonb_typeof(changes) <> 'object' then
    perform app.fail('VALIDATION', 'Nothing to change.');
  end if;
  for v_key in select jsonb_object_keys(changes) loop
    if v_key not in ('title', 'position', 'stages') then
      perform app.fail('VALIDATION', format('"%s" is not a list detail that can change.', v_key));
    end if;
  end loop;
  v_title := case when changes ? 'title'
    then app.client_work_text(changes ->> 'title', 200, 'Give the item a title of up to 200 characters.')
    else v_row.title end;
  v_position := case when changes ? 'position' then app.client_work_position(changes ->> 'position') else v_row.position end;
  v_stages := v_row.stages;
  if changes ? 'stages' then
    if jsonb_typeof(changes -> 'stages') <> 'array'
       or exists (select 1 from jsonb_array_elements(changes -> 'stages') e where jsonb_typeof(e) <> 'string') then
      perform app.fail('VALIDATION', 'Stages are a list of names.');
    end if;
    v_stages := app.client_work_stage_names(array(select jsonb_array_elements_text(changes -> 'stages')));
  end if;
  if v_title is distinct from v_row.title then v_changed := array_append(v_changed, 'title'); end if;
  if v_position is distinct from v_row.position then v_changed := array_append(v_changed, 'position'); end if;
  if v_stages is distinct from v_row.stages then v_changed := array_append(v_changed, 'stages'); end if;
  if cardinality(v_changed) > 0 then
    update public.project_item_blueprints set title = v_title, position = v_position, stages = v_stages
    where id = v_row.id;
  end if;
  return v_changed;
end;
$$;

comment on function public.project_blueprint_add(uuid, text) is
  '7.2 (WORKFLOWS §5.4 item 9; amendment D2): projects.manage; a recurring project''s item list gains '
  'an entry at the end (at most 100 active), carrying the project''s default stages. Feeds later '
  'cycles only: no existing cycle changes.';
comment on function public.project_blueprint_update(uuid, jsonb) is
  '7.2 (decision 9; amendment D2): rename or reorder an entry of the item list, or set its stages '
  '(changes: title, position, stages = a list of names, at most 12). Later cycles only. Returns the '
  'changed keys.';

-- 8. An item's own stages (amendment D2) ------------------------------------------------------------------------
-- The item and its project, locked, the project writable and the item still open (or a done item
-- from before amendment D: its structure was editable then). Structure: projects.manage.
create function app.item_stage_item(p_item_id uuid)
returns public.project_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.project_items;
  v_project public.projects;
begin
  v_item := app.item_lock(p_item_id);
  select p.* into v_project from public.projects p where p.id = v_item.project_id;
  perform app.project_check_writable(v_project);
  if v_item.state not in ('open', 'done') then
    perform app.fail('INVALID_STATE', format('This item is %s, so its stages are locked.', v_item.state));
  end if;
  return v_item;
end;
$$;

-- A stage of the caller's organization, then its item locked (NOT_FOUND for another Admin's).
create function app.item_stage_find(p_stage_id uuid)
returns public.project_item_stage_list
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stage public.project_item_stage_list;
begin
  select s.* into v_stage from public.project_item_stage_list s
  where s.id = p_stage_id and s.org_id = (select m.org_id from app.current_member() m);
  if v_stage.id is null then
    perform app.fail('NOT_FOUND', 'This stage is gone.');
  end if;
  return v_stage;
end;
$$;

-- No two active stages of one item share a name (case-insensitive): "Tick ‹stage› on N" finds one.
create function app.item_stage_name_free(p_item_id uuid, p_name text, p_except uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.project_item_stage_list s
             where s.item_id = p_item_id and s.archived_at is null and s.id is distinct from p_except
               and lower(s.name) = lower(p_name)) then
    perform app.fail('CONFLICT', format('This item already has a stage called %s.', p_name));
  end if;
end;
$$;

revoke all on function app.item_stage_item(uuid), app.item_stage_find(uuid),
  app.item_stage_name_free(uuid, text, uuid) from public, authenticated;
grant execute on function app.item_stage_item(uuid), app.item_stage_find(uuid),
  app.item_stage_name_free(uuid, text, uuid) to service_role;

create function public.item_stage_add(item_id uuid, name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_item public.project_items;
  v_name text;
  v_last text;
  v_id uuid;
begin
  v_caller := app.client_work_caller('projects.manage', 'You cannot edit items.');
  v_item := app.item_stage_item(item_stage_add.item_id);
  if (select count(*) from public.project_item_stage_list s
      where s.item_id = v_item.id and s.archived_at is null) >= 12 then
    perform app.fail('VALIDATION', 'An item has at most 12 stages.');
  end if;
  v_name := app.client_work_text(item_stage_add.name, 120, 'Give the stage a name of up to 120 characters.');
  perform app.item_stage_name_free(v_item.id, v_name, null);
  select max(s.position collate "C") into v_last from public.project_item_stage_list s where s.item_id = v_item.id;
  insert into public.project_item_stage_list (org_id, project_id, item_id, name, position)
  values (v_item.org_id, v_item.project_id, v_item.id, v_name, app.client_work_next_position(v_last))
  returning id into v_id;
  return v_id;
end;
$$;

create function public.item_stage_update(stage_id uuid, changes jsonb)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_stage public.project_item_stage_list;
  v_key text;
  v_name text;
  v_position text;
  v_changed text[] := '{}';
begin
  v_caller := app.client_work_caller('projects.manage', 'You cannot edit items.');
  v_stage := app.item_stage_find(item_stage_update.stage_id);
  perform app.item_stage_item(v_stage.item_id);
  select s.* into v_stage from public.project_item_stage_list s where s.id = v_stage.id for update;
  if v_stage.archived_at is not null then
    perform app.fail('INVALID_STATE', 'This stage was removed.');
  end if;
  if changes is null or jsonb_typeof(changes) <> 'object' then
    perform app.fail('VALIDATION', 'Nothing to change.');
  end if;
  for v_key in select jsonb_object_keys(changes) loop
    if v_key not in ('name', 'position') then
      perform app.fail('VALIDATION', format('"%s" is not a stage detail that can change.', v_key));
    end if;
  end loop;
  v_name := case when changes ? 'name'
    then app.client_work_text(changes ->> 'name', 120, 'Give the stage a name of up to 120 characters.')
    else v_stage.name end;
  v_position := case when changes ? 'position' then app.client_work_position(changes ->> 'position') else v_stage.position end;
  if v_name is distinct from v_stage.name then
    perform app.item_stage_name_free(v_stage.item_id, v_name, v_stage.id);
    v_changed := array_append(v_changed, 'name');
  end if;
  if v_position is distinct from v_stage.position then v_changed := array_append(v_changed, 'position'); end if;
  if cardinality(v_changed) > 0 then
    update public.project_item_stage_list set name = v_name, position = v_position where id = v_stage.id;
  end if;
  return v_changed;
end;
$$;

create function public.item_stage_archive(stage_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_stage public.project_item_stage_list;
begin
  v_caller := app.client_work_caller('projects.manage', 'You cannot edit items.');
  v_stage := app.item_stage_find(item_stage_archive.stage_id);
  perform app.item_stage_item(v_stage.item_id);
  select s.* into v_stage from public.project_item_stage_list s where s.id = v_stage.id for update;
  if v_stage.archived_at is not null then
    perform app.fail('INVALID_STATE', 'This stage was already removed.');
  end if;
  -- Archived, never deleted: it leaves the item, its tick kept on the row and in the history.
  perform set_config('app.audit_override', jsonb_build_object('action', 'archived')::text, true);
  update public.project_item_stage_list set archived_at = now() where id = v_stage.id;
end;
$$;

create function public.item_stage_tick(stage_id uuid, done boolean default true)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_stage public.project_item_stage_list;
  v_item public.project_items;
begin
  v_caller := app.client_work_caller('items.tick', 'You cannot tick stages.');
  v_stage := app.item_stage_find(item_stage_tick.stage_id);
  -- Decision 7: open items only (a done item is approved, so its ticks are locked).
  v_item := app.item_stage_item(v_stage.item_id);
  select s.* into v_stage from public.project_item_stage_list s where s.id = v_stage.id for update;
  if v_stage.archived_at is not null then
    perform app.fail('INVALID_STATE', 'This stage was removed.');
  end if;
  if item_stage_tick.done is null then
    perform app.fail('VALIDATION', 'Tick or untick the stage.');
  end if;
  if item_stage_tick.done then
    if v_stage.done_at is not null then
      return false;
    end if;
    perform set_config('app.audit_override', jsonb_build_object('action', 'ticked')::text, true);
    update public.project_item_stage_list set done_at = now(), done_by = v_caller.id where id = v_stage.id;
    perform app.project_mark_started(v_item.project_id);
  else
    if v_stage.done_at is null then
      return false;
    end if;
    perform set_config('app.audit_override', jsonb_build_object('action', 'unticked')::text, true);
    update public.project_item_stage_list set done_at = null, done_by = null where id = v_stage.id;
  end if;
  return true;
end;
$$;

revoke all on function public.item_stage_add(uuid, text), public.item_stage_update(uuid, jsonb),
  public.item_stage_archive(uuid), public.item_stage_tick(uuid, boolean) from public, anon;
grant execute on function public.item_stage_add(uuid, text), public.item_stage_update(uuid, jsonb),
  public.item_stage_archive(uuid), public.item_stage_tick(uuid, boolean) to authenticated, service_role;

comment on function public.item_stage_add(uuid, text) is
  'Amendment D2: projects.manage on the caller''s clients (the Owner, the client''s Admin), the '
  'project open or in progress, the item open; a stage at the end of the item''s own list (at most '
  '12 active; a name the item''s active stages do not have yet, CONFLICT otherwise). Returns its id. '
  'Audited by the trigger.';
comment on function public.item_stage_update(uuid, jsonb) is
  'Amendment D2: projects.manage; rename or reorder one of an open item''s stages (changes: name, '
  'position). Returns the changed keys.';
comment on function public.item_stage_archive(uuid) is
  'Amendment D2: projects.manage; a stage removed from an open item is archived (its tick kept on '
  'the row and in the history). Audited ''archived''.';
comment on function public.item_stage_tick(uuid, boolean) is
  'Amendment D2 (decision 7): items.tick; tick (done true) or untick one of an open item''s stages '
  '(a done item''s are locked; an archived stage is refused). Returns false when nothing changed. A '
  'tick moves the project open -> in_progress. Audited ''ticked'' / ''unticked''. Notifies nobody. '
  '"Tick ‹stage› on N" calls it once per item, with that item''s stage of that name.';

-- 9. Done = approved (amendment D3) ---------------------------------------------------------------------------
create or replace function public.item_mark_done(item_id uuid)
returns public.item_state
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
  v_item := app.item_lock(item_mark_done.item_id);
  select p.* into v_project from public.projects p where p.id = v_item.project_id;
  perform app.project_check_writable(v_project);
  if v_item.state <> 'open' then
    perform app.fail('INVALID_STATE', format('This item is %s, not open.', v_item.state));
  end if;
  -- D3: done is the approval, in one step: it counts at once, whoever marks it (the Owner or the
  -- client's Admin; ADR-0007 amendment). The history's 'done' entry records both.
  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'done', 'meta', jsonb_build_object('approved', true))::text, true);
  update public.project_items
  set state = 'approved', done_at = now(), done_by = v_caller.id, approved_at = now(), approved_by = v_caller.id
  where id = v_item.id;
  perform app.project_mark_started(v_project.id);
  perform app.cycle_refresh(v_item.cycle_id);
  -- WORKFLOWS §9: nobody is told (the progress line shows it).
  return 'approved';
end;
$$;

comment on function public.item_mark_done(uuid) is
  '7.2, amendment D3 (owner 2026-10-09): items.tick on the caller''s clients (the Owner, the client''s '
  'Admin), the project open or in progress; open -> approved in one step: done_at / done_by and '
  'approved_at / approved_by stamped, so it counts for revenue at once; the project open -> '
  'in_progress the first time; the cycle re-checked. Audited ''done'' (meta approved). Notifies '
  'nobody. The project page''s "Mark N done" calls it per id.';

create function public.item_reopen(item_id uuid, reason text)
returns public.item_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_item public.project_items;
  v_project public.projects;
  v_client public.clients;
  v_reason text;
  v_owner uuid;
begin
  v_caller := app.client_work_caller('items.approve', 'You cannot reopen items.');
  v_item := app.item_lock(item_reopen.item_id);
  select p.* into v_project from public.projects p where p.id = v_item.project_id;
  -- Decision 14: a completed or cancelled project is read-only: reopen it first.
  perform app.project_check_writable(v_project);
  if v_item.state not in ('approved', 'done') then
    perform app.fail('INVALID_STATE', format('This item is %s, not done.', v_item.state));
  end if;
  v_reason := nullif(btrim(coalesce(item_reopen.reason, '')), '');
  if v_reason is null then
    perform app.fail('REASON_REQUIRED', 'Reopening a done item needs a reason.');
  end if;
  if length(v_reason) > 1000 then
    perform app.fail('VALIDATION', 'Keep the reason under 1000 characters.');
  end if;
  v_owner := app.org_owner_id(v_project.org_id);
  -- D3: open again and no longer counted; the ticks stay (locked while done, workable again now).
  perform set_config('app.audit_override', jsonb_build_object(
    'action', case when v_caller.id = v_owner then 'sent_back' else 'reopened' end,
    'meta', jsonb_build_object('reason', v_reason, 'from_state', v_item.state))::text, true);
  update public.project_items
  set state = 'open', done_at = null, done_by = null, approved_at = null, approved_by = null
  where id = v_item.id;
  insert into public.item_reviews (org_id, item_id, decision, reason, reviewer_id)
  values (v_item.org_id, v_item.id, 'rejected', v_reason, v_caller.id);
  perform app.cycle_refresh(v_item.cycle_id);

  v_client := app.project_client(v_project);
  if v_caller.id = v_owner then
    -- The Owner's send-back: the client's Admin, with the reason (actionable: email fallback).
    perform app.notify(array[v_client.admin_id], 'item_rejected',
      format('Sent back: %s', v_item.title),
      format('%s · %s. %s: %s', v_project.name, v_client.name, v_caller.full_name, v_reason),
      app.project_link(v_project), 'project_items', v_item.id,
      jsonb_build_object('project_id', v_project.id, 'item_id', v_item.id), v_caller.id);
  else
    -- The client's Admin reopened it: the Owner, for information (in-app and push, never email).
    perform app.notify(array[v_owner], 'item_reopened',
      format('%s reopened %s', v_caller.full_name, v_item.title),
      format('%s · %s. Reason: %s', v_project.name, v_client.name, v_reason),
      app.project_link(v_project), 'project_items', v_item.id,
      jsonb_build_object('project_id', v_project.id, 'item_id', v_item.id), v_caller.id);
  end if;
  return 'open';
end;
$$;

revoke all on function public.item_reopen(uuid, text) from public, anon;
grant execute on function public.item_reopen(uuid, text) to authenticated, service_role;

comment on function public.item_reopen(uuid, text) is
  'Amendment D3 (owner 2026-10-09): items.approve on the caller''s clients (the Owner on any, the '
  'client''s Admin on theirs), the project open or in progress; a done (approved) item -> open with a '
  'reason (REASON_REQUIRED): done_* and approved_* cleared, so it no longer counts until done again; '
  'ticks kept; an item_reviews rejection row; the cycle re-checked (an ended cycle''s item joins the '
  'carry list). Audited ''sent_back'' (the Owner) or ''reopened'' (the Admin) with the reason. The '
  'Owner''s send-back tells the client''s Admin (item_rejected, actionable); the Admin''s reopen tells '
  'the Owner (item_reopened, info). Never the actor.';

-- 10. A carried item takes its own stages with their ticks (decision 12, amendment D2) --------------------
create or replace function public.cycle_carry_decide(item_ids uuid[], decision public.carry_decision, reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_cycle_ids uuid[];
  v_cycle public.project_cycles;
  v_project public.projects;
  v_client public.clients;
  v_today date := app.today_ist();
  v_reason text;
  v_target public.project_cycles;
  v_try public.project_cycles;
  v_target_start date;
  v_id uuid;
  v_item public.project_items;
  v_new uuid;
  v_last text;
  v_results jsonb := '[]'::jsonb;
  v_done integer := 0;
  v_code text;
  v_detail text;
  v_title text;
begin
  v_caller := app.client_work_caller('cycles.carry_decide', 'You cannot decide unfinished items.');
  if item_ids is null or cardinality(item_ids) = 0 then
    perform app.fail('VALIDATION', 'Choose the items to decide.');
  end if;
  if cardinality(item_ids) > 100 then
    perform app.fail('VALIDATION', 'A cycle holds at most 100 items.');
  end if;
  if cycle_carry_decide.decision is null then
    perform app.fail('VALIDATION', 'Choose carry forward, close or leave pending.');
  end if;
  -- Decision 16: carry forward and leave pending in bulk per cycle; close one item at a time with a
  -- reason.
  if cycle_carry_decide.decision = 'close' then
    if cardinality(item_ids) <> 1 then
      perform app.fail('VALIDATION', 'Close one item at a time, with a reason.');
    end if;
    v_reason := nullif(btrim(coalesce(cycle_carry_decide.reason, '')), '');
    if v_reason is null then
      perform app.fail('REASON_REQUIRED', 'Closing an item needs a reason.');
    end if;
    if length(v_reason) > 1000 then
      perform app.fail('VALIDATION', 'Keep the reason under 1000 characters.');
    end if;
  end if;

  -- Only the items the caller may see decide the cycle (7A review L4): another Admin's id is
  -- NOT_FOUND on its own line below, never a reason to refuse the batch.
  select array_agg(distinct i.cycle_id) into v_cycle_ids from public.project_items i
  where i.id = any (item_ids) and i.org_id = v_caller.org_id and app.project_visible(i.project_id);
  if v_cycle_ids is null then
    perform app.fail('NOT_FOUND', 'These items are not yours.');
  end if;
  if cardinality(v_cycle_ids) > 1 then
    perform app.fail('VALIDATION', 'Decide the items of one cycle at a time.');
  end if;
  select c.* into v_cycle from public.project_cycles c where c.id = v_cycle_ids[1];
  v_project := app.project_lock(v_cycle.project_id);
  perform app.project_check_writable(v_project);
  select c.* into v_cycle from public.project_cycles c where c.id = v_cycle.id for update;
  -- Items of an ended period only (a one-time project's cycle has none).
  if v_cycle.period_end is null or v_cycle.period_end >= v_today then
    perform app.fail('INVALID_STATE', 'This cycle''s period has not ended, so its items are not decided yet.');
  end if;
  v_client := app.project_client(v_project);
  if cycle_carry_decide.decision = 'carry_forward' then
    -- Decision 13: refused on an Inactive client (Close or Leave pending only); allowed on Paused.
    if v_client.state = 'inactive' then
      perform app.fail('INVALID_STATE', format('%s is closed: close the items or leave them pending.', v_client.name));
    end if;
    -- The next cycle, or the current period's when the next one has already ended (new items never
    -- go into a past cycle, decision 9). When missing it is made by the first item that carries
    -- (generated_by carry; the nightly job then finds it), never by a batch where none does (L7);
    -- with the item list on an Active client, without it on a Paused one (Q4 (a)).
    v_target_start := greatest(app.period_next(v_project.recurrence, v_cycle.period_start),
                               app.period_start(v_project.recurrence, v_today));
    select c.* into v_target from public.project_cycles c
    where c.project_id = v_project.id and c.period_start = v_target_start;
  end if;

  for v_id in select distinct x.id from unnest(item_ids) as x(id) order by 1 loop
    begin
      select i.* into v_item from public.project_items i
      where i.id = v_id and i.cycle_id = v_cycle.id
      for update;
      if v_item.id is null then
        perform app.fail('NOT_FOUND', 'This item is not in this cycle.');
      end if;
      -- Decision 11: open items only (done items wait for approval in their own cycle).
      if v_item.state <> 'open' then
        perform app.fail('INVALID_STATE', format('This item is %s, not open.', v_item.state));
      end if;
      if cycle_carry_decide.decision = 'carry_forward' then
        -- The target, made here in this item's savepoint when missing: if the item then fails, the
        -- cycle goes with it and v_target stays empty (it is set only once the item has carried).
        v_try := v_target;
        if v_try.id is null then
          -- Q4 (a): on a client that is not Active the new cycle takes only the carried items; the
          -- item list joins it once the client is Active again (cycle_generate).
          v_try := app.cycle_create(v_project, v_target_start, 'carry', v_caller.id, v_client.state = 'active');
        end if;
        if app.cycle_live_items(v_try.id) >= 100 then
          perform app.fail('VALIDATION', format('%s already holds 100 items.', v_try.label));
        end if;
        -- Decision 12: title, notes, custom fields and the stage ticks (their original times and
        -- people) go along; the planned date does not. origin_cycle_id stays the first cycle.
        select max(i.position collate "C") into v_last from public.project_items i where i.cycle_id = v_try.id;
        perform set_config('app.audit_override', jsonb_build_object(
          'action', 'carried_in', 'meta', jsonb_build_object('carried_from_item_id', v_item.id))::text, true);
        insert into public.project_items (
          org_id, project_id, cycle_id, title, position, notes, custom_fields, carried_from_item_id,
          origin_cycle_id, created_by)
        values (
          v_item.org_id, v_item.project_id, v_try.id, v_item.title, app.client_work_next_position(v_last),
          v_item.notes, v_item.custom_fields, v_item.id, v_item.origin_cycle_id, v_caller.id)
        returning id into v_new;
        -- Amendment D2: the item's own stage list goes along, each with its tick (original time and
        -- person); a removed (archived) stage stays with the original.
        perform app.item_stage_list_copy(v_item.id, v_new);
        perform set_config('app.audit_override', jsonb_build_object(
          'action', 'carried', 'meta', jsonb_build_object('carried_to_item_id', v_new, 'to_cycle_id', v_try.id))::text, true);
        update public.project_items
        set state = 'carried', carry_decision = 'carry_forward', carry_decided_by = v_caller.id, carry_decided_at = now()
        where id = v_item.id;
        v_target := v_try;
      elsif cycle_carry_decide.decision = 'close' then
        perform set_config('app.audit_override', jsonb_build_object('action', 'closed')::text, true);
        update public.project_items
        set state = 'cancelled', cancelled_reason = v_reason, cancelled_by = v_caller.id, cancelled_at = now(),
            carry_decision = 'close', carry_decided_by = v_caller.id, carry_decided_at = now()
        where id = v_item.id;
      else
        perform set_config('app.audit_override', jsonb_build_object('action', 'left_pending')::text, true);
        update public.project_items
        set carry_decision = 'leave_pending', carry_decided_by = v_caller.id, carry_decided_at = now()
        where id = v_item.id;
      end if;
      v_done := v_done + 1;
      v_results := v_results || case when cycle_carry_decide.decision = 'carry_forward'
        then jsonb_build_object('id', v_id, 'ok', true, 'state', 'carried', 'new_item_id', v_new, 'cycle_id', v_target.id)
        else jsonb_build_object('id', v_id, 'ok', true, 'state',
               case when cycle_carry_decide.decision = 'close' then 'cancelled' else 'open' end) end;
    exception when sqlstate 'P0001' then
      get stacked diagnostics v_code = message_text, v_detail = pg_exception_detail;
      v_results := v_results || jsonb_build_object('id', v_id, 'ok', false, 'code', v_code, 'message', v_detail);
    end;
  end loop;
  perform app.cycle_refresh(v_cycle.id);
  if v_target.id is not null then
    perform app.cycle_refresh(v_target.id);
  end if;

  -- WORKFLOWS §9 "Carry decisions made by the Owner": the client's Admin, one combined row per batch
  -- (info); the Admin's own decisions tell nobody (the actor; amendment C6).
  if v_done > 0 then
    v_title := case cycle_carry_decide.decision
      when 'carry_forward' then format('%s carried into %s', case when v_done = 1 then '1 item' else v_done || ' items' end, v_target.label)
      when 'close' then format('1 item closed in %s', v_cycle.label)
      else format('%s left pending in %s', case when v_done = 1 then '1 item' else v_done || ' items' end, v_cycle.label)
    end;
    perform app.notify(array[v_client.admin_id], 'carry_decided', v_title,
      case when cycle_carry_decide.decision = 'close'
        then format('%s · %s. Reason: %s', v_project.name, v_client.name, v_reason)
        else format('%s · %s.', v_project.name, v_client.name) end,
      app.project_link(v_project), 'projects', v_project.id,
      jsonb_build_object('project_id', v_project.id, 'cycle_id', v_cycle.id, 'decision', cycle_carry_decide.decision),
      v_caller.id);
  end if;
  return v_results;
end;
$$;

comment on function public.cycle_carry_decide(uuid[], public.carry_decision, text) is
  '7.2 (WORKFLOWS §5.3, §5.4 items 11-13, 16; amendment C; Q4 (a); amendment D2): cycles.carry_decide '
  'on the caller''s clients; the open items of ONE recurring cycle whose period has ended; the cycle '
  'is the one of the ids the caller may see (another Admin''s id is NOT_FOUND on its own line). '
  'carry_forward (bulk; refused on an Inactive client): a new item in the next cycle (or the current '
  'period''s when the next has ended), made with generated_by carry by the first id that carries when '
  'missing, with the item list on an Active client and only the carried items on a Paused one, '
  'taking title, notes, custom fields and the item''s own active stages with their ticks, never the '
  'planned date; the original becomes carried. close (one item, REASON_REQUIRED): cancelled. '
  'leave_pending (bulk): stays open, decided again later. Per-id results. Audited (carried_in, '
  'carried, closed, left_pending). The Owner''s decisions tell the client''s Admin, one carry_decided '
  'row per call.';

-- 11. Reopening a project: "anything ticked" reads the items' own stages too (decision 14) -------------------
create or replace function public.project_reopen(project_id uuid, reason text)
returns public.project_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_project public.projects;
  v_reason text;
  v_state public.project_state;
  v_client public.clients;
begin
  v_caller := app.client_work_caller('projects.complete', 'You cannot reopen projects.');
  v_project := app.project_lock(project_reopen.project_id);
  if v_project.state not in ('completed', 'cancelled') then
    perform app.fail('INVALID_STATE', 'Only a completed or cancelled project can be reopened.');
  end if;
  -- Q6 (a): an Inactive client's project stays closed (§4: no new work there).
  v_client := app.project_client(v_project);
  if v_client.state = 'inactive' then
    perform app.fail('INVALID_STATE', format('%s is closed. Reactivate the client first.', v_client.name));
  end if;
  v_reason := nullif(btrim(coalesce(project_reopen.reason, '')), '');
  if v_reason is null then
    perform app.fail('REASON_REQUIRED', 'Reopening a project needs a reason.');
  end if;
  if length(v_reason) > 1000 then
    perform app.fail('VALIDATION', 'Keep the reason under 1000 characters.');
  end if;
  -- Decision 14: in progress when anything was ever ticked or done (a tick row, an item done or
  -- reviewed, a 'done' entry in its history), otherwise open. Items cancelled by a cancel stay so.
  v_state := case when exists (
      select 1 from public.project_items i
      where i.project_id = v_project.id
        and (i.done_at is not null
             or exists (select 1 from public.project_item_stages s where s.item_id = i.id)
             or exists (select 1 from public.project_item_stage_list s where s.item_id = i.id and s.done_at is not null)
             or exists (select 1 from public.item_reviews r where r.item_id = i.id)
             or exists (select 1 from public.activity_log a
                        where a.entity = 'project_items' and a.entity_id = i.id and a.action = 'done')))
    then 'in_progress'::public.project_state else 'open'::public.project_state end;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'reopened', 'meta', jsonb_build_object('from_state', v_project.state, 'reason', v_reason))::text, true);
  begin
    update public.projects
    set state = v_state, completed_at = null, completed_by = null,
        cancelled_at = null, cancelled_by = null, cancelled_reason = null
    where id = v_project.id;
  exception when unique_violation then
    perform app.fail('CONFLICT', 'This client already has an open project with this name: rename one first.');
  end;

  v_client := app.project_client(v_project);
  perform app.project_lifecycle_notify(v_project, 'project_reopened',
    format('%s reopened %s', v_caller.full_name, v_project.name),
    format('%s. Reason: %s', v_client.name, v_reason), v_caller.id);
  return v_state;
end;
$$;

-- 12. The project's activity, paged (the owner's preview feedback, 2026-10-09) -------------------------------
-- Newest first by keyset (at, id) below the cursor; the project's own entries (project, defaults, item
-- list, cycles) and its items' (items, their stages and ticks), or one item's only; kind narrows to
-- items, stages or the project. Under the caller's RLS (security invoker): the Owner, the client's
-- Admin; another Admin and Crew read nothing. Entries the history never shows are skipped here so a
-- page is a page of lines: an item's stages as it was created ('initial'), a cycle settling, an update
-- that changed only internal keys, and the review rows (their item's own entry says it).
create function public.project_activity(
  project_id uuid,
  kind text default 'all',
  item_id uuid default null,
  before_at timestamptz default null,
  before_id bigint default null,
  max_rows integer default 20
)
returns table (id bigint, actor_id uuid, entity text, entity_id uuid, action text, diff jsonb, meta jsonb, at timestamptz)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if project_activity.kind is null or project_activity.kind not in ('all', 'items', 'stages', 'project') then
    perform app.fail('VALIDATION', 'Choose all, items, stages or project.');
  end if;
  if (project_activity.before_at is null) <> (project_activity.before_id is null) then
    perform app.fail('VALIDATION', 'A page starts after an entry: give its time and its id.');
  end if;
  return query
    select a.id, a.actor_id, a.entity, a.entity_id, a.action, a.diff, a.meta, a.at
    from public.activity_log a
    where ((project_activity.item_id is null
            and a.entity in ('projects', 'project_cycles', 'project_item_blueprints', 'project_stages')
            and a.entity_id = project_activity.project_id)
           or (a.entity in ('project_items', 'project_item_stage_list', 'project_item_stages')
               and a.entity_id in (
                 select i.id from public.project_items i
                 where i.project_id = project_activity.project_id
                   and (project_activity.item_id is null or i.id = project_activity.item_id))))
      and case project_activity.kind
            when 'items' then a.entity = 'project_items'
            when 'stages' then a.entity in ('project_stages', 'project_item_stage_list', 'project_item_stages')
            when 'project' then a.entity in ('projects', 'project_cycles', 'project_item_blueprints')
            else true
          end
      and a.action not in ('initial', 'settled', 'unsettled')
      and not (a.action = 'update' and not exists (
            select 1 from jsonb_object_keys(coalesce(a.diff -> 'new', '{}'::jsonb)) as k(key)
            where k.key not in ('overdue_armed_at', 'delivery_armed_at', 'reopened_at', 'ready_armed_at',
                                'prompted_at', 'updated_at', 'search')))
      and (project_activity.before_at is null
           or (a.at, a.id) < (project_activity.before_at, project_activity.before_id))
    order by a.at desc, a.id desc
    limit least(greatest(coalesce(project_activity.max_rows, 20), 1), 100);
end;
$$;

revoke all on function public.project_activity(uuid, text, uuid, timestamptz, bigint, integer) from public, anon;
grant execute on function public.project_activity(uuid, text, uuid, timestamptz, bigint, integer) to authenticated, service_role;

comment on function public.project_activity(uuid, text, uuid, timestamptz, bigint, integer) is
  'The project page''s Activity panel (owner 2026-10-09): a project''s history, or one item''s '
  '(item_id), newest first, at most max_rows (1..100, default 20) entries before the (before_at, '
  'before_id) cursor; kind all | items | stages | project. Security invoker: RLS decides (the Owner, '
  'the client''s Admin; never Crew). Skips what the history never shows (initial stages, settling, '
  'updates of internal keys only).';

-- The latest shown entry of each item (the item sheet's "Last change"), at most 200 items, under RLS.
create function public.item_last_changes(item_ids uuid[])
returns table (id bigint, actor_id uuid, entity text, entity_id uuid, action text, diff jsonb, meta jsonb, at timestamptz)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if cardinality(coalesce(item_last_changes.item_ids, '{}')) > 200 then
    perform app.fail('VALIDATION', 'At most 200 items at once.');
  end if;
  return query
    select distinct on (a.entity_id) a.id, a.actor_id, a.entity, a.entity_id, a.action, a.diff, a.meta, a.at
    from public.activity_log a
    where a.entity in ('project_items', 'project_item_stage_list', 'project_item_stages')
      and a.entity_id = any (coalesce(item_last_changes.item_ids, '{}'))
      and a.action not in ('initial', 'settled', 'unsettled')
      and not (a.action = 'update' and not exists (
            select 1 from jsonb_object_keys(coalesce(a.diff -> 'new', '{}'::jsonb)) as k(key)
            where k.key not in ('overdue_armed_at', 'delivery_armed_at', 'reopened_at', 'ready_armed_at',
                                'prompted_at', 'updated_at', 'search')))
    order by a.entity_id, a.at desc, a.id desc;
end;
$$;

revoke all on function public.item_last_changes(uuid[]) from public, anon;
grant execute on function public.item_last_changes(uuid[]) to authenticated, service_role;

comment on function public.item_last_changes(uuid[]) is
  'The item sheet''s "Last change" (owner 2026-10-09): for each item (at most 200), its latest '
  'history entry the history shows (as project_activity skips), under RLS (security invoker).';
