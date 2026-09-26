---
description: Settle every business question a phase raises, all at once, before any of it is built
argument-hint: "[phase number]"
---
Kick off phase $ARGUMENTS of MaxOff. (Run this on the highest-capability model: it reads the whole phase.)

The point: `/run-phase` builds a phase unit by unit without stopping for approval, so every business question the phase raises has to be settled **before** it starts. Ask them all here, once.

1. Read `docs/PROGRESS.md` in full. If the phase already has a "Kickoff <N> decisions" block there, show it and ask whether to add to it or stop.
2. Read the phase's section of `docs/ROADMAP.md` (its exit criterion, units and task lines), then the parts of `docs/PRODUCT.md`, `docs/WORKFLOWS.md`, `docs/DATA-MODEL.md`, `docs/PERMISSIONS.md`, `docs/ARCHITECTURE.md` and `docs/decisions/` that those tasks touch. Use an Explore subagent for the code the phase will change, so the questions are grounded in what exists.
3. List **every** business question the phase raises that the docs do not settle: a state or transition WORKFLOWS leaves open, a permission PERMISSIONS does not name, a field or rule DATA-MODEL implies but does not state, copy the product will show that PRODUCT does not decide, a default, a limit, a notification recipient, anything a builder would otherwise have to invent (CLAUDE.md business invariant 10). Skip anything the docs already answer, and say so if the phase raises nothing.
4. For each question give: the unit and task it blocks, the options, a **recommended answer** with the reason, and what the recommendation rules out. Number them and **ask them all at once** (`AskUserQuestion` with the recommendation first, or one numbered list), then wait.
5. Record every answer where it belongs, dated: rules in `docs/WORKFLOWS.md`, product behaviour and copy in `docs/PRODUCT.md`, a permission in `docs/PERMISSIONS.md`, a column or constraint in `docs/DATA-MODEL.md` (each as "owner decision <date>, kickoff <N>"). A decision that contradicts an ADR needs a new ADR, so stop and say so. Then add a **"Kickoff <N> decisions (<date>)"** block to `docs/PROGRESS.md` under "Things the next session must know": one line per decision, in the order of the units they affect. That block is what `/run-phase` and every unit's subagent read.
6. Run `pnpm check` (docs are format-checked), commit as `docs: phase <N> kickoff decisions`, push.
7. Tell me the phase is ready for `/run-phase <N>` (or `/start-task <unit>` one unit at a time), and remind me to `/clear` first.
