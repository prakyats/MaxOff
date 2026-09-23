# MaxOff: Operating Manual (for Prishit)

Everything you need to run the build, without asking anyone what to do next.
**BUILD-GUIDE.md** = setup and models. **This file** = the daily loop, what each task should deliver, and how to check it.

---

## 1. Why the terminal can't "run out of context"

Claude Code never needs to remember the project, because the project **is the files**:

| File | Holds | Who updates it |
|---|---|---|
| `CLAUDE.md` | The rules and business invariants. Auto-loaded in every session | You / an ADR |
| `docs/PRODUCT.md` | What to build | `/add-feature` |
| `docs/PERMISSIONS.md` · `WORKFLOWS.md` · `DATA-MODEL.md` · `ARCHITECTURE.md` · `decisions/` | How it works and how it's built | Claude, when something changes |
| `docs/ROADMAP.md` | ~45 tasks, each sized for one session | `/finish-task` ticks them |
| `docs/PROGRESS.md` | **The handoff file:** where you are, what's next, notes for the next session | `/finish-task`, `/save-progress` |
| Git | Every change, one commit per task, one tag per phase | `/finish-task`, `/review-phase` |

So a session only ever loads **one task's worth** of information. When you `/clear`, nothing is lost. If a session does fill up mid-task, `/save-progress` writes the half-finished state into PROGRESS.md and the next session carries on from there.

**The three habits that make this work:**
1. **One task per session.** Never two.
2. **`/clear` after every `/finish-task`.**
3. **Never** answer "just continue without the docs". If Claude seems to have forgotten something, tell it to re-read the relevant doc.

---

## 2. The loop (this is the whole job)

```
/model            → pick the tier shown on the task in ROADMAP.md ([H] Fable 5.1, [C] Opus 5, [Q] Sonnet 5)
/start-task       → it reads PROGRESS + ROADMAP and proposes a plan, then waits
                    ↳ YOU read the plan and approve, or correct it
   (it builds)
                    ↳ YOU test it using the checkpoint in §4 of this file
/finish-task      → runs all tests, checks the Definition of Done, updates docs, commits, pushes
/clear            → start the next task fresh
```

**At the end of each phase:**
```
/model            → [H]
/review-phase N   → reviews the whole phase, fixes problems, merges, tags
/clear
```
Then send me (in chat) the **phase report** from §5, and I'll tell you if anything needs attention before you move on.

