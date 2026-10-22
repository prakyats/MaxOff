# MaxOff: advisor handoff (as of 8 October 2026, 07:30 IST)

> **To the next advisor session:** this updates `MaxOff-Advisor-Handoff.md` (7 October, up to v1.4.0). Read that one for the role, the business, the stack and the hard rules. Then read this one for what changed on 7 October. Then read `CLAUDE.md`, `docs/PROGRESS.md` and `docs/ROADMAP.md` on `origin/main` and `origin/phase-6`. Your memory files (`merge-own-docs-prs`, `advisor-local-builders-cloud`) carry the standing rules.

---

## 1. What changed in how we work (owner decisions, 7 October)

**The owner wants the build to run hands-free.** His rule: *"Anything that touches the live database and production goes through me. Everything else, day-to-day work on GitHub and staging, you do directly, without asking."*

- **The advisor does every merge to `main`, once that PR's bar is met** (memory `merge-own-docs-prs`):
  - docs PRs: required checks green and CLEAN;
  - code and phase PRs: a full run with both Playwright shards actually run and green, the review's must-fix done, and for a phase the owner's phone walk passed;
  - always a normal merge commit, then tag `archive/<branch>` and delete the branch;
  - never `--admin` or bypass.
- **Still the owner's:**
  - `v*` tags and the production Deploy approval;
  - production secrets and settings;
  - `deploy.yml` beyond the approved Sentry source-map step;
  - production backfills;
  - new business rules, money, roles and permissions;
  - the phone walk.
- **⚠ A conflict to settle with the owner:** `CLAUDE.md` → "Production is live" still says *"Sessions never merge to `main`, tag or approve on their own."* The owner overrode that in chat on 7 October, for merges only. Ask him whether to update that CLAUDE.md line to match: "the advisor session merges per its bars; nobody but the owner tags or approves". Until then, mention the conflict whenever you merge.
- **Talking to the builder:**
  - **Advisor to builder:** `SendMessage` to the cloud session named **"phase 6"**. It's one-way, and delivery isn't confirmed.
  - **Builder to advisor:** comments on **GitHub issue #49** ("Phase 6 build log"), each starting `REPORT`, `BLOCKED`, `REPLY` or `QUESTION FOR OWNER`. The advisor posts `ADVISOR` comments there for the record.
  - The owner told the phase 6 session directly that the advisor's messages and `ADVISOR` comments count as his instructions for day-to-day work (recorded in PROGRESS at `017d34b`). A new builder session needs that instruction again, from the owner himself.
  - Cloud sessions can't be read from the laptop (`list_events` and search cover local sessions only).
- **The overnight watch:** a `CronCreate` job every 30 minutes (:13 and :43) read #49, `phase-6` CI and the PRs, acted, and sent a push notification only for owner items. **It was stopped when the owner paused** (job deleted). To restart: CronCreate is allowed in `~/.claude/settings.json`. Rebuild the prompt from section 4.
  - The laptop's power settings are "never sleep when plugged in". `request_keep_awake` holds only about 5 minutes between turns.
- **Permissions added to `~/.claude/settings.json`:** `Bash(git push origin --delete:*)`, `Bash(git branch -d:*)`, `CronCreate`, `CronList`, `CronDelete`. The `/auto-mode-setup` environment block was de-duplicated, and its Resend domain corrected to `mail.maxoff.in`.

## 2. Repo state (7 October)

**Merged to `main` on 7 October** (all docs):
- #47: PROGRESS after phase 5.
- #32: kickoff 6, re-checked against phase 5; decisions 17, 18 and 23 changed.
- #48: working hours and Owner tasks decided.
- #50: ROADMAP phase 6b.
- #51: 6b additions to the Owner's Today.

`main` = `7f2bdab`.

