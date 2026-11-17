# Advisor handoff: read this first (cloud advisor, from 17 Nov 2026)

The **advisor** session moved from the owner's laptop to the cloud on 17 Nov 2026, so the owner can steer from his phone.
This file and `docs/handoff/advisor-memory/` hold everything the laptop advisor knew.
**The owner** is Prishit (GitHub `prakyats`), the Owner role in MaxOff. Address the owner as "you"; refer to others with they/them unless told otherwise.

## 1. Your role
- You are the **advisor**: you plan, review, merge and talk to the owner in plain words. **Builders write the code.**
- **Never tag `v*` or approve a production deploy**: those are the owner's. **Never bypass checks.**
- **Never run anything against production.** The live app is `https://app.maxoff.in`.
- Merge to `main` only when the bar is met (CLAUDE.md):
  - **docs:** green CI;
  - **code:** a full CI run green on the first attempt (two runs for releases touching all-role screens or the shared layout), the review's must-fix items fixed, the speed gate scoped as CLAUDE.md says, the guide updated, and the owner's phone walk passed.
- **Never** make a test pass by retrying, raising a timeout, skipping or weakening it.
- **"Note only until proceed":** nothing gets built until the owner says "proceed vX".
- **Samples before major UI changes,** with the owner's OK. **Secrets never through chat.**

## 2. Where everything is
| What | Where |
|---|---|
| Rules | `CLAUDE.md` (updated 14 Nov: scoped speed gate) |
| Current state | `docs/PROGRESS.md` "Current state" |
| **The release plan (what comes next)** | **`docs/handoff/release-plan.md`** |
| Scope per item | `docs/ROADMAP.md` |
| Revenue decisions (v2.1–v3.5) | `docs/kickoff/phase-9-kickoff-refresh-2026-11-14.md`. The OWNER ANSWERS block at the top wins. |
| Drive / upload-link decisions (v4.0–v5.5) | GitHub issue **#89** comments 6878907953, 6879165419, 6879199286, 6879244245, 6879293330, **6879421505** (full spec), 6879494745, 6879555186; plus `advisor-memory/drive-upload-task-type.md` |
| Admin calendar etc. (v6.0–v7.0, formerly "v2.1") | `docs/handoff/v2.1-plan.md`; #89 6874042506, 6874350719, 6874389662, 6874423650, 6878616642 (decision-sheet answers) |
| Old laptop memory notes | `docs/handoff/advisor-memory/*.md` (MEMORY.md is the index) |
| Build log, and how builders hear from you | **GitHub issue #89** in `prakyats/MaxOff`; post as "ADVISOR: …" |
| v2.0 change summary for the owner | `docs/handoff/v2.0-owner-summary.md` |

**Samples the owner approved** (claude.ai artifacts):
- Crew busy calendar: https://claude.ai/artifact/EgFYQUCuF6f6eEX8Ex9px3
- Admin ideas (Team today, Upcoming shoots, New task type-first v2, People v2): https://claude.ai/artifact/WMdFpTnpveWEm4JCVzfxRF

## 3. State on 17 Nov 2026
- **Live:** v2.0, tag `v2.0` on `main` 6e9f19cc, deployed 14 Nov at about 12:40 IST. No known incidents.
- **`main`** = d223102c plus this handoff PR. All planning docs are merged.
- **Next:** **v2.1 "Money in"** (Revenue, phase 9). It waits for the owner's **"proceed v2.1"**.
- **Approved way of working (14 Nov):**
  - **pipeline:** the builder starts the next release while the last one is checked and walked;
  - **two streams:** the builder does Revenue v2.1→v3.5, and the integrator does Drive v4.0 (then v4.5) in parallel, released in order;
  - **CI once** if green first time;
  - **the speed gate scoped** to the touched routes;
  - **the owner's full walk is kept for every release**, and v4.0 stays its own release.
- **Builders** (cloud sessions):
  - **"MaxOff v1.9 builder"**: did v2.0; branch `phase-v2` at a5839db7 is merged into main and finished;
  - **"MaxOff integrator"**: branch `phase-v21` at d5fbc67e (cut 11 Nov, before v2.0's last fixes). It holds early iPhone/axe work that now belongs to **v7.0**. Rebase on `main` before use; its iPhone CI job 43072474285 failed and hasn't been reviewed.
- **How to reach them:** SendMessage by name may not work cloud-to-cloud. If it doesn't, post an "ADVISOR:" comment on #89 and ask the owner to nudge the builder from the app if it doesn't pick it up. Builders post "BUILDER:" comments on #89.
- **Staging** keeps two test tasks the advisor made as the Admin "Prakyat" on Mon 16 Nov ("Brand reel shoot" 2–4 pm with PShetty, "Cafe site visit" 11–1 with the freelancer "free"). The owner said keep them. The staging app for `main` is `https://main-preview-maxoff-staging.pixoraclips.workers.dev`.

## 4. On "proceed v2.1": the briefs to send
**Builder (Revenue, `phase-v21-money` or as you name it, from `main`):**
> v2.1 "Money in" per `docs/handoff/release-plan.md` and `docs/kickoff/phase-9-kickoff-refresh-2026-11-14.md` (the OWNER ANSWERS block wins).
> - **Start with the pre-work:** the money-lint list missing `item_values_v` / `project_advances` (`eslint.config.mjs`); the pgTAP 46 money list; the PRODUCT / WORKFLOWS one-time-split wording; the ADR-0007 advances amendment; `formatRupees` moved to core.
> - **Then** the Owner-only money tables with RLS and pgTAP for each role; the Billing section (amount, category default from recurrence, extras priced **on top**, advances); the Revenue page (Potential / Achieved / Remaining by month and client); the one-time "Mark done and complete project" prompt.
> - **Rules:** amounts start from the first month entered ("this month on"); a cancelled one-time project is ₹0; never put an amount on `project_items`.
> - **Process:** post on #89 before each push. The speed gate covers the touched routes (Owner).

**Integrator (Drive, from `main`):**
> v4.0 "Drive connected": `core/drive`, the Owner-only connect to the studio's personal Gmail (2 TB; never write its address into the repo) with the `drive.file` scope only; automatic folders (Clients / client / month / task); the storage watch (alerts at 80 % and 90 %); the account switchable later. Confirm the Google OAuth publishing status so no weekly expiry applies to `drive.file`. Then prepare the v4.5 upload-link sample (#89 6879421505 plus follow-ups) for the owner's OK, and a security review before building.

## 5. Things only the owner does
- Say "proceed vX".
- Tag releases and approve deploys on GitHub.
- The phone walk.
- Create the Google OAuth app and secrets in the Google Cloud console; the advisor gives the names and steps only.
- A sealed spare copy of the backup key.
- 2-step verification on the studio Gmail.
- The **December** restore practice.

## 6. Owner preferences (short)
- Plain, simple language, no jargon.
- Tables for comparisons.
- Ask with multiple choice, recommendation first.
- Be honest about uncertainty.
- Report timings as IST.
- **Small releases, but don't let checks slow things down.**
- The owner cares most about **finishing Revenue and Drive**.
