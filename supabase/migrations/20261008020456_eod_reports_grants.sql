-- 6.5 follow-up: eod_reports keeps only SELECT for the API role, in its own migration.
--
-- Why a separate file: 20261007130000_eod_report_weekly_digest.sql created public.eod_reports with
-- `grant select ... to authenticated` but no revoke, so the table also kept the schema's default
-- grants for the API roles (anon and authenticated: INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES,
-- TRIGGER). The revoke was first appended to that file after its push had already been applied to
-- the shared staging database, which recorded the version without it. An applied migration is never
-- edited (CLAUDE.md, engineering rule 7), so that file is restored to what staging ran and the
-- revoke lives here, applied after it everywhere (staging, production, a fresh database).
--
-- The end state: anon holds nothing on eod_reports; authenticated holds SELECT only (RLS then
-- limits it to reports.all, the Owner). The eod_report job writes as the table owner; no API role
-- inserts, updates or deletes a report. Idempotent: revoke and grant may run any number of times.

revoke all on public.eod_reports from anon, authenticated;
grant select on public.eod_reports to authenticated;