**Branches:** 24 stale branches were deleted, each archived as a tag `archive/<name>` first. Remaining:
- `main`;
- `phase-1` … `phase-5b` (ROADMAP says "the branch stays phase-N");
- `kickoff-7/8/9` (draft PRs #38, #36, #42);
- `phase-6`.

The worktrees `Desktop\MaxOff-main` and `Desktop\MaxOff-kickoff5` were removed. **`Desktop\MaxOff-guide` is left alone**: a detached worktree holding two rebuilt PDFs from 1 October.

**Production:** v1.4.0, healthy.
- One Error 1101 on `GET /` at 2026-10-07 12:44:30 UTC. It's in neither Workers Logs (sampled) nor Sentry. Issue #52 is closed as a one-off.
- Sentry on production shows only two client network drops (MAXOFF-8 and MAXOFF-9).
- PGRST303 (JWT expired, MAXOFF-3/-6) and MAXOFF-4 (`/tasks/:id`) are **staging** errors, queued for 6D.

## 3. Phase 6: where it stands

- **6A (6.0–6.3): done and verified.** Full run 37614966608 is green on both shards.
  - First load of `/today` and `/my-day`: 790 KB → about 633 KB, with the budget at 670 KB.
  - Two real app bugs fixed: the lazy theme menu losing a tap, and the bell tapped while My Day's streamed section is still hydrating. The diagnosis confirmed the advisor's hypothesis.
- **6B (6.4 calendar + 6.5 end-of-day report and weekly digest): in progress, paused.**
  - Builder on Fable; the orchestrator is the cloud session "phase 6".
  - On `origin/phase-6` (head `b196589`): the 6.5 migration and pgTAP 64 iterations. Push run 37654648876 was **green**, the first green pgTAP 64.
  - Committed in the builder's worktree but **not visible on `origin/phase-6` at 07:30 IST**: the calendar (`a80d9e0`), the badge fix (`85487d8`) and the Owner's Today decision 24 (`ed3458f`). Its promised "wip checkpoint + PROGRESS handoff" also hadn't been pushed. **On resume, first check the phase 6 session's worktree and get those commits pushed.**
- **⚠ First fix on resume (before any more 6B work):** an applied migration was edited.
  - `20261007130000_eod_report_weekly_digest.sql` was applied to staging by the `f097765` preview (16:18 UTC), then edited by `12e5432` to add `revoke all … from anon, authenticated`.
  - The fix, which the builder acknowledged on #49:
    1. restore the file to its `f097765` content;
    2. a new idempotent migration `eod_reports_grants` with the revoke and the grant;
    3. pgTAP 01 and 64 green with both;
    4. a PROGRESS rule: with no local Docker, a migration file is final from its first push.
- **Folded into 6B (owner decisions):**
  - the bell badge clipping fix (no new e2e spec, checked by eye at 375 and 430);
  - **kickoff 6 decision 24** for the Owner's Today:
    - "Needs you" and "See all" removed;
    - the attendance card's counts are the way in: Not started (renamed from "Not chosen yet"), Waiting, Present, On leave, plus Absent and End not recorded when non-zero;
    - amber for "have a look", red for problems, grey for zero, always with a dot;
    - empty sections hidden, with "Nothing else needs you today";
    - "overdue by" in red;
    - the rule "exceptions only, counts not lists, hidden when empty" goes in PRODUCT §4.7.
- **6C (6.5b Sentry on the Worker):** the cold-start probe can't reach `*.workers.dev` from the cloud. The advisor runs `scripts/measure-coldstart.mjs` from the laptop (curl and Node 24 work) for both preview URLs, with the same settings for both. Under about 250 ms gain: don't switch.
- **6D (6.6 hardening):**
  - **The owner approved** a `deploy.yml` change for the Sentry source-map build, inject and upload step only, in both jobs. The upload is proven on staging after the merge, before any tag.
  - Also in 6D: PGRST303 becomes a refresh-and-retry or the 2.6 retryable screen; root-cause MAXOFF-4; offline fetch failures are not reported as errors; say whether the 1101 would now be caught.
- **Then:** `/review-phase 6`, the owner's phone walk (also ask about the calendar's phone view: Day first as built, or the month grid with the day's list below), the merge (advisor), and the v1.5.0 release (the owner's tag and approval; give him the exact lines and a safe window).

## 4. Next in the launch order (ROADMAP on `main`)

6 → **6b** → 8 → 7 → 9 → 10.

- **6b.1** [H] Working hours and leaving early:
  - 10:00–18:00 every working day, Saturday included, as settings;
  - Late after a 15-minute grace, with a reason, never blocked, and a reminder at 10:00;
  - the day's end time is 18:00, or later for a shoot's end or a "Stay until" (from the Owner for anyone, from Admins for Crew only); a shoot never makes it earlier;
  - "Ask to leave early" is decided by the Owner only, and allowed after 30 minutes unanswered (marked);
  - the recorded end is always the real tap;
  - half-day leave records Morning or Afternoon;
  - no rules on weekly offs and holidays;
  - on Today: a Late count, and an Ended count after the end time.
- **6b.2** [H] Owner tasks:
  - the Owner and Admins can assign the Owner;
  - Done completes the Owner's own tasks;
  - reminders but no escalations;
  - My tasks on Today, under the exceptions rule;
  - "Remind" on the task page, at most once an hour per task.
- Each is planned with `/add-feature`, right after v1.5.0. No kickoff is needed (PROGRESS "Open questions": everything is decided).

**The watch prompt (to rebuild the cron):** read #49 for new comments; `git fetch`; check `phase-6` CI; diagnose red full runs from the blob report's page-snapshot `.md` files; message the builder fixes; merge PRs that meet their bar; run the 6C probe on request; notify the owner only for production, business rules, the phone walk or a release; one line if nothing changed. Check every push for **edits to files under `supabase/migrations` after their first push** (staging applies them on push).

## 5. Open owner items

- **The CLAUDE.md merge-rule conflict** (section 1).
- **The app guide** for v1.4.0: deferred by the owner ("not sending it to anyone now"). It's recorded in PROGRESS Ideas.
- **His laptop tasks:**
  - issue #39 (the October Supabase usage check);
  - the age key offline;
  - delete the R2 drill token and the old Resend key `maxoff-app`;
  - the Stream subscription;
  - Web Analytics for maxoff.in;
  - a staging-only Supabase login;
  - whether to accept Cloudflare's Workers Logs sampling change (his account terms).
- **The intro video**, at the very end, with local tools only.
