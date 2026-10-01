-- 5.1 (migration notifications_realtime): `notifications` is in the supabase_realtime publication
-- and is the only table there (no money table, ADR-0007); its replica identity is the default, so
-- an UPDATE event sends the new row only; Realtime authorises each change with the subscriber's
-- RLS, which hands a member only their own rows (the e2e `notifications.spec` proves the delivery
-- itself: another member subscribed never receives the row).
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

select ok(exists (select 1 from pg_publication where pubname = 'supabase_realtime'),
  'the supabase_realtime publication exists');
select is(
  (select array_agg((schemaname || '.' || tablename)::text order by tablename)
     from pg_publication_tables where pubname = 'supabase_realtime'),
  array['public.notifications']::text[],
  'notifications is the only table Realtime publishes');
select ok(not exists (
    select 1 from pg_publication_tables
    where tablename in ('expense_claims', 'revenue_entries', 'client_private', 'org_settings')),
  'no money or Owner-only table is in any publication');
select is((select relreplident::text from pg_class where oid = 'public.notifications'::regclass),
  'd', 'notifications keeps the default replica identity (an UPDATE sends the new row only)');

-- RLS as Realtime applies it: the subscriber's claims, role authenticated.
insert into public.notifications (org_id, recipient_id, kind, title)
select m.org_id, m.id, 'end_day_reminder', 'Realtime fixture for the Owner'
from public.members m where m.id = '10000000-0000-4000-8000-000000000001';
insert into public.notifications (org_id, recipient_id, kind, title)
select m.org_id, m.id, 'end_day_reminder', 'Realtime fixture for Staff'
from public.members m where m.id = '10000000-0000-4000-8000-000000000003';

create function pg_temp.as_member(id uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', id::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', id, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

select pg_temp.as_member('10000000-0000-4000-8000-000000000003');
select is((select count(*)::int from public.notifications where title like 'Realtime fixture%'), 1,
  'Staff sees one fixture row');
select is((select title from public.notifications where title like 'Realtime fixture%'),
  'Realtime fixture for Staff', 'and it is their own');
select is((select count(*)::int from public.notifications
           where recipient_id = '10000000-0000-4000-8000-000000000001'), 0,
  'Staff never sees the Owner''s rows');

select pg_temp.as_member('10000000-0000-4000-8000-000000000002');
select is((select count(*)::int from public.notifications where title like 'Realtime fixture%'), 0,
  'an Admin sees neither');

reset role;
select pg_temp.as_member('10000000-0000-4000-8000-000000000001');
select is((select title from public.notifications where title like 'Realtime fixture%'),
  'Realtime fixture for the Owner', 'the Owner sees only their own');

reset role;
select * from finish();
rollback;
