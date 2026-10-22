# V5b builder C: light-theme handoff for the integrator

Light sweep (after only, every route per role at 1280 and 375): `light-sweep/`. Token and shared
fixes made by C (backward-compatible): `--leave-stripe` light `#e4e4e7` → `#d4d4d8` (PP-light-2),
new `--row-unread` / `bg-row-unread` (PP-alerts-2), the red `Badge` link hover underlines in light
instead of deepening to 20% (3.9:1 on the page), `Avatar` ring `foreground/15` without blend modes
and medium-weight initials (PP-me-2), calendar chip secondary words `text-foreground/80`
(PP-light-3), and every laptop `DataTable` (People, leave requests, Clients…) now carries `shadow-raised` like the other grouped lists. No page anywhere paints `#FFFFFF` (`THEME_COLORS.light`, `global-error.tsx` and every
shell route sit on `#F6F5F2`); white is only cards and overlays.

Fixes on screens in A's or B's area (not edited by C):

| Area | Screen | File | Fix |
|---|---|---|---|
| B | Reports index | `src/app/(app)/reports/page.tsx` (`REPORTS_LIST_CLASS`) | The two report rows sit flat on the cream page with only a hairline: add `bg-card shadow-raised` to the list (major change 4: white cards with the raised shadow). |
| B | Settings | `src/app/(app)/settings/list.ts` (`GROUP_LIST_CLASS`, `HELP_LIST_CLASS`) | Group lists are `bg-card` without `shadow-raised`; the "Help and troubleshooting" row is cream (no `bg-card`). Add `shadow-raised` to both and `bg-card` to the help list (or fold it into a Help group, PP-settings-2). |
| A | My Day (phone) | the attendance strip (`modules/attendance` strip on `/my-day`) | "Started 2:05 pm · waiting for app…" ends in an ellipsis on a bar whose tap does not open the full text: the truncation rule says wrap here (or name the state shorter, "Waiting for the Owner"). |
