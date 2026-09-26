# MaxOff: Data Model

> The authoritative list of tables. Migrations must match it. Change it here (and in an ADR for anything structural) **before** writing a migration.
> Conventions (ARCHITECTURE §6): `id uuid pk`, `created_at`, `updated_at` (trigger) and `created_by` on business tables. `archived_at` instead of delete. RLS on every table. Workflow `state` columns change **only** through transition functions.
> **Org seam:** root tables have `org_id uuid not null default current_org_id()`. Child tables inherit scope from their parent. There's one organization row in the prototype.

## 0. Enums (only for categories code depends on)
```
member_role        owner | admin | staff
member_status      invited | active | deactivated
attendance_choice  present | leave | half_day | comp_leave
day_status         present | leave | half_day | comp_leave | absent
attendance_state   awaiting_choice | pending_review | approved | corrected
leave_type         leave | half_day | comp_leave
leave_state        submitted | approved | rejected | withdrawn | superseded | cancelled
client_state       draft | active | paused | inactive
recurrence         one_time | weekly | monthly
project_state      open | in_progress | completed | cancelled
billing_category   retainer | project | additional
cycle_state        open | settled
item_state         open | done | approved | cancelled | carried
carry_decision     carry_forward | close | leave_pending
task_state         todo | in_progress | submitted | admin_approved | changes_requested | completed | cancelled
admin_step         required | none | skipped
priority           low | medium | high | urgent
task_type_kind     normal | event | custom          -- behaviour category; names are data
review_decision    approved | rejected
request_state      pending | converted | declined | withdrawn
billing_status     not_billed | billed
field_type         text | long_text | number | date | datetime | checkbox | select |
                   multi_select | url | email | phone | color | member | rating
                   -- deliberately NO currency type: money lives only in the Owner-only tables (§7)
```

