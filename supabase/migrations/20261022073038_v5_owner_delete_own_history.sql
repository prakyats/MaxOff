-- v1.8 V5b-0 item 8, own history never blocks Delete (owner, 22 Oct 2026, confirmed to the
-- integrator; DATA-MODEL §2 "The Owner-only Delete of what was never used", PERMISSIONS ⁵,
-- WORKFLOWS §3.7). Replaces the 6c judgement of 20261022055442_v5_owner_delete_unused, which counted
-- any history beyond the row's creation as use: a task type renamed once, a contact archived, a draft
-- client edited could never be deleted.
--
-- The rule now: only OTHER records count as "used" (a task with the type, a person with the job title,
-- a claim in the category, a field value, a client's projects, tasks or files, and every foreign key
-- into the table in any state, as before), and so does history ABOUT other records that names the row
-- (a task that once had the type, a claim that once sat in the category, a value under a field's key).
-- The row's OWN lifecycle never blocks: created, renamed, reordered, edited, archived, restored, i.e.
-- every activity_log row on the row's own tables (audit_row_change's and the transitions'). The delete
-- still writes its 'deleted' history row first, with the name.
--
-- Expand-only: `create or replace` of the internal history check (same signature, so unused_usage and
-- unused_delete, which call it through unused_reference_found, follow at once) and new comments. No
-- table, column, policy or grant changes; no row is touched by the migration.

create or replace function app.unused_history_found(p_id uuid, p_own text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
      select 1 from public.activity_log a
      where (a.entity_id = p_id
             or strpos(a.diff::text, p_id::text) > 0
             or strpos(a.meta::text, p_id::text) > 0)
        -- Its own lifecycle (any action on its own tables) is never use (item 8).
        and not (a.entity = any (p_own)))
    or exists (
      select 1 from public.notifications n
      where n.entity_id = p_id
         or strpos(n.payload::text, p_id::text) > 0
         or strpos(coalesce(n.link, ''), p_id::text) > 0)
    or exists (select 1 from public.client_work_alerts w where w.entity_id = p_id);
$$;
revoke all on function app.unused_history_found(uuid, text[]) from public, anon, authenticated;
grant execute on function app.unused_history_found(uuid, text[]) to service_role;
comment on function app.unused_history_found(uuid, text[]) is
  'V5b-0 item 8 (replacing V5a 6c), internal: true when another record''s history names the id (an '
  'activity_log row on any table but the row''s own, by entity_id, diff or meta), or a notification '
  '(entity_id, payload or link) or a client-work alert names it. The row''s own lifecycle (every '
  'activity_log row on the given tables: created, renamed, reordered, edited, archived, restored) never '
  'counts.';

comment on function app.unused_reference_found(text, uuid, uuid) is
  'V5b-0 item 8 (replacing V5a 6c), internal: true when another record uses or used the row: any foreign '
  'key into its table in any state, another record''s history, a notification or alert naming it, a '
  'field''s values or value history under its key, a draft client''s notes or brand, a primary contact '
  'with other live contacts. The row''s own lifecycle history never counts.';

comment on function public.unused_usage(text, uuid) is
  'V5a 6c, V5b-0 item 8: the Owner only. {used: boolean} for a task type, job title, expense category, '
  'field, draft client or contact: whether another record uses or used it (its own history never '
  'counts; no count, nothing about what). Reads only.';

comment on function public.unused_delete(text, uuid) is
  'V5a 6c, V5b-0 item 8 (owner 2026-10-22): the Owner only. Deletes a task type, job title, expense '
  'category, field, draft client or contact that no other record uses or used (app.unused_reference_found, '
  'checked with the row locked; its own lifecycle history never blocks); INVALID_STATE "In use — archive '
  'it instead." (a client: "In use — it stays.") otherwise, and for the last active task type. One '
  'activity_log row first (entity = the table, action deleted, meta {name, kind} and a contact''s '
  'client_id), then the row (a client with its empty brand and private rows).';
