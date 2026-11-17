---
name: truncation-rule
description: Owner design rule 21 Oct — ellipsis only on first views that open to the full text; never truncate where nothing opens further
metadata:
  type: feedback
---

Owner, 21 Oct 2026: one-line ellipsis ("Pre Product…") is deliberate in a first/collapsed view when tapping it expands or opens the full thing (rows, chips, calendar items, tabs); the opened view must show the full text. Where there's no further expansion (final detail, dialog body, details fields), show everything in full, wrapping.

**Why:** splitting names onto two lines makes rows inconsistent heights; he prefers uniform single-line rows with the full text one tap away.
**How to apply:** don't suggest wrapping/min-width fixes for truncated labels in expandable rows; instead check the expanded view shows the full text, and flag any ellipsis on a non-expanding element as a bug. Recorded for DESIGN.md (#89). Related: [[premium-every-screen-gate]].