## 0a. Base schema (task 0.2)
Extensions: `pg_cron` (in `pg_catalog`, jobs from 2.5), `pg_net` (in `extensions`). pgTAP is created by the test runner only, never in production.
Schema **`app`** holds the helpers every module uses. It's not exposed through the API. `authenticated` and `service_role` have usage and execute; `anon` has nothing. Every function in `app` (and every `security definer` function later) gets an explicit `revoke all ... from public` + `grant execute ... to authenticated, service_role`, because Postgres grants EXECUTE to PUBLIC on creation and a per-schema default privilege can't undo it. Consequence: a policy or default that calls `app.*` raises `42501` for `anon` instead of returning no rows, so no table may be readable by `anon` (fine: clients never log in).
```
app.set_updated_at()            BEFORE UPDATE row trigger: every table with updated_at attaches it
app.to_ist_date(timestamptz)    -> date in Asia/Kolkata (stable, strict; null in -> null out)
app.today_ist()                 -> app.to_ist_date(now())
app.fail(code, detail)          raises SQLSTATE P0001 with message = code, detail = the human reason
                                (ARCHITECTURE 4.3). Every transition function raises through it
app.is_working_day(date)        (1.4) false when the date's weekday is in org_settings.weekly_off_days
                                or a holidays row matches it, true otherwise. Stable, parallel safe,
                                security definer, scoped by app.current_org_id() so a service-role job
                                gets the same answer. **Null in, null out, and null when no single
                                organization is in scope** (none, or more than one): callers treat null
                                as "do not act", never as a working day, so a job cannot mark a team
                                absent on a Sunday. The TS mirror is core/time isWorkingDay()

-- Identity and audit helpers (task 1.1, ARCHITECTURE §5). All security definer, search_path = ''.
app.current_org_id()            the caller's org; with no member row (bootstrap, service role) the single
                                organizations row; null when there are none or several. Default of every
                                root table's org_id
app.current_member()            the caller's member row when status = 'active', else no row
app.has_permission(text)        caller's role has this key in role_permissions (active members only)
app.audit_row_change()          AFTER INSERT/UPDATE/DELETE row trigger writing activity_log:
                                entity = table name, action = insert|update|delete, entity_id = new/old.id
                                (or TG_ARGV[0] as the id column), diff = {old:{}, new:{}} of the changed
                                columns only (updated_at excluded), actor_id = auth.uid() or null (system).
                                A transition function that writes an audited table sets the transaction
                                setting app.audit_override = '{"action": "...", "meta": {...}}' first
                                (1.3): the trigger's row then carries the workflow action name and meta
                                (e.g. the deactivation reason) instead of a generic 'update', and the
                                function writes no second row. Consumed by the FIRST audited write of
                                the transaction, so set it right before the row it describes (a
                                function that writes a history row first labels that row instead)
app.in_transition()             true while the statement runs as the function owner (inside a security
                                definer transition function, a migration, a seed or a service-role job);
                                false for a direct API write as authenticated / anon. Nothing to switch on
app.protect_columns()           BEFORE UPDATE trigger; TG_ARGV = column names that may change only
                                while app.in_transition(). Raises FORBIDDEN otherwise. Every state
                                column gets it (ADR-0006 "trigger guard")
app.members_self_edit_guard()   BEFORE UPDATE on members: without team.manage only full_name and phone
                                change; the Owner row never loses its role outside a transition
app.members_insert_guard()      BEFORE INSERT on members: outside a transition a new row is invited,
                                with no joined_at / deactivated_at
app.create_org_settings()       AFTER INSERT on organizations: the org_settings row with launch defaults

-- Session and bootstrap functions (task 1.2, ADR-0012). public schema (RPC), security definer,
-- search_path = ''. EXECUTE is revoked from public AND anon explicitly: Supabase's default
-- privileges grant it to anon on every new public function.
public.session_login(user_agent, ip_hash)    inserts session_events(login) for the calling active
                                member (app.current_member()); UNAUTHENTICATED otherwise. Called
                                once per sign-in and once when a recovery link opens a session.
                                No activity_log row: the session_events row is the record
public.session_logout(user_agent, ip_hash)   the same for logout, then app.attendance_logout()
                                (2.1, §3): today's attendance day gets last_logout_at
public.bootstrap_owner(user_id, email, full_name, org_name)   service_role only. Creates the single
                                organization when none exists and the first, active Owner member for
                                an existing auth user; CONFLICT once any member exists. Called by
                                scripts/bootstrap-owner.mjs, which prints a one-time recovery link and
                                never handles a password

-- Team functions (task 1.3, WORKFLOWS §1a). public schema, security definer, search_path = '', the
-- same grants. Each one writes its activity_log row through app.audit_override (above).
public.member_invite(user_id, email, full_name, role, job_title_id)
                                team.manage. Inserts the invited member row for the auth user the action
                                just created with auth.admin.generateLink(type = invite). role is admin or
                                staff; CONFLICT when a member with that email exists; the auth user's
                                email must match. Audit action 'invited'
public.member_invite_refresh(member_id)
                                team.manage, member must be invited. Bumps invited_at; audit action
                                'invite_link_issued'. The action then generates a fresh link, and the
                                previous link stops working (GoTrue keeps one token per user)
public.member_self_status()     the caller's own status whatever it is (null with no row). RLS shows a
                                member row only to active members, so the invite link and set-password
                                steps read the status through this instead
public.member_accept_invite()   the caller's own row, invited → active with joined_at. Called by
                                setPassword() once the invited person's password is stored. Audit
                                action 'accepted'
public.member_deactivate(member_id, reason)
                                team.manage. active | invited → deactivated (deactivated_at). Never the
                                caller, never the Owner. Deletes the person's auth.refresh_tokens and
                                auth.sessions rows in the same transaction, so a live session cannot
                                refresh (ADR-0012). reason is optional free text, kept in meta.reason.
                                Audit action 'deactivated'
public.member_reactivate(member_id)
                                team.manage. deactivated → active when joined_at is set, otherwise back
                                to invited (they still have to accept). deactivated_at is cleared; the
                                activity log keeps the history. Audit action 'reactivated'
public.list_item_move(list_key, item_id, direction)
                                (1.4) lists.manage. Swaps an entry's `position` with the neighbour
                                above or below it (archived entries skipped) in ONE update that
                                touches no other column, so a reorder cannot revert a rename another
                                editor just made and the order is never half-written. Returns the
                                neighbour's id, or null at either end. A plain edit: the audit
                                trigger's two 'update' rows are the record
public.member_change_email(member_id, new_email)
                                (1.4) team.manage. Changes the login identity of an active, invited
                                or Owner row: CONFLICT when the address is another member's,
                                VALIDATION when it is malformed or unchanged. Writes members.email
                                only; the sign-in itself is moved by the action through
                                auth.admin.updateUserById(email_confirm: true), which is the
                                supported way and the reason this is not one transaction (the
                                action rolls the Auth change back when the rpc refuses). Sessions
                                are left alive: nothing reads the email from the JWT. Audit action
                                'email_changed', meta.from / meta.to
app.members_job_title_guard()   BEFORE INSERT/UPDATE on members: job_title_id, when set, is an
                                unarchived list_items row with list_key = 'job_title' of the same org
app.seed_org_lists()            AFTER INSERT on organizations: the launch job titles (PRODUCT §7)
```

