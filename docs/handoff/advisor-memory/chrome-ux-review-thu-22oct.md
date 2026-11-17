---
name: chrome-ux-review-thu-22oct
description: "REMIND THE OWNER FIRST: Thu 22 Oct 2026 (after the 07:30 usage reset), before any v1.8 work, do the end-to-end UX review of staging with Claude in Chrome"
metadata:
  node_type: memory
  type: project
  originSessionId: 8b868806-9783-4b1b-99ee-1c631b0ca40c
  modified: 2026-10-16T08:12:17.010Z
---

Owner 2026-10-16: "after the v1.7.1 release… make use of Claude in Chrome, run the entire application end to end, look for improvements in UI/UX and overall suggest improvements… we'll do it on Thursday. Just remind me about it before we start working any further."

**When:** Thursday 22 Oct 2026, after the weekly usage reset (07:30 IST), **before starting v1.8 or any other build work**. At the start of the next working conversation, remind the owner before anything else.

**How (agreed):**
- The owner opens **staging** (https://maxoff-staging.pixoraclips.workers.dev) in Chrome and **signs in himself**. Claude never types passwords.
- Claude drives that tab with the Claude in Chrome tools, at laptop and phone widths.
- **Pass order:**
  1. Owner role first, all screens: Today, Approvals, Tasks, Calendar, Clients/projects, People, Reports, Settings, the guide.
  2. Then a quick pass signed in as a test Admin.
  3. Then a test Crew account. Check the Crew never see client work.
- **What to check:** clarity of the next action; tap → action match; the colour rule; wording; empty, loading and error states; §14.2 back behaviour; speed as felt; consistency; the guide matches the screens.
- **Safety:** staging only, never production. Browsing is free. The owner offered full control (16 Oct), but browser safety rules still need confirmation before submit, save, approve or delete, so **batch them**: list the exact actions of each flow ("create UX test 1, assign, note, done, approve, archive") and get one "yes" per list. Name every test record "UX test …".
- **Deliverable:** a ranked report (fix now / v1.8 / v1.9 / nice to have), each finding with its screen and a screenshot, plus overall product suggestions. Publish it as an artifact so the owner can share it.
- **Cost:** about 15–25% of a week. Do it at the start of the week.

Related: [[launch-deadline-nov-2026]] (release order), [[ui-changes-one-release]].

**Also on Thu 22 Oct, right after the review:** the backup **restore drill**, ROADMAP 6b.20 (a). Restore the latest nightly backup into a LOCAL Supabase stack only, check the business tables row counts and one recent record, and write docs/runbooks/restore.md. The 6b.20 (b) gap audit comes after v1.8.

**Tools for the review (owner 2026-10-16, premium UI):** besides Claude in Chrome, run an **Impeccable audit/critique**, **design:design-critique**, **design:accessibility-review** and **design:ux-copy** on what the review finds. The report then feeds v1.8's app-wide premium-UI pass (CLAUDE.md "Premium UI", PR #101).

**Premium UI plan (16 Oct):** https://claude.ai/artifact/DipBbH2ETmKZaxxWCyoNKn. Owner gives feedback and picks (feel, density, motion, dark mode, fonts) and says "proceed" next time. It feeds v1.8. Research: Taste Skill = borrow checks only (excludes app screens; runs download scripts); awesome-design-md = Linear/Vercel traits as reference, no brand copying.

**v1.8 visual target APPROVED (16 Oct):** the refined sample https://claude.ai/artifact/AjsmCURJBuijasCy1bwTvG (v2) is the project-page target and the style reference for v1.8 ("we are good to go"): full width, Needs-you pills, group progress strips, Next chip, neutral Mark done only when ready, History and ⋯ in the header, ⋯ plus › on rows, Details full width. Builders implement it in real code with core/ui tokens.

**Next release (v1.8) item, owner 2026-10-16:** "Save as template" from a project copies the STRUCTURE ONLY (deliverables, stage groups, repeat), never the project description or custom-field values, so one client's details never leak into a shared template. Don't change v1.7.1. Recorded in PROGRESS (PR #105) after the v1.7.1 tag.

**Long stage lists, APPROVED (owner 17 Oct), sample v3 section "Long stage lists":** rows collapsed by default (one line: name, continuous bar, n/m, truncated Next), expanded = left-aligned checklist in 3 columns (1 on phone), next stage bold+outlined, "Group stages" hint (Admin chooses; never automatic), revision-round tip, 2-line clamp for long names. PROGRESS PR #106. **During the Thursday Chrome check:** open a real-shaped project on staging with 12 long-named stages (create a "UX test" project with the team's stage names if none) and confirm the current breakdown, at laptop and phone widths; list anything else the sample misses.

**DONE early, Wed 21 Oct 2026** (owner chose to use the leftover weekly usage). Report: https://claude.ai/artifact/9wxAFfKFos56Ue61ETYZHH — 13 bugs (fix first in v1.8), 30 v1.8 items, 5 v1.9, 5 nice-to-have. B7 DECIDED (owner, option a): a new revision round goes after the last revision stage, or after Edit if none. Recorded in PROGRESS (PR #107). Not covered: true 375/430 widths (Chrome min ~500), Admin/Crew at phone width, light theme, auth screens. Test data: project "UX test – long stages" on client Shetty, cancelled with reason. Thursday now starts with the restore drill, then v1.8 using this report.

**v1.8 build (21 Oct, owner AFK, advisor orchestrates the "MaxOff integrator" cloud session via #89 + SendMessage; watcher script in scratchpad `watch89.sh`):** V0–V3 accepted; V4 running; V5 = guide/screenshots/release review. Then full CI → READY FOR OWNER → owner walk → advisor merges → owner tags v1.8.0. Owner decisions 21 Oct ("all as recommended"): B7 fallback before "Posted"; B6 Remind not in Chat; B11 deploy.yml staging head_sha change APPROVED (staging only); after v1.8 the restore drill runs FIRST, then 6b.20 (b), then v1.9. Preview: https://phase-6b-r3-maxoff-staging.pixoraclips.workers.dev
**Colour plan APPROVED (owner 21 Oct, "colour plan approved with forest"; sample claude.ai/artifact/DE5WJ8qrfN7q8QQQKVvw3Z):** red solid = final/irreversible (Close deliverable, Cancel, Reject, Revoke, Deactivate, Remove, Delete); Forest green #15803D solid = Approve / Approve all / Mark done / Grant; neutral solid = Save/Create/Send; outline = second choices; one solid per layer. Status: red late/cancelled/rejected/absent, amber waiting, blue in progress, green done/approved, grey draft/archived. Owner reversed C5: Cancelled is RED. Built in V5 + ADR-0015 amendment.
**Delete plan APPROVED (owner 21 Oct):** config lists get Edit · Archive · Delete. Delete = permanent, Owner only, only when nothing references the row (templates/presets always; task types, job titles, expense categories, custom fields, holidays, draft clients, contacts when unused). Never deletable: people, attendance, leave, expenses, tasks, client work, history, money. Admins: Edit · Archive. Built in V5 (V4's "Delete = archive" label renamed back to Archive).

**Handoff 22 Oct ~13:20 IST:** full state in `C:\Users\ASUS\Downloads\maxoff-advisor-handoff-2026-10-22.md` (read it first after compaction). v1.8 is in V5b (polish) on `phase-6b-r3`; builder A on V5b-0; re-arm the #89 watcher (last comment 6334877899).
