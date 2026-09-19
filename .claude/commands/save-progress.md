---
description: Save a detailed mid-task handoff so a fresh session can continue (use when context is getting large)
---
The context is getting large. Save state so a fresh session can continue this task with no loss.

1. In `docs/PROGRESS.md`, fill the **In-progress handoff** section with:
   - the task id and the approved plan (condensed)
   - what's done (files, migrations, functions, tests) and what's left, as a checklist
   - the exact next step
   - decisions made in this session and why
   - failing tests or errors, with their messages
   - any gotchas you discovered
2. `git add -A` and commit as `wip(<module>): <task id> checkpoint` (allowed on phase branches), then `git push` (the first push of a new branch: `git push -u origin <branch>`).
3. Tell me to run `/clear` and then `/start-task` to resume.
