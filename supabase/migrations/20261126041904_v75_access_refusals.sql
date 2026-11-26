-- v7.5 Q6 (owner 2026-11-26): a daily Owner note when one account is refused FORBIDDEN more than
-- 20 times in a day (a possible probe; docs/handoff/v7.5-plan.md §2.8 and §6).
--
-- Where a refusal is counted: where the app answers it (a raised refusal rolls its own transaction
-- back, so the database cannot count its own). The server calls public.access_refusal_note() once
-- for each refusal it gives a signed-in member: a page's permission check that sends them to
-- /forbidden (`requirePermission`), and an action that ends FORBIDDEN (`action()`: its own check
-- or a transition function's refusal). A request that RLS simply filters is not a refusal and is
-- not counted.
--
-- 1. access_refusals: one row per member per IST day, the count and when. RLS on, no policy and no
--    API grant: only these two functions write it, and only the service role reads it. A security
--    record (kept like sign-in records, 1 year: docs/PRIVACY.md), not business history, so no
--    audit trigger: every write is a count going up.
-- 2. public.access_refusal_note(): the caller's own row for today goes up by one. No argument, so
--    a member can only count against themselves.
-- 3. public.access_refusals_daily(now): the morning job. For yesterday (IST), each organisation's
--    Owner gets one note listing whoever was refused more than 20 times, each day once (noted_at).
-- 4. The notification kind access_refusals (in-app and push; never emailed on its own).
--
-- Expand-only: a new table, two new functions, a new kind and a new pg_cron job.

-- 1. The counts -----------------------------------------------------------------------------------
create table public.access_refusals (
  member_id uuid not null references public.members (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  day date not null,
  refusals integer not null default 1 check (refusals > 0),
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  noted_at timestamptz,
  primary key (member_id, day)
);
create index access_refusals_org_day on public.access_refusals (org_id, day);

comment on table public.access_refusals is
  'v7.5 Q6: how often each member was refused (FORBIDDEN) per IST day, written only by '
  'access_refusal_note() and access_refusals_daily(); service_role reads it. noted_at: the day was '
  'in the Owner''s note. A security record (1 year, docs/PRIVACY.md).';

alter table public.access_refusals enable row level security;
revoke all on table public.access_refusals from public, anon, authenticated;
grant select, insert, update on table public.access_refusals to service_role;

-- 2. A refusal, counted against the caller --------------------------------------------------------
create function public.access_refusal_note()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.members;
begin
  select * into v_me from app.current_member();
  if v_me.id is null then
    return;
  end if;
  insert into public.access_refusals as r (member_id, org_id, day)
  values (v_me.id, v_me.org_id, app.today_ist())
  on conflict (member_id, day) do update
    set refusals = r.refusals + 1, last_at = now();
end;
$$;
comment on function public.access_refusal_note() is
  'v7.5 Q6: the server calls it once for each FORBIDDEN it gives the signed-in member (a page''s '
  'bounce to /forbidden, an action''s refusal): their own row for today (IST) goes up by one. No '
  'argument: a member can only count against themselves. Nothing for a signed-out caller.';
revoke all on function public.access_refusal_note() from public, anon;
grant execute on function public.access_refusal_note() to authenticated, service_role;

-- 3. The morning note -----------------------------------------------------------------------------
create function public.access_refusals_daily(p_now timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- More than this many refusals in one IST day puts a member in the note (the owner's 20).
  c_more_than constant integer := 20;
  v_day date := app.to_ist_date(p_now) - 1;
  v_org record;
  v_owner uuid;
  v_rows jsonb;
  v_count integer;
  v_names text;
  v_first record;
  v_title text;
  v_body text;
  v_link text;
  v_notes integer := 0;
begin
  for v_org in select o.id from public.organizations o order by o.id loop
    -- One run at a time per organisation: two overlapping runs cannot both send the note.
    perform pg_advisory_xact_lock(hashtext('access_refusals_daily:' || v_org.id::text));
    v_owner := app.org_owner_id(v_org.id);
    if v_owner is null then
      continue;
    end if;

    select count(*)::integer,
           jsonb_agg(jsonb_build_object('member_id', r.member_id, 'refusals', r.refusals)
                     order by r.refusals desc, m.full_name, r.member_id),
           string_agg(m.full_name || ' ' || r.refusals, ' · '
                      order by r.refusals desc, m.full_name, r.member_id)
      into v_count, v_rows, v_names
    from public.access_refusals r
    join public.members m on m.id = r.member_id
    where r.org_id = v_org.id and r.day = v_day and r.noted_at is null
      and r.refusals > c_more_than;

    if v_count = 0 then
      continue;
    end if;

    if v_count = 1 then
      select r.member_id, r.refusals, m.full_name into v_first
      from public.access_refusals r
      join public.members m on m.id = r.member_id
      where r.org_id = v_org.id and r.day = v_day and r.noted_at is null
        and r.refusals > c_more_than;
      v_title := v_first.full_name || ' hit "No access" ' || v_first.refusals || ' times yesterday';
      v_body := 'An old link or bookmark can do this, or someone trying screens or actions they '
        || 'can''t use. Open their profile to see who they are and what they do.';
      v_link := '/people/' || v_first.member_id;
    else
      v_title := v_count || ' people hit "No access" more than ' || c_more_than
        || ' times yesterday';
      v_body := v_names || '. An old link or bookmark can do this, or someone trying screens or '
        || 'actions they can''t use.';
      v_link := '/people';
    end if;

    perform app.notify(array[v_owner], 'access_refusals', left(v_title, 200), left(v_body, 2000),
      v_link, null, null, jsonb_build_object('day', v_day, 'members', v_rows), null);

    update public.access_refusals set noted_at = p_now
    where org_id = v_org.id and day = v_day and noted_at is null and refusals > c_more_than;
    v_notes := v_notes + 1;
  end loop;
  return v_notes;
end;
$$;
comment on function public.access_refusals_daily(timestamptz) is
  'v7.5 Q6, service_role only (pg_cron access_refusals_daily, 08:11 IST): for the IST day before '
  'p_now, one access_refusals notification to each organisation''s Owner naming every member '
  'refused more than 20 times, each day noted once (noted_at). Returns how many notes it wrote.';
revoke all on function public.access_refusals_daily(timestamptz) from public, anon, authenticated;
grant execute on function public.access_refusals_daily(timestamptz) to service_role;

-- 4. The kind --------------------------------------------------------------------------------------
insert into public.notification_kinds (kind, actionable, always_email, in_app, description) values
  ('access_refusals', false, false, true,
   'Someone was refused ("No access") more than 20 times in a day (to the Owner, the next morning)');

-- 08:11 IST (02:41 UTC), after the 08:00 digest.
select cron.schedule('access_refusals_daily', '41 2 * * *',
  $$select public.access_refusals_daily(now())$$);
