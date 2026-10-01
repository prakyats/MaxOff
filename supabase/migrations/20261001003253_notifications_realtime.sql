-- 5.1 (unit 5A, the bell): the in-app bell updates live (ADR-0009, ARCHITECTURE §10; owner
-- approval 2026-10-01). Supabase Realtime sends `postgres_changes` only for tables in the
-- `supabase_realtime` publication, and until now it held none.
--
-- Expand-only: no data, no function and no policy changes. `notifications` is the ONLY table in
-- the publication (pgTAP 46): Realtime checks each change against the subscriber's RLS
-- (`notifications_select`: recipient_id = auth.uid()), so a member receives their own rows and
-- nobody else's, the same rows the API already lets them read. A row never carries money or text
-- its recipient may not see (kickoff 5 decisions 24 and 25, pgTAP 40/41/43). Money tables stay out
-- of every publication (ADR-0007; pgTAP 26 for expense_claims). The browser treats an event as a
-- signal to re-read the screen, never as data to show (ARCHITECTURE §10).
--
-- The replica identity stays the default (the primary key): an UPDATE (a read receipt) sends the
-- new row only.

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$$;
