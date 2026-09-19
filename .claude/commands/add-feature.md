---
description: Plan a new feature or change so it fits the architecture without disturbing existing modules
argument-hint: "<describe the feature>"
---
I want to add this to MaxOff: $ARGUMENTS

Don't write any code yet.
1. Read `docs/PRODUCT.md`, `docs/ARCHITECTURE.md` (especially §4 and §10) and the ADRs.
2. Ask me the questions you need answered to understand the business need. Remember that every client is different, so prefer configuration over hard-coding.
3. Then propose:
   - whether it's configuration only (lists, custom fields, templates), an extension of an existing module, or a new module
   - the data model changes (additive only), permissions, feature flag, and extension slots used
   - the impact on existing modules (it should be none or minimal) and how that will be tested
   - a task breakdown sized for one session each
4. After I approve: write `docs/features/<name>.md`, add an ADR if needed, and add the tasks to `docs/ROADMAP.md`. Don't start building.
