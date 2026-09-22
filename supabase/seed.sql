-- Dev seed, loaded by `pnpm db:reset` after the migrations (config.toml [db.seed]).
-- Real data never goes into local or staging (ARCHITECTURE §2).
-- 1.1: the organization (org_settings follows by trigger). People arrive with 1.2's CEO
-- bootstrap and seeded users; the Pixora lists with 1.3/1.4.

insert into public.organizations (name)
select 'Pixora Clips'
where not exists (select 1 from public.organizations);
