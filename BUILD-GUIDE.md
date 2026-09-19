# How to build MaxOff with Claude Code

This guide is for **you**. `CLAUDE.md` and `docs/` are for Claude.

## The key idea: the memory lives in files, not in the chat

A single chat can't hold a whole product, so don't try. Every session starts fresh and reads what it needs from the repo:

| File | Holds | Updated by |
|---|---|---|
| `CLAUDE.md` | The rules. Loaded automatically in every session | You / an ADR |
| `docs/PRODUCT.md` | What to build | You, through `/add-feature` |
| `docs/ARCHITECTURE.md` + `docs/decisions/` | How to build it | Claude, when a pattern changes |
| `docs/ROADMAP.md` | ~40 tasks, each sized for one session | `/finish-task` ticks them off |
| `docs/PROGRESS.md` | Where you are, what's next, and handoff notes | `/finish-task`, `/save-progress` |
| Git history | Exactly what changed and when | One commit per task, one tag per phase |

**So continuity doesn't depend on any one chat.** You can close the terminal, change model, or come back weeks later, and `/start-task` picks up where you left off.

---

## Which model to use

All the current top Claude models have a 1M-token context window. The difference is capability and cost:

| Model | Best for | Relative cost |
|---|---|---|
| **Fable 5.1** | The most capable. Architecture, tricky core pieces (security rules, the customization engine, the template engine, drag-and-drop ordering), phase reviews, hard bugs | Highest (about **2× Opus 5**). On a subscription it uses up your allowance fastest |
| **Opus 5** | Excellent at coding. Most day-to-day feature building | About half of Fable 5.1 |
| **Sonnet 5** | Simple screens, polish, tests, docs | About 1/5 of Fable 5.1 |
| Haiku 4.5 | Not needed for this project | Lowest |

**My recommendation:** Fable 5.1 is a good choice, and if your plan's limits allow it, you can use it for everything. To make your usage go further, **mix models**. Every roadmap task is marked:
- **[F]** Fable 5.1: foundations, security and engines (about 12 tasks)
- **[O]** Opus 5: most features (about 27 tasks)
- **[S]** Sonnet 5: polish

Switch with `/model` at the start of a session. Always use Fable 5.1 for `/review-phase`. If a task goes badly on Opus 5, run `/clear` and redo it on Fable 5.1.

> A 1M context window doesn't mean you should fill it. Long chats get slower, cost more and lose focus. Keeping each session to one task is what keeps quality high.

---

## One-time setup (≈ 1 hour)

1. **Install:** Node.js LTS, pnpm (`npm i -g pnpm`), Git, **Docker Desktop** (with WSL2), and the GitHub CLI (`gh`).
2. **Create free accounts:**
   - GitHub (private repo)
   - Supabase (2 projects: `maxoff-staging` and `maxoff-prod`)
   - Cloudflare (Workers + R2)
   - Resend
   - Sentry
   - UptimeRobot
3. Keep all keys in a password manager. **Never paste secrets into the chat.** Put them in `.env.local` yourself. Claude is blocked from reading `.env` files by `.claude/settings.json`.
4. Open a terminal in this folder and run `claude`.

---

## The loop for each task (~1–3 hours each)

```
/model                 ← pick the model marked on the task
/start-task            ← Claude reads PROGRESS + ROADMAP, then proposes a plan
   (review the plan, ask questions, approve it; Shift+Tab switches plan mode)
   ...Claude builds...
   (you try it: pnpm dev → http://localhost:3000)
/finish-task           ← tests, Definition of Done, docs updated, commit
/clear                 ← ALWAYS clear before the next task
```

At the end of each phase:
```
/review-phase 3        ← Fable 5.1 reviews the phase, fixes issues, merges and tags phase-3
```

### Keeping context under control
- **One task per session**, then `/clear`. This is the most important habit.
- Run `/context` now and then. If it's above ~50% in the middle of a task, run **`/save-progress`**, then `/clear`, then `/start-task`. It picks up from the handoff notes.
- If a session goes off track, **don't argue with it for 20 messages.** Run `git restore .` or `git reset --hard HEAD` to undo, then `/clear` and start the task again with a clearer instruction.
- Let Claude use **subagents** for searches and reviews. They work in their own context and send back only a summary.
- Don't paste huge logs. Point Claude to the file or command instead.

### Your job in each session
1. **Read the plan before approving it.** Look at the scope, whether it matches how Pixora works, and whether anything is hard-coded that should be editable.
2. **Try the feature yourself** in the browser before `/finish-task`.
3. **Answer business questions.** Claude is told to ask rather than guess.

---

## Adding or changing features later

```
/add-feature Leads pipeline with stages, and converting a won lead into a client
```
Claude asks questions, then proposes the design: configuration only, an extension of an existing module, or a new module behind a feature flag. It then writes a feature spec and roadmap tasks. After that you use the normal task loop. The architecture is designed so that new features **add** to the app and don't change existing modules (ARCHITECTURE §10).

Many "every client is different" needs **won't need any code**. They're handled in MaxOff's Settings:
- new fields, globally or for one client
- new services and deliverable types
- a client-specific monthly template
- custom statuses and phases for each project

---

## What "production level" is backed by
- **Security:** database-level rules (RLS) with tests for every role, invite-only access, private files through expiring links.
- **Quality gates:** `pnpm check` (types, lint, unit tests, database tests, build) plus end-to-end tests. CI blocks anything that's red.
- **Every task** has to meet the Definition of Done (loading, empty and error states, mobile, logging, tests, docs).
- **Phase reviews** by a separate reviewer subagent.
- **Operations:** Sentry error monitoring, uptime monitoring, nightly backups with a tested restore, separate staging and production.

## Running costs
**₹0/month** on free tiers, for a small team. Upgrade only when you need to:
- Supabase Pro ($25/mo) for daily backups and no pausing
- Cloudflare Workers Paid ($5/mo) above 100k requests/day
- R2 beyond 10 GB of files (about $0.015 per GB per month)

**Claude Code is the main cost**, through your Claude plan.

## Timeline
About 40 tasks. At 1–2 tasks a day that's **about 5–8 weeks**. Phases 0–2 (foundations) feel slow because nothing visible happens yet, but they're what makes everything after them fast and safe.
