-- v7.5 Q2 review (advisor, 26 Nov 2026): a new member can never be inserted with second_step on. Only
-- second_step_set() turns it on, for its caller, from a session that passed the second step; without
-- this an invite through the API could set it on an Admin who never set up an authenticator.
--
-- Expand-only: app.members_insert_guard() re-created (the same trigger function, the same checks as
-- migration freelancers, plus one).

create or replace function app.members_insert_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- An invite through the API starts as 'invited'; only the accept / deactivate transition
  -- functions (1.2, 1.3) move status and its timestamps.
  if not app.in_transition()
     and (new.status <> 'invited' or new.joined_at is not null or new.deactivated_at is not null) then
    perform app.fail('FORBIDDEN', 'A new member starts as invited.');
  end if;
  -- 4A: a freelancer is added through member_add_freelancer() (the coordinator row comes with it).
  if not app.in_transition() and new.engagement = 'freelance' then
    perform app.fail('FORBIDDEN', 'Add a freelancer through Add person.');
  end if;
  -- v7.5 Q2: two-step sign-in is the member's own to turn on (second_step_set()).
  if new.second_step then
    perform app.fail('FORBIDDEN', 'Two-step sign-in is turned on by the member themselves.');
  end if;
  return new;
end;
$$;

comment on function app.members_insert_guard() is
  'BEFORE INSERT on members: outside a transition function a new row is invited, with no '
  'joined_at or deactivated_at, and never a freelancer (member_add_freelancer() creates those); '
  'and never with second_step on (v7.5 Q2: only second_step_set() turns it on, for its caller).';
