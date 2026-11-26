# Privacy: the staff notice and the retention rule per record

**Owner decision (26 Nov 2026, v7.5 Q1; `docs/handoff/v7.5-plan.md` §3 and §6):** the staff privacy notice is
approved with the periods below. **A lawyer checks the wording before v8.0.**

- **The words** live in `src/modules/privacy/domain/notice.ts` (and nowhere else). Any change to them gets
  a new `PRIVACY_NOTICE_VERSION`: the date it changed. The home screen's card then asks everyone to read it
  again.
- **Where it shows:**
  - **Me → Your information** (`/me/privacy`) for every role;
  - a one-time card at the end of the home screen (Today, My Day) until the member taps **Got it**
    (`privacy_notice_reads`, audited);
  - the guide's "How MaxOff uses your information".

## The periods (owner, 26 Nov 2026)

| Records | Kept for, after the person leaves | What it covers in MaxOff (DATA-MODEL) |
|---|---|---|
| **Attendance, leave, expenses** | **8 years** | `attendance_days`, `attendance_events`, `early_leave_requests`, `extra_work_notes`; `leave_requests`, `comp_leave_credits`, `comp_leave_credit_uses`; `expense_claims` and their receipt files |
| **Tasks and chat** | **3 years** | `tasks` and their assignees, stages, submissions, reviews and warnings; `task_comments`; `task_requests`; the files attached to them |
| **Sign-in records** | **1 year** | `session_events` (sign-ins and sign-outs, a salted hash of the IP address); `access_refusals` (how often someone was refused "No access", v7.5 Q6) |

"After the person leaves" is how the notice puts it: "While you work with us, and afterwards for as long as
the law and the studio's accounts need it".

**Not set by the owner yet** (no period, so nothing changes for them): profile details on `members`
(kept while the account exists, deactivated rather than deleted), `notifications` and their deliveries,
`activity_log` (each record's history), and client work (`clients`, `projects` and their items). Client work
is the studio's business records, not a person's.

## What happens at the end of a period

**Nothing is deleted before v8.0, and nothing is deleted automatically today.**
- Each period gets its own scheduled job only **after v8.0**, once the lawyer has checked the wording. That
  job is a separate task with its own plan, tests and the owner's approval.
- Any removal follows invariant 9 (CLAUDE.md): archived first, with a reason and a history row, and a
  permanent delete only by the Owner.
- A member's own requests (to see, correct or remove what is kept) go to the Owner: the notice says "Contact the
  Owner", with no name or email (owner, 26 Nov 2026), so it shows nobody's contact details. The
  Owner answers them by hand until there is a screen for it.

## Service providers named in the notice

Supabase (database), Cloudflare (hosting and files), Google (Drive), Resend (email) and Sentry (error
reports, scrubbed of names, emails and money: `core/observability`).