## 1. Organization, people and access
```
organizations        id, name, logo_file_id (added in 3.3 with files), timezone ('Asia/Kolkata'), created_at, updated_at
                     -- API UPDATE grant: name only (timezone stays IST, invariant 8; phase 1 review)
org_settings         org_id pk, weekly_off_days smallint[] (0=Sun..6=Sat), logout_reminder_time time,
                     ack_repeat_hours int (2), ack_escalate_hours int (4), ack_escalate_owner_hours int (8),
                     overdue_escalate_hours int (24), email_daily_cap_per_member int (20),
                     default_task_reminders jsonb, workload_warning_threshold int
                     -- API UPDATE grant: the nine settings columns above, never org_id or the timestamps
                     -- defaults in brackets = launch settings (PRODUCT §7); default_task_reminders '[]' until
                     -- 5.3, workload_warning_threshold null until 4.3. Created by trigger with the organization
holidays             id, org_id, date, name, created_at, updated_at, unique(org_id, date)
                     -- API UPDATE grant: date, name
                     -- 1.4. RLS: every active member reads (a holiday is everyone's calendar);
                     -- insert/update/delete need settings.manage. Audited. The one configuration
                     -- table with a real DELETE (it has no archived_at): removing a mistyped date
                     -- is the Owner's, and audit_row_change() keeps the removed row. Deleting a
                     -- holiday never rewrites the past: attendance_days carries its own is_day_off
                     -- (2.1), decided on the day itself
members              id (= auth.users.id), org_id, full_name, email, phone, avatar_file_id (added in 3.3),
                     role member_role, job_title_id null → list_items (1.3), status member_status,
                     invited_at, joined_at, deactivated_at, created_at, updated_at
                     unique partial index (org_id) where role = 'owner'; unique index on lower(email)
                     -- status, invited_at, joined_at, deactivated_at are protected columns (transition
                     -- functions only, 1.2/1.3). RLS: own row; every row for team.view; writes team.manage;
                     -- own name/phone/avatar editable (PERMISSIONS §3). job_title_id is in the API
                     -- role's UPDATE grant, and app.members_self_edit_guard() keeps it team.manage-only
member_directory     view (security definer): id, org_id, full_name, phone, role, status, job_title_id,
                     created_at (+ avatar_file_id from 3.3). Everyone's row for team.view,
                     plus the caller's own.
                     No email (PERMISSIONS §2). Names of people on a member's own tasks join in 4.1
role_permissions     role member_role, permission text, pk(role, permission)   -- seeded
session_events       id, member_id, kind ('login'|'logout'), at, user_agent (≤ 512), ip_hash
                     -- append-only, written only by session_login() / session_logout() (1.2) and
                     -- attendance_touch() (2.1). ip_hash = salted SHA-256 of the client IP
                     -- (SESSION_IP_HASH_SALT) or null; never the IP, never an unsalted hash.
                     -- RLS: own rows; all for attendance.view_all
push_subscriptions   id, member_id, endpoint unique, p256dh, auth, user_agent, created_at,
                     platform ('android'|'ios'|'desktop'|'other'), is_standalone bool (PWA installed),
                     label (device name shown to the member), last_success_at, last_failure_at,
                     failure_count, disabled_at, disabled_reason ('gone'|'expired'|'signed_out'|
                     'deactivated'), last_test_at
                     -- kept across logout (title-only payloads); removed on "sign out of this
                     -- device" or deactivation. See PRODUCT §4.11 and WORKFLOWS §9a.
```

## 2. Configuration (customization as data)
```
list_items           id, org_id, list_key ('job_title'|...), name, description, color, icon,
                     position, meta jsonb, is_system, archived_at, created_at, updated_at
                     -- API UPDATE grant: name, description, color, icon, archived_at (position only through
                     -- list_item_move(); list_key, is_system and meta never through the API)
                     -- 1.3 (core/lists). unique (org_id, list_key, lower(name)) where archived_at is
                     -- null. RLS: every active member reads; insert/update need lists.manage; no
                     -- DELETE (archive instead). Audited. Seeded per organization by trigger with the
                     -- launch job titles (PRODUCT §7); 1.4 adds the Settings screen
task_types           id, org_id, name, kind task_type_kind, shows_on_calendar bool,
                     has_location bool, default_reminders jsonb, color, icon, position,
                     is_system, archived_at
                     -- seeds: Normal(normal), Shoot / Site Visit(event), Meeting(event),
                     --        Posting(event), Review / Approval(normal), Other(normal), Custom(custom)
stage_presets        id, org_id, name, stages text[] (ordered), archived_at
field_definitions    id, org_id, entity ('client'|'contact'|'project'|'item'|'task'),
                     client_id null (a field that exists for one client only),
                     task_type_id null (a field that exists for one task type only),
                     key, label, help_text, type field_type, options jsonb, required,
                     section, position, archived_at, unique(org_id, entity, key, client_id, task_type_id)
                     -- rows with entity in ('project','item') are Owner-only to create/edit (PERMISSIONS ¹)
```
Entities with custom fields have `custom_fields jsonb not null default '{}'`, validated against active definitions on every write (`core/custom-fields`).

