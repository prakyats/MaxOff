---
name: samples-before-major-ui
description: Owner 2026-10-22 — any major visual shift needs a sample the owner approves before builders implement it
metadata:
  type: feedback
---

Owner, 22 Oct 2026: "if at all there is a major shift in any of the corrections that you have suggested, before implementing, I want to see a sample of it so that I know what the final outcome will look like."

**Why:** he wants to see the final outcome before real UI changes (he caught mismatches with the 16 Oct sample before).
**How to apply:** split polish into minor (build freely) vs major shifts (new layouts, restructures, new components, theme-wide changes). For majors, publish a sample artifact (also commit it to `docs/design/` so builders can match it exactly), tell builders to HOLD, and release with "SAMPLES APPROVED" on #89 only after his OK. Related: [[premium-every-screen-gate]], [[ui-changes-one-release]].

**Fidelity (owner, 22 Oct):** the real app must look like the approved samples — same colours, contrast, depth (he loved the samples' look and worried builds drift). Builders take exact token values from the sample HTML in `docs/design/` (sample wins over globals.css, AA kept), every screen report shows sample vs built in both themes, and the advisor's gate compares side by side. Calendar: everything one line with "…", full text in the popup.
