# MaxOff Progress

> Claude reads this **first** in every session. `/finish-task` and `/save-progress` keep it up to date.
> Keep it short: current state, what's next, and anything the next session must know.

## Current state
- **Phase:** 0 (Foundation), in progress
- **Branch:** `phase-0` (remote: `origin` → github.com/prakyats/MaxOff)
- **Last completed task:** **0.1 Repo tooling** (2026-09-21, committed on `phase-0`)
- **Next task:** **0.2 Local Supabase** · model tier [H]

## In-progress handoff
<!-- Filled by /save-progress when a session ends mid-task. Clear it when the task is finished. -->
_None_

## Things the next session must know
- **Versions installed by 0.1 (2026-09-21):** Next **16.3.5** (Turbopack), React **19.2.8**, TypeScript **6.0.3**, Tailwind **4.3.3** (`@tailwindcss/postcss`), ESLint **9.39.5** + `eslint-config-next` 16.3.5, Prettier **3.9.8** (+ `prettier-plugin-tailwindcss` 0.8.1, `eslint-config-prettier` 10.1.8), Node 24.14.1, pnpm 12.5.1. **No fallback was needed:** everything is `create-next-app`'s own combination except TypeScript, which is pinned to 6.0.3 because `eslint-config-next` bundles `typescript-eslint@^8`, whose peer range is `typescript <6.1.0` — TypeScript 7.0.2 (the native port) would break type-aware lint. `typecheck`, `lint` and `build` all pass on 6.0.3. Prefer the scaffold's working combination over the newest release when upgrading.
- **`pnpm check` is typecheck + lint + format:check + build.** `db:*` scripts join in **0.2**, unit/pgTAP/e2e in **0.4**. No stub scripts (CLAUDE.md §Commands says the same).
- **Prettier owns code only.** `*.md` is in `.prettierignore` so the hand-formatted docs, ADRs and `CLAUDE.md` stay byte-stable.
- **`agentRules: false` in `next.config.ts` is deliberate.** `next dev` otherwise appends a `nextjs-agent-rules` block to `CLAUDE.md` on every run. Next 16's own guidance is readable at `node_modules/next/dist/docs/` — worth a look, since Next 16 differs from model training data.
- **Verify at 0.5:** Next 16 builds with **Turbopack** by default. Confirm `@opennextjs/cloudflare` (1.20.6 peers `next >=16.3.3`) accepts a Turbopack production build; if not, switch the `build` script to webpack there.
- **Check at the start of 0.3:** shadcn/ui against Next 16 + React 19.2.8 + Tailwind v4 before installing it.
- The repo root is this folder. `CLAUDE.md`, `docs/`, `.claude/`, `BUILD-GUIDE.md`, `.gitattributes` and `.gitignore` already exist and must never be overwritten by a generator. (0.1 scaffolded into a temp folder and copied in selectively; the scaffold's own `CLAUDE.md`, `AGENTS.md`, `README.md` and `.gitignore` were discarded.)
- Windows machine: Node 24, pnpm 12.5.1 and `gh` installed; long paths and PowerShell RemoteSigned are set; `git core.longpaths=true`. Docker Desktop (WSL2) and the Supabase CLI are installed by the owner before 0.2.
- The docs were rewritten for **v2**. `docs/research/` holds the source material (v2 spec, clarifications, Kyran research) and is background only. **`docs/PRODUCT.md` wins where they differ.**

## Ideas / tech debt (don't build these without adding them to the roadmap)
- `src/core/**` and `src/modules/**` are empty `.gitkeep` folders. Each task deletes the `.gitkeep` of the folder it fills; the skeleton exists so `eslint-plugin-boundaries` (0.4) has something to enforce.
- No `LICENSE` file (the repo is private and unlicensed). Add one only if that ever changes.

## Open questions for Pixora
- See PRODUCT.md **§8** (Admin metrics scope before phase 9; data to import at launch). §7 holds the settings already decided.

## Session log (newest first)
| Date | Task | Result | Notes |
|---|---|---|---|
| 2026-09-21 | 0.1 Repo tooling | Next 16.3.5 + React 19.2.8 + TS 6.0.3 + Tailwind v4 scaffolded into the existing repo, strict tsconfig, ESLint (flat, `no-console` allowing warn/error) + Prettier, `@/*` alias, ARCHITECTURE §3 folder skeleton, `pnpm check`, `.env.example`, README, `.gitattributes`. `pnpm check` passes; `pnpm dev` serves 200 | Branch `phase-0`. `agentRules: false` keeps `next dev` out of CLAUDE.md |
| 2026-09-21 | Pre-build consistency pass | 13 doc gaps fixed and 9 rules decided: "I'm working today" transition + `worked_on_leave`, leave-wins auto-correction, CEO correction creates leave, `derived_from_leave` event, two-level ack escalation (`ack_escalate_ceo_hours` 8 h) + overdue escalation (24 h), reopen route, closed items stay in Potential, carry creates the next cycle, previews kept, email cap 20, project/item custom fields CEO-only, projects column guard, jobs "runs in" column | Docs are consistent. **Re-read them; don't work from an earlier copy** |
| 2026-09-21 | Docs finalized | Drive archive (ADR-0010), upload limits, hosting limits, all 9 reconciliation gaps fixed, launch settings recorded | Superseded by the row above |
| 2026-09-20 | v2 reconciliation | PRODUCT, PERMISSIONS, WORKFLOWS, DATA-MODEL, ARCHITECTURE, ADR-0004 to 0009, ROADMAP rewritten | 9 clarification questions answered |
| 2026-09-19 | Planning | v1 docs and workflow kit created | Superseded by v2 |
