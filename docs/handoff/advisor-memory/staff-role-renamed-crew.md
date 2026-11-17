---
name: staff-role-renamed-crew
description: "Owner decided 2026-09-30 that the third role is shown as \"Crew\" instead of \"Staff\" (UI label only)"
metadata:
  node_type: memory
  type: project
  originSessionId: 32c30ced-e55d-4ca9-a13b-95a331bea045
  modified: 2026-09-30T02:33:59.652Z
---

Prishit (2026-09-30) chose **Crew** as the user-facing name for the third role (roles read Owner · Admin · Crew). It is a wording change only: the database role/enum stays `staff`, permissions unchanged, CLAUDE.md invariant 1 still means the same three roles.

**Why:** "Staff" didn't feel right; Crew fits a video/creative studio and the MaxOff brand (also on maxoff.in's Roles section).

**How to apply:** new UI copy, docs for users, the app guide and the website say "Crew"; code identifiers and DB values keep `staff`. The rename lands as one small PR after phase 4 and 5A merge, before v1.2.0. See [[launch-deadline-nov-2026]].
