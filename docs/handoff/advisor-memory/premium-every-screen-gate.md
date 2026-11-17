---
name: premium-every-screen-gate
description: Owner 2026-10-21 — no release READY until every screen passes the premium design tools (Impeccable, design:*) and guides users by visual hierarchy
metadata:
  type: feedback
---

Owner, 21 Oct 2026: "ensure that every screen does follow the premium design rules that are provided by Impeccable and other tools… before the version 1.8 release, every screen has become more premium… and does the job of guiding the users through visual hierarchy."

**Why:** button/colour fixes alone weren't enough; he wants the whole UI to look premium and lead the eye.
**How to apply:** for v1.8 (and later UI releases), the advisor runs Impeccable + design:* skills locally on the preview (cloud builders don't have them installed), writes a per-screen polish list on #89 (`PP-<screen>-n`), the builder applies it with before/after screenshots, and the advisor re-checks before READY FOR OWNER. Pairs with [[ui-changes-one-release]] and [[plugins-never-override-claude-md]].
