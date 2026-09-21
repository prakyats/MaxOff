# MaxOff Progress

> Claude reads this **first** in every session. `/finish-task` and `/save-progress` keep it up to date.
> Keep it short: current state, what's next, and anything the next session must know.

## Current state
- **Phase:** 0 (Foundation), not started
- **Branch:** `main` (remote: `origin` → github.com/prakyats/MaxOff)
- **Last completed task:** — (planning finished: v2 docs reconciled on 2026-09-20)
- **Next task:** **0.1 Repo tooling** · model tier [C]

## In-progress handoff
<!-- Filled by /save-progress when a session ends mid-task. Clear it when the task is finished. -->
_None_

## Things the next session must know
- The repo root is this folder. `CLAUDE.md`, `docs/`, `.claude/`, `BUILD-GUIDE.md`, `.gitattributes` and `.gitignore` already exist. **The Next.js scaffold must not overwrite them.** Scaffold into a temporary folder and merge.
- **0.1 decisions (2026-09-21):** newest Next.js that `@opennextjs/cloudflare` supports, Tailwind v4, `src/` layout, pnpm.
- Windows machine: Node 24 and `gh` installed; **pnpm is not installed yet** (`npm i -g pnpm` or `corepack enable`); long paths and PowerShell RemoteSigned are set; `git core.longpaths=true`. Docker Desktop (WSL2) and the Supabase CLI are installed by the owner before 0.2.
- The docs were rewritten for **v2**. `docs/research/` holds the source material (v2 spec, clarifications, Kyran research) and is background only. **`docs/PRODUCT.md` wins where they differ.**

## Ideas / tech debt (don't build these without adding them to the roadmap)
- —

## Open questions for Pixora
- See PRODUCT.md §7 (Admin metrics scope, default thresholds, job titles and import data).

## Session log (newest first)
| Date | Task | Result | Notes |
|---|---|---|---|
| 2026-09-21 | Pre-build consistency pass | 13 doc gaps fixed and 9 rules decided: "I'm working today" transition + `worked_on_leave`, leave-wins auto-correction, CEO correction creates leave, `derived_from_leave` event, two-level ack escalation (`ack_escalate_ceo_hours` 8 h) + overdue escalation (24 h), reopen route, closed items stay in Potential, carry creates the next cycle, previews kept, email cap 20, project/item custom fields CEO-only, projects column guard, jobs "runs in" column | Docs are consistent. **Re-read them; don't work from an earlier copy** |
| 2026-09-21 | Docs finalized | Drive archive (ADR-0010), upload limits, hosting limits, all 9 reconciliation gaps fixed, launch settings recorded | Superseded by the row above |
| 2026-09-20 | v2 reconciliation | PRODUCT, PERMISSIONS, WORKFLOWS, DATA-MODEL, ARCHITECTURE, ADR-0004 to 0009, ROADMAP rewritten | 9 clarification questions answered |
| 2026-09-19 | Planning | v1 docs and workflow kit created | Superseded by v2 |
