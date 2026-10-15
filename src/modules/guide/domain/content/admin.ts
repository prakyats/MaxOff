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
          summary: "The sidebar on a laptop, the bottom bar on a phone.",
          blocks: [
            {
              kind: "text",
              text: "On a laptop the sidebar lists Today, Approvals, Clients, Tasks, Calendar, People, Reports and Settings. On a phone the bottom bar shows Today, Approvals, Tasks and Calendar, and a More cell holds the rest.",
            },
            {
              kind: "steps",
              steps: [
                "On a phone, tap More in the bottom bar.",
                "Pick Reports, Clients, People or Settings.",
                "Tap the Me row at the bottom of the sheet for your own page.",
                "A number on a tab or on More counts what is waiting for you.",
              ],
            },
            {
              kind: "note",
              text: "There is no tab for your own leave. It lives on Me, under Attendance & leave.",
            },
          ],
          link: { href: "/today", label: "Open Today" },
          keywords: ["menu", "sidebar", "more", "navigation", "tabs"],
        },
        {
          id: "admin-bell-me",
          title: "The bell and Me",
          summary: "Your alerts, your devices and your own attendance and leave.",
          blocks: [
            {
              kind: "text",
              text: "The bell sits in the title bar on a phone and in the top bar on a laptop. It opens Alerts and shows how many are unread. Me holds your own page: Attendance & leave, Extra work & expenses, Notifications, Your devices and Help & troubleshooting.",
            },
            {
              kind: "steps",
              steps: [
                "Tap the bell to open Alerts.",
                "Tap Me (in the More sheet on a phone).",
                "Pick the row you need, for example Attendance & leave.",
              ],
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
          summary: "Your day first, then the work you run, top to bottom.",
          blocks: [
            {
              kind: "text",
              text: "Today answers one question: what needs me now? It updates by itself. The order is: your attendance strip, Needs you, Client work, My tasks, My clients, This week and Issues.",
            },
            {
              kind: "steps",
              steps: [
                "Start with the attendance strip at the top: it is your own day.",
                "Open Needs you and clear what is waiting for your check.",
                "Look at Client work and My clients for deliverables due soon.",
                "Check My tasks, then This week for what is coming.",
              ],
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
              text: "Needs you lists tasks waiting for your check, suggested tasks to decide, unfinished deliverables to decide and tasks flagged Overdue or Not noted. Tap a line to go straight to it. When it is empty it says “Nothing needs you right now.”",
            },
            {
              kind: "example",
              text: "“2 tasks waiting for your check” opens Approvals. “1 suggested task to decide” opens Suggested tasks.",
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
              text: "Client work lists deliverables on your clients that are overdue or due this week, each with Mark done. My clients is the clients you run. My tasks shows your own tasks that are not noted, have changes requested, are overdue or are due today. This week is a strip of the next days. Issues appears only when something is wrong on a task you created or check: an assignee on leave on a deadline day, or someone who can’t be reached.",
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
          summary: "Start day and End day on the strip at the top of Today.",
          blocks: [
            {
              kind: "text",
              text: "Your attendance strip has one button. It reads Start day when you begin, End day when you finish. On an approved leave day it reads “I’m working today”, and on a day off “I worked today”.",
            },
            {
              kind: "steps",
              steps: [
                "Tap Start day when you begin work.",
                "When you finish, tap End day.",
                "Read “End your day?” and confirm. It is final.",
                "Answer “Any expenses to claim today?” with No or Yes.",
              ],
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
          summary: "A full day, a half day or comp leave, through Me.",
          blocks: [
            {
              kind: "text",
              text: "Your leave is on Me, under Attendance & leave. The Owner approves or declines it. You can withdraw a request while it waits.",
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
          summary: "Change, Ask to cancel and Withdraw, and what the status words mean.",
          blocks: [
            {
              kind: "text",
              text: "Each request row shows what you can do next. Change edits a request. Withdraw takes back a request that is still waiting. Ask to cancel asks the Owner to cancel leave that was already approved.",
            },
            {
              kind: "steps",
              steps: [
                "Open Me, then Attendance & leave.",
                "Find the request on the Leave requests tab.",
                "Tap Change, Ask to cancel or Withdraw.",
                "Confirm. The status word on the row updates.",
              ],
            },
            {
              kind: "example",
              text: "Waiting means the Owner has not decided. Approved and Not approved are the Owner’s decision. Withdrawn is you taking it back. Replaced means a change took its place. Cancelled means the leave was cancelled.",
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
              text: "Me has a row called Extra work & expenses. It has two tabs, Extra work and Expenses. You see only your own entries. The Owner decides every one of them.",
            },
            {
              kind: "steps",
              steps: [
                "Open Me, then Extra work & expenses.",
                "Choose the Extra work or Expenses tab.",
                "Add your entry and send it.",
                "Watch the status on the row until the Owner decides.",
              ],
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
          summary: "What needs you, then every open task by deadline.",
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
          summary: "Every field on New task, and what happens after.",
          blocks: [
            {
              kind: "text",
              text: "Tap New task. The form asks for Start from (only if task templates exist), Title, Type, Priority, Assign to, Deadline and Time (IST), Reminders, Client label, Description, Stages and any custom fields. An event type also asks for the Event date, and may ask for Starts, Ends, Location and Purpose.",
            },
            {
              kind: "steps",
              steps: [
                "Tap New task.",
                "Optionally pick a template under Start from.",
                "Enter the Title, then choose the Type and Priority.",
                "Add people under Assign to and choose the primary owner.",
                "Set the Deadline and Time (IST).",
                `Add a Client label only if it helps. ${CREW} never see client records.`,
                "Tap Create task. The new task opens.",
              ],
            },
            {
              kind: "note",
              text: "Stages can be added only while you create the task. After that you can still add, remove and reorder them from the task page (see the stages topic).",
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
          summary: "You check it when it’s done, then the Owner approves it.",
          blocks: [
            {
              kind: "text",
              text: "When the primary owner taps Mark done, the task goes to review and is locked. Tasks you check come to you first. After your check the task goes to the Owner, who gives the final approval. If you are one of the assignees, your check is skipped and it goes straight to the Owner.",
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
          ],
          keywords: ["approve", "approval route", "review", "done"],
        },
        {
          id: "admin-check-tasks",
          title: "Check a finished task",
          summary: "Approvals shows Tasks to check. Review, Approve or Request changes.",
          blocks: [
            {
              kind: "text",
              text: "Approvals shows one group for you: Tasks to check. Each row has Review and Approve. Approve works at once and shows a 6-second Undo. Review opens the task so you can read it first.",
            },
            {
              kind: "steps",
              steps: [
                "Open Approvals.",
                "Tap Review to read the task, or Approve if it is fine.",
                "After Approve you have 6 seconds to tap Undo.",
                "To send it back, tap Request changes and say what needs to change.",
              ],
            },
            {
              kind: "note",
              text: "On the task page itself there is no Undo. The Undo is on Approvals and on Today.",
            },
          ],
          link: { href: "/approvals", label: "Open Approvals" },
          keywords: ["tasks to check", "approve", "undo", "request changes"],
        },
        {
          id: "admin-task-stages",
          title: "Stages on a task",
          summary: "Who can add, remove and reorder a task’s stages.",
          blocks: [
            {
              kind: "text",
              text: `Assignees tick stages as they go. The ticks lock once the task is marked done. You may add, remove and reorder stages on a task you created or approve, and so may the Owner. ${CREW} never can, even as primary owner.`,
            },
            {
              kind: "steps",
              steps: [
                "Open the task.",
                "Add a stage, or open the menu on a stage to Remove it.",
                "Use Move up and Move down to reorder, or drag the handle.",
              ],
            },
          ],
          keywords: ["stages", "checklist", "reorder", "tick"],
        },
        {
          id: "admin-task-actions",
          title: "Edit, reopen or cancel a task",
          summary: "The ⋯ menu on tasks you created or approve.",
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
              kind: "note",
              text: "Nothing is deleted. A cancelled task stays in the history with its reason.",
            },
          ],
          keywords: ["edit task", "cancel task", "reopen task"],
        },
        {
          id: "admin-task-remind",
          title: "Remind the people on a task",
          summary: "One reminder per hour, from the task page.",
          blocks: [
            {
              kind: "text",
              text: "Remind appears on the task page while the task is with its people and someone else is on it. It tells everyone on the task. You can send it once an hour.",
            },
            {
              kind: "example",
              text: "After you send a reminder the button reads “Reminded · again at 4:05 PM”. You can send the next one then.",
            },
          ],
          keywords: ["remind", "nudge", "reminder"],
        },
        {
          id: "admin-all-tasks",
          title: "All tasks and its filters",
          summary: "Every open task and the latest finished ones, with filters.",
          blocks: [
            {
              kind: "text",
              text: "All tasks shows every open task and the latest finished ones. Filter by State, Deadline (Overdue or Due today), Client, Type, Person and Engagement (Employees or Freelancers), or search by title.",
            },
            {
              kind: "steps",
              steps: [
                "Open Tasks, then All tasks, with filters.",
                "Pick a filter, or type in Search by title.",
                "Tap a row to open the task.",
              ],
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
              text: "People can suggest tasks. They wait under Waiting and move to Decided once you act. You can also suggest a task yourself.",
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
              text: "A task template saves a Name, Type, Priority, Description, Stages and field defaults. In New task, pick it under Start from and the form fills in. Change anything afterwards.",
            },
            {
              kind: "steps",
              steps: [
                "Open Settings, then Templates, and add a task template.",
                "Later, tap New task.",
                "Pick it under Start from.",
                "Adjust the form and tap Create task.",
              ],
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
          summary: "Views, what you see and how to filter.",
          blocks: [
            {
              kind: "text",
              text: "On a laptop pick Day, Week or Month; it opens on Month. On a phone there is no switch: swipe up or down, or use the handle, to move between the week strip, the compact month and the full month. You see full detail on tasks you can open. Other people’s time shows only as Busy or On leave.",
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
          ],
          link: { href: "/calendar", label: "Open Calendar" },
          keywords: ["busy", "on leave", "month", "week", "filter"],
        },
        {
          id: "admin-day-sheet",
          title: "The day sheet and a task from a day",
          summary: "See who is free and add a task on that day.",
          blocks: [
            {
              kind: "text",
              text: "A day sheet shows Who’s free, what is Due, and events. Its footer has “+ New task on ‹day›” and Open day. The New task form opens with that date set.",
            },
            {
              kind: "steps",
              steps: [
                "Tap a day on the calendar.",
                "Check Who’s free.",
                "Tap “+ New task on ‹day›”.",
                "Fill the form and tap Create task.",
              ],
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
          summary: "How the work you run is going, for a week, a month or your own dates.",
          blocks: [
            {
              kind: "text",
              text: "Reports shows how the work you run is going. Choose Week, Month or Custom. Four cards sit at the top: Rework, My turnaround, Overdue now and Acknowledgement lag.",
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
              text: "Clients shows only the clients assigned to you. The list opens on Active. Use the State filter or Search by name. Another Admin’s client is not visible to you. Client deliverables, across all your clients, is one tap away on this screen.",
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
          summary: "A client you add starts Active and is yours.",
          blocks: [
            {
              kind: "text",
              text: "When you add a client it starts Active and you run it. Add the rest on its page.",
            },
            {
              kind: "steps",
              steps: [
                "Open Clients and tap New client.",
                "Enter the Client name. It is the only required field.",
                "Fill any custom fields your company uses.",
                "Save, then add contacts and details on the client page.",
              ],
            },
          ],
          link: { href: "/clients", label: "Open Clients" },
          keywords: ["add client", "new client", "sample client"],
        },
        {
          id: "admin-client-page",
          title: "Inside a client",
          summary: "Overview, Projects, Brand and Activity.",
          blocks: [
            {
              kind: "text",
              text: "A client page has four tabs: Overview, Projects, Brand and Activity. Overview shows the Admin, the primary contact, the contacts, Details and Requirements and notes. Activity is the client’s history, newest first. The header ⋯ menu gives you Edit details.",
            },
            {
              kind: "steps",
              steps: [
                "Open a client.",
                "Tap ⋯, then Edit details, to change its name or facts.",
                "On Overview, tap Add a contact and fill in the Name (required) and, if you like, Designation, Email and Phone.",
                "Open Projects to see its work.",
              ],
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
          summary: "Name it, choose how it repeats, add deliverables, then Create project.",
          blocks: [
            {
              kind: "text",
              text: "On a client’s Projects tab, tap New project. The fields are Start from, Project name, Repeats (One-time, Weekly or Monthly), Delivery date (one-time only), Default stage groups, the Deliverables, Description and any custom fields.",
            },
            {
              kind: "steps",
              steps: [
                "Open the client, then the Projects tab.",
                "Tap New project.",
                "Optionally pick a template under Start from.",
                "Enter the Project name and choose Repeats.",
                "Add the deliverables and check the preview.",
                "Tap Create project.",
              ],
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
              text: "Start from fills the repeat, the default stage groups, the deliverables, and the description and custom fields if they are empty. Search and preview templates opens a library where you can search by template name or deliverable title and preview one before using it.",
            },
            {
              kind: "steps",
              steps: [
                "In New project, tap Search and preview templates.",
                "Type a name or deliverable in the search box.",
                "Tap Preview on a row to see what it makes.",
                "Tap Use this template, or Back to keep looking.",
                "Change anything you need afterwards.",
              ],
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
              text: "In the Add deliverables box, type a Deliverable name and How many (1 to 100). “Reel” × 4 makes Reel 1 to Reel 4. × 1 keeps the name exactly as typed. Tick presets to give them their own stages, or leave none ticked to use the default stages.",
            },
            {
              kind: "steps",
              steps: [
                "Type the Deliverable name.",
                "Set How many.",
                "Tick any stage presets you want, in the order you tick them. Each becomes one group.",
                "Tap Add.",
                "Open a row (⌄) to rename it or edit its stages.",
              ],
            },
          ],
          keywords: ["deliverable", "reel", "quantity", "how many", "preset"],
        },
        {
          id: "admin-project-preview",
          title: "Read the live preview",
          summary: "See what Create makes before anything is saved.",
          blocks: [
            {
              kind: "text",
              text: "The preview sits beside the form on a laptop. On a phone, tap Preview. It shows one card per deliverable, tagged Default stages or Own stages, with its stage groups. Identical neighbours collapse, so Reel 1 to 4 shows as one card with ×4. Tap it to see the names.",
            },
            {
              kind: "steps",
              steps: [
                "Fill in the deliverables.",
                "Open the preview (the Preview button on a phone).",
                "Check the three totals: deliverables, groups, stages.",
                "Tap Back to edit to fix anything, or Create project.",
              ],
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
          summary: "Cycles, the progress ring and the deliverable rows.",
          blocks: [
            {
              kind: "text",
              text: "A repeating project has one cycle per period; use the arrows to move between cycles. The ring shows a percentage, with a line like “12 of 18 stages · 3 of 7 deliverables done”, and either On track or “N behind plan”. At 100% it says the period is complete. Closed and carried deliverables are not counted.",
            },
            {
              kind: "example",
              text: "A row reads “Reel 1 · Planned 18 Oct · 2 days late”. Planned today, Planned 21 Oct and Not planned are the other forms. Stage chips are filled when ticked, outlined for the next stage and dashed for to do.",
            },
            {
              kind: "text",
              text: "Done, closed and carried deliverables sit in the collapsed group “Done and closed (N)”. The Activity button shows the project’s history.",
            },
          ],
          keywords: ["progress", "ring", "cycle", "planned", "stage chips", "on track"],
        },
        {
          id: "admin-add-deliverable",
          title: "Add a deliverable to this month",
          summary: "Add one mid-cycle without changing the list.",
          blocks: [
            {
              kind: "text",
              text: "Tap Add deliverable on the project page. Give a Title, an optional Planned date and Notes. Start from lets you copy the stages of a deliverable template. The default is the project’s default stages.",
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
              kind: "note",
              text: "It joins this cycle only. The Deliverables list for next month stays as it is. The button is hidden once the cycle has ended.",
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
              text: "Tap a deliverable to open its sheet. It shows its state (Open, Done, Closed or Carried), the Planned date, a History button and its stages under group headings. Edit lets you change the Title, Planned date (open only) and Notes. Once it is done, closed or carried, only the title and notes can change.",
            },
            {
              kind: "steps",
              steps: [
                "Open the deliverable.",
                "Tick each stage as it is finished.",
                "Tap Edit stages to add, rename or remove stages for this deliverable only.",
                "Tap Edit to change the title, date or notes.",
              ],
            },
            {
              kind: "note",
              text: "You can tick or untick stages only while the deliverable is open.",
            },
          ],
          keywords: ["tick", "edit stages", "history", "notes"],
        },
        {
          id: "admin-mark-done",
          title: "Mark a deliverable done",
          summary: "Done is the approval. It counts at once.",
          blocks: [
            {
              kind: "text",
              text: "For client work there is no separate approval step. When you tap Mark done, the deliverable counts as approved straight away and its ticks lock. You get a 6-second Undo.",
            },
            {
              kind: "steps",
              steps: [
                "Tap Mark done on the row, or open the deliverable and tap Mark done.",
                "Read the toast “Marked ‹title› done”.",
                "Tap Undo within 6 seconds if it was a mistake.",
              ],
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
              text: "On a done deliverable, tap Reopen… and say what needs to change. It goes back to open and stops counting as done until it is done again. Close deliverable… keeps it in the cycle as closed, not done, and asks why.",
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
              kind: "note",
              text: "Closing cannot be undone. Use Reopen… if you only need more changes.",
            },
          ],
          keywords: ["reopen", "close", "send back", "reason"],
        },
        {
          id: "admin-bulk-actions",
          title: "Mark or tick many at once",
          summary: "Select rows, then Mark N done or Tick a stage on N.",
          blocks: [
            {
              kind: "text",
              text: "Select several deliverables on the project page. Two bulk actions appear: “Mark N done” and “Tick ‹stage› on N”. Each asks you to confirm.",
            },
            {
              kind: "steps",
              steps: [
                "Select the rows you want.",
                "Choose Mark N done, or Tick a stage and pick the stage.",
                "Confirm, for example “Mark N items done?”.",
              ],
            },
          ],
          keywords: ["bulk", "select", "many", "tick a stage"],
        },
        {
          id: "admin-project-activity",
          title: "See what changed on a project",
          summary: "The Activity panel lists every change.",
          blocks: [
            {
              kind: "text",
              text: "Tap Activity on the project page. Use the chips All, Deliverables, Stages and Project to narrow it. It shows the latest 20 entries; tap Show older for more. Each deliverable also has its own History button.",
            },
          ],
          keywords: ["history", "audit", "who changed"],
        },
        {
          id: "admin-complete-cancel-project",
          title: "Complete, cancel or reopen a project",
          summary: "The ⋯ menu on the project page.",
          blocks: [
            {
              kind: "text",
              text: "The project ⋯ menu has Edit details, Default stages, Deliverables list (repeating projects), Save as template, Complete project, and Cancel project… with a reason. A completed or cancelled project is read-only. Reopen project… brings it back.",
            },
            {
              kind: "steps",
              steps: [
                "Open the project and tap ⋯.",
                "Choose Complete project, or Cancel project… and give a reason.",
                "To change anything later, tap ⋯ and choose Reopen project….",
              ],
            },
            {
              kind: "note",
              text: "A banner reads “Completed: read-only.” Every change is refused until you reopen it.",
            },
          ],
          keywords: ["complete", "cancel", "read-only", "reopen project"],
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
              text: "Add a group opens New group, with a Group name and One stage per line. Add from a preset… adds the preset as a new group named after it, and you can rename it. Each group and each stage has a ⋯ menu with Move up, Move down and Remove. On a phone, long press the handle to start a drag.",
            },
            {
              kind: "steps",
              steps: [
                "Tap Add a group, or Add from a preset….",
                "Type the Group name and the stages, one per line.",
                "Type a stage under “Add a stage” and press Enter to add more.",
                "Long press the handle and drag, or use Move up and Move down.",
                "Use Remove group or Remove stage to take one away.",
              ],
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
          summary: "A reusable list of stages, kept in Settings.",
          blocks: [
            {
              kind: "text",
              text: "A stage preset is a flat list of stages you reuse. You can make your own and edit or archive only the ones you made. Each row shows who made it.",
            },
            {
              kind: "steps",
              steps: [
                "Open Settings, then Stage presets.",
                "Tap to add a preset.",
                "Enter the Name and the Stages in order (up to 100).",
                "Tap Add preset.",
              ],
            },
            {
              kind: "note",
              text: "Archiving stops new projects from offering it. Projects that already used it keep their stages.",
            },
          ],
          link: { href: "/settings/stage-presets", label: "Open Stage presets" },
          keywords: ["preset", "stages", "archive"],
        },
        {
          id: "admin-project-template-build",
          title: "Build a project template",
          summary: "Save a whole project shape: repeat, groups and deliverables.",
          blocks: [
            {
              kind: "text",
              text: "In Settings, Templates, add a project template. It has a Name, Repeats, Default stage groups, Deliverables (with × N), a Description and field defaults. A preview follows the form.",
            },
            {
              kind: "steps",
              steps: [
                "Open Settings, then Templates.",
                "Add a project template.",
                "Enter the Name and choose Repeats.",
                "Add the deliverables, using × N where it helps.",
                "Check the preview, then tap Add template.",
              ],
            },
          ],
          link: { href: "/settings/templates", label: "Open Templates" },
          keywords: ["project template", "build", "× N"],
        },
        {
          id: "admin-deliverable-templates",
          title: "Make a deliverable template",
          summary: "A name and stage groups for a kind of deliverable you repeat.",
          blocks: [
            {
              kind: "text",
              text: "A deliverable template holds a Name and its stage groups, with a preview. Use it from Start from in Add deliverable, or when building a project template.",
            },
            {
              kind: "steps",
              steps: [
                "Open Settings, then Templates.",
                "Add a deliverable template.",
                "Name it and build its stage groups.",
                "Check the preview and save.",
              ],
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
              text: "From a project’s ⋯ menu, or a deliverable’s ⋯ menu, tap Save as template. A project template keeps the default stage groups and the deliverables with their stages. A deliverable template keeps its stage groups, with no ticks or dates. The original stays as it is.",
            },
            {
              kind: "steps",
              steps: [
                "Open the project or deliverable and tap ⋯.",
                "Tap Save as template.",
                "Edit the Template name.",
                "Save. A message offers Open templates.",
              ],
            },
          ],
          keywords: ["save as template", "reuse"],
        },
        {
          id: "admin-templates-yours",
          title: "Your templates and the Owner’s",
          summary: "You edit and archive your own; templates are copied, never linked.",
          blocks: [
            {
              kind: "text",
              text: "Templates has Task templates, Project templates and Deliverable templates, with a search box and a Preview button on every client-work row. You edit and archive only the templates you made. The Owner can do it for any. A template is copied into a project when you use it, so later template edits never change existing projects.",
            },
            {
              kind: "note",
              text: "Archiving a template stops it being offered. It does not touch work already made from it. Archived templates can be restored.",
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
          summary: "From stage presets to a project that renews itself every month.",
          blocks: [
            {
              kind: "text",
              text: "A retainer is work that comes back every month. You build it once from small parts, and MaxOff makes a fresh cycle each month. This walk-through uses a monthly retainer for Sample Client.",
            },
            {
              kind: "steps",
              steps: [
                "Make stage presets. In Settings, Stage presets, add “Edit” (Rough cut, Fine cut) and “Review” (Internal check, Final check).",
                "Make a deliverable template. In Settings, Templates, add “Reel” and give it stage groups, for example Edit and Review.",
                "Build a project template named “Monthly retainer” with Repeats set to Monthly and the deliverables Reel × 4 and Post × 2.",
                "Create the project. Open Sample Client, then Projects, then New project. Under Start from pick “Monthly retainer” and check the preview.",
                "Tap Create project. This month’s cycle appears at once.",
              ],
            },
            {
              kind: "example",
              text: "The Monthly retainer makes Reel 1 to Reel 4 and Post 1 to Post 2, each with its stage groups. The preview shows the Reels as one collapsed card marked ×4.",
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
              text: "This month needs one more Post? Add it to the running cycle. Editing stages on a deliverable changes that deliverable only.",
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
              kind: "note",
              text: "Add deliverable affects this cycle only. To change what every month starts with, edit the Deliverables list.",
            },
          ],
          keywords: ["this month", "adjust", "extra post"],
        },
        {
          id: "admin-retainer-monthly",
          title: "What happens every month",
          summary: "A new cycle at 00:00 IST, filled from the Deliverables list.",
          blocks: [
            {
              kind: "text",
              text: "At 00:00 IST on the 1st (Mondays for a weekly project) MaxOff makes a new cycle from the Deliverables list, with each line’s stages. This happens only while the client is Active and the project is open. A Paused client gets no new cycle. A recurring project gets its current period’s cycle as soon as you create it.",
            },
            {
              kind: "steps",
              steps: [
                "Open the project and tap ⋯, then Deliverables list.",
                "Rename or add lines, and open Stages on a line to change them.",
                "To get ahead, tap ⋯ and Start ‹period› and confirm “Start ‹period› now?”.",
              ],
            },
            {
              kind: "note",
              text: "Start ‹period› only appears when the next cycle may start, and the deliverables you named ahead of time are already in place.",
            },
          ],
          keywords: ["new cycle", "00:00", "start early", "deliverables list", "paused"],
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
                "Open the project and tap ⋯, then Save as template.",
                "Name it, for example “Monthly retainer”.",
                "Next time, pick it under Start from in New project.",
              ],
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
          summary: "Every open deliverable on the clients you run.",
          blocks: [
            {
              kind: "text",
              text: "Client deliverables lists the open deliverables of all the clients you run. Filter Open or Overdue, and by client or project. Tap a row to open the project on that deliverable’s cycle.",
            },
            {
              kind: "steps",
              steps: [
                "Open Clients, then Client deliverables.",
                "Choose Open or Overdue.",
                "Narrow by Every client or Every project if needed.",
                "Tap a row to open it.",
              ],
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
          summary: "Notifications, Job titles, Stage presets, Custom fields and Templates.",
          blocks: [
            {
              kind: "text",
              text: "You see five sections. Notifications shows who on your open tasks can’t be reached. Job titles are the titles people can be given. Stage presets and Templates are covered in their own topics. Custom fields are extra fields on clients and contacts.",
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
          summary: "People on your open tasks who will miss a push.",
          blocks: [
            {
              kind: "text",
              text: "Settings, Notifications lists people on your open tasks who can’t be reached by push, and why. When all is well it says “Everyone on your open tasks can be reached.”",
            },
            {
              kind: "steps",
              steps: [
                "Open Settings, then Notifications.",
                "Read the Can’t be reached list.",
                "Ask that person to turn on notifications on their phone.",
              ],
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
              text: "Job titles are just labels: they never change what someone can do. Custom fields add extra fields to clients and contacts, either for everyone or for one client.",
            },
            {
              kind: "steps",
              steps: [
                "Open Settings.",
                "Choose Job titles or Custom fields.",
                "Add or change an entry and save.",
              ],
            },
          ],
          link: { href: "/settings/job-titles", label: "Open Job titles" },
          keywords: ["job title", "custom field", "client fields"],
        },
      ],
    },
    {
      id: "notifications",
      title: "Notifications",
      topics: [
        {
          id: "admin-alerts",
          title: "Read your Alerts",
          summary: "Each alert is a tap away from what it is about.",
          blocks: [
            {
              kind: "text",
              text: "Alerts lists your notifications, newest day first. Filter All or Unread, tap Mark all read to clear the count, and tap an alert to open what it is about. The back control then reads Alerts.",
            },
            {
              kind: "steps",
              steps: [
                "Tap the bell.",
                "Choose All or Unread.",
                "Tap an alert to open it.",
                "Tap Mark all read when you are done.",
              ],
            },
          ],
          link: { href: "/notifications", label: "Open Alerts" },
          keywords: ["bell", "unread", "mark all read"],
        },
        {
          id: "admin-push",
          title: "Turn on push on this device",
          summary: "Set it up once on Me, on each phone or laptop.",
          blocks: [
            {
              kind: "text",
              text: "Push notifications are set up per device. On Me, under Notifications, tap Turn on. When it works it says “Notifications are on for this device”. Your devices shows where your notifications go.",
            },
            {
              kind: "steps",
              steps: [
                "Open Me.",
                "Under Notifications, tap Turn on (or Turn on here).",
                "Allow notifications when asked.",
                "On an iPhone, first add MaxOff to the Home Screen and open it from there.",
              ],
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
          "Some buttons are the Owner’s: client states, assigning an Admin, deciding attendance, leave and expenses, final task approval, Task types and Thresholds. Others depend on the step: Approve appears only after the primary owner marks a task done; Edit task and Cancel task appear only on tasks you created or approve; a completed project is read-only until it is reopened; and there is no New project on an Inactive client.",
        ),
        ...COMMON_HELP_TOPICS,
      ],
    },
  ],
};