## 3. Attendance and leave
```
attendance_days      id, member_id, work_date date (IST), first_login_at, is_day_off bool,
                     state attendance_state, submitted_choice attendance_choice null, submitted_at,
                     proposed_by_system bool (the absent check, or a day derived from approved leave,
                     or a system correction), final_status day_status null,
                     decided_by null (system), decided_at, decision_reason,
                     last_logout_at, logout_not_recorded bool, overtime_flag bool, overtime_reason,
                     worked_on_leave bool ("1 day worked": Present approved on an approved-leave day),
                     leave_request_id null, created_at, updated_at, unique(member_id, work_date)
                     -- 2.1. No org_id: the member carries it (like session_events). RLS: own rows,
                     -- all for attendance.view_all. NO insert/update/delete grant for the API role:
                     -- every change is a transition function, and the state columns carry
                     -- protect_columns as well. Audited through app.audit_override.
                     -- is_day_off is decided when the row is created and never re-derived from
                     -- today's holidays / weekly_off_days. Every time is the server clock (now());
                     -- session_events.user_agent / ip_hash are caller-supplied and are not evidence
attendance_events    id bigint identity, attendance_day_id, action ('submitted'|'proposed_absent'|'derived_from_leave'|
                     'approved'|'corrected'|'logout'|'overtime_flagged'), from_status, to_status, reason,
                     actor_id null (system), at                    -- append-only (no API writes);
                     -- readable with the parent day. Not audited: it is the history
leave_requests       id, member_id, type leave_type, start_date, end_date, reason,
                     state leave_state, source ('form'|'attendance'|'owner'), supersedes_id null,
                     requests_cancellation bool, decided_by null, decided_at, decision_reason,
                     created_at, updated_at
                     -- RLS and grants as attendance_days. Audited. Half day: start_date = end_date.
                     -- requests_cancellation (2.1): an employee's "cancel my approved leave" is a
                     -- new submitted row that supersedes the original; on approval the original AND
                     -- this row end cancelled, so "approved leave covering a date" is always
                     -- state = approved and nothing else
```
Functions (2.1, WORKFLOWS §1/§2). `public` schema (RPC), security definer, search_path = '', the usual grants. Each audited write is labelled through `app.audit_override`; a system correction carries `meta.system = true` (the audit trigger records the caller as actor). **No notification rows yet:** 5.1 adds them to every function below; the WORKFLOWS §9 recipient is named in each function's comment. The `app.*` helpers of this task that write or read across members (`attendance_event`, `attendance_apply_leave`, `attendance_release_leave`, `attendance_logout`, `leave_covering`, `leave_overlaps`, and since 2.2 `leave_supersede_gate`, `leave_clash`, `leave_clash_label`) are **executable by service_role only**: the security definer functions call them as the owner, and `00_core_base` lists them as the exception to "authenticated may execute app.*".
```
app.ist_day_start(date)         -> timestamptz: midnight IST of that date (stable). SQL mirror of
                                core/time istDayStart(); use it for "events on this IST date" so an
                                index on the timestamp still applies
public.attendance_touch(user_agent, ip_hash)
                                every active member. Writes session_events(login) when the caller has
                                none on today's IST date (a session kept across midnight). For an
                                Admin or Staff member with no day row yet: approved leave covering
                                today creates it approved (final_status = the leave type,
                                proposed_by_system, leave_request_id, event derived_from_leave; two
                                covering requests -> the most recently decided), otherwise
                                awaiting_choice. first_login_at = now(); is_day_off =
                                app.is_working_day(today) is false. Idempotent: a second call, or a
                                second device, gets the same row. Returns (day_id, work_date, state,
                                gate_required, is_day_off, final_status, proposed_by_system,
                                leave_request_id); whoever lacks attendance.self (the Owner) gets
                                gate_required = false and no day. Audit action 'opened' |
                                'derived_from_leave' | 'first_login' (a day the 23:59 job opened).
                                2.2: serialised per member (pg_advisory_xact_lock on 'touch:' ||
                                member id, taken first), so two devices at once give one day and one
                                login row. On the member's joining day (IST date of joined_at) and
                                before it: the login only, no day, gate_required = false. 2.5: the
                                day itself is opened by app.attendance_open_day (below)
public.attendance_submit(choice, reason, for_date)
                                attendance.self, today's own day. for_date (2.2, optional): the IST
                                date the gate screen was shown for; any other date is INVALID_STATE
                                ("The day changed. Choose again for today."). awaiting_choice -> pending_review;
                                or approved + proposed_by_system -> pending_review for choice =
                                present only ("I'm working today", leave_request_id kept). A leave
                                choice inserts leave_requests(source = attendance, today, submitted)
                                and links it. reason optional. Event submitted. Notifies nobody
public.attendance_decide(day_id, decision, status, reason)
                                attendance.decide. decision = 'approve' (pending_review only;
                                final_status = the submitted choice, or the proposed absent;
                                worked_on_leave when the choice was Present on a day linked to
                                approved leave, which stays untouched) or 'correct' (any state,
                                status required, REASON_REQUIRED without a reason; awaiting_choice
                                included, the gate then stops asking; Present on a date covered by
                                the linked approved leave sets worked_on_leave and that leave is
                                never touched, phase 2 review 2026-09-26). A linked submitted request is
                                decided in the same call: approved when the outcome equals its type,
                                otherwise rejected with the same reason. Correcting to a leave type
                                with no approved request of that type behind it creates
                                leave_requests(source = owner, approved) and links it. Events
                                approved | corrected. Bulk = one call per row. Notifies the member
app.attendance_logout(member_id)
                                called by session_logout() (re-created in 2.1, same signature).
                                Today's day gets last_logout_at = now() and an event logout; with no
                                day today, yesterday's day when it has a login and no logout (a real
                                time, never made up). ONLY those two writes: state, final_status and
                                decisions are never touched, an Owner-approved day included. The
                                Owner has no day: session_events only. 2.5: when yesterday's day
                                carries logout_not_recorded (the 00:00 job ran first), that same
                                write clears it, because a logout is now recorded
public.attendance_flag_overtime(day_id, reason)
                                attendance.self, own day, any state: overtime_flag = true and
                                overtime_reason, REQUIRED (VALIDATION when empty, 2.2; a second call
                                replaces the reason). Event overtime_flagged. No approval, no
                                notification
public.attendance_flag_overtime_today(reason)
                                attendance.self. The Log out note (phase 2 review, 2026-09-26):
                                attendance_flag_overtime() on the caller's day for today, or on
                                yesterday's when there is none today and yesterday has a login and
                                no logout, the day app.attendance_logout() will pick. INVALID_STATE
                                when neither exists. Returns the day id
public.leave_submit(type, start_date, end_date, reason)
                                attendance.self. start_date >= today, end_date >= start_date, at most
                                365 days (phase 2 review, 2026-09-26; app.leave_validate, shared by
                                leave_request_change and leave_owner_edit), half_day a single date,
                                reason optional (VALIDATION otherwise). CONFLICT when
                                the range overlaps the caller's own submitted or approved request;
                                rejected, withdrawn, superseded and cancelled rows never block.
                                source = form. Audit 'submitted'. Notifies the Owner
public.leave_withdraw(request_id)
                                own row, submitted -> withdrawn. Never a source = attendance request:
                                the attendance day is the single door for those. Audit 'withdrawn'
public.leave_request_change(request_id, type, start_date, end_date, reason, cancel)
                                own approved request that has not ended (2.3: end_date < today IST
                                -> INVALID_STATE "This leave has ended. Ask the Owner to correct it.";
                                ongoing leave stays changeable; past leave is the Owner's, through
                                the attendance day) -> a new submitted row with supersedes_id.
                                cancel = true copies type and dates and sets requests_cancellation;
                                otherwise the new dates are validated as in leave_submit (start may
                                stay the original's, end >= today) and checked for overlap against
                                everything but the original. One open change per request (CONFLICT).
                                The original stays approved until the decision. Audit
                                'change_requested' | 'cancellation_requested'. Notifies the Owner
public.leave_decide(request_id, decision, reason)
                                attendance.decide, submitted only, never source = attendance. reject
                                needs a reason (REASON_REQUIRED). approve: an original this row
                                supersedes becomes superseded (a cancellation: the original becomes
                                cancelled and this row too), then "a later leave wins" over every day
                                in range: pending_review (2.2: only a day not yet decided) ->
                                corrected to the leave type (actor null, reason "leave approved",
                                event corrected, and the gate's own still-submitted request for
                                that day is superseded); an untouched derived day follows the new
                                request; an awaiting_choice day in range -> the derived day. CONFLICT
                                when approved leave already covers the dates. 2.2: only a form or
                                owner request clashes (the message names its type and dates); an
                                approved source = attendance request on those dates is superseded
                                first (app.leave_supersede_gate) and its day, approved or corrected,
                                is corrected to this leave even when the type is the same. A day the
                                Owner decided, approved or corrected (not a gate leave), is kept and
                                its date returned.
                                Returns (state, kept_dates date[]) since 2.2. A cancellation (and a
                                superseded range) returns today's untouched derived day (approved,
                                proposed_by_system, no submission) to awaiting_choice (actor null,
                                reason "leave cancelled") so the gate asks again; past days are
                                history and stay. Audit 'approved' | 'rejected' | 'cancelled'
                                (+ 'superseded' | 'cancelled' on the original). Notifies the member
public.leave_owner_edit(request_id, type, start_date, end_date, reason)
                                attendance.decide, approved only: the original becomes superseded by
                                a new source = owner, approved row (any dates; CONFLICT while the
                                member has another open request on them, a pending change to this
                                one included), then the same day corrections as leave_decide. 2.2:
                                an approved gate leave on the new dates is superseded before the
                                overlap check (app.leave_supersede_gate, as leave_decide). Audit
                                'superseded' + 'approved'. Notifies the member. 2.4: returns
                                (new_id uuid, kept_dates date[]), the new row's id and the dates whose
                                Owner decision was kept, as leave_decide
public.leave_owner_cancel(request_id, reason)
                                attendance.decide, approved only, REASON_REQUIRED: -> cancelled, and
                                today's untouched derived day returns to awaiting_choice. Notifies
                                the member
public.attendance_today()       2.4. attendance.view_all (FORBIDDEN otherwise). Read only, security
                                definer (it needs app.is_working_day and members without a day row).
                                One row per active member other than the Owner, for today (IST):
                                (member_id, full_name, job_title, started boolean: attendance has
                                begun, i.e. today > the IST date of joined_at; day_id, state,
                                final_status, submitted_choice, proposed_by_system, first_login_at,
                                last_logout_at, logout_not_recorded, overtime_flag, is_day_off:
                                the day row's value, else app.is_working_day(today) is false;
                                on_leave: approved leave covers today). The Owner's card and people
                                board (WORKFLOWS §1 "Settled in 2.4") derive their buckets from it

-- Jobs (2.5, WORKFLOWS §8). app schema (not an RPC), security definer, search_path = '',
-- executable by service_role only; pg_cron runs them as postgres. Every write is labelled through
-- app.audit_override, actor null (system). No notification rows yet (5.1).
app.job_day(at, cutoff)         -> date: the most recent IST date whose cutoff time has passed at
                                `at` (stable, strict). 23:59 IST on D -> D; 00:00 IST on D+1 -> D; 23:58
                                IST on D -> D-1. Both jobs default to job_day(now(), '23:59')
app.attendance_open_day(member_id, date, first_login)
                                the member's day for that date, opened when there is none: approved
                                leave covering it (app.leave_covering) -> approved, final_status =
                                the leave type, proposed_by_system, leave_request_id, event and audit
                                'derived_from_leave'; otherwise awaiting_choice, audit 'opened'.
                                first_login (timestamptz, null for a job) -> first_login_at;
                                is_day_off = app.is_working_day(date) is false. Named-constraint
                                on-conflict re-read, so a concurrent writer's row is returned.
                                THE CALLER HOLDS THE MEMBER'S leave: LOCK. Used by attendance_touch
                                (2.5 factored today's derivation out of it) and by absent_check
app.absent_check(for_date default null)
                                returns (work_date, member_id, day_id, outcome 'proposed_absent' |
                                'derived_from_leave'), one row per day written. for_date null: the
                                7 IST dates ending at job_day(now(), '23:59'), oldest first (catch-
                                up, WORKFLOWS §8); a given date: that date only, INVALID_STATE when
                                its cutoff has not passed. Per date: app.is_working_day null ->
                                INVALID_STATE (no single organization in scope, do not act), false
                                -> nothing at all. Then for each active member whose role holds
                                attendance.self and whose attendance started before the date
                                (app.to_ist_date(joined_at) < date), in id order, under the
                                member's leave: lock (before any row lock): no day + leave covering
                                -> attendance_open_day (a derived day with no login); no day, no
                                leave -> pending_review, final_status = absent, proposed_by_system,
                                first_login_at null; awaiting_choice and not is_day_off -> the same
                                update, first_login_at kept. Event proposed_absent, audit
                                'proposed_absent'. Any other state, and a row marked is_day_off,
                                is left alone: running twice writes nothing. Notifies the Owner
                                once per run with everyone proposed (5.1; the return value is the
                                list)
app.logout_not_recorded(for_date default null)
                                the same date rule. Every day on the date with first_login_at set,
                                last_logout_at null and logout_not_recorded false gets the flag,
                                under the member's leave: lock; audit 'logout_not_recorded', no
                                event (the flag is a column; the audit row is its history). Returns
                                (work_date, member_id, day_id). Twice: nothing. Notifies nobody
                                (the reminder before it is 5.1's)
cron.job                        'absent_check' at 29 18 * * * (23:59 IST) -> select
                                app.absent_check(); 'logout_not_recorded' at 30 18 * * * (00:00
                                IST) -> select app.logout_not_recorded(). Scheduled by the 2.5
                                migration through cron.schedule(name, schedule, command), which
                                updates an existing name instead of adding a second job
```
**Lock order (2.4, migration `attendance_owner_review`):** every function that writes a member's days or leave (`attendance_submit`, `attendance_decide`, `leave_submit`, `leave_withdraw`, `leave_request_change`, `leave_decide`, `leave_owner_edit`, `leave_owner_cancel`) takes `pg_advisory_xact_lock(hashtext('leave:' || member_id))` **before any row lock**. A function that starts from a row id reads the row's member without a lock, takes the advisory lock, then locks the row and re-checks it. `attendance_touch()` takes its own `touch:` lock first and, **when it has to open today's day** (it derives the day from approved leave), the `leave:` lock next and then looks for the day again (`touch:` → `leave:` → rows). pgTAP `12` asserts each waits on the advisory lock first. **2.5's jobs follow the same order:** `app.absent_check()` and `app.logout_not_recorded()` take each member's `leave:` lock before that member's rows (members in id order, so two overlapping runs cannot cross), and `app.attendance_open_day()` is called only under it (pgTAP `14`). Partial index `attendance_days_pending_idx (work_date) where state = 'pending_review'` serves the Approvals list and badge.

