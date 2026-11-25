-- v3.5 "Month close", U4 (the U3 review's should-fix 2): app.month_snapshot_figures removes the names only
-- where the snapshot keeps names, not every key called "label" or "title" at any depth (WORKFLOWS §7.4
-- "As built (U4)").
--
-- U3's version (migration v35_month_correct, frozen) removed client_name, project_name, title, full_name and
-- label wherever they appeared. In the schema 1 document every one of those keys is a name, so the result was
-- right; but a section added later (v3.0's people report and client-work progress, WORKFLOWS §7.1 Q2) may
-- carry a "label" or a "title" that is a figure's meaning, and a change to it would have read "Nothing
-- changed." This version removes exactly the names of the schema 1 document, by path:
--   revenue.cycles[]            client_name, project_name, label (the cycle's label, "October 2026")
--   revenue.cycles[].items[]    title
--   revenue.projects[]          client_name, project_name
--   revenue.advances[]          client_name, project_name
--   revenue.totals.by_client[]  client_name
--   expenses[]                  full_name
--   month_summary[]             full_name
-- Every other key, at any depth, is compared exactly (jsonb equality). A renamed client, project, cycle,
-- deliverable or person alone is still "Nothing changed." (WORKFLOWS §7.1), as in U3.
--
-- EXPAND-ONLY: one internal function replaced in place (same signature, same grants: service_role only);
-- nothing stored changes. month_correct calls it by name, so it follows at once. Append-only.

create or replace function app.month_snapshot_figures(p_data jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v jsonb;
  r record;
begin
  if p_data is null then
    return null;
  end if;
  if jsonb_typeof(p_data) <> 'object' then
    return p_data;
  end if;
  v := p_data;

  -- The cycles, and each cycle's deliverables.
  if jsonb_typeof(v #> '{revenue,cycles}') = 'array' then
    v := jsonb_set(v, '{revenue,cycles}', (
      select coalesce(jsonb_agg(
        case
          when jsonb_typeof(c.value) <> 'object' then c.value
          when jsonb_typeof(c.value -> 'items') = 'array' then
            jsonb_set(c.value - array['client_name', 'project_name', 'label'], '{items}', (
              select coalesce(jsonb_agg(
                case when jsonb_typeof(i.value) = 'object' then i.value - 'title' else i.value end
                order by i.n), '[]'::jsonb)
              from jsonb_array_elements(c.value -> 'items') with ordinality i(value, n)))
          else c.value - array['client_name', 'project_name', 'label']
        end
        order by c.n), '[]'::jsonb)
      from jsonb_array_elements(v #> '{revenue,cycles}') with ordinality c(value, n)));
  end if;

  -- The other lists that copy a name.
  for r in
    select t.path, t.keys
    from (values
      ('{revenue,projects}'::text[], array['client_name', 'project_name']),
      ('{revenue,advances}'::text[], array['client_name', 'project_name']),
      ('{revenue,totals,by_client}'::text[], array['client_name']),
      ('{expenses}'::text[], array['full_name']),
      ('{month_summary}'::text[], array['full_name'])
    ) t(path, keys)
  loop
    if jsonb_typeof(v #> r.path) = 'array' then
      v := jsonb_set(v, r.path, (
        select coalesce(jsonb_agg(
          case when jsonb_typeof(e.value) = 'object' then e.value - r.keys else e.value end
          order by e.n), '[]'::jsonb)
        from jsonb_array_elements(v #> r.path) with ordinality e(value, n)));
    end if;
  end loop;

  return v;
end;
$$;
revoke all on function app.month_snapshot_figures(jsonb) from public, anon, authenticated;
grant execute on function app.month_snapshot_figures(jsonb) to service_role;
comment on function app.month_snapshot_figures(jsonb) is
  'v3.5 U3, paths since U4 (WORKFLOWS §7.4): a snapshot document without the names it copies, by path only '
  '(revenue.cycles[] client_name, project_name, label; their items[] title; revenue.projects[] and '
  'revenue.advances[] client_name, project_name; revenue.totals.by_client[] client_name; expenses[] and '
  'month_summary[] full_name); every other key is kept. What month_correct compares, so a rename alone is not '
  'a change. Internal (service_role).';
