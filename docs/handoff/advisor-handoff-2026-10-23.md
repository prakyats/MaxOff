# Advisor handoff: 23 Oct 2026 (morning checkpoint)

Read this first, then the tail of issue #89 (newest comments), then `docs/PROGRESS.md` on `phase-6b-r3`.
The previous handoff, `advisor-handoff-2026-10-22.md`, still holds the overnight runbook and the background-work plan.

## Where v1.8 is

- **Branch:** `phase-6b-r3` (the integration branch). The "MaxOff integrator" cloud session runs builders on:
  - `r3-v5b-f2`: the gate follow-ups, plus the 2 CI failures;
  - `r3-v5b-speed`: 3 speed fixes;
  - `r3-v5b-chath`: chat height;
  - `r3-v5b-cal`: the calendar dropdown, the phone revert to v1.7.1 + option A, and the phone audit.
- **Preview:** https://phase-6b-r3-maxoff-staging.pixoraclips.workers.dev
- **Last advisor-verified SHA:** 74f8e01. On it:
  - the 10 gate fixes PASSED (phone pairs in `docs/reviews/v18-polish/gate/`);
  - Impeccable detect: 0 findings in `src`;
  - laptop Owner pass in dark and light was clean;
  - full CI run 39889591399 was **RED** (shard 2): `task-settings.spec:557` drag handle 43 px (needs 44), and `team.spec:88` 'Actions for Invited Person' never stable. Sent back for a fix at the cause (#89 comment 6356273102).
- **Earlier full CI on 4a6213d:** green (run 39874876959).

## Owner decisions today (all on #89)

1. **Task chat height, LAPTOP ONLY** (sample `docs/design/v18-task-chat-height-sample.html`, PR #127):
   - a tighter header, identical on Work and Chat (priority + due on one line, Remind inside the next-step box);
   - the chat fills to the viewport bottom;
   - a sticky Work|Chat bar on scroll;
   - an ⤢ enlarged overlay;
   - the People card stays.
   - Rejected along the way: the collapsing header (tabs jump), work-left/chat-right, and the chat in the right rail. The owner wants the **same width, more height**.
2. **Phone layouts stay as on the live app (v1.7.1)** unless the owner approved that phone change. My gate-fix item 2 rebuilt the phone month into two-column day cards, which was wrong. It is being reverted to the v1.7.1 structure: week strip → "Show more of the month" → full month, with the day panel below. The builder is listing every other phone difference for the owner to decide (it changes nothing on its own).
3. **Calendar All/Tasks/Client work becomes an `All ▾` dropdown:**
   - **Laptop:** beside Filters, toolbar on one row at 1024/1280.
   - **Phone, option A** (sample `docs/design/v18-phone-calendar-filter-sample.html`, PR #128): one header row ‹ Oct 2026 › · Today · All ▾ · Filters icon. It must not break at 320/360/375/430; shorten to "Client ▾", never "…".
   - Crew never see it.
4. **Leave bars never truncate:** use "Name · Leave" when space is short.
5. **Speed gate thresholds** (advisor call, owner to confirm):
   - FAIL: p50 > 600 ms, or more than 100 ms slower than live, or more than 10 % **and** at least 50 ms slower;
   - WARN: more than 10 % but under 50 ms;
   - INFO, timing not judged: `/api/warm`, the static CDN file and the 404 check, though their status is still judged.

## What happens next (no owner input needed until the preview)

1. The integrator merges the four branches and deploys to the preview. It posts **REPORT (chat height)** with the preview link and the phone-difference list. **Send the owner the link.**
2. The advisor checks it on the preview:
   - laptop chat height vs the sample;
   - the calendar dropdown at 1024/1280;
   - the phone calendar = v1.7.1 + option A at 320–430;
   - full CI green;
   - then speed gate (10 samples, all three roles) vs staging.
3. **READY FOR OWNER: v1.8**, with the speed table (WARN/INFO rows), the guide confirmation and the walk script. Write the owner's morning summary.
4. **Then v1.9:** tell "MaxOff v1.9 builder" to merge the frozen phase-6b-r3 and build W4 → W5 → W6 (skip A5; working-hours switch off).

## Never without the owner

- merges of phase work to main;
- `v*` tags and production deploys;
- anything touching production;
- phone layout changes;
- new major UI without a sample.

## Loop mechanics

- Builder → advisor: `REPORT (...)` comments on #89.
- Advisor → builder: `ADVISOR:` comments on #89 plus SendMessage to "MaxOff integrator".
- Local watcher: `bash <scratchpad>/watch89.sh <latest comment id>`. It is lost when the laptop sleeps; on resume, read #89 from comment 6356972022 onward.
- Full CI on a branch: `gh workflow run CI --repo prakyats/MaxOff --ref <branch> -f full=true`.
