-- v1.4.0 (owner decision 2026-10-06, 5B decision 11): the daily removal of read notifications older
-- than 90 days is switched on. public.notifications_remove_read (migration notifications_read_removal,
-- pgTAP 57) runs every day at 03:30 IST (22:00 UTC; pg_cron runs in UTC), after the 03:00 IST
-- storage_cleanup. Unread notifications are never removed, however old; a read one's deliveries go with
-- it (cascade); every business record, comment and activity entry is kept (invariant 9). One run at a
-- time (the function's advisory lock); a re-run removes nothing more.
--
-- Expand-only: one cron job, and the function's comment.

select cron.schedule('notifications_remove_read', '0 22 * * *',
  $$select public.notifications_remove_read(now(), false)$$);

comment on function public.notifications_remove_read(timestamptz, boolean) is
  '5B decision 11 (owner 2026-10-01), service_role only: removes read notifications created more '
  'than 90 days before p_now, with their deliveries (cascade); unread ones stay. p_dry_run (the '
  'default) only counts. Returns (notifications, deliveries) removed or that would be. Scheduled '
  '(owner 2026-10-06): pg_cron notifications_remove_read, daily at 03:30 IST (22:00 UTC), p_dry_run '
  'false.';
