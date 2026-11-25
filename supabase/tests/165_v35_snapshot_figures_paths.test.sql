-- v3.5 "Month close", U4 (the U3 review's should-fix 2; migration v35_snapshot_figures_paths):
-- app.month_snapshot_figures removes the names a schema 1 document copies, by path, and nothing else.
--   1. every name of the schema 1 document is removed (a rename alone is "Nothing changed.");
--   2. a "label" or "title" anywhere else is kept, so a change to it is a change (a later section's label may
--      carry meaning: v3.0's people report and client-work progress);
--   3. figures beside the names are kept; the order of a list is kept; non-objects and null pass through;
--   4. it stays internal (service_role only).
-- Pure function calls on literal documents: no table is read or written. Every name here is neutral.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

create function pg_temp.doc(p_client text, p_label text, p_title text, p_person text) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'schema', 1,
    'month', '2026-09-01',
    'revenue', jsonb_build_object(
      'cycles', jsonb_build_array(jsonb_build_object(
        'cycle_id', 'c1', 'label', p_label, 'client_name', p_client, 'project_name', p_client || ' reels',
        'amount', 30000, 'potential', 30000,
        'items', jsonb_build_array(
          jsonb_build_object('item_id', 'i1', 'title', p_title, 'value', 10000, 'achieved', true),
          jsonb_build_object('item_id', 'i2', 'title', p_title || ' 2', 'value', 20000, 'achieved', false)))),
      'projects', jsonb_build_array(jsonb_build_object(
        'project_id', 'p1', 'client_name', p_client, 'project_name', p_client || ' film', 'amount', 60000)),
      'advances', jsonb_build_array(jsonb_build_object(
        'advance_id', 'a1', 'event', 'received', 'client_name', p_client, 'project_name', p_client || ' film',
        'amount', 5000)),
      'totals', jsonb_build_object(
        'potential', 90000,
        'by_client', jsonb_build_array(jsonb_build_object('client_id', 'k1', 'client_name', p_client,
          'potential', 90000)),
        'by_category', jsonb_build_array(jsonb_build_object('category', 'retainer', 'potential', 30000)))),
    'expenses', jsonb_build_array(jsonb_build_object('member_id', 'm1', 'full_name', p_person, 'approved', 1200)),
    'month_summary', jsonb_build_array(jsonb_build_object('id', 'm1', 'full_name', p_person, 'days_worked', 20)));
$$;

-- 1. The names, by path ----------------------------------------------------------------------------------------
select is(app.month_snapshot_figures(pg_temp.doc('First client', 'September 2026', 'Reel', 'First person')),
          app.month_snapshot_figures(pg_temp.doc('Renamed client', 'Sept', 'Renamed reel', 'Renamed person')),
          'a renamed client, project, cycle label, deliverable and person alone compare equal');
select ok(not (app.month_snapshot_figures(pg_temp.doc('A', 'L', 'T', 'P')) #> '{revenue,cycles,0}') ?| array['client_name', 'project_name', 'label'],
          'a cycle keeps no client, project or label');
select ok(not (app.month_snapshot_figures(pg_temp.doc('A', 'L', 'T', 'P')) #> '{revenue,cycles,0,items,0}') ? 'title',
          'a deliverable keeps no title');
select ok(not (app.month_snapshot_figures(pg_temp.doc('A', 'L', 'T', 'P')) #> '{revenue,projects,0}') ?| array['client_name', 'project_name']
          and not (app.month_snapshot_figures(pg_temp.doc('A', 'L', 'T', 'P')) #> '{revenue,advances,0}') ?| array['client_name', 'project_name']
          and not (app.month_snapshot_figures(pg_temp.doc('A', 'L', 'T', 'P')) #> '{revenue,totals,by_client,0}') ? 'client_name',
          'a one-time line, an advance and a client total keep no names');
select ok(not (app.month_snapshot_figures(pg_temp.doc('A', 'L', 'T', 'P')) #> '{expenses,0}') ? 'full_name'
          and not (app.month_snapshot_figures(pg_temp.doc('A', 'L', 'T', 'P')) #> '{month_summary,0}') ? 'full_name',
          'an expense total and a month summary keep no person''s name');

-- 2. A label or a title anywhere else is kept ------------------------------------------------------------------
select isnt(app.month_snapshot_figures(pg_temp.doc('A', 'L', 'T', 'P') || '{"people": [{"id": "m1", "label": "On time"}]}'),
            app.month_snapshot_figures(pg_temp.doc('A', 'L', 'T', 'P') || '{"people": [{"id": "m1", "label": "Late"}]}'),
            'a label in another section is compared: a changed one is a change');
select isnt(app.month_snapshot_figures(pg_temp.doc('A', 'L', 'T', 'P') || '{"client_work": {"title": "8 of 10"}}'),
            app.month_snapshot_figures(pg_temp.doc('A', 'L', 'T', 'P') || '{"client_work": {"title": "9 of 10"}}'),
            'and a title');
select isnt(app.month_snapshot_figures(jsonb_set(pg_temp.doc('A', 'L', 'T', 'P'), '{revenue,totals,by_category,0,label}', '"x"')),
            app.month_snapshot_figures(jsonb_set(pg_temp.doc('A', 'L', 'T', 'P'), '{revenue,totals,by_category,0,label}', '"y"')),
            'and a label inside revenue where no name is kept (a category total)');
select isnt(app.month_snapshot_figures(jsonb_set(pg_temp.doc('A', 'L', 'T', 'P'), '{expenses,0,title}', '"x"')),
            app.month_snapshot_figures(jsonb_set(pg_temp.doc('A', 'L', 'T', 'P'), '{expenses,0,title}', '"y"')),
            'and a title beside an expense total (only full_name is that list''s name)');

-- 3. Figures are kept, and the rest passes through -------------------------------------------------------------
select isnt(app.month_snapshot_figures(pg_temp.doc('A', 'L', 'T', 'P')),
            app.month_snapshot_figures(jsonb_set(pg_temp.doc('A', 'L', 'T', 'P'), '{revenue,cycles,0,items,1,value}', '25000')),
            'a deliverable''s value beside its title is still compared');
select is(app.month_snapshot_figures(pg_temp.doc('A', 'L', 'T', 'P')) #>> '{revenue,cycles,0,items,1,item_id}', 'i2',
          'the deliverables keep their order');
select is(app.month_snapshot_figures('[1, {"label": "x"}]'::jsonb), '[1, {"label": "x"}]'::jsonb,
          'a document that is not an object passes through');
select is(app.month_snapshot_figures(null), null, 'and null is null');

-- 4. Internal ----------------------------------------------------------------------------------------------------
select ok(not has_function_privilege('authenticated', 'app.month_snapshot_figures(jsonb)', 'execute')
          and not has_function_privilege('anon', 'app.month_snapshot_figures(jsonb)', 'execute')
          and has_function_privilege('service_role', 'app.month_snapshot_figures(jsonb)', 'execute'),
          'service_role only, as in U3');

select * from finish();
rollback;
