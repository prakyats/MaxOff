---
name: phone-layouts-stay-live
description: Phone layouts stay exactly as on the live app unless the owner explicitly approves a phone change; never push phone restructures via fix lists
metadata:
  node_type: memory
  type: feedback
  originSessionId: ea770483-9990-482d-8bc8-b4cbf9e4045e
  modified: 2026-10-23T03:13:38.572Z
---

Phone layouts (<768 px) stay exactly as they are on the live release unless the owner explicitly approved that phone change (owner, 23 Oct 2026: "phone layout as it is tday, dont change it again"; "why is the calender view like this on the phone?? it should be the same as it is on the live app").

**Why:** my v1.8 gate-fix list asked the builder to rebuild the phone calendar month to a sample, which produced a two-column day-card layout the owner never wanted.

**How to apply:** when a fidelity review flags a phone mismatch, compare against the live tag (`git show v<live>:...`) first; only send phone *structure* changes to builders when the owner approved that exact phone change. Cross-width colour/contrast fixes are fine. Related: [[samples-before-major-ui]], [[ui-changes-one-release]].