### Useful mid-session commands
| Situation | Command |
|---|---|
| Context feels heavy mid-task | `/save-progress` → `/clear` → `/start-task` |
| It went down the wrong path | Tell it to stop. If files are messy: `git restore .` then `/clear` and restart the task |
| You want to check how full it is | `/context` |
| You thought of a new feature | `/add-feature <describe it>` (it plans, doesn't build) |
| Mid-task and you must stop for the day | `/save-progress`, then close. Resume any time |

### What you never have to do
- Explain the product again.
- Re-paste decisions. They're in the docs.
- Copy terminal output to me for every task. Only at **phase gates**, or when something fails twice.

---

## 3. How to test what was built (general)

From phase 0 onwards:
```bash
pnpm dev
```
Then open http://localhost:3000. Stop it with Ctrl+C.

From phase 1 onwards you'll have three logins to test with: the **Owner** (you), an **Admin** and a **Staff** member. The seed data creates test accounts. **Always check a feature as all three**, because the whole product depends on each role seeing only what it should.

If something's wrong, describe it plainly in the same session: *"As a Staff user I can see the client's GSTIN on the task page. That shouldn't be visible."* Claude fixes it before `/finish-task`.

---

## 4. Checkpoints: what each task must deliver

Tick it off yourself. If a checkpoint fails, say so in the same session before `/finish-task`.

### Phase 0: Foundation
| Task | You should be able to |
|---|---|
| 0.1 | Run `pnpm dev` and see a page at localhost:3000. `CLAUDE.md`, `docs/`, `.claude/` are untouched. `pnpm check` exists and passes |
| 0.2 | Run `pnpm db:reset` with Docker running and see Supabase start with no errors. `pnpm db:types` generates types |
| 0.3 | See an app shell: sidebar, page header, a 404 page, and light/dark both look right |
| 0.4 | Run `pnpm check` (types, lint, unit, database tests, build) and see it pass. A push to GitHub shows a green tick in the Actions tab |
| 0.5 | Open a **staging URL** in the browser and see the app. Install it as an app (PWA) from the browser menu |

**Phase 0 exit:** an empty but deployed, tested, installable app.

### Phase 1: Identity and access
| Task | You should be able to |
|---|---|
| 1.1 | See the tables in Supabase Studio (`pnpm db:studio` or the local URL). Database tests pass for all three roles |
| 1.2 | Log in as the Owner with the bootstrap script's account. A wrong password fails. Signing up is impossible |
| 1.3 | Invite an Admin and a Staff member by email, accept the invite in another browser, set a password, and see them in the member list. Deactivate someone and watch them lose access immediately |
| 1.4 | Open Settings and change the weekly off day, add a holiday, edit the reminder thresholds, and add a job title |

**Phase 1 exit:** three working logins with different views. ➜ **send me the phase report**

### Phase 2: Attendance and leave
| Task | You should be able to |
|---|---|
| 2.1 | Nothing visible yet (database + rules). Tests must pass for every path |
| 2.2 | Log in as Staff and be **forced** to pick Present / Leave / Half-day / Comp leave before seeing anything. Log out and see the time recorded. Log in again the same day and **not** be asked again |
| 2.3 | Request leave for a future date as Staff, then request a change to it |
| 2.4 | As Owner see pending attendance and leave, approve in bulk, and reject one by setting the correct status with a reason. The employee sees the correction |
| 2.5 | Confirm the 11:59 PM job works (ask Claude to run it manually): someone who never logged in becomes "Absent – pending", someone on approved leave does not, and Sunday is skipped |

**Phase 2 exit:** a full working day of attendance can be run. ➜ **phase report**

### Phase 3: Clients
| Task | You should be able to |
|---|---|
| 3.1 | Tests prove an Admin sees only their clients and Staff see none |
| 3.2 | Add a custom field in Settings (e.g. "Instagram handle") and see it appear on the client form |
| 3.3 | Upload a logo and see it displayed. The file isn't publicly reachable without a signed link |
| 3.4 | Create a real client: details, Admin, contacts, Drive link, brand colours. Check as the other Admin that it's invisible to them |

**Phase 3 exit:** your real clients can be entered. ➜ **phase report**

### Phase 4: Staff tasks
| Task | You should be able to |
|---|---|
| 4.1–4.2 | Tests prove the approval routes: Owner direct → Owner only; through an Admin → Admin then Owner; Admin as assignee → step skipped |
| 4.3 | Create a task with two assignees, a deadline and a client label, and get a warning when assigning someone who's on leave |
| 4.4 | As Staff: see the task, tap **Task Noted**, comment, mark Done. As Admin: approve or send back with a reason. As Owner: give final approval |
| 4.5 | See "My tasks" as Staff, and an Approvals inbox as Owner with bulk approve |
| 4.6 | Suggest a task as Staff, and convert it as Admin. Create a task from a template |

**Phase 4 exit:** the full task lifecycle works end to end. ➜ **phase report**

### Phase 5: Notifications and reminders
| Task | You should be able to |
|---|---|
| 5.1 | See the bell update in real time when a task is assigned to you in another browser |
| 5.2 | Get a **browser notification** on desktop, and on your iPhone after adding MaxOff to the home screen |
| 5.3 | Confirm reminders fire (ask Claude to run the job manually): before due, at due, overdue, and an unacknowledged task escalating to the Admin then the Owner |

**Phase 5 exit:** nobody can say "I didn't know". ➜ **phase report**

### Phase 6: Dashboards and ★ pilot
| Task | You should be able to |
|---|---|
| 6.1 | As Staff on your phone, see My Day and do a full day's work from it |
| 6.2 | As Owner see Today: who's in, what needs approving, what's overdue, all updating live |
| 6.3 | As Admin see your clients and the tasks needing attention |
| 6.4 | See shoots, meetings and leave on the calendar, in day, week and month views |
| 6.5 | Open the end-of-day report and see the day summarized |
| 6.6 | Log in on the **production URL**, confirm a backup file exists, and confirm a restore was tested |

**Phase 6 exit ★ PILOT:** the team starts using MaxOff daily. ➜ **phase report + tell me how the first week goes**

### Phase 7: Client work
| Task | You should be able to |
|---|---|
| 7.1–7.2 | Tests prove cycles generate once, carry-forward works, and Staff can't see any of it |
| 7.3 | Create "Monthly Production" for a client with 12 reels and 4 posts, name the items, tick stages, and mark items done |
| 7.4 | As Owner approve items in bulk, and decide carry-forward at month end. Create a project from a template |

**Phase 7 exit:** a real client month runs in MaxOff. ➜ **phase report**

### Phase 8: Submissions and the Drive archive
| Task | You should be able to |
|---|---|
| 8.1 | Upload photos from an iPhone and a laptop and see them display (HEIC included). A 2 GB file is refused with a clear message |
| 8.2 | Review a photo, request changes, and see v1 and v2 side by side |
| 8.3 | Connect your Google account in Settings, and see files appear in `MaxOff Archive/Clients/...` with the right names |
| 8.4 | Paste a **private** Drive link and see it flagged, get the notification, fix sharing, and watch it archive by itself |

**Phase 8 exit:** nothing submitted can ever be lost. ➜ **phase report**

### Phase 9: Revenue and reports (Owner only)
| Task | You should be able to |
|---|---|
| 9.1 | Tests prove an Admin can't see money through any route |
| 9.2 | Set ₹60,000 for a month, see it split across 16 items, and watch Achieved rise only as you approve items. Override a figure and see both values |
| 9.3 | Open reports for a week, a month and a custom range, with per-employee raw metrics |
| 9.4 | Close a month and see the snapshot freeze even after later edits |
| 9.5 | Export Markdown and paste it into Claude to ask "who is overloaded?" |
| 9.6 | Search the activity log by person, client and date |

**Phase 9 exit:** you can run the business from the numbers. ➜ **phase report**

### Phase 10: Polish and launch
| Task | You should be able to |
|---|---|
| 10.1 | Press Ctrl+K and jump to any client, task or person |
| 10.2 | Use the whole app on a phone without anything looking broken |
| 10.3 | Read the security review and see every issue fixed or logged |
| 10.4 | See every list load quickly with real data |
| 10.5 | Confirm the team is onboarded, data imported, user guide written, restore tested again |

**Phase 10 exit:** MaxOff is fully live. ➜ **final report**

---

## 5. What to send me at each phase gate

Copy this template into our chat, and paste in what Claude gave you:

```text
Phase <N> done.

/review-phase output (must fix / should fix / later):
<paste>

Checkpoints from OPERATING-MANUAL §4: <which passed, which didn't>

What felt wrong when I used it:
<your own words, e.g. "the Staff screen has too many buttons">

Anything Claude asked me that I wasn't sure about:
<paste>
```

I'll check it against the plan, flag anything that's drifted, and confirm you're clear to start the next phase.

**Send it sooner than the gate if:** a checkpoint fails twice, Claude asks you a business question you don't know the answer to, or something about the product feels wrong when you use it. Otherwise, just keep going. You don't need me task by task.

---

## 6. If something goes wrong

| Symptom | Do this |
|---|---|
| "Context left: low" or replies get vague | `/save-progress` → `/clear` → `/start-task` |
| It's editing files it shouldn't | Stop it. `git restore .` (or `git checkout -- .`), `/clear`, then `/start-task` with a clearer instruction |
| Tests fail repeatedly | Let it try twice. Then `/clear`, switch to `[H]` with `/model`, and `/start-task` again |
| It asks a business question you can't answer | Tell it to record the question in PROGRESS.md and use the safest option for now, then ask me |
| It wants to change a rule in CLAUDE.md or an ADR | Say no and ask it to explain why. Then check with me. Those are the product's foundations |
| A commit went wrong | `git log --oneline` to find the last good commit, and ask Claude to revert to it. Nothing is ever lost, it's all on GitHub |
| You're unsure whether a task is really done | Check §4 here. If the checkpoint doesn't pass, it isn't done |

---

## 7. Rhythm

- **1 to 2 tasks a day** is a good pace. Tasks run 1–3 hours.
- Phases 0–2 feel invisible (setup, database, rules). **That's expected**, and it's what makes the rest fast and safe.
- The first real payoff is **phase 6**, when the team starts using it. That's about 25 tasks in.
- Don't skip `/review-phase`. It's the only step that looks at a whole phase at once.
