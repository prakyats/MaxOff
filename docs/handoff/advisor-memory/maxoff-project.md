---
name: maxoff-project
description: "MaxOff is the internal operations/control system for Pixora Clips; the repo is the MaxOff folder (git, origin github.com/prakyats/MaxOff), built task by task with Claude Code from the v2 docs"
metadata: 
  node_type: memory
  type: project
  originSessionId: 5065158f-3f2a-4d2c-a7a8-03769ef74bd9
  modified: 2026-09-19T20:28:45.826Z
---

MaxOff is the internal operations and control system for the user's agency, Pixora Clips. It was re-scoped on 2026-09-20 by the user's v2 spec (docs/research/v2-product-context.md) plus 9 clarification answers (docs/research/v2-clarifications.md). Core: CEO/Admin/Staff roles, daily attendance gate + leave (CEO approves), staff tasks (acknowledgement, Done → Admin → CEO approval), clients with a light brand kit, client work as Projects → cycles → items (separate from staff tasks), notifications, dashboards, CEO-only revenue, reports and month close. Everything runs in IST.

The repo root is C:\Users\ASUS\Desktop\MaxOff. The authoritative docs are docs/PRODUCT, PERMISSIONS, WORKFLOWS, DATA-MODEL, ARCHITECTURE, ROADMAP (tasks tagged [H]/[C]/[Q] model tiers, pilot after phase 6), PROGRESS and ADRs 0001–0009. The user wants everything kept in the local folder, which Claude Code builds from, with GitHub as a backup.

**Why:** the user wants production-level, extensible software built with Claude Code in the terminal (Fable 5.1 for [H] tasks, Opus 5 for [C]).

**How to apply:** follow CLAUDE.md invariants. PRODUCT.md wins over docs/research. Ask the user one question at a time when business rules are unclear. See [[every-client-is-different]].
