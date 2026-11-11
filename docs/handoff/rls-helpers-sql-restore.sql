-- Refuses to run as it stands (X6 review batch 1, #89): copy it into a new migration to use it.
do $$ begin raise exception 'draft: copy into a new migration (pnpm db:new), never run by hand'; end $$;

-- DRAFT, NOT APPLIED (v2.0 X3 (b), 2026-11-06; the advisor on #89): the rollback for migration
-- 20261106030000_rls_helpers_plpgsql. It restores the fifteen helpers as the `language sql`
-- functions they were before it, with the same bodies and every attribute as before (security
-- definer, stable, strict, parallel safe for the three date helpers, rows, the empty search_path;
-- create or replace keeps the grants), so RLS behaves exactly as it does today, only re-planning
-- each call again.
--
-- To use it: copy this file to supabase/migrations/ under a NEW timestamp (an applied migration is
-- never edited or reverted in place), run `pnpm db:reset && pnpm db:test` locally, and keep pgTAP
-- 141's attribute assertions (its language check then expects 'sql'). It is checked in this state:
-- applied in a rolled-back transaction on a database with 20261106030000, every attribute equals
-- the snapshot taken before that migration.

create or replace function app.current_member()
returns setof public.members
language sql
stable security definer rows 1
set search_path = ''
as $function$
  select m.* from public.members m
  where m.id = auth.uid() and m.status = 'active' and m.engagement = 'permanent';
$function$;

create or replace function app.has_permission(key text)
returns boolean
language sql
stable strict security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.members m
    join public.role_permissions rp on rp.role = m.role
    where m.id = auth.uid() and m.status = 'active' and m.engagement = 'permanent'
      and rp.permission = key
  );
$function$;

create or replace function app.is_owner()
returns boolean
language sql
stable security definer
set search_path = ''
as $function$
  select coalesce((select m.role = 'owner' from app.current_member() m), false);
$function$;

create or replace function app.task_visible(p_task_id uuid)
returns boolean
language sql
stable security definer
set search_path = ''
as $function$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task_id
      and t.org_id = (select m.org_id from app.current_member() m)
      and ((select app.is_owner())
           or (t.created_by = auth.uid() and (select app.has_permission('tasks.create')))
           or (t.approving_admin_id = auth.uid() and (select app.has_permission('tasks.approve_admin')))
           or exists (select 1 from public.task_assignees a
                      where a.task_id = t.id and a.removed_at is null and a.member_id = auth.uid())
           or exists (select 1 from public.task_assignees a
                      join public.members f on f.id = a.member_id
                      where a.task_id = t.id and a.removed_at is null
                        and f.engagement = 'freelance' and f.status = 'active'
                        and app.coordinator_of(f.id) = auth.uid())
           or (t.client_id is not null
               and (select app.has_permission('clients.edit_assigned'))
               and t.client_id in (select app.admin_client_ids()))));
$function$;

create or replace function app.client_visible(p_client_id uuid)
returns boolean
language sql
stable security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.clients c
    where c.id = p_client_id
      and c.org_id = (select m.org_id from app.current_member() m)
      and ((select app.has_permission('clients.manage'))
           or ((select app.has_permission('clients.edit_assigned'))
               and c.admin_id = (select m.id from app.current_member() m)))
  );
$function$;

create or replace function app.admin_client_ids()
returns SETOF uuid
language sql
stable security definer
set search_path = ''
as $function$
  select c.id
  from public.clients c
  where c.org_id = (select m.org_id from app.current_member() m)
    and c.admin_id = (select m.id from app.current_member() m)
    and (select app.has_permission('clients.edit_assigned'));
$function$;

create or replace function app.coordinator_of(p_member_id uuid)
returns uuid
language sql
stable security definer
set search_path = ''
as $function$
  select mc.coordinator_id
  from public.member_coordinators mc
  where mc.member_id = p_member_id and mc.to_at is null;
$function$;

