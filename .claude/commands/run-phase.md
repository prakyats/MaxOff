---
description: Build a whole phase unit by unit with one subagent per unit, stopping only on a real decision
argument-hint: "[phase number]"
---
Run phase $ARGUMENTS of MaxOff: every unit in `docs/ROADMAP.md` for this phase, in order, each built by its own subagent. You are the orchestrator: you hold summaries, verify results and decide when to stop. You do not build units yourself. (Run this on the highest-capability model; the subagents get the unit's tier.)

## Before the first unit
1. Read `docs/PROGRESS.md` in full. Required: a **"Kickoff <N> decisions"** block for this phase (otherwise stop: run `/kickoff-phase <N>` first). If an **In-progress handoff** or a **run-phase handoff** is there, resume from it: units it lists as done are skipped after you verify them (step "Verify" below).
2. `git status` must be clean. Be on `phase-<N>` (create it from `main` with `git switch -c phase-<N>` for the first unit). Confirm Docker and the local stack are up (`pnpm db:start`), then `pnpm db:reset` once.
3. Keep the machine awake for the session: start `scripts/keep-awake.ps1` in the background (`powershell -ExecutionPolicy Bypass -File scripts/keep-awake.ps1`, `run_in_background`), and tell me: **keep the laptop plugged in and close other browsers** (the e2e suite runs 3 local workers; CI is the authority when the machine is the problem). Stop the script when the run ends.
4. List the phase's units from ROADMAP (`Units:` line), each with its tier: [H] → `model: "fable"`, [C] → `model: "opus"`, [Q] → `model: "sonnet"` (BUILD-GUIDE "Model tiers").

## For each unit, in order
Spawn **one `general-purpose` subagent** with the unit's model and a **self-contained prompt** (it starts with no context). The prompt says, in this order:
- The repo path, the branch, the unit id and its ROADMAP task lines verbatim, and that it works one unit only.
- Read `CLAUDE.md`; `docs/PROGRESS.md` in full (especially "Kickoff <N> decisions" and "Things the next session must know"); the sections of PRODUCT / PERMISSIONS / WORKFLOWS / DATA-MODEL / ARCHITECTURE / ADRs the unit touches; the code it changes (Explore subagent for wide searches).
- Plan first (the `/start-task` plan headings: scope boundary, files and migrations, DATA-MODEL / WORKFLOWS / PERMISSIONS changes first, permissions / RLS / transition functions / audit / notifications, tests, **Back and gestures**, **First glance**, risks). Then **proceed without waiting**: the kickoff settled the business questions. If the plan needs something the kickoff did not settle, it does not guess and does not build around it: it returns `BLOCKED` at once.
- Build task by task, `pnpm check` green before each commit (Conventional Commit, the attribution trailer). Migrations through `pnpm db:new`, DATA-MODEL updated first, RLS + pgTAP per role in the same migration, every transition function tested per path.
- The full e2e suite at 3 workers after one `pnpm db:reset`. A red that looks like the machine (a 5 s expect on a saved form, a stall with no app error; see PROGRESS "Local full-run stalls") is not fixed locally: push and let **CI be the authority** (`gh run watch`); a CI red is a bug and is fixed. No timeout raised, no retry added, no test skipped or weakened, ever.
- Then the `architecture-reviewer` subagent on `git diff main...HEAD` limited to the unit; fix every must-fix and should-fix; "later" items go to PROGRESS Ideas / tech debt.
- Definition of Done item by item (CLAUDE.md), unchanged. **No per-unit phone check**: the installed-mode Playwright specs at 375 and 430 are required; the real-phone walk is `/review-phase`'s, so the unit lists the screens it added or changed in PROGRESS for that walk.
- Docs: tick the unit's tasks in ROADMAP, update PROGRESS (current state, next unit, session log, gotchas), DATA-MODEL / WORKFLOWS / PERMISSIONS / ARCHITECTURE as needed. **A new ADR is not written by the subagent**: it returns `BLOCKED` with the decision that needs one.
- Commit and push (`git push -u origin phase-<N>` the first time).
- The subagent **never asks the user** and never edits `CLAUDE.md`, the ADRs, `deploy.yml`, `wrangler.jsonc`'s production environment, or anything about production. It ends with **one of two reports**: `DONE` with evidence (the commits, the `pnpm check` tail, the e2e counts and run time, the CI run id and result if used, the DoD list, the screens for the phone walk, decisions it took inside the kickoff's answers) or `BLOCKED: <reason>` with what it did, what it needs and the state of the tree (committed as `wip(<module>): <unit> checkpoint` if anything is half-done, with a PROGRESS handoff).

## Verify, before the next unit
Do not take the report on trust. Check: `git log main..HEAD --oneline` shows the unit's commits and the tree is clean; every task of the unit is ticked in ROADMAP; `pnpm check` exit 0 (re-run it yourself, it is the gate); the e2e evidence names a green local run or a green CI run on the pushed sha (`gh run list --branch phase-<N>`; wait for it with `gh run watch <id>` when it is still running); no In-progress handoff left; the PROGRESS session log has the unit's row; nothing outside the unit's plan touched money, permissions or RLS (`git diff main...HEAD --stat -- supabase/migrations src/modules/revenue src/core/permissions`). Anything off → treat as a failure below.

## When to stop and ask me (only these)
- A business question the kickoff did not settle (a `BLOCKED` for that reason, or one you find while verifying).
- Tests red after **two** fix attempts (the subagent's second try counts; a third is yours to ask, not to take).
- A new ADR is needed, or an existing one would be contradicted.
- Anything touching money, permissions or RLS beyond the unit's plan (a migration on a revenue or permission table the ROADMAP line does not name).
- Anything touching production: `deploy.yml`, a `v*` tag, production secrets or environment.
- An unexplained failure: a red with no root cause, CI failing on something the unit did not touch, the tree in a state the report does not describe.
On a stop: write the handoff first (below), then ask with the options and your recommendation. Resume with `/run-phase <N>` after the answer.

## At every unit boundary
Write a **run-phase handoff** in `docs/PROGRESS.md` (the In-progress handoff section): units done with their commit ranges and evidence, the next unit, decisions taken inside the kickoff's answers, anything odd. Commit as `docs: run-phase <N> handoff after <unit>` and push. A fresh session resumes from it. Keep your own context small: read reports, not files; if `/context` passes ~50%, save the handoff and tell me to `/clear` and re-run `/run-phase <N>`.

## When the last unit is verified
Stop the keep-awake script. Summarise the phase (units, commits, test counts, CI), list every screen the phase added or changed for the phone walk, and tell me to `/clear` and run `/review-phase <N>` on the highest-capability model.
