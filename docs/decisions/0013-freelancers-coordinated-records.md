# ADR-0013: Freelancers are coordinated records, not logins

- **Status:** accepted
- **Date:** 2026-09-27 (owner decision; built in phase 4)

## Context

Pixora gives work to freelancers as well as employees: an editor or designer who takes tasks for a while, is not on the payroll, does not mark attendance and may never open MaxOff. The Owner still wants their work assigned, acknowledged, submitted, approved and reported like anyone else's, with a true record of who did what.

Two forces pull against each other. The task system assumes a **member** on every assignment (roles, RLS, notifications, the approval route). A freelancer who signs in would need an account, an invite, a password, push subscriptions and the day gate, none of which fits someone who may do three tasks and leave. The team's actual practice today is that an employee looks after each freelancer: hands over the brief, collects the files, tells the Owner it's done.

The tempting shortcut is to invite the freelancer and let that employee **use the freelancer's login**. It is rejected below.

## Decision

**A freelancer is a person record with no login and no invite, of engagement type `freelance`, with exactly one coordinator who acts on their behalf from the coordinator's own account.**

1. **Engagement is data, not a role.** `members.engagement` is `permanent` (every employee, the Owner included) or `freelance`. Roles stay exactly Owner / Admin / Staff (ADR-0004); a freelancer row carries `role = staff` for permission arithmetic but has no `auth.users` row, no invite and no session, so it can never sign in. Creating one is the Owner's (`team.manage`), through "Add person → Freelancer", which asks for the coordinator instead of an email.
2. **One coordinator, changeable, with history.** The coordinator is an **active permanent** member, Admin or Staff, chosen by the Owner. Changing it closes the previous `member_coordinators` row (`to_at`) and opens a new one; the history is never rewritten. A freelancer always has a current coordinator; deactivating a coordinator first asks where their freelancers go.
3. **Acting on behalf.** On the freelancer's tasks, and only there, the coordinator may do everything `tasks.work` allows an assignee: "Task Noted", comments, stage ticks, uploads and links, marking Done (with the late reason) and resubmitting after changes. Every such action records **actor = the coordinator** and **on_behalf_of = the freelancer**, in the task rows and in `activity_log` ("Done by Ravi for Asha"). The transition functions check the coordinator relation at the moment of the action; a former coordinator has no standing.
4. **Notifications route to the coordinator.** Anything WORKFLOWS §9 would send to the freelancer goes to their current coordinator instead, worded as such ("Asha's task Reel edit is due tomorrow"). A freelancer is never a reachability concern (§9a).
5. **No attendance, leave, day gate or attendance jobs**, enforced in SQL: `attendance_touch()` and every attendance and leave function refuse a `freelance` member, the day gate never asks (there is no session to gate), and `absent_check()` / `logout_not_recorded()` select `permanent` members only. The Owner's board never lists them.
6. **A Staff coordinator still never sees client records** (ADR-0005). Acting for a freelancer grants exactly the freelancer's task visibility, which carries a client *label* at most.
7. **Login-ready without migration.** The record is a `members` row with the same id space; if a freelancer later gets a tasks-only login, an invite attaches an `auth.users` row to that id and the coordinator relation, the task history and every audit row stay as they are. Whether and when to offer that is a phase-4 kickoff question, not part of this decision.

## Rejected alternative: the coordinator signs in as the freelancer

Invite the freelancer, and let the coordinating employee use those credentials.

- **False audit trail.** Every row would say the freelancer did it. Invariant 9 (never destroy history) is about truth as much as retention: an audit that names the wrong person is worse than none.
- **Breaks the coordinator's own attendance.** Logging out of the freelancer's account records a logout (`session_logout()` → `attendance_logout()`); switching accounts on one phone during the day corrupts both people's days and the 00:00 job's "logout not recorded" flag.
- **Shared passwords.** A credential known to two people is neither person's, cannot be rotated without coordination, and violates the sessions model (ADR-0012: one person, their devices, their sign-outs).
- **Notifications to an unwatched account.** Push and email would go to a mailbox and devices nobody checks; reminders, escalations and "changes requested" would silently miss.

## Consequences

- **Phase 4 builds it** (ROADMAP 4A: `engagement`, `member_coordinators`, on-behalf columns and checks in every task transition; 4B/4C: "Add person → Freelancer", the coordinator picker, "for Asha" labels on cards, badges and history). DATA-MODEL, PERMISSIONS and WORKFLOWS carry the rules from today.
- **Every task transition function gains an `on_behalf_of` path** and its pgTAP tests: the coordinator allowed, a former coordinator refused, any other member refused, the freelancer's own id never an actor.
- **Reports show freelancer work separately** (PRODUCT §4.13): counts and durations by engagement, so employee metrics are not diluted and freelancer output is visible on its own.
- **Payments to freelancers are out of scope for the pilot** (PRODUCT §5); when they arrive they are money, Owner-only, through `modules/revenue` (ADR-0007), never on the person record.
- **Harder:** two people can now legitimately appear on one task row (actor and on_behalf_of); every screen that names "who" must show both when they differ, and exports must carry both columns.
