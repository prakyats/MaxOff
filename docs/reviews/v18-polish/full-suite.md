# v1.8 V5b integration: the whole Playwright suite, locally

Branch `r3-v5b-fin` (A, B, C+D and E merged), 2026-10-22/23, after the last code commit (`ca7e2c0`).

How it ran, as CI runs it (`.github/workflows/ci.yml`):
- a build that inlines the hold proxy's URL (`NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54331 pnpm build`), then `next start` (`CI=1`);
- four shards of `--project=setup --project=desktop --project=mobile --project=mobile-lg --project=production`, each at 1 worker after its own `pnpm db:reset`, all under `flock /tmp/maxoff-db.lock`;
- after shard 4, in the same database: `owner-bulk` alone, then `push-cron` alone (both `--no-deps`, as CI);
- the whole run inside one IST business day.

## Final run (green)

| Chunk | Passed | Failed | Skipped | Time |
|---|---|---|---|---|
| Shard 1/4 | 351 | 0 | 184 | 17.3 min |
| Shard 2/4 | 465 | 0 | 66 | 22.4 min |
| Shard 3/4 | 453 | 0 | 79 | 22.3 min |
| Shard 4/4 | 475 | 0 | 57 | 16.3 min |
| owner-bulk | 3 | 0 | 0 | 11 s |
| push-cron | 8 | 0 | 0 | 17 s |
| **Total** | **1,755** | **0** | **386** | |

Passed counts include each shard's 4 setup tests. Skips are the specs' own project rules, such as desktop-only or phone-only.

`calendar.spec` "as Crew › installed: sizes, days, a month and a filter add no history…" (the known intermittent one, at line 431 now) ran with `--repeat-each=10` at 375 and 430 after a reset: 20/20 green.

## Reds found on the way, and their root causes

1. **instant-skeleton "bar tab, task row, back…" [mobile]**: 3.2 s, or no skeleton at all. It was red only in a full run (shard 2) and 5/5 red on the database that run left.
   - Cause: after a cold reopen, the router prefetches the rows in view four at a time. Every row the warm visit had never prefetched went to the cold Worker for 3 s, so all four slots were taken when the task's row scrolled in.
   - Only the touch's own prefetch then went out. The worker answered it in 1 ms, but the browser holds a page's network tasks while a touch is down, so the answer arrived after the tap.
   - Fix (`public/sw.js` v12): one kept copy of a task page's skeleton serves every task, with that task's id put back in.
   - After the fix: 74/74 green at 375 and 430 on that database, tap to skeleton 185–235 ms.
2. **The same test, warm visit**: it found Today's link to the task while Today was still on screen, and the link was detached a moment later. The spec now waits for Tasks and uses Tasks' own row.
3. **`deliverables-list.spec:325` (every width)**: a project with one cycle drew a 44 px month label where the skeleton draws the 52 px switcher, so the list moved down 8 px when the data arrived. The label now keeps the switcher's height.
4. **`freelancers.spec:139`**: a freelancer's page no longer said "Freelancer" anywhere. B's details card had dropped the role, and the Profile record leaves a freelancer's role out. The card now shows "Role · Freelancer".
5. **`extra-work.spec:128`**: the spec still read the old hint in Request leave. It now reads A's PP-forms-5 balance line ("Comp leave: 1 day · use by …").
6. **`mobile.spec` "/clients: fits at 130% and 200%" at 375**: the logo sat inside the card's title, which left the name 37 px at 200%. The logo is now the card's `leading`.
7. **`instant-skeleton:153` (staff)**: My Day links a task twice by design: its row, and its deadline under "This week" (FINAL 8, PP-today-4). The spec now waits for Tasks and uses Tasks' own row.

Two earlier runs were not counted:
- one used a build without the proxy's URL, so the loading-screen specs could not hold their reads;
- one crossed midnight IST in shard 2, so every date-titled test and the Start-day gate broke.
