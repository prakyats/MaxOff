# How to build MaxOff with Claude Code

This guide is for **you**: setup, models and the basics. For the day-to-day loop and **what to check after every task**, use **[OPERATING-MANUAL.md](OPERATING-MANUAL.md)**.
`CLAUDE.md` and `docs/` are for Claude.
**This folder is the project.** Claude Code works directly in it. GitHub (`origin`) is only a backup copy that `/finish-task` pushes to.

## The key idea: the memory lives in files, not in the chat

| File | Holds |
|---|---|
| `CLAUDE.md` | Rules and business invariants. Loaded automatically every session |
| `docs/PRODUCT.md` | What to build and why (v2) |
| `docs/PERMISSIONS.md` | Who can see and do what |
| `docs/WORKFLOWS.md` | Every state machine, scheduled job and notification recipient |
| `docs/DATA-MODEL.md` | The authoritative tables |
| `docs/ARCHITECTURE.md` + `docs/decisions/` | How it's built, and why |
| `docs/ROADMAP.md` | ~45 tasks grouped into **units** (one session each) from phase 3 on |
| `docs/PROGRESS.md` | Where you are, what's next, and handoff notes |
| `docs/research/` | Background only: the v2 spec, your 9 clarification answers, the Kyran study |
| Git | One commit per task, one tag per phase |

Every session starts fresh and reads only what its task needs, so no chat ever runs out of context, and you can stop and resume at any time.

---

## Model tiers

Each roadmap task is tagged with a **tier**, not a model name, so the method keeps working when models change. Update this table when new models come out:

| Tier | Use for | Model today |
|---|---|---|
| **[H]** highest capability | Schema, security rules, transition functions, scheduled jobs, phase reviews, hard bugs | **Fable 5.1** |
| **[C]** strong coding | Screens and features | **Opus 5.5** (about half the cost of Fable 5.1) |
| **[Q]** fast | Polish, small UI fixes, docs | **Sonnet 5** |

Switch with `/model` at the start of a session. If a [C] task goes badly, run `/clear` and redo it on [H]. If your plan's limits allow, running everything on Fable 5.1 is fine too.

---

## One-time setup (≈ 1 hour)
1. **Install:** Node.js LTS, pnpm (`npm i -g pnpm`), Git (done), **Docker Desktop** (WSL2), GitHub CLI (`gh`).
2. **Free accounts:** Supabase (projects `maxoff-staging` and `maxoff-prod`), Cloudflare (Workers + R2), Resend, Sentry, UptimeRobot. GitHub is already set up (`prakyats/MaxOff`).
3. Keep keys in a password manager. **Never paste secrets into the chat.** Put them in `.env.local` yourself. Claude is blocked from reading `.env*` files.
4. Open a terminal in this folder and run `claude`.

## Your very first session (run once)
Run `claude` in this folder, switch to the **[H]** model with `/model`, and paste:

```text
We're starting to build MaxOff. This folder is the project, and all planning is already in it.

Read CLAUDE.md, then docs/PROGRESS.md, docs/ROADMAP.md, docs/PRODUCT.md, docs/PERMISSIONS.md,
docs/WORKFLOWS.md, docs/DATA-MODEL.md, docs/ARCHITECTURE.md and every ADR in docs/decisions/.
docs/research/ is background only; PRODUCT.md wins where they differ.

Don't write any code yet. Reply with a short report:
1. Contradictions or gaps between these docs that would block building. For each: where, what, and your suggested fix.
2. The open questions in PRODUCT.md §7 that must be answered before phase 0–2.
3. What I need to install or set up before task 0.1 (accounts, keys, tools), as a checklist.
Then wait for me.
```

After you've answered its questions and finished the setup, type `/start-task` to begin task 0.1. From then on, use the loop below.

## The loop for each phase (from phase 3)
```
/model                 ← [H]
/kickoff-phase N       ← reads the whole phase, asks EVERY open business question at once, records the answers
/clear
/run-phase N           ← builds the phase unit by unit, one subagent per unit (the unit's tier picks its model);
                          keeps the laptop awake; stops only for a real decision, a red it can't fix twice,
                          an ADR, money / permissions / RLS beyond plan, production, or something unexplained
/clear
/model → [H]
/review-phase N        ← architecture + security review, the ONE phone walk of the phase, fixes, PR, merge, tag
```
Keep the laptop plugged in with other browsers closed while `/run-phase` runs (3 local e2e workers; CI is the authority when the machine is the problem). If it stops, answer, `/clear`, and run `/run-phase N` again: it resumes from the handoff.

One unit at a time instead (the same gates, you in the loop): `/model` for the unit's tier → `/start-task <unit>` (it plans, then proceeds when the kickoff settled the questions) → try it (`pnpm dev` → http://localhost:3000) → `/finish-task` → `/clear`.

### Keeping context under control
- **One unit per session** (or one `/run-phase`, which keeps only summaries and writes a handoff at every unit boundary), then `/clear`.
- Check `/context` now and then. Above ~50% in the middle of a task: `/save-progress` → `/clear` → `/start-task`.
- If a session goes off track, don't argue with it. Discard the changes yourself (`git restore .`), then `/clear` and restart the task with clearer instructions.
- Let Claude use subagents for searches and reviews.

### Your job in each phase
1. **Answer the kickoff.** Every business question of the phase comes at once, each with a recommendation; that is where the product is decided. Claude is told to ask, not guess.
2. **Let `/run-phase` run**, and answer when it stops (it stops only for the reasons above).
3. **Try the phase yourself** before `/review-phase`: log in as the Owner, an Admin and a Staff member, walk the checkpoints in OPERATING-MANUAL §4, and do the phone walk it asks for.

---

## Milestones
| After phase | You can |
|---|---|
| 1 | Log in, invite the team |
| 2 | Run daily attendance and leave approvals |
| 4 | Assign tasks, with acknowledgement and the Admin → Owner approval chain |
| **6 ★ Pilot** | **Use MaxOff every day in production** (attendance, leave, tasks, notifications, dashboards, calendar, EOD report, backups) |
| 7 | Track client projects, cycles and Owner item approvals |
| 9 | See revenue, close months, export reports for AI analysis |
| 10 | Full launch |

Phases 3–10 are 19 units. A phase is a kickoff, a `/run-phase` (a day or two of machine time), a review; the pilot (end of phase 6) is about **3 weeks** away at that pace and full launch about **6 weeks**.

## Adding or changing features later
```
/add-feature WhatsApp reminders for overdue tasks
```
Claude asks questions, designs the change so existing modules aren't disturbed, and writes the spec and roadmap tasks. Then you use the normal loop. Many changes need no code at all, just Settings (task types, stage presets, custom fields, templates, holidays).

## Running costs
₹0/month on free tiers for a small team. Upgrade only when needed: Supabase Pro ($25/mo, daily backups and no pausing), Workers Paid ($5/mo), and R2 beyond 10 GB (~$0.015/GB-month). **Your Claude plan is the main cost.**
