---
description: Plan a new feature or change so it fits the architecture without disturbing existing modules
argument-hint: "<describe the feature>"
---
I want to add this to MaxOff: $ARGUMENTS

Don't write any code yet.
1. Read `docs/PRODUCT.md`, `docs/PERMISSIONS.md`, `docs/WORKFLOWS.md`, `docs/DATA-MODEL.md`, `docs/ARCHITECTURE.md` (§1, §4, §16) and the ADRs.
2. Ask me the questions you need answered, one at a time. Check the idea against the business invariants in CLAUDE.md and point out any conflict.
3. Then propose:
   - whether it's configuration only (lists, custom fields, templates, settings), an extension of an existing module, or a new module
   - data model changes (additive only), transition functions, permission keys and visibility, notifications, feature flag, extension slots used
   - the impact on existing modules (should be none or minimal) and how that's tested
   - a task breakdown sized for one session each, with model tiers
4. After I approve: update PRODUCT / PERMISSIONS / WORKFLOWS / DATA-MODEL, write `docs/features/<name>.md`, add an ADR if needed, and add the tasks to `docs/ROADMAP.md`. Don't start building.
