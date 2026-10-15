import { ROLE_LABELS } from "@/core/lib/role-labels";

import type { Guide, GuideBlock } from "../types";
import { COMMON_HELP_TOPICS, missingButtonTopic } from "./common";

const CREW = ROLE_LABELS.staff;

const text = (t: string): GuideBlock => ({ kind: "text", text: t });
const steps = (...s: string[]): GuideBlock => ({ kind: "steps", steps: s });
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
              "The bottom bar holds Today, Approvals, Tasks and Calendar. The last cell, More, opens a sheet with Reports, Clients, People, Settings and a Me row.",
            ),
            steps(
              "Tap a cell in the bottom bar to switch screen.",
              "Tap More for Reports, Clients, People and Settings.",
              "Tap Me in the same sheet for your own page.",
            ),
            note(
              "The count on More adds up everything behind it, so a number there can mean a waiting item on one of those screens.",
            ),
          ],
          keywords: ["more", "bottom bar", "menu", "phone", "navigation"],
        },
        {
          id: "owner-bell",
          title: "Read your alerts",
          summary: "The bell opens Alerts, with the unread count on it.",
          blocks: [
            text(
              "On a phone the bell sits in the title bar of each screen. On a laptop it is in the top bar. Both open Alerts and show how many you have not read.",
            ),
          ],
          link: { href: "/notifications", label: "Open Alerts" },
          keywords: ["bell", "notifications", "unread"],
        },
        {
          id: "owner-me",
          title: "Use Me",
          summary: "Your own page: devices, notifications and troubleshooting.",
          blocks: [
            text(
              "Me is where you turn on notifications for this device, see Your devices, and find Help & troubleshooting. On a phone, open it from More.",
            ),
            text(
              "You do not mark attendance or take leave, so Me has no attendance or leave rows for you.",
            ),
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
              "Today answers one question: who is in, and what needs you. The sections come in this order.",
            ),
            steps(
              '"Needs you": the oldest 5 waiting items, in this order: attendance days, leave requests, extra-work notes, expense claims, tasks. "See all N" opens Approvals.',
              '"Attendance": four counts, Not started, Waiting, Present and On leave. Red lines appear only when something is wrong, such as someone absent.',
              '"My tasks": your own open tasks that are overdue or due today.',
              '"Today\'s tasks": one line, "N due today · M handed in".',
              '"Client work": one red line when client items are overdue.',
              '"Overdue and risks": overdue tasks, tasks nobody has noted, people on leave, and people who cannot be reached.',
              '"This week": up to seven days, then "See the week".',
            ),
            note(
              'If everything below "Needs you" is empty, the screen says "Nothing else needs you today."',
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
              "Each row shows what it is (Attendance, Leave, Extra work, Expense or Task), who it is about, and how long it has waited. It turns amber after a day and red after three.",
            ),
            steps(
              "Tap Approve to decide at once. A 6-second Undo appears.",
              "Extra work shows Review instead, because you choose how much comp leave to grant.",
              "Tap anywhere else on the row to open the full review.",
            ),
          ],
          link: { href: "/approvals", label: "Open Approvals" },
          keywords: ["approve", "undo", "waiting"],
        },
        {
          id: "owner-everyone-today",
          title: "See everyone today",
          summary: "Everyone expected today, grouped by where they stand.",
          blocks: [
            text(
              'Tap the "Attendance" heading on Today. The list shows everyone expected today. Filter it by Everyone, Waiting, Not started, Present, On leave, Absent or End not recorded.',
            ),
            text(
              '"End not recorded" is about yesterday: people who never ended their day. Tap a person to open their page.',
            ),
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
              `Attendance days sit under "Attendance" on Approvals. Only you decide them. Original records are never overwritten: a correction is kept beside the original.`,
            ),
            steps(
              "Open Approvals.",
              "Tap Approve on a day, or Review to see it first.",
              'In the review, tap "Correct…" if the recorded times are wrong.',
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
            steps(
              "Open Approvals and find the request under Leave.",
              "Tap Approve to accept it, with a 6-second Undo.",
              'To refuse, tap Review, then "Reject…". A reason is required.',
              "The review also links to the person's leave page.",
            ),
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
              'When someone works on a day off they leave an extra-work note. It appears under "Extra work" on Approvals. It has no Approve button, because you choose what it earns.',
            ),
            steps(
              "Tap Review on the note.",
              'Choose "Grant 1 day of comp leave", "Grant ½ day of comp leave" or "No comp leave".',
              'Tap "Grant comp leave", or "Mark reviewed" if you chose none.',
            ),
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
              'Expense claims sit under "Expenses" on Approvals. You see all of them. They are visible to you and to the person who made them, and to nobody else.',
            ),
            steps(
              "Open Approvals and find the claim under Expenses.",
              "Tap Approve for a 6-second Undo, or Review to look first.",
              'To refuse, tap Review, then "Reject…". A reason is required.',
            ),
            text(
              'Categories, and when a claim needs a receipt photo, are set in Settings under "Expenses".',
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
            text("Open People, tap the person, then the Leave tab."),
            steps(
              'To give comp leave, tap "Grant comp leave" and choose "How much".',
              'To take it back, tap "Revoke". A reason is required.',
              'On approved leave, tap "Edit" to change it ("Edit this leave").',
              'Tap "Cancel leave" to cancel it.',
            ),
            note("Nothing is deleted. A change adds a history entry beside the original."),
          ],
          link: { href: "/people", label: "Open People" },
          keywords: ["comp leave", "grant", "revoke", "cancel leave", "edit leave"],
        },
        {
          id: "owner-person-attendance",
          title: "Correct a person's attendance",
          summary: "Fix a recorded day from the Attendance tab.",
          blocks: [
            text(
              "Open People, tap the person, then the Attendance tab. It lists the month's days.",
            ),
            steps(
              "Find the day that is wrong.",
              'Tap "Correct…" on that day.',
              "Enter the right details and save.",
            ),
            note("The original stays in the history. A correction sits alongside it."),
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
              'Tasks opens on "Needs you": tasks waiting for your approval, suggested tasks to decide, and tasks that are overdue, have changes requested, or have not been noted. Below it, "Open tasks" are listed by deadline.',
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
            text("Tap New task (the round button on a phone). Fill in these fields."),
            steps(
              '"Start from": appears only if task templates exist. Pick one, or "No template".',
              '"Title" and "Type". An event type also asks for the event date, optional start and end times, a location if the type has one, and the purpose.',
              '"Priority": Low, Medium, High or Urgent.',
              '"Assign to": tap "Add a person" for each. Pick one as the primary owner. You can assign yourself too.',
              '"Deadline" and "Time (IST)" are required. "Reminders" use the default unless you change them.',
              '"Client label" or "No client", and "Checked first by": "Nobody: you approve it" or an Admin.',
              '"Description", optional "Stages", and any custom fields. Then tap "Create task".',
            ),
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
              `Every person on a task taps "Task Noted" to say they have seen it. Only the primary owner can mark it done. Pick the primary owner with the radio button beside a name in "Assign to".`,
            ),
            text(
              `For a freelancer, the coordinator notes the task and marks it done on their behalf.`,
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
            text(
              'In the task form, "Checked first by" lets you choose an Admin, or "Nobody: you approve it". With an Admin, the route is: Done, then the Admin checks, then you approve. Without one, it comes straight to you.',
            ),
            text("The Admin's check is skipped if that Admin is one of the people on the task."),
            text(
              'You can change the Admin later from the task\'s ⋯ menu with "Change approver", while the task is unfinished.',
            ),
          ],
          keywords: ["approver", "admin check", "route", "change approver"],
        },
        {
          id: "owner-task-stages",
          title: "Add and order a task's stages",
          summary: "Stages are a checklist inside a task.",
          blocks: [
            text(
              `Assignees tick stages as they work. Adding, removing and reordering stages is for you, the person who created the task, and its approving Admin. ${CREW} members never do this, even as primary owner. Ticks lock once the task is done.`,
            ),
            steps(
              'In the task form, tap "Add stage" under "Stages (optional)".',
              "Drag a stage to reorder it, or use Move up and Move down.",
              'Tap "Remove stage" to take one out.',
            ),
            note(
              "Stages can be set when you create the task, and managed later on the task page by those who may.",
            ),
          ],
          keywords: ["stages", "checklist", "reorder", "tick"],
        },
        {
          id: "owner-task-flow",
          title: "Follow a task from start to finish",
          summary: "Noted, worked on, marked done, checked, approved.",
          blocks: [
            text("The task page shows one next-step button at a time."),
            steps(
              '"Task Noted": each assignee taps it once.',
              '"Start work": optional.',
              '"Mark done": only the primary owner. They may add a note, and say why if it is late.',
              "Then the approving Admin checks it, if there is one.",
              "Then you approve it. Approval is always yours.",
            ),
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
              'Tap "Approve", then "Approve task". This is the final approval and the task is complete.',
              'Or tap "Request changes" and write "What needs to change?".',
              "The task goes back to the primary owner.",
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
            text(
              "If you are the primary owner, Mark done completes the task straight away. Nobody checks or approves it. The sheet reminds you of this before you confirm.",
            ),
          ],
          keywords: ["my tasks", "done", "primary owner"],
        },
        {
          id: "owner-remind",
          title: "Remind people on a task",
          summary: "Nudge everyone on a task, once an hour.",
          blocks: [
            text(
              'On the task page, tap Remind while the task is still with its people. Everyone on it gets a reminder. You can send one once an hour per task. While you wait, the button reads like "Reminded · again at 4:05 PM".',
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
              '"Decide it yourself": while an Admin check is still waiting, removes the Admin and brings it to you.',
              '"Edit task".',
              '"Reopen task": for finished tasks only.',
              '"Cancel task": needs a reason.',
              '"Change approver": on unfinished tasks.',
            ),
          ],
          keywords: ["edit", "cancel", "reopen", "change approver", "menu"],
        },
        {
          id: "owner-all-tasks",
          title: "Filter all tasks",
          summary: "Find any task by state, deadline, client, type or person.",
          blocks: [
            text(
              "All tasks lists every open task and the latest 300 finished ones. Use the filters, or the Search by title box.",
            ),
            steps(
              '"State" and "Deadline" (Overdue or Due today).',
              '"Client", "Type" and "Person".',
              '"Engagement": Employees or Freelancers.',
            ),
          ],
          link: { href: "/tasks/all", label: "Open All tasks" },
          keywords: ["search", "filter", "find task", "overdue"],
        },
        {
          id: "owner-suggested-tasks",
          title: "Decide a suggested task",
          summary: "Turn a suggestion into a task, or decline it.",
          blocks: [
            text(
              "Admins can suggest tasks. They appear on Suggested tasks under Waiting. Decided ones move to Decided.",
            ),
            steps(
              'To accept, tap "Make it a task". The form opens filled in.',
              'To refuse, tap "Decline suggestion" and give a reason under "Why not".',
            ),
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
            text("Each row has Review and Approve."),
            steps(
              "Tap Approve to decide at once.",
              "A toast appears with Undo. You have 6 seconds to take it back.",
              "Tap Review to see the details first. The sheet offers the extra actions for that kind of item.",
            ),
            text(
              'Review offers "Correct…" for attendance, "Reject…" for leave and expenses, and "Open the task" and "Request changes…" for tasks.',
            ),
          ],
          keywords: ["approve", "undo", "review", "reject"],
        },
        {
          id: "owner-approve-all",
          title: "Approve a whole group",
          summary: "Approve all N at once. There is no undo.",
          blocks: [
            text(
              'A group with more than one row has "Approve all N". It asks you to confirm, and says: "There is no undo for approving all at once."',
            ),
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
              "On a laptop the views are Day, Week and Month, opening on Month. Use the arrow keys to move, T for today, and D, W or M to switch view. On a phone there is no switch: swipe up or down, or use the handle, to change between a week strip, a compact month and a full month.",
            ),
            text('You see everything. Tap "Filters" to narrow by Client, Person, Type or Status.'),
          ],
          link: { href: "/calendar", label: "Open Calendar" },
          keywords: ["month", "week", "day", "filters"],
        },
        {
          id: "owner-calendar-day",
          title: "Open a day and add a task to it",
          summary: "See who is free and what is due, then add a task.",
          blocks: [
            text(
              'Tap a day. The day sheet shows "Who\'s free", what is due, events, and client items.',
            ),
            steps(
              "Tap a day on the calendar.",
              'Tap "+ New task on" the date at the bottom.',
              "The New task form opens on that date. After you create it, the task page opens.",
              'Tap "Calendar" to go back to the same view and day.',
            ),
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
              'People lists the team. Tap "Add person", choose Employee or Freelancer, and fill in Email, Full name, Role, Coordinator, Job title and an optional phone.',
            ),
            steps(
              'Tap "Add person".',
              'Choose "Who are you adding?".',
              'Fill in the details, then tap "Send invite" or "Add".',
            ),
          ],
          link: { href: "/people", label: "Open People" },
          keywords: ["invite", "add person", "employee", "freelancer", "role"],
        },
        {
          id: "owner-person-page",
          title: "Use a person's page",
          summary: "Profile, Leave, Attendance and Month tabs.",
          blocks: [
            text(
              'Open a person to see a "today" line and four tabs: Profile, Leave, Attendance and Month. The ⋯ menu has Edit, Change sign-in email, Change coordinator, Invite as employee, Copy invite link, Reactivate, and Deactivate or Revoke invite.',
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
              "Reports has two rows. Month shows each person's IST month, live. It does not show salary.",
            ),
          ],
          link: { href: "/reports/month", label: "Open Month" },
          keywords: ["month report", "attendance month"],
        },
        {
          id: "owner-report-eod",
          title: "Read the End of day report",
          summary: "Today and yesterday are live; older days are saved.",
          blocks: [
            text(
              "End of day shows how each day closed. Today and yesterday are live. Earlier days are saved the morning after.",
            ),
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
              'The list shows each client with its state and Admin. It opens on Active. Use "State" and "Admin" to filter, or "Search clients". "Client deliverables" at the top opens every client\'s open deliverables in one list.',
            ),
            text('A row\'s ⋯ menu has "Assign Admin" or "Change Admin".'),
          ],
          link: { href: "/clients", label: "Open Clients" },
          keywords: ["search", "filter", "client list"],
        },
        {
          id: "owner-new-client",
          title: "Add a new client",
          summary: "A new client starts as Draft until it has an Admin.",
          blocks: [
            text(
              'Tap "New client". Only "Client name" is required. You can choose an Admin now, or later. The client starts as Draft.',
            ),
            steps(
              'Tap "New client" and type the "Client name".',
              "Optionally pick an Admin and fill in the company's client fields.",
              "Save, then add contacts and details on the client's page.",
              "Assign an Admin, then Activate the client.",
            ),
            note("A Draft client cannot start work. Assign an Admin first, then activate."),
          ],
          link: { href: "/clients", label: "Open Clients" },
          keywords: ["draft", "add client", "onboard"],
        },
        {
          id: "owner-assign-admin",
          title: "Assign an Admin to a client",
          summary: "The Admin runs the client and sees only their own clients.",
          blocks: [
            text(
              "Each client belongs to one Admin. That Admin sees the client and its work. Other Admins cannot open it.",
            ),
            steps(
              "Open the client's ⋯ menu, on the list or on the client page.",
              'Tap "Assign Admin", or "Change Admin" if one is set.',
              "Choose the Admin and save.",
            ),
          ],
          keywords: ["admin", "assign", "change admin", "owner of client"],
        },
        {
          id: "owner-client-states",
          title: "Move a client between states",
          summary: "Activate, Pause, Close and Reactivate, and what each means.",
          blocks: [
            text("A client is Draft, Active, Paused or Inactive. You move it from the ⋯ menu."),
            steps(
              'Draft to Active: "Activate". It is offered only once an Admin is assigned.',
              'Active to Paused with "Pause", or to Inactive with "Close".',
              'Paused to Active with "Activate", or to Inactive with "Close".',
              'Inactive to Active with "Reactivate".',
            ),
            note(
              "Paused: everything stays editable, but recurring projects make no new cycles. Inactive: still searchable and editable, but no new projects, deliverables or client-labelled tasks until you reactivate. Only the Owner can change a state.",
            ),
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
              "Open a contact to edit it.",
              'Archiving the primary contact asks for the "Next primary contact".',
              'An archived contact has "Restore".',
            ),
          ],
          keywords: ["contact", "primary contact", "archive"],
        },
        {
          id: "owner-client-page",
          title: "Read a client's page and your private notes",
          summary: "Overview, Projects, Brand and Activity.",
          blocks: [
            text(
              'A client page has the tabs Overview, Projects, Brand and Activity. Overview shows the Admin, the primary contact, details, and "Requirements and notes". Activity is the client\'s history, newest first.',
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
              'On the client\'s Projects tab, tap "New project". How often it repeats cannot change later. Everything else stays editable.',
            ),
            steps(
              '"Start from" (if templates exist): pick a template, then change anything.',
              '"Project name" is required. "Repeats": One-time, Weekly or Monthly (Monthly is the default).',
              'One-time projects also need a "Delivery date" that is not in the past.',
              '"Default stage groups": optional. A deliverable without its own stages starts with these.',
              '"Deliverables" (or "Deliverables list" for repeating projects), then "Description" and custom fields.',
              'Check the preview, then tap "Create project".',
            ),
            note(
              'You cannot add a project to an Inactive client. The button is replaced by "No new projects on an Inactive client."',
            ),
          ],
          link: { href: "/clients", label: "Open Clients" },
          keywords: ["new project", "repeats", "monthly", "weekly", "one-time", "delivery date"],
        },
        {
          id: "owner-start-from-template",
          title: "Start a project from a template",
          summary: "Search and preview templates before you use one.",
          blocks: [
            text(
              'Use "Start from" to pick a template, or tap "Search and preview templates" for the library. It lists templates with a summary like "Monthly · 6 deliverables · 72 stages".',
            ),
            steps(
              'Tap "Search and preview templates".',
              'Search by "Name or deliverable".',
              "Tap Preview on a row to see what it contains.",
              'Tap "Use this template", or Back to keep looking.',
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
            text(
              'In the "Add deliverables" box, type a "Deliverable name" and "How many" (1 to 100). Reel × 4 makes Reel 1 to Reel 4. × 1 keeps the name as you typed it.',
            ),
            steps(
              'Type the "Deliverable name".',
              'Set "How many".',
              "Optionally tick one or more stage presets. Each becomes one stage group, in the order you tick them. With none ticked, the default stages apply.",
              'Tap "Add".',
            ),
            text(
              "Each deliverable's ⋯ menu has Move up, Move down, Duplicate and Remove. A project holds at most 100 deliverables.",
            ),
          ],
          keywords: ["add deliverables", "how many", "reel", "post", "preset"],
        },
        {
          id: "owner-own-stages",
          title: "Give one deliverable its own stages",
          summary: "Open a deliverable in the form and edit its stages.",
          blocks: [
            text(
              'A row says "Uses the default stages" or "Own stages · n groups · m stages". Open it with the arrow.',
            ),
            steps(
              "Open the deliverable row.",
              'Tap "Give it its own stages".',
              "Edit the groups and stages. Changes apply to this deliverable only.",
              'Tap "Use the default stages instead" to go back.',
            ),
          ],
          keywords: ["own stages", "default stages", "customise"],
        },
        {
          id: "owner-live-preview",
          title: "Check the live preview",
          summary: "See what Create will make before anything is saved.",
          blocks: [
            text(
              'On a laptop the preview sits beside the form. On a phone, tap "Preview" to open it as a step. It says "What Create makes". Nothing is saved until you create.',
            ),
            text(
              'The top shows three figures: deliverables, groups and stages. Each card is tagged "Default stages" or "Own stages". Identical neighbours collapse, so "Reel 1–4" shows as one card with "×4"; tap it to see the names.',
            ),
            text(
              'Tap "Back to edit" to return to the form. Closing after changes asks "Discard this project?".',
            ),
          ],
          keywords: ["preview", "default stages", "own stages", "collapse"],
        },
        {
          id: "owner-project-page",
          title: "Read the project page",
          summary: "Cycles, the progress ring and the deliverable rows.",
          blocks: [
            text(
              'The header shows the name, repeat and delivery date, with an Activity button and a ⋯ menu. Use the arrows to move between cycles. A one-time project shows "The project\'s deliverables".',
            ),
            text(
              'The ring shows a percentage, with a line such as "12 of 18 stages · 3 of 7 deliverables done". Pace reads "On track", or "N behind plan" in red. At 100% it says the cycle is complete. Closed and carried deliverables are not counted.',
            ),
            text(
              'Rows show a planned date in words: "Planned 21 Oct", "Planned today", "Planned 18 Oct · 2 days late" or "Not planned". Stage chips are filled when ticked, outlined when next, and dashed when still to do. Finished ones sit in the collapsed "Done and closed (N)".',
            ),
          ],
          keywords: ["progress", "ring", "pace", "planned", "overdue", "stage chips"],
        },
        {
          id: "owner-add-deliverable",
          title: "Add a deliverable to this month",
          summary: "Add one to the running cycle only.",
          blocks: [
            text(
              'On the project page, tap "Add deliverable". Fill in Title, an optional "Planned date", and Notes. "Start from" can use a deliverable template for its stages; the default is "The project\'s default stages".',
            ),
            note(
              'It joins this cycle only. "The deliverables list stays as it is", so next month will not include it unless you add it to that list.',
            ),
          ],
          keywords: ["add deliverable", "extra", "this cycle"],
        },
        {
          id: "owner-deliverable-sheet",
          title: "Work in a deliverable's sheet",
          summary: "Tick stages, edit, mark done, send back or close.",
          blocks: [
            text(
              "Tap a deliverable to open its sheet. It shows Planned, From and History, and the stages under their group headings. You can tick or untick stages only while it is open.",
            ),
            steps(
              "Tick stages as the work moves on.",
              '"Edit stages" changes the stages of this deliverable only.',
              '"Edit" changes the title, notes, and the planned date while it is open.',
              'The ⋯ menu has "Save as template".',
            ),
            text('"Last change" has a History button that shows who changed what, and when.'),
          ],
          keywords: ["sheet", "tick", "history", "edit stages"],
        },
        {
          id: "owner-mark-done",
          title: "Mark a deliverable done",
          summary: "Done is the approval. It counts straight away.",
          blocks: [
            text(
              'On an open deliverable, tap "Mark done". There is no separate approval step for client work: marking it done is the approval. It locks the ticks and counts at once. A toast gives you 6 seconds to Undo.',
            ),
            steps(
              'Tap "Mark done" on the row or in the sheet.',
              'Watch for the toast "Marked … done".',
              "Tap Undo within 6 seconds if it was a mistake.",
            ),
            note("Approvals does not list deliverables. Do this on the project."),
          ],
          keywords: ["done", "approve", "undo", "complete deliverable"],
        },
        {
          id: "owner-send-back",
          title: "Send a done deliverable back",
          summary: "Return it to open with a reason.",
          blocks: [
            text(
              'On a done deliverable, tap "Send back…". It asks "What needs to change". The deliverable returns to open and stops counting as done until it is done again.',
            ),
          ],
          keywords: ["send back", "reopen", "rework", "return"],
        },
        {
          id: "owner-close-deliverable",
          title: "Close a deliverable",
          summary: "Drop it from the cycle with a reason. This cannot be undone.",
          blocks: [
            text(
              'On an open or done deliverable, tap "Close deliverable…". It asks "Why close it". It stays in the cycle as closed, not done, and is not counted in progress.',
            ),
            note(
              "Closing cannot be undone. If you only want to redo the work, use Send back instead.",
            ),
          ],
          keywords: ["close", "drop", "cancel deliverable"],
        },
        {
          id: "owner-bulk",
          title: "Mark or tick several at once",
          summary: "Select rows, then mark done or tick one stage on all.",
          blocks: [
            text("Select several open rows on the project page. Two bulk actions appear."),
            steps(
              "Select the rows.",
              '"Mark N done" asks "Mark N items done?" first.',
              'Or "Tick a stage" and choose a stage, to "Tick ‹stage› on N".',
            ),
          ],
          keywords: ["bulk", "select", "many", "tick stage"],
        },
        {
          id: "owner-project-activity",
          title: "Read a project's Activity",
          summary: "Every change to the project, newest first.",
          blocks: [
            text(
              'Tap Activity in the project header. Filter by All, Deliverables, Stages or Project. It shows the latest 20, then "Show older".',
            ),
          ],
          keywords: ["history", "audit", "who changed"],
        },
        {
          id: "owner-project-state",
          title: "Complete, cancel or reopen a project",
          summary: "Use the project's ⋯ menu.",
          blocks: [
            text(
              'The ⋯ menu also has "Edit details", "Default stages", "Deliverables list" for repeating projects, and "Save as template".',
            ),
            steps(
              '"Complete project" when the work is finished.',
              '"Cancel project…" needs a reason.',
              '"Reopen project…" brings a completed or cancelled project back.',
            ),
            note(
              'A completed or cancelled project is read-only: "Reopen it from ⋯ to change anything."',
            ),
          ],
          keywords: ["complete", "cancel", "reopen", "read-only", "finish project"],
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
              "Or open the ⋯ menu and choose Move up or Move down.",
              'To delete, use "Remove stage", or "Remove group" (it confirms, and its stages go with it).',
            ),
            note("A stage moves within its own group. The limit is 100 stages in a list."),
          ],
          keywords: ["drag", "long press", "move up", "move down", "remove", "limit"],
        },
        {
          id: "owner-default-stages",
          title: "Change a project's default stages",
          summary: "New deliverables start with them. Old ones never change.",
          blocks: [
            text(
              'Open "Default stages" from the project\'s ⋯ menu. New deliverables start with these. Existing deliverables keep their own stages, so a change never touches them.',
            ),
            text("Removing a stage from a deliverable keeps its tick in the history."),
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
              "In Settings, open Stage presets. A preset is a flat list of stages with a name. Tap to add one, name it (up to 80 characters), and list the stages in order, up to 100.",
            ),
            steps(
              'Open Stage presets and tap to add ("Add a stage preset").',
              "Type the Name and the stages in order. Drag or use Move to reorder.",
              'Tap "Add preset" or "Save preset".',
            ),
            note(
              'Archiving a preset stops "New project" offering it. Projects that used it keep their stages. "Restore" brings it back.',
            ),
          ],
          link: { href: "/settings/stage-presets", label: "Open Stage presets" },
          keywords: ["preset", "checklist", "archive", "restore"],
        },
        {
          id: "owner-project-template",
          title: "Build a project template",
          summary: "A reusable project: repeat, stage groups and deliverables.",
          blocks: [
            text(
              'In Settings, open Templates and add a project template. It has a Name, Repeats, "Default stage groups", "Deliverables" (with × N, and a deliverable-template picker), a Description and project field defaults.',
            ),
            text(
              'A preview shows beside the form on a laptop. On a phone, tap "Preview". Then tap "Add template" or "Save template".',
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
              'Add a deliverable template with a Name and its "Stage groups". A preview shows as you build. Archiving asks "Why archive it".',
            ),
            text(
              "Use one when you repeat a kind of deliverable, such as a reel with the same steps every time.",
            ),
          ],
          link: { href: "/settings/templates", label: "Open Templates" },
          keywords: ["deliverable template", "reel", "post"],
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
              'The toast "Saved as the template …" has an "Open templates" action.',
            ),
            text(
              "A project template keeps its default stage groups and deliverables with their stages. A deliverable template keeps its stage groups, with no ticks or dates. The original stays as it is.",
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
              'Settings, Stage presets: add a preset for each kind of checklist, such as "Shoot prep".',
              "Settings, Templates: add a deliverable template for Reel and one for Post, using those presets.",
              'Add a project template called "Monthly retainer", with Repeats set to Monthly and the deliverables Reel × 4 and Post × 2.',
              'Open the client, then Projects, then "New project". Under "Start from", pick "Monthly retainer". Check the preview, then "Create project".',
              'Adjust this month: "Add deliverable" for a one-off, or "Edit stages" on a deliverable. This changes this month only.',
              "Each month a new cycle appears, with the deliverables list copied in.",
              'At month end, decide what is unfinished on "Unfinished deliverables".',
              'After a good month, use "Save as template" on the project so the next client starts from it.',
            ),
            example(
              "Sample Client has a Monthly retainer: Reel 1 to Reel 4 and Post 1 and Post 2. In this month's cycle you add one extra Reel with Add deliverable. Next month's cycle still starts with the usual six.",
            ),
            note(
              "A project template's deliverables are built in the template builder. In New project you pick the template through Start from; New project itself has no deliverable-template picker.",
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
              'You get a "cycle ready" notice at 8:00 AM. A repeating project also gets its current period\'s cycle as soon as you create it.',
            ),
          ],
          keywords: ["new cycle", "automatic", "paused", "00:00", "1st"],
        },
        {
          id: "owner-start-early",
          title: "Start next month early",
          summary: "Name next month's deliverables before the month begins.",
          blocks: [
            text(
              'Open the project\'s ⋯ menu and tap "Start" followed by the period, such as the next month. It confirms with "Start … now?". The cycle starts with the deliverables list, so you can name the deliverables ahead.',
            ),
            text("It is offered only shortly before the period begins (up to 7 days early)."),
          ],
          keywords: ["start early", "next month", "ahead"],
        },
        {
          id: "owner-deliverables-list",
          title: "Edit the deliverables list",
          summary: "What every new month starts with.",
          blocks: [
            text(
              'Open "Deliverables list" from a repeating project\'s ⋯ menu. It has one row per line. Each line has "Stages" and can be added with × N. Every month starts with these, from the next period.',
            ),
            steps(
              'Open "Deliverables list".',
              "Add lines with × N, or rename them.",
              'Tap "Stages" on a line to set its stages.',
            ),
            note('To add something to the running month only, use "Add deliverable" instead.'),
          ],
          keywords: ["deliverables list", "every month", "lines"],
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
              "Select the deliverables, or none to act on all rows.",
              '"Carry N forward" moves them into the next cycle.',
              '"Leave N pending" leaves them where they are.',
              '"Close…" on a row closes it. It asks "Why close it".',
            ),
            note(
              'On an Inactive client, Carry forward is hidden: close them or leave them pending. If the client is not Active, the next cycle takes only carried deliverables. Empty screen: "Nothing to decide."',
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
              "Client deliverables shows every client's open deliverables, grouped by Admin, with \"No Admin (yours)\" for clients without one. Filter by Open or Overdue, and by client or project. Tap a row to open the project on that deliverable's cycle.",
            ),
            text(
              'Today shows "N client items overdue" in red when any are late. Tap it to open this list filtered to overdue.',
            ),
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
              "Company: the company name and the timezone everything runs on.",
              "Days off & holidays: weekly off days and the holiday list.",
              "Thresholds: reminders, escalations, the logout nudge and the email cap.",
              "Notifications: who cannot be reached by push, and why.",
              "Expenses: expense categories and when a claim needs a receipt photo.",
              "Job titles: the titles people can be given.",
              "Task types: the kinds of task, their order and what each asks for.",
              "Stage presets: reusable stage checklists.",
              "Custom fields: extra fields on clients and contacts.",
              "Templates: project, deliverable and task templates for work that repeats.",
            ),
            text(
              "Admins can open Notifications, Job titles, Stage presets, Custom fields and Templates. The rest are yours alone.",
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
            text("Thresholds holds the timings that drive reminders. You can change:"),
            steps(
              '"Acknowledgement reminder (hours)".',
              '"Escalate to the Admin after (hours)" and "Escalate to the Owner after (hours)".',
              '"Overdue escalation (hours)" and "Workload warning (tasks due that day)".',
              '"End-of-day reminder" and "Late End day until".',
              '"Quiet from" and "Quiet until", and "Email cap per person per day".',
            ),
            text("There are also thresholds for client work on the same screen."),
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
          ],
          link: { href: "/settings/job-titles", label: "Open Job titles" },
          keywords: ["job title", "designer", "editor", "role"],
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
          ],
          link: { href: "/settings/days-off", label: "Open Days off" },
          keywords: ["holiday", "weekly off", "sunday", "day off"],
        },
      ],
    },
    {
      id: "notifications",
      title: "Notifications",
      topics: [
        {
          id: "owner-alerts",
          title: "Use the Alerts screen",
          summary: "Every notification, one tap from what it is about.",
          blocks: [
            text(
              'Alerts lists your notifications, grouped by day, 20 to a page. Switch between All and Unread, and tap "Mark all read". Tap one to open what it is about. The back control then reads "Alerts".',
            ),
            text('Empty states read "Nothing yet" and "You\'re all caught up".'),
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
              'It then says "Notifications are on for this device".',
            ),
            text(
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
          "Almost every button is yours as the Owner. If one is missing, it usually depends on the step the item is at. A completed project is read-only until you Reopen it. Mark done shows only on open deliverables. Approve on a task appears only after the primary owner marks it done. On the client side, there is no New project on an Inactive client, and Activate appears only once an Admin is assigned. If the button should be there and is not, reload the app from Me.",
        ),
        ...COMMON_HELP_TOPICS,
      ],
    },
  ],
};
