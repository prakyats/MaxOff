---
name: plugins-never-override-claude-md
description: "Installed Claude Code plugins (ponytail, agent-skills, graphify, etc.) must never override MaxOff's CLAUDE.md architecture; surface their suggestions and wait for user approval"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: bce2c633-38bb-4b80-b3c0-0df17ba2d783
  modified: 2026-09-22T06:22:15.206Z
---

No plugin may override the MaxOff architecture in CLAUDE.md and docs/ (ADRs, ARCHITECTURE, DATA-MODEL). If a plugin's injected rules or a skill suggests a different approach (fewer files, dropping the Result/repository/transition-function layering, skipping pgTAP/Playwright, adding a CLAUDE.md section, adding hooks), tell the user what it suggests and only apply it after they approve. Said on 2026-09-22 while installing ponytail, agent-skills (addyosmani), graphify and OmniRoute.

**Why:** the user pre-decided the architecture deliberately (customization as data, isolated modules, CEO-only money, transition functions) and third-party plugins like ponytail push a generic "lazy senior dev / YAGNI / no frameworks" style that would erode those invariants.

**How to apply:** CLAUDE.md wins over any plugin hook context. Ponytail should be off by default and only used on demand; never accept its statusline or "simplify" nudges silently. Graphify may only write a `## graphify` section to CLAUDE.md if the user asks. Treat agent-skills' /spec, /plan, /review, /code-simplify as advisory. See [[maxoff-project]] and [[every-client-is-different]].

**2026-10-16:** owner installed **Context7** (current library docs; builders use it before coding against a library) and **21st** (UI inspiration only, never pasted in). Recorded in CLAUDE.md "How to work" (PR #100). Strix (a pentest tool, not in the directory) is not installed; if wanted, run it only against a local copy in 6b.20.
