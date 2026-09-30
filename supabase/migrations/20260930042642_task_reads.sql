-- The task page rework (Kickoff 4 decision 28, owner 2026-09-30): per-member read tracking of a
-- task's comments, so the page's Chat tab says "Chat · 2 new" and every task list marks the rows
-- with unread comments. Expand-only (3c decision 7): one new table and two new functions.
--
-- 1. task_reads: each member's last read of a task's comments. Their own rows only (RLS), written
--    only by task_mark_read(). Not audited: it records what a member has seen, not a fact about
--    the task (like session_events and attendance_events, the row is its own record), and a read
--    would otherwise put a history entry on every chat opened. Its foreign keys cascade: a read
--    marker means nothing without its task or its member, and the rows are never history.
-- 2. task_mark_read(task_id, up_to): the caller's read moves forward to up_to (the newest comment
--    they were shown; now() when null, never past now()), never back.
-- 3. task_unread_counts(task_ids): per task the caller sees, the comments by someone else after
--    the caller's last read (a member's own comments, written for a freelancer included, never
--    count for them; a coordinator's reads are their own). Only tasks with unread comments.

-- 1. task_reads ------------------------------------------------------------------------------------
create table public.task_reads (
  task_id uuid not null references public.tasks (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (task_id, member_id)
);

comment on table public.task_reads is
  'Each member''s last read of a task''s comments (Kickoff 4 decision 28): the Chat tab''s "N new" '
  'and the lists'' unread marker. The member''s own rows only (RLS); written only by '
  'task_mark_read(). Not audited: a read is the member''s own view state, not a fact about the task.';

create index task_reads_member_idx on public.task_reads (member_id);

alter table public.task_reads enable row level security;

revoke all on public.task_reads from anon;
revoke insert, update, delete, truncate, references, trigger on public.task_reads from authenticated;

-- A member reads their own rows, while they are an active member.
create policy task_reads_select_own on public.task_reads for select to authenticated
  using (member_id = (select m.id from app.current_member() m));

-- 2. task_mark_read -------------------------------------------------------------------------------
create function public.task_mark_read(task_id uuid, up_to timestamptz default null)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.members;
  v_at timestamptz := least(coalesce(task_mark_read.up_to, now()), now());
begin
  select m.* into v_me from app.current_member() m;
  if v_me.id is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  if not app.has_permission('tasks.work') then
    perform app.fail('FORBIDDEN', 'You cannot work on tasks.');
  end if;
  if task_mark_read.task_id is null or not app.task_visible(task_mark_read.task_id) then
    perform app.fail('NOT_FOUND', 'This task is not there.');
  end if;

  insert into public.task_reads as r (task_id, member_id, last_read_at)
  values (task_mark_read.task_id, v_me.id, v_at)
  on conflict on constraint task_reads_pkey
  do update set last_read_at = greatest(r.last_read_at, excluded.last_read_at)
  returning r.last_read_at into v_at;
  return v_at;
end;
$$;

revoke all on function public.task_mark_read(uuid, timestamptz) from public, anon;
grant execute on function public.task_mark_read(uuid, timestamptz) to authenticated, service_role;

comment on function public.task_mark_read(uuid, timestamptz) is
  'tasks.work, on a task the caller sees (NOT_FOUND otherwise). Moves the caller''s own read of '
  'the task''s comments forward to up_to (the newest comment they were shown; now() when null, '
  'never later than now()), never back. Returns the stored time. Not audited (task_reads). '
  'Notifies nobody.';

-- 3. task_unread_counts ---------------------------------------------------------------------------
create function public.task_unread_counts(task_ids uuid[] default null)
returns table (task_id uuid, unread integer)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select m.id, m.org_id from app.current_member() m
    where (select app.has_permission('tasks.work'))
  ),
  counted as (
    select c.task_id, count(*)::integer as unread
    from public.task_comments c
    join public.tasks t on t.id = c.task_id
    join me on t.org_id = me.org_id
    left join public.task_reads r on r.task_id = c.task_id and r.member_id = me.id
    where c.author_id <> me.id
      and (r.last_read_at is null or c.created_at > r.last_read_at)
      and (task_unread_counts.task_ids is null or c.task_id = any (task_unread_counts.task_ids))
    group by c.task_id
  )
  select counted.task_id, counted.unread
  from counted
  where app.task_visible(counted.task_id);
$$;

revoke all on function public.task_unread_counts(uuid[]) from public, anon;
grant execute on function public.task_unread_counts(uuid[]) to authenticated, service_role;

comment on function public.task_unread_counts(uuid[]) is
  'The caller''s unread comments per task (Kickoff 4 decision 28): comments by anyone else '
  '(author_id is never the caller: their own, written for a freelancer included, never count) '
  'after the caller''s own last read (task_reads; every comment when there is none), on tasks the '
  'caller sees (app.task_visible), only tasks with any; task_ids narrows it (null: every task). '
  'No rows for an inactive member or without tasks.work.';