## 4. Clients
```
clients              id, org_id, name, legal_name, state client_state, admin_id → members,
                     gstin, address, city, phone, email, website, drive_url, requirements, notes,
                     custom_fields, activated_at, archived_at, created_by
client_private       client_id pk, ceo_notes                        -- Owner-only table
client_admin_assignments  id, client_id, admin_id, assigned_by, from_at, to_at null
client_contacts      id, client_id, name, designation, email, phone, is_primary, custom_fields, archived_at
client_brand         client_id pk, logo_file_id, colors jsonb [{name, hex}], fonts jsonb [{family, usage}],
                     tone_of_voice, brand_notes                     -- shape validated by zod
view client_labels   (id, name, logo_file_id, colors, fonts, tone_of_voice, brand_notes)
                     security-barrier view: rows only for clients the caller may see OR that label a task
                     the caller is assigned to
```

## 5. Client work: projects, cycles, items
```
projects             id, client_id (required), name, description, recurrence, state project_state,
                     billing_category (Owner-set; default from recurrence; a template's default applies
                     only when the Owner creates the project), template_id null,
                     custom_fields, created_by, completed_at, completed_by, archived_at
                     -- guard trigger: state, billing_category, client_id and recurrence change only
                     -- through transition functions (billing_category/client_id/recurrence: Owner only)
project_stages       id, project_id, name, position                  -- copied from a preset; may be empty
project_item_blueprints  id, project_id, title, position            -- item list copied into each new cycle
project_cycles       id, project_id, period_start date null, period_end date null, label,
                     state cycle_state, generated_by ('schedule'|'manual'|'create'|'carry'), created_at,
                     unique(project_id, period_start),
                     unique partial index (project_id) where period_start is null  -- one cycle per one-time project
project_items        id, cycle_id, title, position, planned_date null, notes, custom_fields,
                     state item_state, done_at, done_by, approved_at, approved_by,
                     cancelled_reason, cancelled_by, cancelled_at,
                     carry_decision null, carry_decided_by, carry_decided_at,
                     carried_from_item_id null, origin_cycle_id (self cycle unless carried in)
project_item_stages  item_id, stage_id, done_at, done_by, pk(item_id, stage_id)
item_reviews         id, item_id, decision review_decision, reason, reviewer_id, at   -- append-only
project_templates    id, org_id, name, description, recurrence, default_billing_category (applied only
                     when the Owner creates the project), stages text[], items text[], field_defaults jsonb, archived_at
```

