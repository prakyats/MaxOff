import { ROLE_LABELS } from "@/core/lib/role-labels";

import type { Guide } from "../types";
import { COMMON_HELP_TOPICS, missingButtonTopic } from "./common";

const CREW = ROLE_LABELS.staff;

/** The Admin's guide: only what an Admin can see and do (ROADMAP 6b.14). */
export const ADMIN_GUIDE: Guide = {
  role: "admin",
  sections: [
    {
      id: "getting-around",
      title: "Getting around",
      topics: [
        {
          id: "admin-navigation",
          title: "Find your way around",
          summary:
            "Move between screens with the sidebar on a laptop or the bottom bar on a phone.",
          blocks: [
            {
              kind: "text",
              text: "On a laptop the sidebar lists Today, Approvals, Clients, Tasks, Calendar, People, Reports and Settings. On a phone the bottom bar shows Today, Approvals, Tasks and Calendar, and a More cell holds the rest. With very large text set on the phone, the bar shows its icons only.",
            },
            {
              kind: "steps",
              steps: [
                { text: "Open Today. It is the first screen.", shot: "admin/today" },
                "On a phone, tap More in the bottom bar.",
                "Pick Reports, Clients, People or Settings.",
                "Tap the Me row at the bottom of the sheet for your own page.",
              ],
            },
            {
              kind: "next",
              text: "The screen you picked opens. A number on a tab or on More counts what is waiting for you.",
            },
            {
              kind: "note",
              text: "There is no tab for your own leave. It lives on Me, under Attendance & leave.",
            },
            {
              kind: "text",
              text: "On a phone each screen has one bar at the top: the back arrow (or, on a main tab, the small MaxOff “M”, which takes you to your home screen), the title, the screen's ⋯ menu when it has one, and the bell. A ⋯ menu opens as a sheet from the bottom; back closes it.",
            },
          ],
          link: { href: "/today", label: "Open Today" },
          keywords: ["menu", "sidebar", "more", "navigation", "tabs", "title bar", "sheet"],
        },
        {
          id: "admin-bell-me",
          title: "The bell and Me",
          summary: "Open your alerts and your own page.",
          blocks: [
            {
              kind: "text",
              text: "The bell sits in the title bar on a phone and in the top bar on a laptop. Your own Attendance & leave and Extra work & expenses are in the sidebar on a laptop and under More on a phone (and on Me). Me holds your own page: Notifications, Your devices and Help & troubleshooting. Help, this guide, is also in the account menu (your name, top right) and at the foot of the sidebar.",
            },
            {
              kind: "steps",
              steps: [
                "Tap the bell to open Alerts.",
                "Tap Me (in the More sheet on a phone).",
                "Pick the row you need, for example Attendance & leave.",
              ],
            },
            {
              kind: "next",
              text: "The bell shows how many alerts are unread. The row you picked opens its screen.",
            },
            {
              kind: "note",
              text: "Your own attendance, leave and devices are all on Me, not in the sidebar.",
            },
          ],
          link: { href: "/me", label: "Open Me" },
          keywords: ["profile", "bell", "alerts", "me"],
        },
      ],
    },
    {
      id: "today",
      title: "Today",
      topics: [
        {
          id: "admin-today-overview",
          title: "Read your Today screen",
          summary: "See what needs you now, from your own day down to the work you run.",
          blocks: [
            {
              kind: "text",
              text: "Today updates by itself. The order is: your attendance strip, Needs you, Client work, My tasks, My clients, This week and Issues.",
            },
            {
              kind: "steps",
              steps: [
                "Start with the attendance strip at the top: it is your own day.",
                {
                  text: "Open Needs you (highlighted) and clear what is waiting for your check.",
                  shot: "admin/today",
                },
                "Look at Client work and My clients for deliverables due soon.",
                "Check My tasks, then This week for what is coming.",
              ],
            },
            {
              kind: "next",
              text: "As you clear things, they leave the list. The screen updates by itself.",
            },
            {
              kind: "note",
              text: "Today answers one question: what needs me now? Anything not on it can wait.",
            },
          ],
          link: { href: "/today", label: "Open Today" },
          keywords: ["home", "dashboard", "first screen"],
        },
        {
          id: "admin-today-needs-you",
          title: "What “Needs you” holds",
          summary: "Tasks to check, suggestions to decide and late work.",
          blocks: [
            {
              kind: "text",
              text: "Needs you lists tasks waiting for your check, suggested tasks to decide, unfinished deliverables to decide and tasks flagged Overdue or Not noted.",
            },
            {
              kind: "steps",
              steps: [
                "Open Today.",
                "Find the Needs you list.",
                "Tap a line to go straight to it.",
              ],
            },
            {
              kind: "example",
              text: "“2 tasks waiting for your check” opens Approvals. “1 suggested task to decide” opens Suggested tasks.",
            },
            {
              kind: "next",
              text: "The line you tap opens the screen where you can act. When nothing is left it says “Nothing needs you right now.”",
            },
            {
              kind: "note",
              text: "A line stays until you have dealt with it.",
            },
          ],
          link: { href: "/approvals", label: "Open Approvals" },
          keywords: ["needs you", "waiting", "overdue", "not noted"],
        },
        {
          id: "admin-today-other",
          title: "Client work, My tasks, This week and Issues",
          summary: "What each lower section on Today shows.",
          blocks: [
            {
              kind: "text",
              text: "Client work lists deliverables on your clients that are overdue or due this week. Each row offers “Next: ‹stage›”, which ticks that stage with Undo, until every stage is ticked; then it offers Mark done. My clients is the clients you run; one that is not Active shows its state beside its name (for example “· Paused”). My tasks shows your own tasks that are not noted, have changes requested, are overdue or are due today. This week is a strip of the next days. Issues appears only when something is wrong on a task you created or check: an assignee on leave on a deadline day, or someone who can’t be reached.",
            },
            {
              kind: "note",
              text: "Issues covers only your own tasks. It is hidden when there is nothing to show.",
            },
          ],
          link: { href: "/today", label: "Open Today" },
          keywords: ["issues", "this week", "my tasks", "my clients"],
        },
      ],
    },
    {
      id: "attendance-leave",
      title: "Your attendance and leave",
      topics: [
        {
          id: "admin-start-end-day",
          title: "Start and end your day",
          summary: "Mark when you begin and finish work.",
          blocks: [
            {
              kind: "text",
              text: "Your attendance strip has one button. On an approved leave day it reads “I’m working today”, and on a day off “I worked today”.",
            },
            {
              kind: "steps",
              steps: [
                "Open Today.",
                "Tap Start day when you begin work.",
                "When you finish, tap End day.",
                "Read “End your day?” and confirm. It is final.",
                "Answer “Any expenses to claim today?” with No or Yes.",
              ],
            },
            {
              kind: "next",
              text: "Your day is recorded. The Owner decides attendance.",
            },
            {
              kind: "note",
              text: "Only the Owner decides attendance. You never decide anyone else’s day, and your own is never overwritten: a correction sits beside the original.",
            },
          ],
          link: { href: "/leave/attendance", label: "See your attendance" },
          keywords: ["attendance", "check in", "start day", "end day", "working"],
        },
        {
          id: "admin-request-leave",
          title: "Ask for leave",
          summary: "Ask for a full day, a half day or comp leave.",
          blocks: [
            {
              kind: "text",
              text: "Your leave is on Me, under Attendance & leave.",
            },
            {
              kind: "steps",
              steps: [
                "Open Me, then Attendance & leave.",
                "On the Leave requests tab, tap Request leave.",
                "Choose the Kind of leave: Leave, Half day or Comp leave.",
                "Pick the Date, or the First day and Last day.",
                "Add a reason if you like (it is optional) and send it.",
              ],
            },
            {
              kind: "next",
              text: "The request shows as Waiting. The Owner approves or declines it, and you can withdraw it while it waits.",
            },
            {
              kind: "note",
              text: "Comp leave appears in the list only when you have credit to use.",
            },
          ],
          link: { href: "/leave", label: "Open Attendance & leave" },
          keywords: ["holiday", "time off", "half day", "comp leave", "vacation"],
        },
        {
          id: "admin-change-leave",
          title: "Change or take back a request",
          summary: "Change, withdraw or ask to cancel a leave request.",
          blocks: [
            {
              kind: "text",
              text: "Change edits a request. Withdraw takes back a request that is still waiting. Ask to cancel asks the Owner to cancel leave that was already approved.",
            },
            {
              kind: "steps",
              steps: [
                "Open Me, then Attendance & leave.",
                "Find the request on the Leave requests tab.",
                "Tap Change, Ask to cancel or Withdraw.",
                "Confirm.",
              ],
            },
            {
              kind: "example",
              text: "Waiting means the Owner has not decided. Approved and Not approved are the Owner’s decision. Withdrawn is you taking it back. Replaced means a change took its place. Cancelled means the leave was cancelled.",
            },
            {
              kind: "next",
              text: "The status word on the row updates.",
            },
            {
              kind: "note",
              text: "Each request row shows only what you can do next.",
            },
          ],
          link: { href: "/leave", label: "Open Attendance & leave" },
          keywords: ["withdraw", "cancel leave", "status", "waiting", "approved"],
        },
        {
          id: "admin-extra-work-expenses",
          title: "Extra work and your own expenses",
          summary: "Note overtime and claim your own expenses from Me.",
          blocks: [
            {
              kind: "text",
              text: "Me has a row called Extra work & expenses, with two tabs: Extra work and Expenses.",
            },
            {
              kind: "steps",
              steps: [
                "Open Me, then Extra work & expenses.",
                "Choose the Extra work or Expenses tab.",
                "Add your entry and send it.",
              ],
            },
            {
              kind: "next",
              text: "Watch the status on the row. The Owner decides every entry.",
            },
            {
              kind: "note",
              text: "You see only your own entries.",
            },
          ],
          link: { href: "/leave/extra-work", label: "Open Extra work & expenses" },
          keywords: ["overtime", "expenses", "claim", "extra work"],
        },
      ],
    },
    {
      id: "tasks",
      title: "Tasks",
      topics: [
        {
          id: "admin-tasks-screen",
          title: "The Tasks screen",
          summary: "See what needs you, then every open task by deadline.",
          blocks: [
            {
              kind: "text",
              text: "Needs you comes first: tasks waiting for your check, suggested tasks to decide, and tasks flagged Overdue, Changes requested or Not noted. Open tasks follows, ordered by deadline. Two links take you deeper: “All tasks, with filters” and Suggested tasks.",
            },
          ],
          link: { href: "/tasks", label: "Open Tasks" },
          keywords: ["task list", "open tasks", "deadline"],
        },
        {
          id: "admin-new-task",
          title: "Create a task",
          summary: "Make a task and give it to people.",
          blocks: [
            {
              kind: "text",
              text: "New task asks for the Title, Assign to, and the Deadline and Time (IST) first. Everything else is under More options: Start from (only if task templates exist), Type (the first by default; an event type opens More options by itself), Priority (Medium by default), Reminders, Client label, Description, Stages and any custom fields.",
            },
            {
              kind: "steps",
              steps: [
                "Open Tasks and tap New task.",
                "Optionally pick a template under Start from.",
                "Enter the Title, then choose the Type and Priority.",
                {
                  text: 'Add people under "Assign to" (highlighted) and choose the primary owner.',
                  shot: "admin/new-task",
                },
                "Set the Deadline and Time (IST).",
                `Add a Client label only if it helps. ${CREW} never see client records.`,
                "Tap Create task.",
              ],
            },
            {
              kind: "next",
              text: "The new task opens. Everyone you assigned is asked to note it.",
            },
            {
              kind: "note",
              text: "Stages can be added only while you create the task. After that you can still add, remove and reorder them from the task page.",
            },
          ],
          link: { href: "/tasks", label: "Open Tasks" },
          keywords: ["new task", "assign", "deadline", "priority", "type", "reminders"],
        },
        {
          id: "admin-task-people",
          title: "Primary owner and Task Noted",
          summary: "Who notes a task and who marks it done.",
          blocks: [
            {
              kind: "text",
              text: "Everyone you assign must note the task: they tap Task Noted. Only the primary owner marks it done. Pick the primary owner with the radio button beside a name. The form warns you if someone is busy that day or on leave.",
            },
            {
              kind: "example",
              text: "You assign a Designer and an Editor, and make the Designer the primary owner. Both tap Task Noted. Only the Designer can tap Mark done.",
            },
            {
              kind: "note",
              text: "A freelancer’s coordinator notes the task and marks it done for them.",
            },
          ],
          keywords: ["acknowledge", "task noted", "primary owner", "assignee"],
        },
        {
          id: "admin-task-route",
          title: "From done to approved",
          summary: "You check a finished task, then the Owner approves it.",
          blocks: [
            {
              kind: "text",
              text: "When the primary owner taps Mark done, the task goes to review and is locked. Tasks you check come to you first.",
            },
            {
              kind: "steps",
              steps: [
                "The primary owner taps Mark done and may add a note.",
                "If the task is late, they also say why.",
                "You check it and approve it or ask for changes.",
                "The Owner gives the final approval.",
              ],
            },
            {
              kind: "next",
              text: "After your check the task goes to the Owner, who gives the final approval.",
            },
            {
              kind: "note",
              text: "If you are one of the assignees, your check is skipped and the task goes straight to the Owner.",
            },
          ],
          keywords: ["approve", "approval route", "review", "done"],
        },
        {
          id: "admin-check-tasks",
          title: "Check a finished task",
          summary: "Approve a finished task or send it back with Request changes.",
          blocks: [
            {
              kind: "text",
              text: "Approvals shows one group for you: Tasks to check. Each row has Review and Approve.",
            },
            {
              kind: "steps",
              steps: [
                "Open Approvals.",
                "Tap Review to read the task first.",
                { text: 'Tap "Approve" (highlighted) if it is fine.', shot: "admin/approvals" },
                "To send it back, tap Request changes and say what needs to change.",
              ],
            },
            {
              kind: "next",
              text: "Approve works at once and shows a 6-second Undo. An approved task goes to the Owner. A task sent back returns to its people.",
            },
            {
              kind: "note",
              text: "The Undo is on Approvals and on Today. On the task page itself there is no Undo.",
            },
          ],
          link: { href: "/approvals", label: "Open Approvals" },
          keywords: ["tasks to check", "approve", "undo", "request changes"],
        },
        {
          id: "admin-task-stages",
          title: "Stages on a task",
          summary: "Add, remove and reorder a task’s stages.",
          blocks: [
            {
              kind: "text",
              text: "Assignees tick stages as they go. The ticks lock once the task is marked done.",
            },
            {
              kind: "steps",
              steps: [
                "Open the task.",
                "Add a stage, or open the menu on a stage to Remove it.",
                {
                  text: "Use Move up and Move down to reorder, or drag the handle (highlighted).",
                  shot: "admin/task-stages",
                },
              ],
            },
            {
              kind: "next",
              text: "The stages show in the new order for everyone on the task.",
            },
            {
              kind: "note",
              text: `You may change stages on a task you created or approve, and so may the Owner. ${CREW} never can, even as primary owner.`,
            },
          ],
          keywords: ["stages", "checklist", "reorder", "tick"],
        },
        {
          id: "admin-task-actions",
          title: "Edit, reopen or cancel a task",
          summary: "Use the ⋯ menu on tasks you created or approve.",
          blocks: [
            {
              kind: "text",
              text: "The ⋯ menu (Task actions) offers Edit task, Reopen task on a finished task, and Cancel task. These appear only on tasks you created or approve.",
            },
            {
              kind: "steps",
              steps: [
                "Open the task and tap ⋯.",
                "Choose Edit task, Reopen task or Cancel task.",
                "For Cancel task, give a reason.",
              ],
            },
            {
              kind: "next",
              text: "The task changes and the change is added to its history.",
            },
            {
              kind: "note",
              text: 'Nothing is deleted. A cancelled task stays in the history with its reason. A reopened task goes back to its people, and its old hand-in folds away under "Earlier hand-in · reopened ‹date›: ‹reason›" in Work.',
            },
          ],
          keywords: ["edit task", "cancel task", "reopen task"],
        },
        {
          id: "admin-task-remind",
          title: "Remind the people on a task",
          summary: "Nudge everyone on a task, once an hour.",
          blocks: [
            {
              kind: "text",
              text: "Remind appears on the task page of a task you created or check, while the task is with its people and someone else is on it. It names whom it reaches, such as “Remind Sam and Ria” or “Remind Sam and 2 others”; when the names are not known it reads “Remind everyone on the task”.",
            },
            {
              kind: "steps",
              steps: ["Open the task.", "Tap Remind ‹names›."],
            },
            {
              kind: "example",
              text: "After you send a reminder the toast says “Reminder sent to Sam and Ria” and the button reads “Reminded · again at 4:05 pm”. You can send the next one then. The reminder is a notification, not a chat message: Activity reads “sent Sam and Ria a reminder”.",
            },
            {
              kind: "next",
              text: "Each of them gets a push and a note in the app.",
            },
            {
              kind: "note",
              text: "You can send one reminder an hour.",
            },
          ],
          keywords: ["remind", "nudge", "reminder"],
        },
        {
          id: "admin-all-tasks",
          title: "All tasks and its filters",
          summary: "Find any open task, or a recently finished one.",
          blocks: [
            {
              kind: "text",
              text: "All tasks shows every open task and the latest finished ones.",
            },
            {
              kind: "steps",
              steps: [
                "Open Tasks, then All tasks, with filters.",
                "Pick a filter: State, Deadline (Overdue or Due today), Client, Type, Person or Engagement (Employees or Freelancers).",
                "Or type in Search by title.",
                "Tap a row to open the task.",
              ],
            },
            {
              kind: "next",
              text: "The list narrows to match.",
            },
          ],
          link: { href: "/tasks/all", label: "Open All tasks" },
          keywords: ["filter", "search", "overdue", "person"],
        },
        {
          id: "admin-suggested-tasks",
          title: "Suggested tasks",
          summary: "Turn a suggestion into a task, or decline it.",
          blocks: [
            {
              kind: "text",
              text: "People can suggest tasks. You can also suggest a task yourself.",
            },
            {
              kind: "steps",
              steps: [
                "Open Tasks, then Suggested tasks.",
                "To accept, tap Make it a task. The New task form opens filled in.",
                "Review it and tap Create task.",
                "To refuse, tap Decline suggestion and say why not.",
              ],
            },
            {
              kind: "next",
              text: "Suggestions wait under Waiting and move to Decided once you act.",
            },
            {
              kind: "note",
              text: "When you decline, say why not. The person who suggested it can read it.",
            },
          ],
          link: { href: "/tasks/requests", label: "Open Suggested tasks" },
          keywords: ["request", "suggestion", "decline", "make it a task"],
        },
        {
          id: "admin-task-templates",
          title: "Start a task from a template",
          summary: "Fill New task from a saved task template.",
          blocks: [
            {
              kind: "text",
              text: "A task template saves a Name, Type, Priority, Description, Stages and field defaults.",
            },
            {
              kind: "steps",
              steps: [
                "Open Settings, then Templates, and add a task template.",
                "Later, tap New task.",
                "Tap More options and pick it under Start from.",
                "Adjust the form and tap Create task.",
              ],
            },
            {
              kind: "next",
              text: "The form fills in when you pick the template.",
            },
            {
              kind: "note",
              text: "Change anything after the form fills in. The template itself stays as it was.",
            },
          ],
          link: { href: "/settings/templates", label: "Open Templates" },
          keywords: ["task template", "start from", "repeat task"],
        },
      ],
    },
    {
      id: "calendar",
      title: "Calendar",
      topics: [
        {
          id: "admin-calendar-views",
          title: "Use the calendar",
          summary: "Switch views and filter what you see.",
          blocks: [
            {
              kind: "text",
              text: "On a laptop pick Day, Week or Month; it opens on Month. On a phone there is no switch: swipe up or down, or use the handle, to move between the week strip, the compact month and the full month.",
            },
            {
              kind: "steps",
              steps: [
                "Open Calendar.",
                "Tap Filters to narrow by Client, Person, Type or Status.",
                "Status can be Open and completed, Open, or Completed.",
                "Tap a day to open its day sheet.",
              ],
            },
            {
              kind: "next",
              text: "The calendar shows only what matches your filters.",
            },
            {
              kind: "note",
              text: "You see full detail on tasks you can open. Other people’s time shows only as Busy or On leave. A day’s sheet names who is away (On leave, Busy all day), or says “Everyone is available”.",
            },
          ],
          link: { href: "/calendar", label: "Open Calendar" },
          keywords: ["busy", "on leave", "month", "week", "filter"],
        },
        {
          id: "admin-day-sheet",
          title: "A day and a task from it",
          summary: "See who is away and add a task on that day.",
          blocks: [
            {
              kind: "text",
              text: "A day shows what is Due, events, and who is away: “On leave” and “Busy all day”, each only when someone is, else “Everyone is available”. On a laptop the day you tap sits in a panel beside the month; on a phone it opens in a sheet.",
            },
            {
              kind: "steps",
              steps: [
                "Tap a day on the calendar.",
                "Check who is away.",
                { text: 'Tap "+ New task on ‹day›" (highlighted).', shot: "admin/calendar-day" },
                "Fill the form and tap Create task.",
              ],
            },
            {
              kind: "next",
              text: "The New task form opens with that date set. The footer also has Open day.",
            },
            {
              kind: "note",
              text: "If you open a task from the calendar, the back control says Calendar and returns you to the same view and day.",
            },
          ],
          link: { href: "/calendar", label: "Open Calendar" },
          keywords: ["day sheet", "free", "new task on"],
        },
      ],
    },
    {
      id: "people-reports",
      title: "People and reports",
      topics: [
        {
          id: "admin-people",
          title: "See the team",
          summary: "People is read-only for you.",
          blocks: [
            {
              kind: "text",
              text: "People lists everyone on the team with their role and job title. Open a person to see their profile. Only the Owner adds people, changes roles or sees attendance and leave there.",
            },
          ],
          link: { href: "/people", label: "Open People" },
          keywords: ["team", "directory", "profile", "job title"],
        },
        {
          id: "admin-report",
          title: "Read your work report",
          summary: "See how the work you run is going.",
          blocks: [
            {
              kind: "text",
              text: "Reports shows how the work you run is going. Four cards sit at the top: Rework, My turnaround, Overdue now and Acknowledgement lag.",
            },
            {
              kind: "steps",
              steps: [
                "Open Reports (under More on a phone).",
                "Choose Week, Month or Custom.",
                "Read the four cards.",
                "Scroll to Client items for your clients’ deliverables.",
                "Scroll to Who is loaded this week to see who has the most due.",
              ],
            },
            {
              kind: "next",
              text: "The cards and lists change to the dates you chose.",
            },
            {
              kind: "note",
              text: "Month and End of day reports are the Owner’s. You will not see them.",
            },
          ],
          link: { href: "/reports", label: "Open Reports" },
          keywords: ["report", "turnaround", "rework", "load", "workload"],
        },
      ],
    },
    {
      id: "clients",
      title: "Clients",
      topics: [
        {
          id: "admin-clients-list",
          title: "The clients you run",
          summary: "Your list of clients, with a search and a state filter.",
          blocks: [
            {
              kind: "text",
              text: "Clients shows only the clients assigned to you. The list opens on Active. Another Admin’s client is not visible to you. Client deliverables, across all your clients, is one tap away on this screen. Beside each client it says what is running now, such as “3 open · 9/12 done”.",
            },
            {
              kind: "steps",
              steps: [
                { text: "Open Clients (highlighted: the client row).", shot: "admin/clients" },
                "Use the State filter or Search by name.",
                "Tap a client to open it.",
              ],
            },
            {
              kind: "next",
              text: "The client page opens.",
            },
            {
              kind: "note",
              text: "If the list is empty, the Owner has not assigned a client to you yet.",
            },
          ],
          link: { href: "/clients", label: "Open Clients" },
          keywords: ["client list", "search", "state"],
        },
        {
          id: "admin-new-client",
          title: "Add a new client",
          summary: "Add a client. It starts Active and is yours.",
          blocks: [
            {
              kind: "steps",
              steps: [
                "Open Clients.",
                "Tap New client.",
                {
                  text: 'Enter the "Client name" (highlighted). It is the only required field.',
                  shot: "admin/new-client",
                },
                "Fill any custom fields your company uses.",
                "Save.",
              ],
            },
            {
              kind: "next",
              text: "The client starts Active and you run it. Add contacts and details on the client page.",
            },
            {
              kind: "note",
              text: "Only the client name is required. You can add the rest later.",
            },
          ],
          link: { href: "/clients", label: "Open Clients" },
          keywords: ["add client", "new client", "sample client"],
        },
        {
          id: "admin-client-page",
          title: "Inside a client",
          summary: "Find a client’s details, projects, brand and history.",
          blocks: [
            {
              kind: "text",
              text: "A client page has four tabs: Overview, Projects, Brand and Activity. Overview opens with the client’s active projects and their progress, then the Admin, the primary contact, the contacts, Details and Requirements and notes. Details lists only what is filled in; the empty ones fold into “Add details”, which opens Edit. Activity is the client’s history, newest first.",
            },
            {
              kind: "steps",
              steps: [
                {
                  text: "Open a client and look at the tabs (highlighted).",
                  shot: "admin/client-page",
                },
                "Tap ⋯, then Edit details, to change its name or facts.",
                "On Overview, tap Add a contact and fill in the Name (required) and, if you like, Designation, Email and Phone.",
                "Open Projects to see its work.",
              ],
            },
            {
              kind: "next",
              text: "Your changes show on the client page and are added to its Activity.",
            },
            {
              kind: "note",
              text: "Tasks are separate from client work. The Overview only shows how many open tasks carry this client’s label.",
            },
          ],
          keywords: ["overview", "brand", "activity", "contact", "edit details"],
        },
        {
          id: "admin-client-states",
          title: "Client states",
          summary: "Draft, Active, Paused and Inactive, and what each means for you.",
          blocks: [
            {
              kind: "text",
              text: "Only the Owner can change a client’s state. Active is normal. Paused keeps everything visible and editable, but a monthly or weekly project creates no new cycles. Inactive keeps the client searchable and editable, but allows no new projects, deliverables or client-labelled tasks until it is reactivated.",
            },
            {
              kind: "note",
              text: "A banner on the client page tells you the state. For you it says “Only the Owner can change this.” Ask the Owner to reactivate.",
            },
          ],
          keywords: ["paused", "inactive", "draft", "active", "close"],
        },
      ],
    },
    {
      id: "projects",
      title: "Projects and deliverables",
      topics: [
        {
          id: "admin-new-project",
          title: "Create a project",
          summary: "Name a project, choose how it repeats and add its deliverables.",
          blocks: [
            {
              kind: "text",
              text: "The New project form has Start from, Project name, Repeats (One-time, Weekly or Monthly), Delivery date (one-time only), Default stage groups, the Deliverables, Description and any custom fields.",
            },
            {
              kind: "steps",
              steps: [
                "Open the client, then the Projects tab.",
                "Tap New project.",
                "Optionally pick a template under Start from.",
                {
                  text: 'Enter the Project name and choose "Repeats" (highlighted).',
                  shot: "admin/new-project",
                },
                "Add the deliverables and check the preview.",
                "Tap Create project.",
              ],
            },
            {
              kind: "next",
              text: "The project opens. A repeating project gets its current period’s cycle at once.",
            },
            {
              kind: "note",
              text: "How often a project repeats cannot change later. Everything else stays editable. There is no New project on an Inactive client.",
            },
          ],
          link: { href: "/clients", label: "Open Clients" },
          keywords: ["new project", "repeats", "monthly", "weekly", "one-time"],
        },
        {
          id: "admin-project-templates-start",
          title: "Start a project from a template",
          summary: "Pick a template, or search and preview them.",
          blocks: [
            {
              kind: "text",
              text: "Start from fills the repeat, the default stage groups, the deliverables, and the description and custom fields if they are empty. Browse templates opens “Start from a template”: “Preview one to see what it gives, then Use this template.” Search by template name or deliverable title.",
            },
            {
              kind: "steps",
              steps: [
                {
                  text: 'In New project, tap "Browse templates" (highlighted).',
                  shot: "admin/templates",
                },
                "Type a name or deliverable in the search box.",
                "Tap Preview on a row to see what a project started from it gets.",
                "Tap Use this template, or Back to templates to keep looking.",
                "Change anything you need afterwards.",
              ],
            },
            {
              kind: "next",
              text: "The form fills in from the template.",
            },
            {
              kind: "note",
              text: "Using a template overwrites the repeat, the groups and the deliverables you already typed.",
            },
          ],
          keywords: ["template", "library", "start from", "preview"],
        },
        {
          id: "admin-project-deliverables-add",
          title: "Add deliverables with × N",
          summary: "One name and a number makes Reel 1, Reel 2 and so on.",
          blocks: [
            {
              kind: "text",
              text: "In the Add deliverables box, type a Deliverable name and How many (1 to 100). Tick presets to give them their own stages, or leave none ticked to use the default stages.",
            },
            {
              kind: "steps",
              steps: [
                "Type the Deliverable name.",
                { text: 'Set "How many" (highlighted).', shot: "admin/template-builder" },
                "Tick any stage presets you want, in the order you tick them. Each becomes one group.",
                "Tap Add.",
                "Open a deliverable's row to rename it or edit its stages.",
              ],
            },
            {
              kind: "example",
              text: "“Reel” × 4 makes Reel 1 to Reel 4. × 1 keeps the name exactly as typed.",
            },
            {
              kind: "next",
              text: "The rows join the list and the preview.",
            },
            {
              kind: "note",
              text: "Presets become groups in the order you tick them.",
            },
          ],
          keywords: ["deliverable", "reel", "quantity", "how many", "preset"],
        },
        {
          id: "admin-project-preview",
          title: "Read the live preview",
          summary: "See what Create project makes before anything is saved.",
          blocks: [
            {
              kind: "text",
              text: "The preview sits beside the form on a laptop. On a phone, tap Preview. It shows one card per deliverable, tagged Default stages or Own stages, with its stage groups.",
            },
            {
              kind: "steps",
              steps: [
                "Fill in the deliverables.",
                {
                  text: "Open the preview (highlighted). On a phone, tap Preview.",
                  shot: "admin/project-preview",
                },
                "Check the three totals: deliverables, groups, stages.",
                "Tap Back to edit to fix anything, or Create project.",
              ],
            },
            {
              kind: "example",
              text: "Identical neighbours collapse, so Reel 1 to 4 shows as one card with ×4. Tap it to see the names.",
            },
            {
              kind: "next",
              text: "Create project saves exactly what the preview shows.",
            },
            {
              kind: "note",
              text: "Nothing is saved until you tap Create project.",
            },
          ],
          keywords: ["preview", "default stages", "own stages", "collapse"],
        },
        {
          id: "admin-project-page",
          title: "Read the project page",
          summary: "Read the cycles, the progress ring and the deliverable rows.",
          blocks: [
            {
              kind: "text",
              text: "A repeating project has one cycle per period; the months sit as tabs (the previous, this and the next cycle, such as September · October 2026 · November): tap one to switch. The ring shows a percentage, with a line like “12 of 18 stages · 3 of 7 deliverables done”, and either On track or “N behind plan”. At 100% it says the period is complete.",
            },
            {
              kind: "steps",
              steps: [
                "Open the project.",
                { text: "Read the progress ring (highlighted).", shot: "admin/project-page" },
                "Tap a month tab (the previous or the next cycle) to switch.",
                "Tap Activity to see the project’s history.",
              ],
            },
            {
              kind: "text",
              text: "Beside the ring, “Needs you” names what to look at: a red dot for a late deliverable (“Reel 1 is 1 day late”), an amber dot for one nearly done (“Interview 2: 1 stage left”, “Reel 3: ready to mark done”). Nothing is shown there when nothing is late or nearly done. On a laptop Deliverables is a table (Deliverable, Progress by group, Next, Planned): the name over “3 groups · 1 of 9 stages”, one line per group with its bar and “n/m” (a long list without groups shows one bar), the next stage as a chip or, once every stage is ticked, a green Mark done, the planned date (late ones in red), then ⋯ and ›. On a phone each deliverable is a card with the same lines per group. Every part of the page uses the full width. An empty cycle says “No deliverables yet: add one or start from a template.” with Add deliverable. Details below is a grid: Client contact (the client’s primary contact), Repeats, the delivery date, Template (the template it started from, or None), Notes and the project fields.",
            },
            {
              kind: "example",
              text: "A row reads “Reel 1 · Planned 18 Oct · 2 days late”. Planned today, Planned 21 Oct and Not planned are the other forms.",
            },
            {
              kind: "next",
              text: "Finished ones read Done, Closed or Carried and sit in the collapsed group “Done and closed (N)”.",
            },
            {
              kind: "note",
              text: "Closed and carried deliverables are not counted in the ring.",
            },
          ],
          keywords: [
            "progress",
            "ring",
            "cycle",
            "planned",
            "needs you",
            "late",
            "on track",
            "next",
          ],
        },
        {
          id: "admin-deliverable-rows",
          title: "Tick stages from the list",
          summary: "Open a row's bar and tick from its checklist, or tap Next.",
          blocks: [
            {
              kind: "text",
              text: "You can tick stages without opening a deliverable. Tapping anywhere else on the row (or its ›) opens it; on a laptop, Tab to it and press Enter.",
            },
            {
              kind: "steps",
              steps: [
                {
                  text: "Tap a row’s progress bar, such as “2/4” (highlighted), to open its checklist: each stage with a tick box, under its group’s name and count. Ticked ones are filled with a ✓, the next one is bold and outlined, later ones are grey; long names wrap to two lines. On a laptop the checklist runs in three columns, on a phone in one. Tap the bar again to close it.",
                  shot: "admin/deliverable-rows",
                },
                "Tap a stage to tick it (“Tick Edit”) or untick it (“Untick Edit”).",
                "Or tap “Next: ‹stage›” on the row to tick that stage in one tap.",
                "Read the toast, such as “Ticked Video steps · Edit on Reel 2”, and tap Undo if it was a mistake.",
              ],
            },
            {
              kind: "next",
              text: "The row’s count and the ring move at once, and the tick is added to the History.",
            },
            {
              kind: "note",
              text: "Stages tick only while the deliverable is open.",
            },
          ],
          keywords: ["tick", "untick", "next", "checklist", "bar", "undo", "quick"],
        },
        {
          id: "admin-add-deliverable",
          title: "Add a deliverable to this month",
          summary: "Add one mid-cycle without changing the list.",
          blocks: [
            {
              kind: "text",
              text: "Give a Title, an optional Planned date and Notes. Start from lets you copy the stages of a deliverable template. The default is the project’s default stages.",
            },
            {
              kind: "steps",
              steps: [
                "Open the project and tap Add deliverable.",
                "Enter the Title.",
                "Choose Start from if you want a template’s stages.",
                "Set a Planned date if it has one.",
                "Save.",
              ],
            },
            {
              kind: "next",
              text: "The deliverable joins this cycle.",
            },
            {
              kind: "note",
              text: "It joins this cycle only. The Deliverables list for next month stays as it is, until the month-end question “Keep ‹Month›’s extra deliverables next month?”. The button is hidden once the cycle has ended.",
            },
          ],
          keywords: ["add deliverable", "planned date", "extra"],
        },
        {
          id: "admin-deliverable-sheet",
          title: "Work on a deliverable",
          summary: "Tick stages, edit stages, edit details and add notes.",
          blocks: [
            {
              kind: "text",
              text: "A deliverable’s sheet shows its state (Open, Done, Closed or Carried), the Planned date, a History button and its stages under group headings with their count, as on the list (“Stages 1/1”, “Edit 2/3”).",
            },
            {
              kind: "steps",
              steps: [
                { text: "Tap a deliverable to open its sheet.", shot: "admin/deliverable-sheet" },
                "Tick each stage as it is finished.",
                {
                  text: "Tap Edit stages to add, rename or remove stages for this deliverable only.",
                  shot: "admin/edit-stages",
                },
                "Tap Edit details to change the title, date or notes.",
                "Tap ⋯ for Another revision round, Move up or Move down (its place in the list; the toast says, for example, “Moved Reel 2 down”) and Save as template.",
              ],
            },
            {
              kind: "next",
              text: "Your ticks and edits are saved and added to the History. Ticked boxes are plain, never red.",
            },
            {
              kind: "note",
              text: "You can tick or untick stages only while the deliverable is open. Once it is done, closed or carried, only the title and notes can change.",
            },
          ],
          keywords: ["tick", "edit stages", "edit details", "history", "notes", "move up", "order"],
        },
        {
          id: "admin-revision-round",
          title: "Add another revision round",
          summary: "One more revision stage on a deliverable, in one tap.",
          blocks: [
            {
              kind: "text",
              text: "When the client asks for one more round of changes, add a revision stage instead of editing the stages by hand.",
            },
            {
              kind: "steps",
              steps: [
                {
                  text: "Open the deliverable, tap its ⋯ menu, then Another revision round (highlighted).",
                  shot: "admin/revision-round",
                },
                "Read the toast, such as “Added Revision 3”.",
              ],
            },
            {
              kind: "next",
              text: "The new stage follows the deliverable’s own revision stages (“Revision 2” is followed by “Revision 3”) in their group; one with none gets “Revision round 1”. It goes right after the last revision stage, or right after “Edit” when there is none, so it comes before “Posted”. With neither, it goes just before “Posted”, “Published” or “Delivered”, or at the end when there is none of those. Ticks already made stay.",
            },
            {
              kind: "note",
              text: "It works on open deliverables only. Reopen a done one first.",
            },
            {
              kind: "note",
              text: "Use it instead of typing numbered round stages (“Approval round 1”, “Approval round 2”). When a deliverable has two or more stages like that, its open row shows this tip.",
            },
          ],
          keywords: ["revision", "another round", "changes", "client feedback", "tip"],
        },
        {
          id: "admin-group-stages",
          title: "Split a long stage list into groups",
          summary: "You choose where each group starts; nothing is grouped by itself.",
          blocks: [
            {
              kind: "text",
              text: "A deliverable with 9 or more stages and no groups shows, when you open its row, “12 stages: split them into groups?” with a Group stages button. It is only a suggestion: nothing changes until you choose.",
            },
            {
              kind: "steps",
              steps: [
                "Open the row’s checklist and tap Group stages.",
                "Tap the stage where each new group starts (“Start a group here”). The first group always starts at the first stage. Tap it again to undo.",
                "Name each group, such as Concept, Shoot and Post, then tap Group stages.",
                "Read the toast “Grouped the stages of ‹deliverable›”.",
              ],
            },
            {
              kind: "next",
              text: "The checklist shows each group’s name and its own count. Ticks and the order stay as they were, and only that deliverable changes. The History lists each stage moved into its group.",
            },
            {
              kind: "example",
              text: "A 12-stage reel: Concept starts at Concept note, Shoot at Shoot planning, Post at Rough cut.",
            },
            {
              kind: "note",
              text: "A deliverable that already has groups is changed in Edit stages, as before.",
            },
          ],
          keywords: ["group", "groups", "long", "stages", "split", "concept", "shoot"],
        },
        {
          id: "admin-mark-done",
          title: "Mark a deliverable done",
          summary: "Mark a deliverable done. Done is the approval.",
          blocks: [
            {
              kind: "text",
              text: "For client work there is no separate approval step. Mark done comes onto a row once every stage is ticked (the first such row’s button is solid green); until then it waits in the row’s ⋯, beside Open. A deliverable with no stages always shows it.",
            },
            {
              kind: "steps",
              steps: [
                {
                  text: 'Tap "Mark done" on the row (or in its ⋯), or open the deliverable and tap Mark done (highlighted).',
                  shot: "admin/deliverable-sheet",
                },
                "Read the toast “Marked ‹title› done”.",
                "Tap Undo within 6 seconds if it was a mistake.",
              ],
            },
            {
              kind: "next",
              text: "The deliverable counts as approved straight away and its ticks lock.",
            },
            {
              kind: "note",
              text: "After 6 seconds the Undo is gone. Use Reopen… to send it back.",
            },
          ],
          keywords: ["done", "approve", "undo", "complete deliverable"],
        },
        {
          id: "admin-reopen-close-deliverable",
          title: "Reopen or close a deliverable",
          summary: "Send a done deliverable back, or close one for good.",
          blocks: [
            {
              kind: "text",
              text: "Reopen… sends a done deliverable back to open. Close deliverable… keeps it in the cycle as closed, not done.",
            },
            {
              kind: "steps",
              steps: [
                "Open the deliverable.",
                "Tap Reopen… (done ones) or Close deliverable….",
                "Write the reason.",
                "Confirm.",
              ],
            },
            {
              kind: "next",
              text: "A reopened deliverable stops counting as done until it is done again. A closed one stays in the cycle as closed.",
            },
            {
              kind: "note",
              text: "Closing cannot be undone. Use Reopen… if you only need more changes.",
            },
          ],
          keywords: ["reopen", "close", "send back", "reason"],
        },
        {
          id: "admin-bulk-actions",
          title: "Select several deliverables",
          summary: "Select rows, then mark done, tick a stage or edit them all.",
          blocks: [
            {
              kind: "text",
              text: "Tap Select above the deliverables. It says “Select deliverables, then choose an action.” Checkboxes appear and the rows’ own Mark done step aside.",
            },
            {
              kind: "steps",
              steps: [
                "Tap the rows you want: a tap anywhere on a row selects it. Select all takes every row.",
                {
                  text: "Use the bar at the bottom: Mark N done (it asks “Mark N deliverables done?” first), Tick a stage then “Tick ‹stage› on N”, or Edit N (highlighted).",
                  shot: "admin/select-edit",
                },
                "Tap Done, or go back, to leave Select.",
              ],
            },
            {
              kind: "next",
              text: "The action applies to every selected row.",
            },
            {
              kind: "note",
              text: "Mark N done asks you to confirm. Read the number before you do.",
            },
          ],
          keywords: ["bulk", "select", "many", "tick a stage", "select all"],
        },
        {
          id: "admin-bulk-edit",
          title: "Edit several deliverables at once",
          summary: "Plan, move dates, add a stage group or rename, all in one go.",
          blocks: [
            {
              kind: "text",
              text: "Select the deliverables, tap Edit N in the bar and pick an edit. Each opens a sheet that names what it changes.",
            },
            {
              kind: "steps",
              steps: [
                "Set planned date…: pick a Planned date; every selected deliverable is planned for it.",
                "Move planned dates…: set “By how many days” and choose Earlier or Later. One without a planned date stays as it is.",
                "Add a stage group…: build the “Groups to add”, typed or from a preset.",
                "Rename…: type a New name with {n} where the number goes ({title} keeps the current name), set Start at, check the Preview and tap Rename N.",
              ],
            },
            {
              kind: "example",
              text: "“Reel {n}” starting at 5 renames three deliverables to Reel 5, Reel 6 and Reel 7, in the list’s order.",
            },
            {
              kind: "next",
              text: "The toast says what changed, such as “Renamed 3 deliverables”.",
            },
            {
              kind: "note",
              text: "Edit N counts only the open deliverables you selected. An edit is all or nothing: if one of them cannot change, nothing changes and the message names it.",
            },
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
          id: "admin-project-activity",
          title: "See what changed on a project",
          summary: "See every change made to a project.",
          blocks: [
            {
              kind: "steps",
              steps: [
                "Open the project and tap Activity.",
                "Use the chips All, Deliverables, Stages and Project to narrow it.",
                "Tap Show older for more.",
              ],
            },
            {
              kind: "next",
              text: "You see the latest 20 entries first.",
            },
            {
              kind: "note",
              text: "Each deliverable also has its own History button.",
            },
          ],
          keywords: ["history", "audit", "who changed"],
        },
        {
          id: "admin-complete-cancel-project",
          title: "Complete, cancel or reopen a project",
          summary: "Finish, cancel or bring back a project from its ⋯ menu.",
          blocks: [
            {
              kind: "text",
              text: "The project ⋯ menu has Edit details, Default stages, Deliverables list (repeating projects), Save as template, Copy schedule as text, Complete project, and Cancel project… with a reason.",
            },
            {
              kind: "steps",
              steps: [
                "Open the project and tap ⋯.",
                "Choose Complete project, or Cancel project… and give a reason (Keep project closes the question without cancelling).",
                "To change anything later, tap ⋯ and choose Reopen project….",
              ],
            },
            {
              kind: "next",
              text: "A banner reads “Completed: read-only.” Every change is refused until you reopen the project.",
            },
            {
              kind: "note",
              text: "A completed or cancelled project is read-only. Reopen project… brings it back.",
            },
          ],
          keywords: ["complete", "cancel", "read-only", "reopen project"],
        },
        {
          id: "admin-copy-schedule",
          title: "Send the schedule on WhatsApp",
          summary: "Copy the shown cycle's plan as plain text.",
          blocks: [
            {
              kind: "steps",
              steps: [
                "Open the project on the cycle you want.",
                {
                  text: "Tap ⋯, then Copy schedule as text (highlighted).",
                  shot: "admin/copy-schedule",
                },
                "Read the toast “Schedule copied: paste it into WhatsApp”, then paste it into the chat.",
              ],
            },
            {
              kind: "example",
              text: "The text starts with the project and the month in bold, then each planned date (“Tue 21 Oct”) with its deliverables, and “Not planned yet” last. A done one says “(done)”.",
            },
            {
              kind: "next",
              text: "Closed and carried deliverables are left out: they are not this cycle’s work.",
            },
            {
              kind: "note",
              text: "If the browser does not allow copying, it says “The schedule could not be copied”. Try again, or copy from a laptop.",
            },
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
          id: "admin-stage-groups-what",
          title: "What a stage group is",
          summary: "A heading over a list of stages, such as Edit or Review.",
          blocks: [
            {
              kind: "text",
              text: "A stage group is a heading over its stages. A deliverable can have one group or several. An older list made before groups existed is one untitled group; tap Name this group to give it a name. A stage name must be unique inside its group.",
            },
            {
              kind: "example",
              text: "Group “Edit” holds Rough cut and Fine cut. Group “Review” holds Internal check and Final check. The chips show 1/2 and 0/2.",
            },
          ],
          keywords: ["group", "stages", "untitled", "name this group"],
        },
        {
          id: "admin-stage-groups-edit",
          title: "Add, move and remove groups and stages",
          summary: "Add a group, add from a preset, reorder, or remove.",
          blocks: [
            {
              kind: "text",
              text: "Each group and each stage has a ⋯ menu with Move up, Move down and Remove. On a phone, long press the handle to start a drag.",
            },
            {
              kind: "steps",
              steps: [
                'Tap Add a group, or "Add from a preset…" (highlighted). The preset becomes a new group named after it.',
                "Type the Group name and the stages, one per line.",
                "Type a stage under “Add a stage” and press Enter to add more.",
                "Long press the handle and drag, or use Move up and Move down.",
                "Use Remove group or Remove stage to take one away.",
              ],
            },
            {
              kind: "next",
              text: "The groups and stages show in the new order.",
            },
            {
              kind: "note",
              text: "A list holds at most 100 stages. Only one group may be left without a name.",
            },
          ],
          keywords: ["add a group", "preset", "drag", "reorder", "100 stages"],
        },
        {
          id: "admin-default-stages",
          title: "Default stages",
          summary: "What a new deliverable starts with.",
          blocks: [
            {
              kind: "text",
              text: "A project’s Default stages are what a new deliverable starts with when it has none of its own. Open them from the project ⋯ menu.",
            },
            {
              kind: "note",
              text: "Changing the defaults never changes deliverables that already exist. Edit a single deliverable’s stages from its own sheet.",
            },
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
          id: "admin-stage-presets",
          title: "Make a stage preset",
          summary: "Save a reusable list of stages in Settings.",
          blocks: [
            {
              kind: "text",
              text: "A stage preset is a flat list of stages you reuse. Each row shows who made it.",
            },
            {
              kind: "steps",
              steps: [
                "Open Settings, then Templates: Stage presets is the first section (on a phone, the Presets tab).",
                {
                  text: 'Tap "Add preset" (highlighted) to add a preset.',
                  shot: "admin/stage-presets",
                },
                "Enter the Name and the Stages in order (up to 100).",
                "Tap Add preset.",
              ],
            },
            {
              kind: "next",
              text: "The preset appears in the list and can be used when you build stages.",
            },
            {
              kind: "note",
              text: "You can edit or delete only the presets you made. Delete stops new projects from offering it, with Undo in its message for a few seconds. Projects that already used it keep their stages.",
            },
          ],
          link: { href: "/settings/templates#presets", label: "Open Stage presets" },
          keywords: ["preset", "stages", "archive"],
        },
        {
          id: "admin-project-template-build",
          title: "Build a project template",
          summary: "Save a whole project shape: repeat, groups and deliverables.",
          blocks: [
            {
              kind: "text",
              text: "A project template has a Name, Repeats, Default stage groups, Deliverables (with × N), a Description and field defaults. A preview follows the form.",
            },
            {
              kind: "steps",
              steps: [
                "Open Settings, then Templates.",
                'Tap "Add project template" beside Project templates.',
                "Enter the Name and choose Repeats.",
                {
                  text: 'Add the deliverables, using "How many" (highlighted) for × N where it helps.',
                  shot: "admin/template-builder",
                },
                "Check the preview, then tap Add template. On a phone the button is Preview and save: the preview opens as its own step, and Back to editing returns to the form.",
              ],
            },
            {
              kind: "next",
              text: "The toast says “Added ‹name›: New project offers it under Start from”, and New project offers it under Start from.",
            },
            {
              kind: "note",
              text: "A template is copied into a project when you use it, so later template edits never change existing projects.",
            },
          ],
          link: { href: "/settings/templates", label: "Open Templates" },
          keywords: ["project template", "build", "× N"],
        },
        {
          id: "admin-deliverable-templates",
          title: "Make a deliverable template",
          summary: "Save a name and stage groups for a deliverable you repeat.",
          blocks: [
            {
              kind: "text",
              text: "A deliverable template holds a Name and its stage groups, with a preview.",
            },
            {
              kind: "steps",
              steps: [
                "Open Settings, then Templates.",
                'Tap "Add deliverable template" beside Deliverable templates.',
                "Name it and build its stage groups.",
                "Check the preview and tap Add template (on a phone, Preview and save).",
              ],
            },
            {
              kind: "next",
              text: "The toast says “Added ‹name›: + Add deliverable offers it”. Use it from Start from in Add deliverable, or when building a project template.",
            },
            {
              kind: "note",
              text: "Using a template copies its stages. Later template edits do not change work already made from it.",
            },
          ],
          link: { href: "/settings/templates", label: "Open Templates" },
          keywords: ["deliverable template", "stage groups"],
        },
        {
          id: "admin-save-as-template",
          title: "Save as template",
          summary: "Turn a good project or deliverable into a template.",
          blocks: [
            {
              kind: "text",
              text: "A project template keeps the structure only: the repeat, the default stage groups and the deliverables with their stages, never the description or custom field values. A deliverable template keeps its stage groups, with no ticks or dates.",
            },
            {
              kind: "steps",
              steps: [
                "Open the project or deliverable and tap ⋯.",
                "Tap Save as template.",
                { text: 'Edit the "Template name" (highlighted).', shot: "admin/save-as-template" },
                "Save.",
              ],
            },
            {
              kind: "next",
              text: "A message offers Open templates.",
            },
            {
              kind: "note",
              text: "The original stays as it is.",
            },
          ],
          keywords: ["save as template", "reuse"],
        },
        {
          id: "admin-templates-yours",
          title: "Your templates and the Owner’s",
          summary: "You edit and delete your own; templates are copied, never linked.",
          blocks: [
            {
              kind: "text",
              text: "Templates is one page: Stage presets, Deliverable templates and Project templates, then, under a line, Task templates (on a phone, four tabs), with one search box for all of them. Every project and deliverable template row has a Preview button, and on your own ones a pencil (“Edit ‹name›”) and a bin (“Delete ‹name›”; on a phone, in the row’s ⋯). You edit and delete only the templates you made. The Owner can do it for any. With none yet, a list says so, such as “No project templates yet: Add one to start projects faster.”",
            },
            {
              kind: "steps",
              steps: [
                {
                  text: "Open Settings, then Templates, and use the search box (highlighted).",
                  shot: "admin/templates",
                },
                "Tap Preview on a project or deliverable template to see what work made from it gets.",
                "Edit or delete one of your own. Delete asks first.",
              ],
            },
            {
              kind: "next",
              text: "A deleted template stops being offered: the message “‹name› deleted” has Undo for a few seconds. The question's Delete button is red, as for every final action; nothing is destroyed.",
            },
            {
              kind: "note",
              text: "A template is copied into a project when you use it, so later template edits never change existing projects. Deleting does not touch work already made from it.",
            },
          ],
          link: { href: "/settings/templates", label: "Open Templates" },
          keywords: ["archive", "restore", "own templates", "linked"],
        },
      ],
    },
    {
      id: "recurring",
      title: "Monthly retainers",
      topics: [
        {
          id: "admin-retainer-walkthrough",
          title: "Set up a monthly retainer, start to finish",
          summary: "Build work that comes back every month, from presets to a renewing project.",
          blocks: [
            {
              kind: "text",
              text: "A retainer is work that comes back every month. You build it once from small parts, and MaxOff makes a fresh cycle each month. This walk-through uses a monthly retainer for Sample Client.",
            },
            {
              kind: "steps",
              steps: [
                {
                  text: "Make stage presets. In Settings, Templates, Stage presets, add “Edit” (Rough cut, Fine cut) and “Review” (Internal check, Final check).",
                  shot: "admin/stage-presets",
                },
                "Make a deliverable template. In Settings, Templates, add “Reel” and give it stage groups, for example Edit and Review.",
                "Build a project template named “Monthly retainer” with Repeats set to Monthly and the deliverables Reel × 4 and Post × 2.",
                "Create the project. Open Sample Client, then Projects, then New project. Under Start from pick “Monthly retainer” and check the preview.",
                "Tap Create project.",
              ],
            },
            {
              kind: "example",
              text: "The Monthly retainer makes Reel 1 to Reel 4 and Post 1 to Post 2, each with its stage groups. The preview shows the Reels as one collapsed card marked ×4.",
            },
            {
              kind: "next",
              text: "This month’s cycle appears at once. A new one is made every month.",
            },
            {
              kind: "note",
              text: "There is no template picker for deliverables inside New project. Pick the deliverable template when you build the project template, or use Start from in Add deliverable.",
            },
          ],
          link: { href: "/settings/templates", label: "Open Templates" },
          keywords: ["retainer", "monthly", "recurring", "repeat", "walk-through"],
        },
        {
          id: "admin-retainer-adjust",
          title: "Adjust this month",
          summary: "Add a deliverable or edit stages for one month only.",
          blocks: [
            {
              kind: "text",
              text: "This month needs one more Post? Add it to the running cycle.",
            },
            {
              kind: "steps",
              steps: [
                "Open the project and stay on the current cycle.",
                "Tap Add deliverable and enter “Post 3”.",
                "To change one deliverable’s stages, open it and tap Edit stages.",
              ],
            },
            {
              kind: "next",
              text: "The change applies to this month only. Editing stages on a deliverable changes that deliverable only.",
            },
            {
              kind: "note",
              text: "Add deliverable affects this cycle only. To change what every month starts with, edit the Deliverables list.",
            },
          ],
          keywords: ["this month", "adjust", "extra post"],
        },
        {
          id: "admin-retainer-monthly",
          title: "What happens every month",
          summary: "A new cycle starts at 00:00 IST, filled from the Deliverables list.",
          blocks: [
            {
              kind: "text",
              text: "At 00:00 IST on the 1st (Mondays for a weekly project) MaxOff makes a new cycle from the Deliverables list, with each line’s stages. This happens only while the client is Active and the project is open.",
            },
            {
              kind: "steps",
              steps: [
                {
                  text: "Open the project and tap ⋯, then Deliverables list.",
                  shot: "admin/deliverables-list",
                },
                "Rename or add lines, and open Stages on a line to change them.",
                "To get ahead, tap ⋯ and Start ‹period› and confirm “Start ‹period› now?”.",
              ],
            },
            {
              kind: "next",
              text: "The next cycle is made by itself. A recurring project gets its current period’s cycle as soon as you create it.",
            },
            {
              kind: "note",
              text: "A Paused client gets no new cycle. Start ‹period› only appears when the next cycle may start, and the deliverables you named ahead of time are already in place.",
            },
          ],
          keywords: ["new cycle", "00:00", "start early", "deliverables list", "paused"],
        },
        {
          id: "admin-keep-extras",
          title: "Keep a month’s extra deliverables",
          summary: "At month end, say whether this month’s extras repeat.",
          blocks: [
            {
              kind: "text",
              text: "Near the end of a month, a repeating project that gained deliverables this cycle asks “Keep ‹Month›’s extra deliverables next month?” (a weekly one: “next week?”). It lists the ones added this cycle that are not on the Deliverables list and says: “Yes adds them to the deliverables list from ‹Month›; No leaves the list as it is.”",
            },
            {
              kind: "steps",
              steps: [
                "Open the project page and read the card under the ring.",
                "Tap Yes, keep them to add them to the Deliverables list.",
                "Or tap No: the list stays as it is.",
              ],
            },
            {
              kind: "next",
              text: "Yes adds them for later cycles only: this month and any cycle already started stay as they are. The toast says, for example, “2 deliverables added to the deliverables list from November 2026”.",
            },
            {
              kind: "note",
              text: "The card shows from 6 days before the month’s last day to 7 days after (a weekly project: from its last 2 days to 2 days after), once per cycle. Either answer is kept and the card goes.",
            },
          ],
          keywords: ["extra", "keep", "month end", "deliverables list", "next month", "yes no"],
        },
        {
          id: "admin-retainer-unfinished",
          title: "Decide what to do with unfinished deliverables",
          summary: "Carry forward, Leave pending or Close when a cycle ends.",
          blocks: [
            {
              kind: "text",
              text: "When a cycle ends with open deliverables, the project shows a link: “‹period› has ended: N unfinished deliverables to decide”. It opens the Unfinished deliverables screen, grouped by project and cycle.",
            },
            {
              kind: "steps",
              steps: [
                "Open the link, or Unfinished deliverables from Today.",
                "Select the rows, or select none to act on all.",
                "Tap Carry N forward, or Leave N pending.",
                "For one row, tap Close… and say why.",
              ],
            },
            {
              kind: "next",
              text: "A carried deliverable shows “Carried from …” in the next cycle.",
            },
            {
              kind: "note",
              text: "Carry forward is hidden on an Inactive client. Close or leave those pending.",
            },
          ],
          link: { href: "/clients/items/decide", label: "Open Unfinished deliverables" },
          keywords: ["carry forward", "leave pending", "close", "unfinished", "ended cycle"],
        },
        {
          id: "admin-retainer-save-template",
          title: "Save a good month as a template",
          summary: "Keep the shape of a month that worked.",
          blocks: [
            {
              kind: "text",
              text: "Once a month looks right, save it so the next retainer starts from it.",
            },
            {
              kind: "steps",
              steps: [
                {
                  text: "Open the project and tap ⋯, then Save as template.",
                  shot: "admin/save-as-template",
                },
                "Name it, for example “Monthly retainer”.",
                "Next time, pick it under Start from in New project.",
              ],
            },
            {
              kind: "next",
              text: "The next retainer starts from that template.",
            },
            {
              kind: "note",
              text: "The template is a copy. The project you saved it from stays as it is.",
            },
          ],
          keywords: ["save template", "reuse month"],
        },
        {
          id: "admin-deliverables-list",
          title: "The Deliverables list",
          summary: "What every new month starts with.",
          blocks: [
            {
              kind: "text",
              text: "On a recurring project, ⋯ then Deliverables list holds one row per line. Every month starts with these. Open Stages on a line to change its stage groups, and add lines with × N.",
            },
            {
              kind: "note",
              text: "Add deliverable on the project page adds to the running month only. The list stays as it is.",
            },
          ],
          keywords: ["deliverables list", "lines", "stages per line"],
        },
        {
          id: "admin-carry-screen",
          title: "The carry screen",
          summary: "Where unfinished deliverables from an ended cycle are decided.",
          blocks: [
            {
              kind: "text",
              text: "Unfinished deliverables says: carry forward, leave pending or close what an ended cycle left open. Each cycle has Carry N forward and Leave N pending. Each row has Close…. A carried deliverable shows “Carried from …” in the next cycle. When nothing is waiting it says “Nothing to decide.”",
            },
          ],
          link: { href: "/clients/items/decide", label: "Open Unfinished deliverables" },
          keywords: ["decide", "carried", "pending"],
        },
        {
          id: "admin-client-deliverables",
          title: "Client deliverables across all clients",
          summary: "See every open deliverable on the clients you run.",
          blocks: [
            {
              kind: "text",
              text: "Client deliverables lists the open deliverables of all the clients you run.",
            },
            {
              kind: "steps",
              steps: [
                "Open Clients, then Client deliverables.",
                {
                  text: 'Choose Open or "Overdue" (highlighted).',
                  shot: "admin/client-deliverables",
                },
                "Narrow by Every client or Every project if needed.",
                "Tap a row to open it.",
              ],
            },
            {
              kind: "next",
              text: "The project opens on that deliverable’s cycle.",
            },
          ],
          link: { href: "/clients/items", label: "Open Client deliverables" },
          keywords: ["overdue deliverables", "across clients", "all clients"],
        },
      ],
    },
    {
      id: "settings",
      title: "Settings",
      topics: [
        {
          id: "admin-settings-overview",
          title: "What you can change in Settings",
          summary: "Notifications, Job titles, Custom fields and Templates.",
          blocks: [
            {
              kind: "text",
              text: "You see four sections in two groups, each row with one line on what it holds. Notifications shows who on your open tasks can’t be reached. Job titles are the titles people can be given. Templates (stage presets and every kind of template, on one page) has its own topics. Custom fields are extra fields on clients and contacts.",
            },
            {
              kind: "steps",
              steps: [
                { text: "Open Settings.", shot: "admin/settings" },
                "Pick the section you need.",
              ],
            },
            {
              kind: "note",
              text: "The rest of Settings is the Owner’s, including Task types and Thresholds. You will not see them.",
            },
          ],
          link: { href: "/settings", label: "Open Settings" },
          keywords: ["settings", "job titles", "custom fields"],
        },
        {
          id: "admin-settings-reach",
          title: "See who can’t be reached",
          summary: "Find people on your open tasks who will miss a push.",
          blocks: [
            {
              kind: "text",
              text: "Settings, Notifications lists people on your open tasks who can’t be reached by push, and why.",
            },
            {
              kind: "steps",
              steps: [
                "Open Settings, then Notifications.",
                "Read the Can’t be reached list.",
                "Ask that person to turn on notifications on their phone.",
              ],
            },
            {
              kind: "next",
              text: "When all is well it says “Everyone on your open tasks can be reached.”",
            },
          ],
          link: { href: "/settings/notifications", label: "Open Notifications settings" },
          keywords: ["reachable", "push", "can't be reached"],
        },
        {
          id: "admin-settings-lists",
          title: "Job titles and custom fields",
          summary: "Add titles and extra fields that the rest of the app uses.",
          blocks: [
            {
              kind: "text",
              text: "Custom fields add extra fields to clients and contacts, either for everyone or for one client.",
            },
            {
              kind: "steps",
              steps: [
                "Open Settings.",
                "Choose Job titles or Custom fields.",
                'Tap "Add job title" (or "Add field") at the top of the list, or a row\'s Rename or Edit (in its ⋯ on a phone), and save.',
              ],
            },
            {
              kind: "next",
              text: "The entry is offered across the app.",
            },
            {
              kind: "note",
              text: "Job titles are just labels: they never change what someone can do.",
            },
          ],
          link: { href: "/settings/job-titles", label: "Open Job titles" },
          keywords: ["job title", "custom field", "client fields"],
        },
      ],
    },
    {
      id: "notifications",
      title: "Alerts and your phone",
      topics: [
        {
          id: "admin-alerts",
          title: "Read your Alerts",
          summary: "Open each alert and clear your unread count.",
          blocks: [
            {
              kind: "text",
              text: "Alerts lists your notifications, newest day first.",
            },
            {
              kind: "steps",
              steps: [
                "Tap the bell.",
                "Choose All or Unread.",
                "Tap an alert to open what it is about.",
                "Tap Mark all read when you are done.",
              ],
            },
            {
              kind: "next",
              text: "The alert opens its screen, and the back control then reads Alerts. Mark all read clears the count.",
            },
          ],
          link: { href: "/notifications", label: "Open Alerts" },
          keywords: ["bell", "unread", "mark all read"],
        },
        {
          id: "admin-push",
          title: "Turn on push on this device",
          summary: "Set up push notifications once on each phone or laptop.",
          blocks: [
            {
              kind: "text",
              text: "Push notifications are set up per device. Your devices shows where your notifications go.",
            },
            {
              kind: "steps",
              steps: [
                "On an iPhone, first add MaxOff to the Home Screen and open it from there.",
                "Open Me.",
                "Under Notifications, tap Turn on (or Turn on here).",
                "Allow notifications when asked.",
              ],
            },
            {
              kind: "next",
              text: "When it works it says “Notifications are on for this device”.",
            },
            {
              kind: "note",
              text: "Do this on every device you use.",
            },
          ],
          link: { href: "/me", label: "Open Me" },
          keywords: ["push", "devices", "iphone", "home screen", "allow"],
        },
      ],
    },
    {
      id: "help",
      title: "Help and troubleshooting",
      topics: [
        missingButtonTopic(
          "Some buttons are the Owner’s: client states, assigning an Admin, deciding attendance, leave and expenses, final task approval, Task types and Thresholds. Others depend on the step: Approve appears only after the primary owner marks a task done; Edit task and Cancel task appear only on tasks you created or approve; a completed project is read-only until it is reopened; on the deliverables list Mark done waits in a row’s ⋯ until every stage is ticked; Edit N in Select mode counts only open deliverables; and there is no New project on an Inactive client.",
        ),
        ...COMMON_HELP_TOPICS,
      ],
    },
  ],
};
