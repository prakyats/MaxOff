---
description: Save a detailed mid-task handoff so a fresh session can continue (use when context is getting large)
---
The context is getting large. Save state so a fresh session can continue this task with no loss.

1. In `docs/PROGRESS.md`, fill the **In-progress handoff** section with:
   - the task id and the approved plan (condensed)
   - what's done (files, migrations, tests) and what's left, as a checklist
   - the exact next step
   - decisions made in this session and why
   - known failing tests or errors, with their messages
   - any gotchas you discovered
2. Commit everything as `wip(<module>): <task id> checkpoint`. Work-in-progress commits are allowed on phase branches.
3. Tell me to run `/clear` and then `/start-task` to resume.
