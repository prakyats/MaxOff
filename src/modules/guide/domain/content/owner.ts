import { ROLE_LABELS } from "@/core/lib/role-labels";

import type { Guide, GuideBlock, GuideStep } from "../types";
import { COMMON_HELP_TOPICS, missingButtonTopic } from "./common";

const CREW = ROLE_LABELS.staff;

const text = (t: string): GuideBlock => ({ kind: "text", text: t });
const steps = (...s: GuideStep[]): GuideBlock => ({ kind: "steps", steps: s });
const next = (t: string): GuideBlock => ({ kind: "next", text: t });
const example = (t: string): GuideBlock => ({ kind: "example", text: t });
const note = (t: string): GuideBlock => ({ kind: "note", text: t });

/** The guide for the Owner. Describes only what is built today. */
export const OWNER_GUIDE: Guide = {
  role: "owner",
  sections: [
    {
      id: "getting-around",
      title: "Getting around",
      topics: [
        {
          id: "owner-sidebar",
          title: "Find your way on a laptop",
          summary: "The sidebar lists every screen, in the same order each time.",
          blocks: [
            text(
              "On a laptop the sidebar runs down the left. From the top: Today, Approvals, Clients, Tasks, Calendar, People, Reports and Settings. Today is your home.",
            ),
            text(
              "Small counts sit on Approvals, Tasks and Alerts. They show how many items wait for you.",
            ),
          ],
          link: { href: "/today", label: "Open Today" },
          keywords: ["menu", "navigation", "sidebar", "home"],
        },
        {
          id: "owner-phone-bar",
          title: "Find your way on a phone",
          summary: "The bottom bar has four screens and a More cell.",
          blocks: [
            text(
              "The bottom bar holds Today, Approvals, Tasks and Calendar. With very large text set on the phone, the bar shows its icons only; each still says its name to a screen reader.",
            ),
            steps(
              "Tap a cell in the bottom bar to switch screen.",
              "Tap More for Reports, Clients, People and Settings.",
              "Tap Me in the same sheet for your own page, or Help under it for this guide.",
            ),
            next(
              "The last cell, More, opens a sheet with Reports, Clients, People, Settings, then Me and Help.",
            ),
            note(
              "The count on More adds up everything behind it, so a number there can mean a waiting item on one of those screens.",
            ),
            text(
              "On a phone each screen has one bar at the top: the back arrow (or, on a main tab, the small MaxOff “M”, which takes you to your home screen), the title, the screen's ⋯ menu when it has one, and the bell. A ⋯ menu opens as a sheet from the bottom; back closes it.",
            ),
            text(
              "On a laptop, Help (this guide) is in the account menu under your name, beside Me, and at the foot of the sidebar.",
            ),
          ],
          keywords: ["more", "bottom bar", "menu", "phone", "navigation", "title bar", "sheet"],
        },
        {
          id: "owner-bell",
          title: "Read your alerts",
          summary: "The bell opens Alerts, with the unread count on it.",
          blocks: [
            text(
              "On a phone the bell sits in the title bar of each screen. On a laptop it is in the top bar. Both open Alerts and show how many you have not read.",
            ),
            text(
              "Alerts is one list grouped by day: Today, Yesterday, Earlier this week, then Older. “Show older” at the end adds the next ones. Each row starts with the photo (or initials) of the person who caused it, or a bell when MaxOff sent it itself. An unread alert has a red dot, a bold title and a slightly lighter row; times read like 6:00 pm.",
            ),
          ],
          link: { href: "/notifications", label: "Open Alerts" },
          keywords: ["bell", "notifications", "unread"],
        },
        {
          id: "owner-me",
          title: "Use Me",
          summary: "Your own page: profile, notifications, appearance and help.",
          blocks: [
            text(
              "Me opens with who you are: your photo, name and sign-in email, with Edit profile beside them. Then come Notifications (turn them on for this device, Your devices, and Send a test notification), Appearance (Light, Dark or System) and Help (this guide and Reload app). Sign out of this device is last, and the app's version sits at the very bottom. On a phone, open Me from More.",
            ),
            text("You do not mark attendance or take leave, so Me has no My work rows for you."),
          ],
          link: { href: "/me", label: "Open Me" },
          keywords: ["profile", "account", "settings"],
        },
      ],
    },
    {
      id: "today",
      title: "Today",
      topics: [
        {
          id: "owner-today",
          title: "Read your Today screen",
          summary: "Needs you, attendance, your tasks, risks and the week ahead.",
          blocks: [
            text(
              "Today answers one question: who is in, and what needs you. Today's date is under the title. The sections come in this order; a section with nothing in it is not shown.",
            ),
            steps(
              {
                text: 'Open Today and read "Needs you" (highlighted): the oldest 5 waiting rows, in this order: attendance days, leave requests, extra-work notes, expense claims, tasks. A person with several days waiting is one row, such as "Asha · 5 days proposed absent · Review", which opens Approvals. The count beside "Needs you" is the number of rows. "See all N" opens Approvals.',
                shot: "owner/today",
              },
              {
                text: 'Read "Attendance" (highlighted): four counts, Not started, Waiting, Present and On leave. Red lines appear only when something is wrong, such as someone absent.',
                shot: "owner/attendance-board",
              },
              'Read "My tasks": your own tasks, overdue or due today. Tap one to open it (each row ends in a ›). When there are more than it shows, "See all N of my tasks" opens them all in All tasks.',
              'Read "Today\'s tasks": one line, "N due today · M handed in".',
              'Read "Client work": one red line when client items are overdue.',
              'Read "Overdue and risks": overdue tasks, tasks nobody has noted, people on leave, and people who cannot be reached. The reason is a chip on the right, such as "2 days late" in red or "Not noted · 18 h" in amber, with the plain words under the task.',
              'Read "This week": up to seven days, each deadline by name and time with a "Due" chip, holidays, events and who is on leave, then "See the week". On a wide laptop screen it is a column on the right.',
            ),
            note(
              'With nothing waiting, "Needs you" is one quiet line: "Nothing needs you right now." If everything below it is empty too, the screen says "Nothing else needs you today."',
            ),
          ],
          link: { href: "/today", label: "Open Today" },
          keywords: ["home", "dashboard", "needs you", "overdue", "risks"],
        },
        {
          id: "owner-today-needs-you",
          title: "Decide from the Needs you list",
          summary: "Approve in one tap, or tap the row to review first.",
          blocks: [
            text(
              "Each row shows what it is (Attendance, Leave, Extra work, Expense or Task), who it is about, and how long it has waited.",
            ),
            steps(
              { text: 'Open Today and find "Needs you" (highlighted).', shot: "owner/today" },
              "Tap Approve to decide at once.",
              "Extra work shows Review instead, because you choose how much comp leave to grant.",
              "Tap anywhere else on the row to open the full review.",
            ),
            next("After Approve, a 6-second Undo appears."),
            note("A row turns amber after a day of waiting and red after three."),
          ],
          link: { href: "/approvals", label: "Open Approvals" },
          keywords: ["approve", "undo", "waiting"],
        },
        {
          id: "owner-everyone-today",
          title: "See everyone today",
          summary: "Everyone expected today, grouped by where they stand.",
          blocks: [
            text("The list shows everyone expected today."),
            steps(
              'Open Today and tap the "Attendance" heading.',
              {
                text: "Tap a filter (highlighted): Everyone, Waiting, Not started, Present, On leave, Absent or End not recorded.",
                shot: "owner/everyone-today",
              },
              "Tap a person to open their page.",
            ),
            next("The person's page opens."),
            note('"End not recorded" is about yesterday: people who never ended their day.'),
          ],
          link: { href: "/today/people", label: "Open Everyone today" },
          keywords: ["present", "absent", "who is in", "attendance board"],
        },
      ],
    },
    {
      id: "attendance-leave",
      title: "Attendance, leave and expenses",
      topics: [
        {
          id: "owner-decide-attendance",
          title: "Decide an attendance day",
          summary: "Only you decide attendance. Approve it, or correct it.",
          blocks: [
            text(
              `Attendance days sit under "Attendance" on Approvals. With two or more waiting, "Approve all" is the green button. A single day's Approve is green only when nothing else waits on Approvals; beside other groups it is plain, so there is never more than one green button.`,
            ),
            steps(
              "Open Approvals.",
              {
                text: "Tap Approve (highlighted) on a day, or Review to see it first.",
                shot: "owner/approvals",
              },
              'The review shows the person\'s week (this day marked), their comp leave and any note, ready as it opens. Tap Approve there, or "Correct…" if the day was something else.',
            ),
            next(
              "Original records are never overwritten: a correction is kept beside the original.",
            ),
            note("You do not mark your own attendance. The Owner has no Start day or End day."),
          ],
          link: { href: "/approvals", label: "Open Approvals" },
          keywords: ["attendance", "present", "correct", "approve day"],
        },
        {
          id: "owner-decide-leave",
          title: "Decide a leave request",
          summary: "Approve it, or reject it with a reason.",
          blocks: [
            text('Leave requests sit under "Leave" on Approvals. Only you decide them.'),
            steps("Open Approvals and find the request under Leave.", "Tap Approve to accept it.", {
              text: 'To refuse, tap Review, then "Reject…" (highlighted).',
              shot: "owner/leave-review",
            }),
            next(
              "Approve gives a 6-second Undo. The review also links to the person's leave page.",
            ),
            note("A reason is required to reject a request."),
          ],
          link: { href: "/approvals", label: "Open Approvals" },
          keywords: ["leave", "reject", "holiday", "time off"],
        },
        {
          id: "owner-extra-work",
          title: "Turn extra work into comp leave",
          summary: "Review the note, then grant a day, half a day, or none.",
          blocks: [
            text(
              'When someone works on a day off they leave an extra-work note. It appears under "Extra work" on Approvals.',
            ),
            steps(
              "Open Approvals and tap Review on the note.",
              'Choose "Grant 1 day of comp leave", "Grant ½ day of comp leave" or "No comp leave".',
              'Tap "Grant comp leave", or "Mark reviewed" if you chose none.',
            ),
            next(
              'Granting adds comp leave for the person. "Mark reviewed" closes the note with none.',
            ),
            note("The note has no Approve button, because you choose what it earns."),
          ],
          link: { href: "/approvals", label: "Open Approvals" },
          keywords: ["extra work", "comp leave", "overtime", "day off"],
        },
        {
          id: "owner-expenses",
          title: "Decide an expense claim",
          summary: "Approve a claim, or reject it with a reason.",
          blocks: [
            text(
              'Expense claims sit under "Expenses" on Approvals. Categories, and when a claim needs a receipt photo, are set in Settings under "Expenses".',
            ),
            steps(
              "Open Approvals and find the claim under Expenses.",
              "Tap Approve, or Review to look first.",
              'To refuse, tap Review, then "Reject…". A reason is required.',
            ),
            next("Approve gives a 6-second Undo."),
            note(
              "You see all claims. Each is visible to you and to the person who made it, and to nobody else.",
            ),
          ],
          link: { href: "/settings/expenses", label: "Expense settings" },
          keywords: ["expense", "claim", "receipt", "reimburse"],
        },
        {
          id: "owner-person-leave",
          title: "Manage a person's leave",
          summary: "Grant or revoke comp leave, edit or cancel approved leave.",
          blocks: [
            steps(
              "Open People, tap the person, then the Leave tab.",
              {
                text: 'To give comp leave, tap "Grant comp leave" (highlighted) and choose "How much".',
                shot: "owner/person-leave",
              },
              'To take it back, tap "Revoke".',
              'On approved leave, tap "Edit" to change it ("Edit this leave").',
              'Tap "Cancel leave" to cancel it.',
            ),
            next("A change adds a history entry beside the original. Nothing is deleted."),
            note("Revoke needs a reason."),
          ],
          link: { href: "/people", label: "Open People" },
          keywords: ["comp leave", "grant", "revoke", "cancel leave", "edit leave"],
        },
        {
          id: "owner-person-attendance",
          title: "Correct a person's attendance",
          summary: "Fix a recorded day, or approve a waiting one, from the Attendance tab.",
          blocks: [
            steps(
              "Open People, tap the person, then the Attendance tab. It lists the month's days.",
              "Tap the day that is wrong. Its day opens, with what happened and when.",
              'Tap "Correct this day…".',
              "Enter the right details and save.",
            ),
            next("The original stays in the history. A correction sits alongside it."),
            text(
              'A day still waiting for you has a green "Approve" on its row, and "Approve as present" (or absent) in its day beside "Correct this day…": the same approval as on Approvals. A time that was never recorded reads "Not recorded".',
            ),
            note("Only you can correct a recorded day."),
          ],
          link: { href: "/people", label: "Open People" },
          keywords: ["correct", "fix", "attendance", "wrong time"],
        },
      ],
    },
    {
      id: "tasks",
      title: "Tasks",
      topics: [
        {
          id: "owner-tasks-screen",
          title: "Read the Tasks screen",
          summary: "What needs you first, then every open task by deadline.",
          blocks: [
            text(
              'Tasks opens on "Needs you": tasks waiting for your approval, suggested tasks to decide, and tasks that are overdue, have changes requested, or have not been noted (your own note to give is the amber "Note it" chip). Below it, "Open tasks" are listed by deadline. A section with nothing in it is not shown. Each row is one line with who and when under it, new comments as a small bubble beside the title, and chips on the right: the reason, then the state.',
            ),
            text(
              'Use "All tasks, with filters" for the full list, and "Suggested tasks" for ideas from your team.',
            ),
          ],
          link: { href: "/tasks", label: "Open Tasks" },
          keywords: ["task list", "open tasks"],
        },
        {
          id: "owner-new-task",
          title: "Create a task",
          summary: "Fill in who, what and when, then Create task.",
          blocks: [
            steps(
              'Tap "New task" (the round button on a phone).',
              'Fill in "Title". In "Assign to", tap "Add a person" for each and pick one as the primary owner. You can assign yourself too.',
              '"Deadline" and "Time (IST)" are required. That is enough: tap "Create task".',
              'For the rest, tap "More options": "Start from" (if task templates exist), "Type" (the first one by default; an event type asks for the event date and opens this by itself), "Priority" (Medium by default), "Reminders" (the default unless you change them).',
              {
                text: 'Also under More options: "Client label" or "No client", "Checked first by" (highlighted): "Nobody: you approve it" or an Admin, a "Description", optional "Stages" and any custom fields.',
                shot: "owner/new-task",
              },
            ),
            next('Each person you assigned taps "Task Noted" to say they have seen it.'),
            note(
              "Workload and leave warnings appear beside each person. Saving records that you saw them. A client label is only a label: it does not link the task to client work.",
            ),
          ],
          link: { href: "/tasks", label: "Open Tasks" },
          keywords: ["new task", "assign", "deadline", "priority", "client label"],
        },
        {
          id: "owner-primary-owner",
          title: "Choose the primary owner",
          summary: "Everyone on a task notes it. One person marks it done.",
          blocks: [
            text(
              `For a freelancer, the coordinator notes the task and marks it done on their behalf.`,
            ),
            steps(
              'In the task form, tap "Add a person" under "Assign to" for each person.',
              "Tap the radio button beside a name to make that person the primary owner.",
            ),
            next(
              `Every person on the task taps "Task Noted" to say they have seen it. Only the primary owner can mark it done.`,
            ),
            note(
              `A ${CREW} member who is the primary owner still cannot change the task's stages.`,
            ),
          ],
          keywords: ["primary owner", "task noted", "acknowledge", "freelancer", "coordinator"],
        },
        {
          id: "owner-checked-first",
          title: "Pick who checks a task first",
          summary: "Choose an Admin to check it before it reaches you.",
          blocks: [
            steps(
              {
                text: 'In the task form, tap "Checked first by" (highlighted).',
                shot: "owner/new-task",
              },
              'Choose an Admin, or "Nobody: you approve it".',
              'To change it later, open the task\'s ⋯ menu and tap "Change approver", while the task is unfinished.',
            ),
            next(
              "With an Admin, the route is: Done, then the Admin checks, then you approve. Without one, it comes straight to you.",
            ),
            note("The Admin's check is skipped if that Admin is one of the people on the task."),
          ],
          keywords: ["approver", "admin check", "route", "change approver"],
        },
        {
          id: "owner-task-stages",
          title: "Add and order a task's stages",
          summary: "Stages are a checklist inside a task.",
          blocks: [
            text(
              `Assignees tick stages as they work. Adding, removing and reordering stages is for you, the person who created the task, and its approving Admin. ${CREW} members never do this, even as primary owner.`,
            ),
            steps(
              'In the task form, tap "Add stage" under "Stages (optional)".',
              "Drag a stage to reorder it, or use Move up and Move down.",
              'Tap "Remove stage" to take one out.',
            ),
            next(
              "Stages can be set when you create the task, and managed later on the task page by those who may.",
            ),
            note(
              'Ticks lock once the task is done. On the task page, a task with no stages says "No stages yet." with "Add stage" beside it.',
            ),
          ],
          keywords: ["stages", "checklist", "reorder", "tick"],
        },
        {
          id: "owner-task-flow",
          title: "Follow a task from start to finish",
          summary: "Noted, worked on, marked done, checked, approved.",
          blocks: [
            text(
              "The task page shows one next-step button at a time: at the top beside the History clock on a laptop, in a bar at the bottom on a phone. Its state is a chip, the due time has its own line (red when late), and a box says what is needed now.",
            ),
            steps(
              'Each assignee taps "Task Noted" once.',
              '"Start work" is optional.',
              'Only the primary owner taps "Mark done". They may add a note, and say why if it is late.',
              "Then the approving Admin checks it, if there is one.",
              "Then you approve it.",
            ),
            next("Approval is always yours. It is the final step."),
            note(
              'If changes were requested, the primary owner sees "Mark done again". The task is locked while it waits for review; comments stay open.',
            ),
          ],
          keywords: ["done", "complete", "workflow", "status"],
        },
        {
          id: "owner-approve-task",
          title: "Approve a task or ask for changes",
          summary: "At review, either Approve, or Request changes.",
          blocks: [
            text('When a task waits for you, the task page shows "Request changes" and "Approve".'),
            steps(
              "Open the task.",
              {
                text: 'Tap "Approve" (highlighted), then "Approve task". This is the final approval.',
                shot: "owner/task-approve",
              },
              'Or tap "Request changes" and write "What needs to change?".',
            ),
            next(
              "After Approve the task is complete. After Request changes it goes back to the primary owner.",
            ),
            note(
              "On the task page there is no Undo. The 6-second Undo is only on Approvals and Today.",
            ),
          ],
          link: { href: "/approvals", label: "Open Approvals" },
          keywords: ["approve", "request changes", "review", "send back"],
        },
        {
          id: "owner-own-task",
          title: "Finish a task you own",
          summary: "When you are the primary owner, Done completes it.",
          blocks: [
            steps("Open the task.", 'Tap "Mark done" and confirm in the sheet.'),
            next("The task is complete straight away. Nobody checks or approves it."),
            note("The sheet reminds you of this before you confirm."),
          ],
          keywords: ["my tasks", "done", "primary owner"],
        },
        {
          id: "owner-remind",
          title: "Remind people on a task",
          summary: "Nudge everyone on a task, once an hour.",
          blocks: [
            text(
              'The button names whom it reaches, such as "Remind Sam and Ria" or "Remind Sam and 2 others". When the names are not known it reads "Remind everyone on the task".',
            ),
            steps("Open the task page while the task is still with its people.", {
              text: "Tap Remind ‹names› (highlighted).",
              shot: "owner/remind",
            }),
            next(
              'Each of them gets a push and a note in the app, and the toast says "Reminder sent to ‹names›". The reminder is a notification, not a chat message: the task\'s History (the clock in its header) reads "sent ‹names› a reminder", and Chat stays as it was.',
            ),
            note(
              'You can send one once an hour per task. While you wait, the button reads like "Reminded · again at 4:05 pm"; it is ready again when that time passes.',
            ),
          ],
          keywords: ["remind", "nudge", "chase"],
        },
        {
          id: "owner-task-menu",
          title: "Use a task's ⋯ menu",
          summary: "Decide it yourself, edit, reopen, cancel, change approver.",
          blocks: [
            text('The "Task actions" menu on the task page holds the less common actions.'),
            steps(
              "Open the task page and tap the ⋯ menu.",
              {
                text: 'Tap "Decide it yourself" (highlighted) while an Admin check is still waiting.',
                shot: "owner/task-menu",
              },
              'Tap "Edit task" to change the task.',
              'Tap "Reopen task" to reopen a finished task.',
              'Tap "Cancel task" to cancel it. It needs a reason.',
              'Tap "Change approver" to choose another Admin.',
            ),
            next('"Decide it yourself" removes the Admin and brings the task to you.'),
            note(
              '"Reopen task" is for finished tasks only. "Change approver" is for unfinished tasks.',
            ),
            note(
              'A reopened task goes back to its people. Its old hand-in folds away under "Earlier hand-in · reopened ‹date›: ‹reason›" in Work.',
            ),
          ],
          keywords: ["edit", "cancel", "reopen", "change approver", "menu"],
        },
        {
          id: "owner-all-tasks",
          title: "Filter all tasks",
          summary: "Find any task by state, deadline, client, type or person.",
          blocks: [
            steps(
              "Open All tasks.",
              'Tap "State" and "Deadline" to filter.',
              'Tap "Client", "Type" and "Person" to narrow further.',
              'Tap "Engagement" for Employees or Freelancers, or type in the "Search by title" box.',
            ),
            next("The list shows every open task and the latest 300 finished ones."),
            note('"Deadline" offers Overdue or Due today.'),
          ],
          link: { href: "/tasks/all", label: "Open All tasks" },
          keywords: ["search", "filter", "find task", "overdue"],
        },
        {
          id: "owner-suggested-tasks",
          title: "Decide a suggested task",
          summary: "Turn a suggestion into a task, or decline it.",
          blocks: [
            text("Admins can suggest tasks. They appear on Suggested tasks under Waiting."),
            steps(
              "Open Suggested tasks.",
              'To accept, tap "Make it a task". The form opens filled in.',
              'To refuse, tap "Decline suggestion" and give a reason under "Why not".',
            ),
            next("Decided suggestions move to Decided."),
            note('Declining needs a reason under "Why not".'),
          ],
          link: { href: "/tasks/requests", label: "Open Suggested tasks" },
          keywords: ["request", "suggest", "decline"],
        },
      ],
    },
    {
      id: "approvals",
      title: "Approvals",
      topics: [
        {
          id: "owner-approvals-screen",
          title: "Read the Approvals screen",
          summary: "One grouped list of everything waiting for you.",
          blocks: [
            text(
              `There are no tabs. Everything waiting for your decision is on one screen, oldest first, in groups: Attendance, Leave, Extra work, Expenses and ${CREW} tasks. When nothing waits, it says "Nothing waiting. You're clear."`,
            ),
            note("Client deliverables are not decided here. Mark them done on the project itself."),
          ],
          link: { href: "/approvals", label: "Open Approvals" },
          keywords: ["queue", "waiting", "decisions"],
        },
        {
          id: "owner-review-approve",
          title: "Review or approve a row",
          summary: "Approve in one tap, with a 6-second Undo.",
          blocks: [
            text(
              'Each row has Review and Approve (quiet outlines; the group\'s one green button is "Approve all N", or the row\'s own Approve when it is the only one waiting). Colours mean one thing everywhere: green approves or marks done, red ends or cancels something for good, and the plain solid button saves or creates. Under the name it says what is waiting, the person\'s note for an attendance day, and how long it has waited ("Waiting 2 days": an amber dot from a day, red from three), as on Today. The state is a chip on the right.',
            ),
            steps(
              "Open Approvals.",
              {
                text: "Tap Approve (highlighted) to decide at once.",
                shot: "owner/approvals",
              },
              "Tap Review to see the details first. The sheet offers the extra actions for that kind of item.",
            ),
            next("A toast appears with Undo. You have 6 seconds to take it back."),
            note(
              'Review offers Approve and "Correct…" for attendance (with the person\'s week and comp leave), "Reject…" for leave and expenses, and "Open the task" and "Request changes…" for tasks.',
            ),
          ],
          keywords: ["approve", "undo", "review", "reject"],
        },
        {
          id: "owner-approve-all",
          title: "Approve a whole group",
          summary: "Approve all N at once. There is no undo.",
          blocks: [
            steps(
              "Open Approvals and find a group with more than one row.",
              {
                text: 'Tap the green "Approve all N".',
                shot: "owner/approve-all",
              },
              "Confirm when asked.",
            ),
            next('The confirmation says: "There is no undo for approving all at once."'),
            note(
              "Use it only when you have looked at the group. For anything you are unsure of, approve rows one at a time so you keep the Undo.",
            ),
          ],
          keywords: ["bulk", "approve all", "undo"],
        },
      ],
    },
    {
      id: "calendar",
      title: "Calendar",
      topics: [
        {
          id: "owner-calendar-views",
          title: "Use the calendar",
          summary: "Month, week and day views, with filters.",
          blocks: [
            text(
              "On a laptop the views are Day, Week and Month, opening on Month. ‹ and › on either side of the month’s name move back and forward, and Today just after them brings you back to today; Filters is at the right. Today is dimmed while the day, week or month on screen already holds today. Use the arrow keys to move, T for today, and D, W or M to switch view. On a phone there is no switch: swipe up or down, or use the handle, to change between a week strip, a compact month and a full month.",
            ),
            text(
              "Today’s date is a red circle on a slightly lighter box, and only the day you tap is outlined. Each day shows its events by name, then time; what is due by name, amber (red with an alert when overdue); and leave as a soft grey striped bar, “Asha · On leave”. Done things are dimmed with a ✓. Weekly days off are grey and lightly shaded. A day with more than fits ends in “+N more”; tap it to open the day and see everything.",
            ),
            text(
              "Tasks and client work look different. A task is a filled chip with a dot in its type’s colour. Client work is an outlined chip with a box icon and the client’s name first, “Shetty · Reel 1”, outlined in red when it is late. Each day lists timed tasks first, then what is due, then client work. A long name ends in “…”; open the day to read it in full. The timelines show hours as “10 am” and “1 pm”.",
            ),
            text(
              "Beside Filters, All · Tasks · Client work shows both kinds or only one. This phone or laptop remembers your choice, and leave and holidays always show.",
            ),
            steps("Open Calendar.", {
              text: 'Tap "Filters" (highlighted) to narrow by Client, Person, Type or Status.',
              shot: "owner/calendar",
            }),
            note("You see everything on the calendar, until you filter it."),
          ],
          link: { href: "/calendar", label: "Open Calendar" },
          keywords: ["month", "week", "day", "filters"],
        },
        {
          id: "owner-calendar-day",
          title: "Open a day and add a task to it",
          summary: "See who is away and what is due, then add a task.",
          blocks: [
            text(
              'The day sheet is in two parts: "Tasks · n" (events and what is due), then "Client work · n", grouped by client, every name in full; tap a row to open it. Then who is away: a chip for each person on leave, with their photo ("Asha · On leave"), and "Busy all day" when someone is. When nobody is away, it says "Everyone is available". On a phone the day sits under the calendar and the page scrolls; its timeline shows the hours around the day’s events. On a laptop it opens in the middle of the screen, with "Open day" and "+ New task on" the date at the bottom.',
            ),
            steps(
              "Open Calendar and tap a day.",
              'Tap "+ New task on" the date at the bottom.',
              "Fill in the New task form, which opens on that date.",
            ),
            next(
              'After you create it, the task page opens. Tap "Calendar" to go back to the same view and day.',
            ),
            text(
              "On a laptop with a mouse or trackpad, point at an empty part of a day in the month: a small + appears in its corner. Click it (or Tab to it and press Enter) for the same New task form on that day.",
            ),
            note("The New task form opens on the day you tapped."),
          ],
          link: { href: "/calendar", label: "Open Calendar" },
          keywords: ["day sheet", "free", "new task", "event"],
        },
      ],
    },
    {
      id: "people-reports",
      title: "People and reports",
      topics: [
        {
          id: "owner-people",
          title: "Add and manage people",
          summary: "Invite employees and freelancers, set roles and titles.",
          blocks: [
            text(
              "You fill in Email, Full name, Role, Coordinator, Job title and an optional phone.",
            ),
            steps(
              "Open People.",
              { text: 'Tap "Add person" (highlighted).', shot: "owner/people" },
              'Choose "Who are you adding?": Employee or Freelancer.',
              'Fill in the details, then tap "Send invite" or "Add".',
            ),
            next("The person is added to the People list."),
            note("Job titles are only labels. A person's role decides what they can do."),
          ],
          link: { href: "/people", label: "Open People" },
          keywords: ["invite", "add person", "employee", "freelancer", "role"],
        },
        {
          id: "owner-person-page",
          title: "Use a person's page",
          summary: "A summary, then Profile, Leave, Attendance and Month tabs.",
          blocks: [
            text(
              'Open a person to see their status beside their name, a "today" line and four tabs: Profile, Leave, Attendance and Month. The header\'s clock opens their History (invited, joined, role and job title changes, deactivated). The ⋯ menu has Edit, Change sign-in email, Change coordinator, Invite as employee, Copy invite link, Reactivate, and Deactivate or Revoke invite.',
            ),
            text(
              "Profile opens with a summary: the days waiting for your review (with Review), their leave this month and the comp leave they have left; each opens its tab. Under it one card holds their phone, sign-in email and joining date, then Profile (name, role, job title).",
            ),
            text(
              "In Attendance, a day waiting for you has Approve and Correct… on its row; open it to see the same as in Approvals (their week and comp leave) and approve it there with the green Approve.",
            ),
            note("Deactivating a person keeps all their history. Nothing is deleted."),
          ],
          link: { href: "/people", label: "Open People" },
          keywords: ["deactivate", "profile", "invite link", "coordinator"],
        },
        {
          id: "owner-report-month",
          title: "Read the Month report",
          summary: "Each person's month in IST, live.",
          blocks: [
            text(
              'Reports opens with this month so far: Days worked (team, with leave and absence), Days waiting for you, Overtime notes and Expenses to pay, each tappable. One with nothing in it folds into one quiet line ("So far: no overtime notes and no expenses to pay."). Under it are two rows. Month shows each person\'s IST month, live.',
            ),
            steps("Open Reports.", {
              text: 'Tap "Month" (highlighted).',
              shot: "owner/reports",
            }),
            note("The Month report does not show salary."),
          ],
          link: { href: "/reports/month", label: "Open Month" },
          keywords: ["month report", "attendance month"],
        },
        {
          id: "owner-report-eod",
          title: "Read the End of day report",
          summary: "Today and yesterday are live; older days are saved.",
          blocks: [
            text("End of day shows how each day closed."),
            steps("Open Reports.", "Tap End of day."),
            note("Today and yesterday are live. Earlier days are saved the morning after."),
          ],
          link: { href: "/reports/end-of-day", label: "Open End of day" },
          keywords: ["end of day", "daily report"],
        },
      ],
    },
    {
      id: "clients",
      title: "Clients",
      topics: [
        {
          id: "owner-clients-list",
          title: "Find a client",
          summary: "Filter by state or Admin, or search by name.",
          blocks: [
            text(
              'The list shows each client with its state, its Admin, what is running now ("3 open · 9/12 done") and when work is due: a red "2 late" chip when deliverables are past their planned date, otherwise "Due Thu 22 Oct". It opens on Active.',
            ),
            steps(
              "Open Clients.",
              'Tap "State" and "Admin" to filter, or type in "Search clients".',
              'Tap "Client deliverables" at the top to see every client\'s open deliverables in one list.',
              {
                text: 'Tap a row\'s ⋯ menu (highlighted) for "Assign Admin" or "Change Admin".',
                shot: "owner/clients",
              },
            ),
            next("Tap a client to open its page."),
            note(
              "The list opens on Active, so Draft, Paused and Inactive clients need the State filter.",
            ),
          ],
          link: { href: "/clients", label: "Open Clients" },
          keywords: ["search", "filter", "client list"],
        },
        {
          id: "owner-new-client",
          title: "Add a new client",
          summary: "A new client starts as Draft until it has an Admin.",
          blocks: [
            steps(
              'Open Clients, tap "New client" and type the "Client name". Only the name is required.',
              "Optionally pick an Admin and fill in the company's client fields.",
              "Save, then add contacts and details on the client's page.",
              "Assign an Admin, then tap Activate.",
            ),
            next(
              "The client starts as Draft. After you assign an Admin and activate it, it can start work.",
            ),
            note(
              'A Draft client cannot start work. Assign an Admin first, then activate. A draft made by mistake can be deleted from its ⋯ ("Delete") while nothing else uses it (no contact, project, task, file or note); editing its details does not count.',
            ),
          ],
          link: { href: "/clients", label: "Open Clients" },
          keywords: ["draft", "add client", "onboard"],
        },
        {
          id: "owner-assign-admin",
          title: "Assign an Admin to a client",
          summary: "The Admin runs the client and sees only their own clients.",
          blocks: [
            steps(
              {
                text: "Open the client's ⋯ menu (highlighted), on the list or on the client page.",
                shot: "owner/clients",
              },
              'Tap "Assign Admin", or "Change Admin" if one is set.',
              "Choose the Admin and save.",
            ),
            next("That Admin sees the client and its work."),
            note("Each client belongs to one Admin. Other Admins cannot open it."),
          ],
          keywords: ["admin", "assign", "change admin", "owner of client"],
        },
        {
          id: "owner-client-states",
          title: "Move a client between states",
          summary: "Activate, Pause, Close and Reactivate, and what each means.",
          blocks: [
            text("A client is Draft, Active, Paused or Inactive."),
            steps(
              { text: "Open the client's ⋯ menu (highlighted).", shot: "owner/client-states" },
              'Draft to Active: tap "Activate". It is offered only once an Admin is assigned.',
              'Active to Paused: tap "Pause". Active to Inactive: tap "Close".',
              'Paused to Active: tap "Activate". Paused to Inactive: tap "Close".',
              'Inactive to Active: tap "Reactivate".',
            ),
            next(
              "Paused: everything stays editable, but recurring projects make no new cycles. Inactive: still searchable and editable, but no new projects, deliverables or client-labelled tasks until you reactivate.",
            ),
            note("Only the Owner can change a state."),
          ],
          keywords: ["activate", "pause", "close", "reactivate", "inactive", "draft"],
        },
        {
          id: "owner-contacts",
          title: "Add and archive contacts",
          summary: "People at the client, with one marked Primary.",
          blocks: [
            text(
              'On the client\'s Overview, the contacts list shows each person, with "Primary" and "Archived" marks.',
            ),
            steps(
              'Tap "Add a contact". Name is required; Designation, Email and Phone are optional.',
              "Tap a contact to open and edit it.",
              'To archive the primary contact, choose the "Next primary contact" when asked.',
              'Tap "Restore" on an archived contact to bring it back.',
            ),
            next("An archived contact stays on the list, marked Archived."),
            note(
              'Archiving the primary contact asks for the next primary contact. A contact no other record uses can be deleted for good from its ⋯ ("Delete"): its own edits and archiving never count, and the primary contact can go only while no other live contact is left.',
            ),
          ],
          keywords: ["contact", "primary contact", "archive"],
        },
        {
          id: "owner-client-page",
          title: "Read a client's page and your private notes",
          summary: "Overview, Projects and Brand, with History in the header.",
          blocks: [
            text(
              'A client page has the tabs Overview, Projects and Brand; the clock in its header opens its History. Overview opens with the client\'s active projects and their progress (each bar counts stages: "50% of stages", and a finished one-time project reads "Ready to complete"), then "Key people": the Admin and the primary contact side by side, with Call and the Drive folder under them; then the contacts, details, and "Requirements and notes". Details lists only what is filled in; the empty ones fold into "Add details", which opens Edit. Activity is the client\'s history, newest first; your own changes read "You".',
            ),
            text(
              '"Owner\'s notes" is yours alone. It says "Only you see these", and Admins never see it. You are also the only one who sees the reason a client was closed.',
            ),
          ],
          keywords: ["notes", "owner notes", "private", "overview", "activity", "brand"],
        },
      ],
    },
    {
      id: "projects",
      title: "Projects and deliverables",
      topics: [
        {
          id: "owner-how-client-work",
          title: "How client work is built",
          summary: "A client has projects. A project has cycles. A cycle has deliverables.",
          blocks: [
            text(
              "A project is a piece of ongoing or one-off work for a client. A one-time project has one set of deliverables. A weekly or monthly project starts a new cycle each period, and each cycle holds that period's deliverables. Each deliverable has stages, which are its checklist.",
            ),
            text(
              `Client work is separate from tasks. ${CREW} members never see clients, projects or deliverables.`,
            ),
          ],
          keywords: ["project", "cycle", "deliverable", "stage", "overview"],
        },
        {
          id: "owner-new-project",
          title: "Create a project",
          summary: "Name it, choose how often it repeats, list the deliverables.",
          blocks: [
            text(
              "New project has three steps: 1 Basics, 2 Deliverables & stages, 3 Preview & create.",
            ),
            steps(
              'Open the client, tap the Projects tab, then tap "New project".',
              {
                text: '"Start from a template" (highlighted), if templates exist: pick one in the library. It shows as a chip; change anything after.',
                shot: "owner/new-project",
              },
              'Type the "Project name" (required). Choose "Repeats": One-time, Weekly or Monthly (Monthly is the default). Add a "Description" and custom fields if you like, then tap "Next".',
              'For a one-time project, set a "Delivery date" that is not in the past.',
              'On step 2, fill in "Deliverables" (or "Deliverables list" for repeating projects). Optionally set "Default stage groups": a deliverable without its own stages starts with these. Tap "Next".',
              'Check the preview on step 3, then tap "Create project".',
            ),
            next("The project opens on its page, ready for work."),
            note(
              'Back (the button or the back gesture) returns to the step before. How often it repeats cannot change later. You cannot add a project to an Inactive client: the button is replaced by "No new projects on an Inactive client."',
            ),
          ],
          link: { href: "/clients", label: "Open Clients" },
          keywords: ["new project", "repeats", "monthly", "weekly", "one-time", "delivery date"],
        },
        {
          id: "owner-start-from-template",
          title: "Start a project from a template",
          summary: "Browse and preview templates before you use one.",
          blocks: [
            text(
              'The library lists templates with a summary like "Monthly · 6 deliverables · 72 stages".',
            ),
            steps(
              'In New project, tap "Start from a template". The library opens: "Preview one to see what it gives, then Use this template."',
              'Type in "Search templates": a template\'s name or one of its deliverables.',
              {
                text: "Tap Preview (highlighted) on a row to see what a project started from it gets.",
                shot: "owner/templates",
              },
              'Tap "Use this template", or "Back to templates" to keep looking.',
            ),
            next(
              'The template\'s contents are copied into the new project form, and the template shows as a chip on Basics ("Change template" picks another; "Don\'t use a template" drops the chip).',
            ),
            note(
              "Using a template replaces the repeat, the default stage groups and the deliverables. The description and custom fields fill only if they are empty.",
            ),
          ],
          keywords: ["template", "library", "preview", "start from"],
        },
        {
          id: "owner-add-deliverables",
          title: "Add deliverables with × N",
          summary: "Name a deliverable and say how many to make.",
          blocks: [
            steps(
              'In the "Add deliverables" box, type the "Deliverable name".',
              'Set "How many" (1 to 100).',
              "Optionally tick one or more stage presets. Each becomes one stage group, in the order you tick them.",
              'Tap "Add".',
            ),
            example("Reel × 4 makes Reel 1 to Reel 4. × 1 keeps the name as you typed it."),
            next(
              "With no preset ticked, the default stages apply. Each deliverable's ⋯ menu has Move up, Move down, Duplicate and Remove.",
            ),
            note("A project holds at most 100 deliverables."),
          ],
          keywords: ["add deliverables", "how many", "reel", "post", "preset"],
        },
        {
          id: "owner-own-stages",
          title: "Give one deliverable its own stages",
          summary: "Open a deliverable in the form and edit its stages.",
          blocks: [
            text('A row says "Uses the default stages" or "Own stages · n groups · m stages".'),
            steps(
              "Open the deliverable row with the arrow.",
              'Tap "Give it its own stages".',
              "Edit the groups and stages.",
              'Tap "Use the default stages instead" to go back.',
            ),
            next("The changes apply to this deliverable only."),
            note("Going back to the default stages is always one tap away."),
          ],
          keywords: ["own stages", "default stages", "customise"],
        },
        {
          id: "owner-live-preview",
          title: "Check the live preview",
          summary: "See what Create will make before anything is saved.",
          blocks: [
            text(
              'On a laptop the preview sits beside the deliverables on step 2. Step 3, "Preview & create", shows it on every screen: "What Create makes". The top shows three figures: deliverables, groups and stages.',
            ),
            steps(
              'Tap "Next" on step 2 to open it as step 3.',
              {
                text: 'Read each card: it is tagged "Default stages" or "Own stages" (highlighted). Identical neighbours collapse, so "Reel 1–4" shows as one card with "×4"; tap it to see the names.',
                shot: "owner/project-preview",
              },
              'Tap "Back" to return to the deliverables.',
            ),
            next("Nothing is saved until you create."),
            note('Closing after changes asks "Discard this project?".'),
          ],
          keywords: ["preview", "default stages", "own stages", "collapse"],
        },
        {
          id: "owner-project-page",
          title: "Read the project page",
          summary: "Cycles, the progress ring, Needs you and the deliverable rows.",
          blocks: [
            text(
              'The header shows the name, its state chip, the repeat and delivery date, with a History button (the clock) and a ⋯ menu. The months sit as tabs under it (the previous, this and the next cycle, such as September · October 2026 · November): tap one to switch; a project with only one cycle shows just its month, with no tabs. A one-time project shows "The project\'s deliverables".',
            ),
            steps({
              text: 'Open the project and read the ring (highlighted). It shows a percentage, with a line such as "12 of 18 stages · 3 of 7 deliverables done". Pace reads "On track", or "N behind plan" in red. At 100% it says the cycle is complete.',
              shot: "owner/project-page",
            }),
            text(
              'Beside the ring, "Needs you" names what to look at: a red dot for a late deliverable ("Reel 1 is 1 day late") and an amber dot for one that is nearly done ("Interview 2: 1 stage left", "Reel 3: ready to mark done"). When nothing is late or nearly done, nothing is shown there.',
            ),
            text(
              'Under it, "Deliverables" is a table on a laptop, with the columns Deliverable, Progress by group, Next and Planned. Each row: the name over "3 groups · 1 of 9 stages"; one line per group with its bar and "n/m" (a long list without groups shows one bar); the next stage as a chip, or, once every stage is ticked, a green "Mark done"; the planned date ("21 Oct", "18 Oct · 2 days late" in red, or "Not planned"); then ⋯ and ›. On a phone each deliverable is a card with the same lines per group. Details below is a grid: Client contact (the client’s primary contact), Repeats, the delivery date, Template (the template it started from, or Not added), Notes and the project fields.',
            ),
            text(
              'Finished ones read "Done", "Closed" or "Carried" and sit in the collapsed "Done and closed (N)". An empty cycle says "No deliverables yet: add one or start from a template." with an Add deliverable button.',
            ),
            note("Closed and carried deliverables are not counted in the ring."),
          ],
          keywords: ["progress", "ring", "pace", "planned", "overdue", "needs you", "late", "next"],
        },
        {
          id: "owner-deliverable-rows",
          title: "Tick stages from the list",
          summary: "Open a row's bar and tick from its checklist, or tap Next.",
          blocks: [
            text(
              "You can tick stages without opening a deliverable. Tapping anywhere else on the row opens it.",
            ),
            steps(
              {
                text: "Tap a row's progress bar, such as \"2/4\" (highlighted), to open its checklist: each stage with a tick box, under its group's name and count. Ticked ones are filled with a ✓, the next one is bold and outlined, later ones are grey. Long names wrap to two lines. On a laptop the checklist runs in three columns, on a phone in one. Tap the bar again to close it.",
                shot: "owner/deliverable-rows",
              },
              'Tap a stage to tick it ("Tick Edit") or untick it ("Untick Edit").',
              'Or tap "Next: ‹stage›" on the row: it ticks that stage in one tap.',
              'Read the toast, such as "Ticked Video steps · Edit on Reel 2". Tap Undo if it was a mistake.',
            ),
            next(
              "The line's count and the ring move at once, and the tick is added to the History.",
            ),
            note(
              "On a laptop you can also Tab to a deliverable and press Enter to open it. Stages tick only while the deliverable is open.",
            ),
          ],
          keywords: ["tick", "untick", "next", "checklist", "bar", "undo", "quick"],
        },
        {
          id: "owner-add-deliverable",
          title: "Add a deliverable to this month",
          summary: "Add one to the running cycle only.",
          blocks: [
            steps(
              'On the project page, tap "Add deliverable".',
              'Fill in Title, an optional "Planned date", and Notes.',
              '"Start from" can use a deliverable template for its stages; the default is "The project\'s default stages".',
            ),
            next('It joins this cycle only. "The deliverables list stays as it is."'),
            note(
              "Next month will not include it unless it joins the deliverables list. At the month's end the project asks: see \"Keep a month's extra deliverables\".",
            ),
          ],
          keywords: ["add deliverable", "extra", "this cycle"],
        },
        {
          id: "owner-deliverable-sheet",
          title: "Work in a deliverable's sheet",
          summary: "Tick stages, edit, move, mark done, send back or close.",
          blocks: [
            text(
              'The sheet shows Planned, From and History, and the stages under group headings with their count, as on the list ("Stages 1/1", "Edit 2/3").',
            ),
            steps(
              "Tap anywhere on a deliverable (or its ›) to open its sheet.",
              "Tick stages as the work moves on. Tap a ticked one again to untick it.",
              'Tap "Edit stages" to change the stages of this deliverable only.',
              'Tap "Edit details" to change the title, notes, and the planned date while it is open.',
              'Open the ⋯ menu for "Another revision round", "Move up" or "Move down" (its place in the list, with a toast like "Moved Reel 2 down") and "Save as template".',
            ),
            next(
              '"Last change · ‹who› ‹what› · ‹day›" sits on one line, with the History clock beside it: it shows who changed what, and when.',
            ),
            note(
              "You can tick or untick stages only while the deliverable is open. Ticked boxes are plain, never red: red is kept for what is late.",
            ),
          ],
          keywords: ["sheet", "tick", "history", "edit stages", "edit details", "move up", "order"],
        },
        {
          id: "owner-revision-round",
          title: "Add another revision round",
          summary: "One more revision stage on a deliverable, in one tap.",
          blocks: [
            text(
              "When the client asks for one more round of changes, add a revision stage instead of editing the stages by hand.",
            ),
            steps(
              {
                text: 'Open the deliverable\'s sheet and tap its ⋯ menu, then "Another revision round" (highlighted).',
                shot: "owner/revision-round",
              },
              'Read the toast, such as "Added Revision 3".',
            ),
            next(
              'The new stage follows the deliverable\'s own revision stages ("Revision 2" is followed by "Revision 3") in their group; one with none gets "Revision round 1". It goes right after the last revision stage, or right after "Edit" when there is none, so it comes before "Posted". With neither, it goes just before "Posted", "Published" or "Delivered", or at the end when there is none of those. Ticks already made stay.',
            ),
            note(
              "It works on open deliverables only. To add it to a done one, send it back first.",
            ),
            note(
              'Use it instead of typing numbered round stages ("Approval round 1", "Approval round 2"). When a deliverable has two or more stages like that, its open row shows this tip.',
            ),
          ],
          keywords: ["revision", "another round", "changes", "client feedback", "tip"],
        },
        {
          id: "owner-group-stages",
          title: "Split a long stage list into groups",
          summary: "You choose where each group starts; nothing is grouped by itself.",
          blocks: [
            text(
              'A deliverable with 9 or more stages and no groups shows, when you open its row, "12 stages: split them into groups?" with a "Group stages" button. It is only a suggestion: nothing changes until you choose.',
            ),
            steps(
              'Open the row\'s checklist and tap "Group stages".',
              'Tap the stage where each new group starts ("Start a group here"). The first group always starts at the first stage. Tap it again to undo.',
              'Name each group, such as "Concept", "Shoot" and "Post", then tap "Group stages".',
              'Read the toast "Grouped the stages of ‹deliverable›".',
            ),
            next(
              "The checklist shows each group's name and its own count. Ticks and the order stay as they were, and only that deliverable changes. The History lists each stage moved into its group.",
            ),
            note("A deliverable that already has groups is changed in Edit stages, as before."),
          ],
          keywords: ["group", "groups", "long", "stages", "split", "concept", "shoot"],
        },
        {
          id: "owner-mark-done",
          title: "Mark a deliverable done",
          summary: "Done is the approval. It counts straight away.",
          blocks: [
            text(
              "There is no separate approval step for client work: marking it done is the approval.",
            ),
            text(
              "Mark done comes onto a row once every stage is ticked; the first such row's button is solid green. Until then it waits in the row's ⋯, beside Open, as “Mark done…”, which asks first (“1 stage isn't ticked”). A deliverable with no stages always shows it. In the deliverable's sheet the action is “Next: ‹stage›” (it ticks that stage) until every stage is ticked, then the green Mark done; before that, Mark done… is in the sheet's ⋯. “Close deliverable…” is in red, and its confirmation's way out is “Keep it”.",
            ),
            steps(
              'Open the project and tap "Mark done" on the row (or in its ⋯), or in the sheet.',
              'Watch for the toast "Marked … done".',
              "Tap Undo within 6 seconds if it was a mistake.",
            ),
            next("It locks the ticks and counts at once."),
            note("Approvals does not list deliverables. Do this on the project."),
          ],
          keywords: ["done", "approve", "undo", "complete deliverable"],
        },
        {
          id: "owner-send-back",
          title: "Send a done deliverable back",
          summary: "Return it to open with a reason.",
          blocks: [
            steps(
              "Open the done deliverable's sheet.",
              { text: 'Tap "Send back…" (highlighted).', shot: "owner/send-back" },
              'Write "What needs to change".',
            ),
            next(
              "The deliverable returns to open and stops counting as done until it is done again.",
            ),
            note("A reason is required."),
          ],
          keywords: ["send back", "reopen", "rework", "return"],
        },
        {
          id: "owner-close-deliverable",
          title: "Close a deliverable",
          summary: "Drop it from the cycle with a reason. This cannot be undone.",
          blocks: [
            steps(
              "Open an open or done deliverable.",
              'Tap "Close deliverable…".',
              'Write "Why close it".',
            ),
            next("It stays in the cycle as closed, not done, and is not counted in progress."),
            note(
              "Closing cannot be undone. If you only want to redo the work, use Send back instead.",
            ),
          ],
          keywords: ["close", "drop", "cancel deliverable"],
        },
        {
          id: "owner-bulk",
          title: "Select several deliverables",
          summary: "Select rows, then mark done, tick a stage or edit them all.",
          blocks: [
            steps(
              'On the project page, tap "Select" above the deliverables. It says "Select deliverables, then choose an action." Checkboxes appear and the rows\' own Mark done step aside.',
              'Tap the rows you want: a tap anywhere on a row selects it. "Select all" takes every row.',
              {
                text: 'Use the bar at the bottom: "Mark N done" (it asks "Mark N deliverables done?" first), "Tick a stage" then "Tick ‹stage› on N", or "Edit N" (highlighted) for the edits in the next topic.',
                shot: "owner/select-edit",
              },
              'Tap "Done", or go back, to leave Select.',
            ),
            next("The action applies to all the selected rows."),
            note("Select changes only the view: back leaves it before it leaves the page."),
          ],
          keywords: ["bulk", "select", "many", "tick stage", "select all"],
        },
        {
          id: "owner-bulk-edit",
          title: "Edit several deliverables at once",
          summary: "Plan, move dates, add a stage group or rename, all in one go.",
          blocks: [
            text(
              'Select the deliverables, tap "Edit N" in the bar and pick one of four edits. Each opens a sheet that names what it changes.',
            ),
            steps(
              '"Set planned date…": pick a "Planned date"; every selected deliverable is planned for it.',
              '"Move planned dates…": set "By how many days" and choose Earlier or Later. One without a planned date stays as it is.',
              '"Add a stage group…": build the "Groups to add", typed or from a preset; each selected deliverable gets them.',
              {
                text: '"Rename…": type a "New name" with {n} where the number goes ({title} keeps the current name), set "Start at", and check the Preview (highlighted) before you tap Rename N.',
                shot: "owner/bulk-rename",
              },
            ),
            example(
              "“Reel {n}” starting at 5 renames three deliverables to Reel 5, Reel 6 and Reel 7, in the list's order.",
            ),
            next("The toast says what changed, such as “Renamed 3 deliverables”."),
            note(
              '"Edit N" counts only the open deliverables you selected. An edit is all or nothing: if one of them cannot change, nothing changes and the message names it.',
            ),
          ],
          keywords: [
            "bulk edit",
            "rename",
            "planned date",
            "move dates",
            "shift",
            "add group",
            "{n}",
          ],
        },
        {
          id: "owner-project-activity",
          title: "Read a project's History",
          summary: "Every change to the project, newest first.",
          blocks: [
            steps(
              "Open the project and tap the clock (History) in the header.",
              "Filter by All, Deliverables, Stages or Project.",
              'Tap "Show older" to see more.',
            ),
            next("It shows the latest 20 first."),
            note("Use it to see who changed what."),
          ],
          keywords: ["history", "audit", "who changed"],
        },
        {
          id: "owner-project-state",
          title: "Complete, cancel or reopen a project",
          summary: "Use the project's ⋯ menu.",
          blocks: [
            text(
              'The ⋯ menu also has "Edit details", "Default stages", "Deliverables list" for repeating projects, "Save as template" and "Copy schedule as text".',
            ),
            steps(
              "Open the project's ⋯ menu.",
              'Tap "Complete project" when the work is finished.',
              'Tap "Cancel project…" to cancel it. It needs a reason; "Keep project" closes the question without cancelling.',
              'Tap "Reopen project…" to bring a completed or cancelled project back.',
            ),
            next("A completed or cancelled project becomes read-only."),
            note('"Reopen it from ⋯ to change anything."'),
          ],
          keywords: ["complete", "cancel", "reopen", "read-only", "finish project"],
        },
        {
          id: "owner-copy-schedule",
          title: "Send the schedule on WhatsApp",
          summary: "Copy the shown cycle's plan as plain text.",
          blocks: [
            steps(
              "Open the project on the cycle you want.",
              {
                text: 'Open the project\'s ⋯ menu and tap "Copy schedule as text" (highlighted).',
                shot: "owner/copy-schedule",
              },
              'Read the toast "Schedule copied: paste it into WhatsApp", then paste it into the chat.',
            ),
            example(
              "The text starts with the project and the month in bold, then each planned date (“Tue 21 Oct”) with its deliverables, and “Not planned yet” last. A done one says “(done)”.",
            ),
            next("Closed and carried deliverables are left out: they are not this cycle's work."),
            note(
              'If the browser does not allow copying, it says "The schedule could not be copied". Try again, or copy from a laptop.',
            ),
          ],
          keywords: ["whatsapp", "copy", "schedule", "share", "plan", "send to client"],
        },
      ],
    },
    {
      id: "stage-groups",
      title: "Stage groups",
      topics: [
        {
          id: "owner-what-group",
          title: "What a stage group is",
          summary: "A heading over a set of stages.",
          blocks: [
            text(
              'A stage group is a heading with its stages under it, such as "Shoot prep" with its steps. A list made before groups existed is one untitled group, with a "Name this group" button.',
            ),
            text('Stage chips and the sheet show progress per group as "n/m".'),
          ],
          keywords: ["group", "stages", "heading"],
        },
        {
          id: "owner-add-group",
          title: "Add and fill a group",
          summary: "Add a group by hand, or from a preset.",
          blocks: [
            steps(
              'Tap "Add a group". In "New group", type a "Group name" and "One stage per line", then tap "Add group".',
              'Or tap "Add from a preset…". The preset is added as a new group named after it, and you can rename it.',
              'Type in "Add a stage" and press Enter to add one stage. Paste several lines to add several.',
            ),
            next("The new group appears with its stages under it."),
            note(
              "Only one group may be left without a name. A stage name must be unique within its group.",
            ),
          ],
          keywords: ["add a group", "preset", "name this group", "untitled"],
        },
        {
          id: "owner-reorder-stages",
          title: "Reorder groups and stages",
          summary: "Drag, or use Move up and Move down.",
          blocks: [
            steps(
              "On a laptop, drag the handle.",
              "On a phone, press and hold a stage until it lifts, then drag.",
              "Or open the ⋯ menu and tap Move up or Move down.",
              'To delete, tap "Remove stage", or "Remove group" (it confirms, and its stages go with it).',
            ),
            next("The order changes at once."),
            note("A stage moves within its own group. The limit is 100 stages in a list."),
          ],
          keywords: ["drag", "long press", "move up", "move down", "remove", "limit"],
        },
        {
          id: "owner-default-stages",
          title: "Change a project's default stages",
          summary: "New deliverables start with them. Old ones never change.",
          blocks: [
            steps("Open the project's ⋯ menu.", 'Tap "Default stages" and make your changes.'),
            next(
              "New deliverables start with these. Existing deliverables keep their own stages, so a change never touches them.",
            ),
            note("Removing a stage from a deliverable keeps its tick in the history."),
          ],
          keywords: ["default stages", "existing deliverables"],
        },
      ],
    },
    {
      id: "templates",
      title: "Presets and templates",
      topics: [
        {
          id: "owner-stage-presets",
          title: "Make a stage preset",
          summary: "A reusable checklist of stages.",
          blocks: [
            text(
              "A preset is a flat list of stages with a name (up to 80 characters), and up to 100 stages.",
            ),
            steps(
              "Open Settings, then Templates: Stage presets is the first section (on a phone, the Presets tab).",
              'Tap "Add preset" on the section\'s heading.',
              "Type the Name and the stages in order. Drag or use Move to reorder.",
              'Tap "Add preset" or "Save preset".',
            ),
            next(
              'Archive on a preset stops "New project" offering it; the message "‹name› archived" has Undo for a few seconds, and "Archived (n)" at the foot of the list has Restore later.',
            ),
            note("Projects that used a preset keep their stages."),
          ],
          link: { href: "/settings/templates#presets", label: "Open Stage presets" },
          keywords: ["preset", "checklist", "archive", "undo"],
        },
        {
          id: "owner-project-template",
          title: "Build a project template",
          summary: "A reusable project: repeat, stage groups and deliverables.",
          blocks: [
            text(
              'A project template has a Name, Repeats, "Default stage groups", "Deliverables" (with × N, and a deliverable-template picker), a Description and project field defaults.',
            ),
            steps(
              'Open Settings, then Templates, and tap "Add project template" beside Project templates.',
              'On a laptop a preview shows beside the form; tap "Add template" (or "Save template" when editing).',
              'On a phone, tap "Preview and save": the preview opens as its own step. Tap "Back to editing" to change something, or save from there.',
            ),
            next(
              'The toast says "Added ‹name›: New project offers it under Start from" ("Saved ‹name›" after an edit).',
            ),
            note(
              'With none yet, Templates says "No project templates yet: Add one to start projects faster." Save as template on a project makes one too. Templates are copies: editing one later never changes a project.',
            ),
          ],
          link: { href: "/settings/templates", label: "Open Templates" },
          keywords: ["project template", "build", "preview"],
        },
        {
          id: "owner-deliverable-template",
          title: "Make a deliverable template",
          summary: "A named kind of deliverable with its stage groups.",
          blocks: [
            text(
              "Use one when you repeat a kind of deliverable, such as a reel with the same steps every time.",
            ),
            steps(
              'Open Settings, then Templates, and tap "Add deliverable template" beside Deliverable templates.',
              'Give it a Name and its "Stage groups". A preview shows as you build.',
              'Tap "Add template" (on a phone, "Preview and save").',
            ),
            next(
              'The toast says "Added ‹name›: + Add deliverable offers it". Archiving asks "Why archive it" and says "Archived ‹name›: + Add deliverable no longer offers it".',
            ),
            note("Admins can edit and archive their own templates; you can do it for any."),
          ],
          link: { href: "/settings/templates", label: "Open Templates" },
          keywords: ["deliverable template", "reel", "post"],
        },
        {
          id: "owner-templates-list",
          title: "Preview, edit or archive a template",
          summary: "One Templates page: stage presets, deliverable, project and task templates.",
          blocks: [
            steps(
              "Open Settings, then Templates. It lists Stage presets, Deliverable templates and Project templates, then, under a line, Task templates. On a phone each is a tab.",
              "Type in the search box to find any of them by name, stage or deliverable.",
              'Tap "Preview" on a stage preset, deliverable or project template to see what work made from it gets.',
              'Tap the pencil ("Edit ‹name›") to change it, or the archive box ("Archive ‹name›") to stop offering it; on a phone both are in the row\'s ⋯. Archive asks first.',
            ),
            next(
              'The message "‹name› archived" has Undo for a few seconds; later, "Archived (n)" at the foot of the list has Restore. Work already made from it does not change.',
            ),
            note(
              "The question's Archive button is plain, not red: nothing is destroyed. The template is only no longer offered, and Undo brings it back.",
            ),
          ],
          link: { href: "/settings/templates", label: "Open Templates" },
          keywords: [
            "archive",
            "undo",
            "edit template",
            "preview",
            "task template",
            "stage preset",
          ],
        },
        {
          id: "owner-templates-delete",
          title: "Delete a template for good",
          summary: "Only you can; work made from it keeps everything.",
          blocks: [
            steps(
              "Open Settings, then Templates.",
              'Tap the red bin ("Delete ‹name›") on the template or preset; on a phone it is the red Delete in the row\'s ⋯.',
              'Read the question: it says what uses it, such as "Used by 3 projects (2 still open)", and exactly what happens. Tap the red "Delete ‹name›", or "Keep it".',
            ),
            next(
              'It is gone from Templates and from every list that offered it, and it cannot be brought back. Projects, deliverables and tasks made from it keep all their stages, deliverables and months; a project\'s Details read "Template: ‹name› (deleted)".',
            ),
            note(
              "Deleting a task template first gives its reminders to every open task that follows it, so nobody's reminders change. Admins can archive their own templates but never delete one. To stop offering a template you may want again, use Archive instead.",
            ),
          ],
          link: { href: "/settings/templates", label: "Open Templates" },
          keywords: ["delete", "delete template", "remove template", "deleted", "bin"],
        },
        {
          id: "owner-save-as-template",
          title: "Save work as a template",
          summary: "Turn a good project or deliverable into a template.",
          blocks: [
            steps(
              "Open the project's ⋯ menu, or a deliverable's ⋯ menu.",
              'Tap "Save as template".',
              'Edit the "Template name", then save.',
            ),
            next(
              'The toast "Saved as the template …" has an "Open templates" action. The original stays as it is.',
            ),
            note(
              "A project template keeps the structure only: the repeat, its default stage groups and deliverables with their stages, never the description or custom field values. A deliverable template keeps its stage groups, with no ticks or dates.",
            ),
          ],
          keywords: ["save as template", "copy from project"],
        },
        {
          id: "owner-template-copies",
          title: "Templates are copies, never links",
          summary: "Editing a template never changes a project.",
          blocks: [
            text(
              "When you use a template or preset, its contents are copied in. Editing or archiving the template or preset later changes nothing that already exists. To change a running project, edit the project.",
            ),
            text(
              'In "Add deliverable", "Start from" can take a deliverable template. Admins can edit and archive their own templates; you can do it for any.',
            ),
          ],
          keywords: ["copy", "link", "edit template", "archive template"],
        },
      ],
    },
    {
      id: "recurring",
      title: "Monthly retainer, step by step",
      topics: [
        {
          id: "owner-retainer-walkthrough",
          title: "Set up a monthly retainer",
          summary: "From a stage preset to a project that renews itself.",
          blocks: [
            text(
              "This is the whole path for a client who gets the same work every month. You set it up once. After that, each month starts by itself.",
            ),
            steps(
              'Open Settings, then Templates, Stage presets: add a preset for each kind of checklist, such as "Shoot prep".',
              "Open Settings, then Templates: add a deliverable template for Reel and one for Post, using those presets.",
              'Add a project template called "Monthly retainer", with Repeats set to Monthly and the deliverables Reel × 4 and Post × 2.',
              {
                text: 'Open the client, then Projects, then tap "New project". Tap "Start from a template" (highlighted) and use "Monthly retainer". Name it, tap "Next" twice, check the preview, then tap "Create project".',
                shot: "owner/new-project",
              },
              'To adjust this month, tap "Add deliverable" for a one-off, or "Edit stages" on a deliverable. This changes this month only.',
              'At month end, answer "Keep ‹Month›\'s extra deliverables next month?" if the project asks, then open "Unfinished deliverables" and decide what is unfinished.',
              'After a good month, tap "Save as template" on the project so the next client starts from it.',
            ),
            example(
              "Sample Client has a Monthly retainer: Reel 1 to Reel 4 and Post 1 and Post 2. In this month's cycle you add one extra Reel with Add deliverable. Next month's cycle still starts with the usual six.",
            ),
            next("Each month a new cycle appears, with the deliverables list copied in."),
            note(
              "A project template's deliverables are built in the template builder. In New project you pick the template through “Start from a template”; New project itself has no deliverable-template picker.",
            ),
          ],
          link: { href: "/clients", label: "Open Clients" },
          keywords: ["retainer", "monthly", "recurring", "repeat", "setup", "walkthrough"],
        },
        {
          id: "owner-every-month",
          title: "What happens every month",
          summary: "A new cycle appears at 00:00 IST for Active clients.",
          blocks: [
            text(
              "A monthly project gets a new cycle on the 1st, and a weekly one on Mondays, at 00:00 IST. Each new cycle is filled from the deliverables list, with each line's stages. It runs only for Active clients and projects that are open. A Paused client gets no new cycles.",
            ),
            text(
              'You get a "cycle ready" notice at 8:00 am. A repeating project also gets its current period\'s cycle as soon as you create it.',
            ),
          ],
          keywords: ["new cycle", "automatic", "paused", "00:00", "1st"],
        },
        {
          id: "owner-start-early",
          title: "Start next month early",
          summary: "Name next month's deliverables before the month begins.",
          blocks: [
            steps(
              "Open the project's ⋯ menu.",
              'Tap "Start" followed by the period, such as the next month.',
              'Confirm "Start … now?".',
            ),
            next(
              "The cycle starts with the deliverables list, so you can name the deliverables ahead.",
            ),
            note("It is offered only shortly before the period begins (up to 7 days early)."),
          ],
          keywords: ["start early", "next month", "ahead"],
        },
        {
          id: "owner-deliverables-list",
          title: "Edit the deliverables list",
          summary: "What every new month starts with.",
          blocks: [
            text('It has one row per line. Each line has "Stages" and can be added with × N.'),
            steps(
              'Open the repeating project\'s ⋯ menu and tap "Deliverables list".',
              "Add lines with × N, or rename them.",
              'Tap "Stages" on a line to set its stages.',
            ),
            next("Every month starts with these, from the next period."),
            note('To add something to the running month only, use "Add deliverable" instead.'),
          ],
          keywords: ["deliverables list", "every month", "lines"],
        },
        {
          id: "owner-keep-extras",
          title: "Keep a month's extra deliverables",
          summary: "At month end, say whether this month's extras repeat.",
          blocks: [
            text(
              'Near the end of a month, a repeating project that gained deliverables this cycle asks "Keep ‹Month›\'s extra deliverables next month?" (a weekly one: "next week?"). It lists the ones added this cycle that are not on the deliverables list, and says: "Yes adds them to the deliverables list from ‹Month›; No leaves the list as it is."',
            ),
            steps(
              "Open the project page and read the card under the ring.",
              'Tap "Yes, keep them" to add them to the deliverables list.',
              'Or tap "No": the list stays as it is.',
            ),
            next(
              'Yes adds them for later cycles only: this month and any cycle already started stay as they are. The toast says, for example, "2 deliverables added to the deliverables list from November 2026".',
            ),
            note(
              "The card shows from 6 days before the month's last day to 7 days after (a weekly project: from its last 2 days to 2 days after), once per cycle. Either answer is kept and the card goes. Carried and closed deliverables are not extras.",
            ),
          ],
          keywords: ["extra", "keep", "month end", "deliverables list", "next month", "yes no"],
        },
        {
          id: "owner-carry",
          title: "Decide what to do with unfinished deliverables",
          summary: "Carry forward, leave pending, or close.",
          blocks: [
            text(
              'When a cycle ends with deliverables unfinished, the project shows a link: "… has ended: N unfinished deliverables to decide". It opens "Unfinished deliverables", grouped by project and cycle.',
            ),
            steps(
              "Open the link, then select the deliverables, or none to act on all rows.",
              'Tap "Carry N forward" to move them into the next cycle.',
              'Tap "Leave N pending" to leave them where they are.',
              'Tap "Close…" on a row to close it. It asks "Why close it".',
            ),
            next('Empty screen: "Nothing to decide."'),
            note(
              "On an Inactive client, Carry forward is hidden: close them or leave them pending. If the client is not Active, the next cycle takes only carried deliverables.",
            ),
          ],
          link: { href: "/clients/items/decide", label: "Open Unfinished deliverables" },
          keywords: ["carry forward", "leave pending", "unfinished", "month end"],
        },
        {
          id: "owner-client-deliverables",
          title: "See every client's deliverables",
          summary: "One list of open deliverables, grouped by Admin.",
          blocks: [
            text(
              'Client deliverables shows every client\'s open deliverables, grouped by Admin, with "No Admin (yours)" for clients without one.',
            ),
            steps(
              "Open Clients, then Client deliverables.",
              "Filter by Open or Overdue, and by client or project.",
              "Tap a row to open the project on that deliverable's cycle.",
            ),
            next(
              'Today shows "N client items overdue" in red when any are late. Tap it to open this list filtered to overdue.',
            ),
            note('Clients without an Admin are listed under "No Admin (yours)".'),
          ],
          link: { href: "/clients/items", label: "Open Client deliverables" },
          keywords: ["overdue", "across clients", "all deliverables"],
        },
      ],
    },
    {
      id: "settings",
      title: "Settings",
      topics: [
        {
          id: "owner-settings-overview",
          title: "What each Settings section does",
          summary: "One line on every section.",
          blocks: [
            steps(
              { text: "Open Settings (Thresholds highlighted).", shot: "owner/settings" },
              "Company: the company name and the timezone everything runs on.",
              "Days off & holidays: weekly off days and the holiday list.",
              "Thresholds: reminders, escalations, the logout nudge and the email cap.",
              "Notifications: who cannot be reached by push, and why.",
              "Expenses: expense categories and when a claim needs a receipt photo.",
              "Job titles: the titles people can be given.",
              "Task types: the kinds of task, their order and what each asks for.",
              "Custom fields: extra fields on clients and contacts.",
              "Templates: stage presets, deliverable, project and task templates, on one page.",
            ),
            text(
              "The sections sit in groups named by what they hold: Company and working days; Team (Notifications, Job titles); Lists, templates and integrations. Each row says in one line what it holds, and Help, at the foot, opens How MaxOff works. Admins can open Notifications, Job titles, Custom fields and Templates. The rest are yours alone.",
            ),
          ],
          link: { href: "/settings", label: "Open Settings" },
          keywords: ["settings", "company", "configure"],
        },
        {
          id: "owner-thresholds",
          title: "Set reminders and limits",
          summary: "How soon MaxOff nudges, escalates and goes quiet.",
          blocks: [
            text(
              'Thresholds holds the timings that drive reminders, in four groups: Working day, Tasks, Client work and Notifications. Each group is one row with a line saying its current values, such as "Not noted: remind every 2 h → Admin at 4 h → Owner at 8 h".',
            ),
            steps(
              "Open Settings, then Thresholds.",
              'Tap "Tasks" to open it.',
              {
                text: 'Set "Acknowledgement reminder (hours)" (highlighted).',
                shot: "owner/thresholds",
              },
              'Set "Escalate to the Admin after (hours)", "Escalate to the Owner after (hours)", "Overdue escalation (hours)", "Workload warning (tasks due that day)" and the Default reminders.',
              'In "Working day": "End-of-day reminder" and "Late End day until". In "Client work": the two escalations to you. In "Notifications": quiet hours, the email cap and the weekly summary\'s day.',
              'Tap "Save thresholds". It stays at the bottom of the screen and saves every group\'s changes at once.',
            ),
            next("A group with a value to fix opens by itself, with the message under the field."),
            note("The timings drive the reminders and escalations people receive."),
          ],
          link: { href: "/settings/thresholds", label: "Open Thresholds" },
          keywords: ["reminder", "escalate", "quiet hours", "email cap", "workload"],
        },
        {
          id: "owner-reachability",
          title: "See who cannot be reached",
          summary: "People who will not get push notifications.",
          blocks: [
            text(
              'Settings, Notifications lists "Can\'t be reached". You see everyone, with device detail and a warning if the server is not set up for push. An Admin sees only the people on their open tasks. When everyone is fine it says "Everyone can be reached."',
            ),
          ],
          link: { href: "/settings/notifications", label: "Open Notifications settings" },
          keywords: ["push", "unreachable", "device", "reachability"],
        },
        {
          id: "owner-task-types",
          title: "Edit task types",
          summary: "The kinds of task, their order and what each asks for.",
          blocks: [
            text(
              "Only you can change task types. They set the list in New task, and event types ask for a date, a location and a purpose.",
            ),
          ],
          link: { href: "/settings/task-types", label: "Open Task types" },
          keywords: ["task type", "event", "types"],
        },
        {
          id: "owner-job-titles",
          title: "Edit job titles",
          summary: "Titles are labels. They do not change what anyone can do.",
          blocks: [
            text(
              "Job titles are the titles you can give people. They are only labels. What a person can do depends on their role: Owner, Admin or " +
                CREW +
                ".",
            ),
            text(
              'Every Settings list works the same way: "Add ‹thing›" at the top of the list ("Add job title", "Add holiday", "Add task type") opens a form. On a laptop each row has Move up, Move down, Rename or Edit, and Archive; on a phone they are in the row\'s ⋯. Archive asks first, and its message has Undo for a few seconds; whoever already has the value keeps it. Later, open "Archived (n)" at the foot of the list: Restore brings a row back, and Delete removes one nothing else ever used.',
            ),
          ],
          link: { href: "/settings/job-titles", label: "Open Job titles" },
          keywords: ["job title", "designer", "editor", "role"],
        },
        {
          id: "owner-delete-unused",
          title: "Delete something nobody used",
          summary: "Only what nothing ever pointed at goes; the rest you archive.",
          blocks: [
            steps(
              {
                text: 'In Settings, open Job titles, Expenses, Task types or Custom fields and tap the red bin ("Delete ‹name›") on the row (highlighted); on a phone it is the red Delete in the row\'s ⋯.',
                shot: "owner/delete-unused",
              },
              'For a draft client or a contact, open its ⋯ menu and tap the red "Delete".',
              'MaxOff checks first. If nothing ever used it, tap the red "Delete ‹name›", or "Keep it".',
            ),
            next("It is gone for good, from every list and picker. Its name stays in the history."),
            note(
              'Anything something else ever used stays: a title someone once held, a category on any claim (paid ones too), a type on any task or template, a field with a value now or in the past, a draft with a contact or a note. Its own history never stops a Delete: renaming, editing, reordering, archiving or restoring it is fine. The question then says "In use — archive it instead." and offers only Close. A draft client has no Archive; it simply stays a draft. Admins never see Delete.',
            ),
          ],
          link: { href: "/settings/job-titles", label: "Open Job titles" },
          keywords: [
            "delete",
            "unused",
            "remove",
            "in use",
            "job title",
            "expense category",
            "task type",
            "custom field",
            "draft client",
            "contact",
          ],
        },
        {
          id: "owner-custom-fields",
          title: "Add custom fields",
          summary: "Extra fields on clients and contacts.",
          blocks: [
            text(
              "Custom fields add your own questions to client and contact forms. A field can be for everyone, or for one client only. They appear in New client and on the client's details.",
            ),
          ],
          link: { href: "/settings/custom-fields", label: "Open Custom fields" },
          keywords: ["custom field", "extra field", "gstin"],
        },
        {
          id: "owner-days-off",
          title: "Set days off and holidays",
          summary: "Weekly off days and the holiday list.",
          blocks: [
            text(
              'Days off & holidays holds the weekly off days and the list of holidays. On those days the Attendance heading on Today reads "Attendance · Day off".',
            ),
            note(
              'A holiday still ahead has a bin ("Remove ‹name›"). On its day and after it stays, with no bin: it already counted for attendance and leave.',
            ),
          ],
          link: { href: "/settings/days-off", label: "Open Days off" },
          keywords: ["holiday", "weekly off", "sunday", "day off"],
        },
      ],
    },
    {
      id: "notifications",
      title: "Alerts and your phone",
      topics: [
        {
          id: "owner-alerts",
          title: "Use the Alerts screen",
          summary: "Every notification, one tap from what it is about.",
          blocks: [
            text("Alerts lists your notifications, grouped by day, 20 to a page."),
            steps(
              "Open Alerts.",
              "Tap All or Unread to switch the list.",
              'Tap "Mark all read" to clear the unread count.',
              "Tap a notification to open what it is about.",
            ),
            next('The back control then reads "Alerts".'),
            note('Empty states read "Nothing yet" and "You\'re all caught up".'),
          ],
          link: { href: "/notifications", label: "Open Alerts" },
          keywords: ["alerts", "unread", "mark all read"],
        },
        {
          id: "owner-push",
          title: "Turn on push notifications",
          summary: "Set it up once on each device, from Me.",
          blocks: [
            steps(
              "Open Me.",
              'Under "Notifications", tap "Turn on" (or "Turn on here").',
              "Allow notifications when your phone asks.",
            ),
            next('It then says "Notifications are on for this device".'),
            note(
              'On an iPhone, add MaxOff to your Home Screen first. Me shows the steps. "Your devices" lists where your notifications go.',
            ),
          ],
          link: { href: "/me", label: "Open Me" },
          keywords: ["push", "device", "iphone", "allow notifications"],
        },
      ],
    },
    {
      id: "help",
      title: "Help and troubleshooting",
      topics: [
        missingButtonTopic(
          "Almost every button is yours as the Owner. If one is missing, it usually depends on the step the item is at. A completed project is read-only until you Reopen it. Mark done shows only on open deliverables, and on the list it waits in a row's ⋯ until every stage is ticked. In Select mode the rows' own buttons step aside for the bar. Approve on a task appears only after the primary owner marks it done. On the client side, there is no New project on an Inactive client, and Activate appears only once an Admin is assigned. If the button should be there and is not, reload the app from Me.",
        ),
        ...COMMON_HELP_TOPICS,
      ],
    },
  ],
};