## 6. Staff tasks
```
tasks                id, org_id, title, description, task_type_id, client_id null (label only),
                     priority, due_at timestamptz, event_start_at null, event_end_at null,
                     location null, purpose null, state task_state,
                     approving_admin_id null, admin_step admin_step, created_by,
                     primary_owner_id, reminder_rules jsonb, late_reason, cancelled_reason,
                     custom_fields, template_id null,
                     submitted_at, admin_approved_at, completed_at, cancelled_at, archived_at
task_assignees       task_id, member_id, is_primary, assigned_at, assigned_by,
                     acknowledged_at null, removed_at null, pk(task_id, member_id)
task_stages          id, task_id, name, position, done_at, done_by   -- optional checklist
task_comments        id, task_id, author_id, body, created_at        -- append-only
task_reviews         id, task_id, step ('admin'|'owner'), decision, reason, reviewer_id,
                     submission_id null, at                          -- append-only
task_submissions     id, task_id, version int, note, submitted_by, at, unique(task_id, version)
submission_items     id, submission_id, kind ('upload'|'drive_link'),
                     file_id null (uploads), source_url null (pasted Drive link),
                     source_file_id null (Google file id of THEIR file),
                     original_name, mime, size_bytes null,
                     preview_file_id null (generated JPEG preview for photos),
                     link_state ('ok'|'private'|'missing'|'unchecked'), link_checked_at,
                     archive_state ('queued'|'archived'|'failed'|'blocked'),
                     drive_file_id null, drive_web_link null, archived_at,
                     archive_error, archive_attempts, local_deleted_at, created_at
task_reminders       id, task_id, member_id null, kind ('before_due'|'due'|'overdue'|'ack'|
                     'ack_escalation'|'overdue_escalation'|'event'), escalation_level int null (1 = Admin, 2 = Owner),
                     fire_at, sent_at null, cancelled_at null       -- materialized from reminder_rules + org_settings
task_warnings        id, task_id, kind ('overlap'|'workload'|'on_leave'), details jsonb,
                     overridden_by, at
task_requests        id, org_id, requested_by, title, details, client_id null, state request_state,
                     decided_by, decided_at, decision_reason, task_id null
task_templates       id, org_id, name, task_type_id, description, default_priority,
                     stages text[], reminder_rules jsonb, field_defaults jsonb, archived_at
```

