-- v1.9 W4: working hours ON at release (owner-approved 2026-10-29, in the W4 builder session; ROADMAP
-- v1.9 W4; WORKFLOWS §1 "Working hours, late starts and leaving early": "Switched on by a setting";
-- DATA-MODEL org_settings).
--
-- W0 shipped every working-hours rule behind org_settings.working_hours_on, default false, so the
-- database could go to staging before the screens. W4 ships the screens, so the release turns the
-- rules on: the column's default becomes true (a new organisation starts with them on) and every
-- existing organisation is switched on. The Owner can turn them off again in Settings → Thresholds
-- (Working day), which is an ordinary audited settings save.
--
-- The switch-on is audited per organisation: audit_row_change() records each row's change, labelled
-- 'working_hours_on' with the source in meta (app.audit_override is consumed by the first audited
-- write, so it is set once per row). The actor is null: a migration has no signed-in member.
--
-- Expand-only (ARCHITECTURE §18): no column added, renamed or dropped; one default changed and one
-- boolean set. Append-only: never edit once applied (a pushed migration counts as applied).

alter table public.org_settings alter column working_hours_on set default true;

do $$
declare
  v_org uuid;
begin
  for v_org in
    select s.org_id from public.org_settings s where not s.working_hours_on order by s.org_id
  loop
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'working_hours_on',
      'meta', jsonb_build_object('source', 'migration', 'migration', 'working_hours_on'))::text, true);
    update public.org_settings set working_hours_on = true where org_id = v_org;
  end loop;
  perform set_config('app.audit_override', '', true);
end;
$$;

comment on column public.org_settings.working_hours_on is
  'v1.9 W0 (6b.1): the working-hours rules (Late, the end time, Ask to leave early, the start and '
  'end-time reminders) apply only while true. On by default since the v1.9 release (W4, migration '
  'working_hours_on); the Owner can turn it off in Settings → Thresholds.';
