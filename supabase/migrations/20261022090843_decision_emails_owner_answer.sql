-- v1.9 W3 follow-up: the owner's answer to the 6b.9 question (2026-10-22, issue #89): a standalone
-- comp leave grant, comp leave granted from an extra work note and an expense claim marked paid are
-- never emailed either (push and in-app only, like an approval); a declined extra work note and a
-- revoked grant keep the fallback email. WORKFLOWS §9 "Decision emails"; DATA-MODEL notifications.
-- app.notify() is re-created with the same signature; only the no_email rule changes.
-- Expand-only. Append-only: never edit once applied.

create or replace function app.notify(
  p_recipients uuid[],
  p_kind text,
  p_title text,
  p_body text default null,
  p_link text default null,
  p_entity text default null,
  p_entity_id uuid default null,
  p_payload jsonb default '{}'::jsonb,
  p_actor uuid default auth.uid(),
  p_escalation_level integer default 0
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target record;
  v_seen uuid[] := '{}';
  v_count integer := 0;
  v_id uuid;
  v_title text;
  v_payload jsonb;
  v_no_email boolean;
begin
  if p_kind is null or not exists (select 1 from public.notification_kinds k where k.kind = p_kind) then
    perform app.fail('VALIDATION', format('"%s" is not a notification kind.', coalesce(p_kind, '')));
  end if;
  if nullif(btrim(coalesce(p_title, '')), '') is null then
    perform app.fail('VALIDATION', 'A notification needs a title.');
  end if;

  -- v1.9 W3 (6b.9, kickoff 6b decision 6): an approved attendance day, leave (comp leave included) or
  -- expense claim is never emailed. The decision is the one this transaction audited on the record:
  -- 'approved' (rejected, corrected, cancelled, changed and paid keep the actionable fallback).
  v_no_email := coalesce((p_kind in ('attendance_decided', 'leave_decided', 'expense_decided')
                 and p_entity_id is not null
                 and exists (select 1 from public.activity_log a
                             where a.entity = p_entity and a.entity_id = p_entity_id
                               and a.at = now() and a.action = 'approved'))
    -- The owner's answer (2026-10-22, #89): good news is never emailed either: a standalone comp
    -- leave grant, comp leave granted from an extra work note, an expense claim marked paid. A
    -- declined extra work note (no comp leave) and a revoked grant keep the fallback.
    or p_kind = 'comp_leave_granted'
    or (p_kind = 'extra_work_decided' and coalesce(p_payload, '{}'::jsonb) ->> 'decision' = 'grant')
    or (p_kind = 'expense_decided' and coalesce(p_payload, '{}'::jsonb) ->> 'decision' = 'paid'), false);

  -- Each named recipient in turn: an active member gets the row; a freelancer's row goes to their
  -- current coordinator, worded for them (ADR-0013 §4); anyone else (deactivated, invited, unknown)
  -- is dropped. The actor is never told (kickoff 5 decision 2), and a person reached twice (two
  -- roles, or two freelancers with one coordinator) gets one row.
  for v_target in
    select
      case when m.engagement = 'freelance' then app.coordinator_of(m.id) else m.id end as recipient_id,
      m.org_id,
      case when m.engagement = 'freelance' then m.id end as for_member_id,
      case when m.engagement = 'freelance' then m.full_name end as for_member_name
    from unnest(p_recipients) with ordinality as r(id, ord)
    join public.members m on m.id = r.id and m.status = 'active'
    order by r.ord
  loop
    if v_target.recipient_id is null or v_target.recipient_id = p_actor or v_target.recipient_id = any (v_seen) then
      continue;
    end if;
    if not exists (select 1 from public.members c where c.id = v_target.recipient_id and c.status = 'active') then
      continue;
    end if;
    v_seen := array_append(v_seen, v_target.recipient_id);
    v_title := left(btrim(p_title), 200);
    v_payload := coalesce(p_payload, '{}'::jsonb);
    if v_target.for_member_id is not null then
      v_title := left(btrim(p_title) || ' · for ' || v_target.for_member_name, 200);
      v_payload := v_payload || jsonb_build_object('for_member_id', v_target.for_member_id);
    end if;
    insert into public.notifications (
      org_id, recipient_id, actor_id, kind, title, body, link, entity, entity_id, payload, escalation_level,
      no_email)
    values (
      v_target.org_id, v_target.recipient_id, p_actor, p_kind, v_title, left(p_body, 2000), p_link,
      p_entity, p_entity_id, v_payload, coalesce(p_escalation_level, 0), v_no_email)
    returning id into v_id;
    insert into public.notification_deliveries (notification_id, channel) values (v_id, 'push');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
comment on function app.notify(uuid[], text, text, text, text, text, uuid, jsonb, uuid, integer) is
  '5.1, service_role only (called by the transition functions and jobs, ADR-0006): one '
  'notifications row per remaining recipient plus a queued push delivery each. Drops the actor, '
  'duplicates and anyone not active; a freelancer''s row goes to their current coordinator with '
  '" · for <name>" on the title and payload.for_member_id (ADR-0013 §4; nobody when they have '
  'none, or the coordinator is the actor). Email rows are the dispatcher''s (notification_kinds). '
  'Returns the number of rows written. Never pass money in the title, body, link or payload. '
  'v1.9 W3 (6b.9): no_email is set on an attendance_decided, leave_decided or expense_decided row '
  'about a record this transaction audited ''approved'', on comp_leave_granted, on extra_work_decided '
  'with payload decision grant and on expense_decided with payload decision paid (owner 2026-10-22): '
  'good news is never emailed.';
revoke all on function app.notify(uuid[], text, text, text, text, text, uuid, jsonb, uuid, integer) from public, authenticated;
grant execute on function app.notify(uuid[], text, text, text, text, text, uuid, jsonb, uuid, integer) to service_role;