## 7. Money (all Owner-only tables)
```
project_billing      project_id pk, cycle_amount numeric null (recurring), fixed_amount numeric null (one-time)
item_billing         item_id pk, value numeric                       -- explicit per-item value
cycle_billing        cycle_id pk, billing_status, billed_on date, note
revenue_overrides    id, scope ('cycle'|'project'), ref_id, calculated_value, adjusted_value,
                     note, by_id, at, superseded_at null
views (security invoker, Owner only): item_values_v, revenue_by_cycle_v, revenue_by_client_month_v
```
All amounts are `numeric(12,2)` in INR.

## 8. Google Drive archive (Owner-managed, core module `drive`)
```
drive_account        org_id pk, google_email, refresh_token_encrypted, access_token_encrypted,
                     token_expires_at, root_folder_id, scopes, connected_by, connected_at,
                     state ('connected'|'needs_reconnect'|'disconnected'), last_error,
                     quota_total_bytes, quota_used_bytes, quota_checked_at
drive_folders        id, org_id, path_key text unique       -- e.g. 'Clients/Cafe Mocha/2026-10/Photos'
                     drive_folder_id, created_at            -- cache so folders are made once
drive_jobs           id, submission_item_id, kind ('copy_link'|'upload_file'|'recheck_link'|
                     'delete_local'), state ('queued'|'running'|'done'|'failed'|'blocked'),
                     attempts, next_attempt_at, last_error, created_at, finished_at
```
- Tokens are encrypted with a server-side key (never sent to the browser). Only `drive.manage` can read `drive_account`.
- `drive_jobs` is the retry queue: idempotent, with exponential backoff and a cap.

