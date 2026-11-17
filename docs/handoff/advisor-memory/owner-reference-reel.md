---
name: owner-reference-reel
description: Reel the owner noted 2026-10-12 — 6 legal traps in AI-built apps; checked against MaxOff, only India's DPDP Act is a real follow-up (phase 10)
metadata:
  type: reference
---

https://www.instagram.com/reel/DdyqycEINNe/ (adilet.fndr, "Your vibe-coded app can get sued for $100K…"). It lists six traps: no age gate (COPPA), Google Fonts loaded from Google (GDPR IP leak), session replay (CIPA wiretapping), marketing email without unsubscribe or postal address (CAN-SPAM), auto-renewal terms at checkout, and no DMCA agent for uploads.

**Checked against MaxOff (2026-10-12):** the app has no public signup (invite-only staff, adults), its fonts are self-hosted at build time (`next/font/google`, no runtime Google requests), there's no Sentry session replay, it sends only transactional email (no marketing), no subscriptions or checkout, and no public uploads. The website maxoff.in self-hosts its fonts and has no forms and no cookies. So none of the six apply today.
**The real follow-up is India's DPDP Act 2023**, since MaxOff holds employees' personal data (attendance, phone numbers, leave, expense receipts): a short privacy notice for team members inside the app, a retention policy, and who to contact. Raise it for phase 10's security review (10.3) and check with a lawyer. Not legal advice. If marketing emails or sign-ups are ever added, revisit CAN-SPAM-style rules.
