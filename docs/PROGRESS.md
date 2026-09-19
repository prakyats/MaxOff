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
- The repo root is this folder. `CLAUDE.md`, `docs/`, `.claude/` and `BUILD-GUIDE.md` already exist. **The Next.js scaffold must not overwrite them.** Scaffold into a temporary folder and merge.
- Windows machine: Docker Desktop (WSL2) is needed for local Supabase.
- The docs were rewritten for **v2**. `docs/research/` holds the source material (v2 spec, clarifications, Kyran research) and is background only. **`docs/PRODUCT.md` wins where they differ.**

## Ideas / tech debt (don't build these without adding them to the roadmap)
- —

## Open questions for Pixora
- See PRODUCT.md §7 (Admin metrics scope, default thresholds, job titles and import data).

## Session log (newest first)
| Date | Task | Result | Notes |
|---|---|---|---|
| 2026-09-20 | v2 reconciliation | PRODUCT, PERMISSIONS, WORKFLOWS, DATA-MODEL, ARCHITECTURE, ADR-0004 to 0009, ROADMAP rewritten | 9 clarification questions answered |
| 2026-09-19 | Planning | v1 docs and workflow kit created | Superseded by v2 |
