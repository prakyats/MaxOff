-- 5B decision 11 (owner, 2026-10-01): read notifications older than 90 days are removed; unread
-- ones stay, and every business record, comment and activity entry is kept forever (invariant 9).
-- The owner's reason: an alert is a pointer to a record; the record and its history remain, so
-- removing old read pointers loses nothing. This is the owner's deliberate exception to "nothing
-- is deleted", for `notifications` rows only and their `notification_deliveries` (which cascade).
--
-- **Built, not scheduled** (owner, 2026-10-02: "the 90-day delete of read notifications needs my
-- explicit OK before it is scheduled"). No cron.schedule here; pgTAP proves no job calls it. At the
-- review the owner sees this function's pgTAP and, from the preview workflow's staging dry run,
-- how many rows it would remove. Scheduling it is a later migration, after that OK.
--
-- Expand-only: one new function, nothing else.

create function public.notifications_remove_read(p_now timestamptz default now(), p_dry_run boolean default true)
returns table (notifications integer, deliveries integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_notifications integer;
  v_deliveries integer;
begin
  -- One run at a time.
  perform pg_advisory_xact_lock(hashtext('public.notifications_remove_read'));

  select count(*)::integer into v_deliveries
  from public.notification_deliveries d
  join public.notifications n on n.id = d.notification_id
  where n.read_at is not null and n.created_at < p_now - interval '90 days';

  if p_dry_run then
    select count(*)::integer into v_notifications
    from public.notifications n
    where n.read_at is not null and n.created_at < p_now - interval '90 days';
  else
    -- Their deliveries go with them (on delete cascade).
    delete from public.notifications n
    where n.read_at is not null and n.created_at < p_now - interval '90 days';
    get diagnostics v_notifications = row_count;
  end if;

  return query select v_notifications, v_deliveries;
end;
$$;
comment on function public.notifications_remove_read(timestamptz, boolean) is
  '5B decision 11 (owner 2026-10-01), service_role only: removes read notifications created more '
  'than 90 days before p_now, with their deliveries (cascade); unread ones stay. p_dry_run (the '
  'default) only counts. Returns (notifications, deliveries) removed or that would be. NOT '
  'scheduled: scheduling waits for the owner''s explicit OK.';
revoke all on function public.notifications_remove_read(timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.notifications_remove_read(timestamptz, boolean) to service_role;
