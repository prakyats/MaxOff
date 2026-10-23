# v1.8 design gate: phone pairs after the 10 fixes

Real phone pairs, shot 23 Oct 2026 on a production build of `r3-v5b-gate` (Owner, local demo data).
Each fix has eight pictures: `<pair>-<375|430>-<dark|light>-<sample|built>.png`. The sample is the
agreed mock's part from `docs/design/`, and built is MaxOff at that phone width and theme.

| # | Pair | Sample part | What to check |
|---|------|-------------|---------------|
| 1 | `1-calendar-day` | calendar sample, day popup | A list, not a timeline: `Tasks · n` and `Client work · n`, each counting what it shows, with chips. The foot has Open day and one solid "+ New task on <date>". |
| 2 | `2-calendar-month` | calendar sample, month | The full month on a phone reads "Edit · 11:45 am" (two columns, not "Fi…"). Tapping a day opens the popup. |
| 2 | `2-calendar-today` | major changes, calendar | Today is a red date circle on a neutral tint, with no 2 px outline. |
| 3 | `3-alerts` | pulled-in, alerts | In light, an unread row sits a shade lighter than a read one (dark is unchanged). |
| 4 | `4-project` | project page | "1 behind plan" and "2 days late" are red chips. The ring's track and the open bar segments are neutral, and only done stages are green (0/4 reads grey). |
| 5 | `5-task-chat` | task chat, phone | The composer reads "Message <first name>…" on one line, on the raised bar. The avatars are photos or initials, and "New" stays red. |
| 6 | `6-task-title` | task chat, phone bar | A long title is one line with an ellipsis in the top bar, and whole in the body. |
| 7 | `7-new-project-2`, `…-foot` | major changes, New project step 2 | "New project · Sample Client". The stepper fits one line ("3 Preview"), and the foot has Back beside Next. |
| 8 | `8-bell` | major changes, top bar | A two-digit count sits off the bell's top-right and leaves the bell readable. |
| 9 | `9-templates-archived` | major changes, change 9 rows (no Templates mock exists) | Rows follow the agreed row layout, and "Archived (1)" opens to muted rows with Restore. The segments read whole at 375 ("Deliverables"). Before: `../B/templates-owner-375-*-before.png`. |
| 10 | `10-status-chips` | major changes, change 9 card | Every status chip (To do, Due, In progress…) starts with its tone's dot. |

Found while shooting and fixed in the same round: the deliverable cards' own bars still tinted the
next stage green (gate 4 follow-up), and Templates' equal segments cut "Deliverables" at 375
(gate 9 follow-up).

Known and out of scope (in PROGRESS "Ideas / tech debt"): on Tasks at 375, a row with two long chips
("To approve", "Admin approved · needs you") pushes its › onto a line of its own.