create or replace function app.directory_visible_ids()
returns SETOF uuid
language sql
stable security definer
set search_path = ''
as $function$
  with me as (
    select m.id, m.org_id from app.current_member() m
  ),
  -- The freelancers the caller coordinates now (ADR-0013).
  coordinated as (
    select mc.member_id
    from public.member_coordinators mc
    join me on mc.coordinator_id = me.id
    where mc.to_at is null
  ),
  -- Of those, the active ones: a coordinator stands for an active freelancer only (S-S2).
  coordinated_active as (
    select c.member_id
    from coordinated c
    join public.members f on f.id = c.member_id
    where f.engagement = 'freelance' and f.status = 'active'
  ),
  -- The caller's visible tasks: app.task_visible()'s rule, once for the whole set.
  visible as (
    select t.id, t.created_by, t.approving_admin_id, t.primary_owner_id, t.submitted_by,
           t.submitted_on_behalf_of
    from public.tasks t
    join me on t.org_id = me.org_id
    where (select app.is_owner())
       or (t.created_by = me.id and (select app.has_permission('tasks.create')))
       or (t.approving_admin_id = me.id and (select app.has_permission('tasks.approve_admin')))
       or exists (select 1 from public.task_assignees a
                  where a.task_id = t.id and a.removed_at is null
                    and (a.member_id = me.id
                         or a.member_id in (select ca.member_id from coordinated_active ca)))
       or (t.client_id is not null
           and (select app.has_permission('clients.edit_assigned'))
           and t.client_id in (select app.admin_client_ids()))
  ),
  named (id) as (
    select me.id from me
    union all
    select c.member_id from coordinated c
    -- The task's own people: creator, current approver, primary owner, who marked it done.
    union all
    select x.id from visible v
    cross join lateral (values (v.created_by), (v.approving_admin_id), (v.primary_owner_id),
                               (v.submitted_by), (v.submitted_on_behalf_of)) x(id)
    -- Current and removed assignees, and who noted it for a freelancer.
    union all
    select x.id from public.task_assignees a
    join visible v on v.id = a.task_id
    cross join lateral (values (a.member_id), (a.acknowledged_by)) x(id)
    union all
    select r.reviewer_id from public.task_reviews r join visible v on v.id = r.task_id
    union all
    select x.id from public.task_comments c
    join visible v on v.id = c.task_id
    cross join lateral (values (c.author_id), (c.on_behalf_of)) x(id)
    union all
    select x.id from public.task_stages s
    join visible v on v.id = s.task_id
    cross join lateral (values (s.done_by), (s.on_behalf_of)) x(id)
    union all
    select x.id from public.task_submissions s
    join visible v on v.id = s.task_id
    cross join lateral (values (s.submitted_by), (s.on_behalf_of)) x(id)
    -- Whoever acted on it (every audit entry about the task, warnings aside: they are
    -- availability.view's), and the approvers and primary owners an entry names (past approvers).
    union all
    select x.id from public.activity_log l
    join visible v on v.id = l.entity_id
    cross join lateral (values
      (l.actor_id),
      (l.on_behalf_of_id),
      (case when l.action in ('approver_changed', 'primary_changed')
                 and l.meta ->> 'from' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then (l.meta ->> 'from')::uuid end),
      (case when l.action in ('approver_changed', 'primary_changed')
                 and l.meta ->> 'to' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then (l.meta ->> 'to')::uuid end)) x(id)
    where l.entity in ('tasks', 'task_assignees', 'task_stages', 'task_comments', 'task_reviews',
                       'task_submissions')
    -- The current coordinator of a freelancer on the task.
    union all
    select mc.coordinator_id from public.member_coordinators mc
    join public.task_assignees a on a.member_id = mc.member_id and a.removed_at is null
    join visible v on v.id = a.task_id
    where mc.to_at is null
  )
  select distinct n.id from named n where n.id is not null;
$function$;

create or replace function app.labelled_client_ids()
returns SETOF uuid
language sql
stable security definer
set search_path = ''
as $function$
  select distinct t.client_id
  from public.tasks t
  where t.client_id is not null
    and t.org_id = (select m.org_id from app.current_member() m)
    and ((select app.is_owner())
         or (t.created_by = auth.uid() and (select app.has_permission('tasks.create')))
         or (t.approving_admin_id = auth.uid() and (select app.has_permission('tasks.approve_admin')))
         or exists (select 1 from public.task_assignees a
                    where a.task_id = t.id and a.removed_at is null and a.member_id = auth.uid())
         or exists (select 1 from public.task_assignees a
                    join public.members f on f.id = a.member_id
                    where a.task_id = t.id and a.removed_at is null
                      and f.engagement = 'freelance' and f.status = 'active'
                      and app.coordinator_of(f.id) = auth.uid()));
$function$;

create or replace function app.task_request_visible(p_requested_by uuid, p_client_id uuid)
returns boolean
language sql
stable security definer
set search_path = ''
as $function$
  select (select app.is_owner())
    or p_requested_by = auth.uid()
    or ((select app.has_permission('task_requests.decide'))
        and ((p_client_id is null
              and not exists (select 1 from public.members m where m.id = p_requested_by and m.role = 'admin'))
             -- Never null: a null here would read as "not refused" in a plpgsql IF (the lock).
             or (p_client_id is not null and p_client_id in (select app.admin_client_ids()))));
$function$;

create or replace function app.current_org_id()
returns uuid
language sql
stable security definer
set search_path = ''
as $function$
  select coalesce(
    (select m.org_id from public.members m where m.id = auth.uid()),
    (select o.id from public.organizations o
      where not exists (select 1 from public.organizations o2 where o2.id <> o.id))
  );
$function$;

create or replace function app.leave_covering(p_member_id uuid, d date)
returns public.leave_requests
language sql
stable security definer
set search_path = ''
as $function$
  select r.*
  from public.leave_requests r
  where r.member_id = p_member_id and r.state = 'approved' and r.start_date <= d and r.end_date >= d
  order by r.decided_at desc, r.created_at desc
  limit 1;
$function$;

create or replace function app.is_working_day(d date)
returns boolean
language sql
stable security definer parallel safe
set search_path = ''
as $function$
  select case
    when d is null then null
    -- No organization in scope: "unknown", never "yes" (DATA-MODEL §0a).
    when app.current_org_id() is null then null
    else not (
      exists (
        select 1
        from public.org_settings s
        where s.org_id = app.current_org_id()
          and extract(dow from d)::smallint = any (s.weekly_off_days)
      )
      or exists (
        select 1
        from public.holidays h
        where h.org_id = app.current_org_id() and h.date = d
      )
    )
  end;
$function$;

create or replace function app.ist_day_start(d date)
returns timestamp with time zone
language sql
stable strict parallel safe
set search_path = ''
as $function$
  select (d::timestamp at time zone 'Asia/Kolkata');
$function$;

create or replace function app.to_ist_date(ts timestamp with time zone)
returns date
language sql
stable strict parallel safe
set search_path = ''
as $function$
  select (ts at time zone 'Asia/Kolkata')::date;
$function$;