## 9. Files, notifications, audit, reports
```
files                id, org_id, storage_key, name, mime, size_bytes, sha256 null, uploaded_by,
                     status ('pending'|'ready'|'failed'|'deleted'), created_at, archived_at
                     -- 'deleted' = the R2 object was removed by retention; the row stays
notifications        id, recipient_id, kind, title, body, link, entity, entity_id, payload jsonb,
                     created_at, read_at null, escalation_level int
notification_deliveries  id, notification_id, channel ('push'|'email'), state ('queued'|'sent'|'failed'),
                     attempts, last_error, sent_at
activity_log         id bigint identity, org_id, actor_id null (system), entity, entity_id, action,
                     diff jsonb (old/new), meta jsonb, at               -- append-only (UPDATE/DELETE revoked)
                     -- written only by app.audit_row_change() and transition functions (no INSERT grant).
                     -- RLS: activity.view_all, or entries about the caller's own member row except its
                     -- deactivated entry (the reason is the Owner's note). Scope is per entity, never per
                     -- actor: a row an Admin's action produced may describe an Owner-only table.
                     -- Each module adds a policy for the entities it owns (PERMISSIONS §2)
eod_reports          id, org_id, report_date, data jsonb, generated_at, unique(org_id, report_date)
month_snapshots      id, org_id, month date (1st), version int, data jsonb, closed_by, closed_at,
                     corrects_id null, correction_note, unique(org_id, month, version)
                     -- eod_reports and month_snapshots contain revenue: Owner-only tables
                     -- (single policy has_permission('reports.all')). Admin scoped reports are computed live.
feature_flags        key pk, enabled, description
```

## 10. Key indexes
- Every FK column.
- `tasks(state, due_at)`, `tasks(approving_admin_id, state)`, `tasks(client_id)`, `task_assignees(member_id) where removed_at is null`.
- `attendance_days(work_date, state)`, `leave_requests(state)`, `leave_requests(member_id, start_date, end_date)`.
- `project_items(cycle_id, state)`, `project_cycles(project_id, period_start)`.
- `task_reminders(fire_at) where sent_at is null and cancelled_at is null`.
- `notifications(recipient_id, read_at, created_at desc)`.
- `drive_jobs(state, next_attempt_at)`, `submission_items(archive_state)`, `submission_items(link_state) where kind = 'drive_link'`.
- `activity_log(entity, entity_id, at desc)`, `activity_log(actor_id, at desc)`.
- Full-text search: `tsvector` generated columns on clients, tasks, projects, items and contacts, with GIN indexes.
