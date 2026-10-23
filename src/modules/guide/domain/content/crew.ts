import type { Guide } from "../types";
import { COMMON_HELP_TOPICS, missingButtonTopic } from "./common";

/** The guide for the role shown as ROLE_LABELS.staff. Describes only what is built today. */
export const CREW_GUIDE: Guide = {
  role: "staff",
  sections: [
    {
      id: "getting-around",
      title: "Getting around",
      topics: [
        {
          id: "nav-bar",
          title: "Find your way around",
          summary: "Five tabs on a phone, a sidebar on a laptop.",
          blocks: [
            {
              kind: "text",
              text: 'On a phone, the bar at the bottom has five tabs. With very large text set on the phone, it shows their icons only. On a laptop, the same places sit in the sidebar, and Leave is called "Attendance & leave".',
            },
            {
              kind: "steps",
              steps: [
                "My Day: your working day and what needs you today.",
                "Tasks: the work given to you.",
                "Calendar: your events, due dates, leave and holidays.",
                "Leave: attendance and leave requests.",
                "Me: your profile, your own pages, notifications and help.",
              ],
            },
            {
              kind: "note",
              text: '"Extra work & expenses" is in the laptop sidebar. On a phone it is on Me, under "My work", beside Attendance & leave: "Note extra work and claim what you spent."',
            },
            {
              kind: "text",
              text: "On a phone each screen has one bar at the top: the back arrow (or, on a main tab, the small MaxOff “M”, which takes you to your home screen), the title, the screen's ⋯ menu when it has one, and the bell. A ⋯ menu opens as a sheet from the bottom; back closes it.",
            },
            {
              kind: "text",
              text: "Help (this guide) is in the Help section of Me, and on a laptop also in the account menu under your name and at the foot of the sidebar.",
            },
          ],
          link: { href: "/my-day", label: "Open My Day" },
          keywords: ["menu", "tabs", "navigation", "home", "sidebar", "where is"],
        },
        {
          id: "nav-alerts",
          title: "Open your alerts",
          summary: "The bell opens the Alerts screen.",
          blocks: [
            {
              kind: "steps",
              steps: [
                "Look for the bell. On a phone it sits in the title bar of each page. On a laptop it is in the top bar.",
                'Tap the bell to open "Alerts".',
              ],
            },
            {
              kind: "note",
              text: "On a laptop the bell shows a count of unread alerts.",
            },
          ],
          link: { href: "/notifications", label: "Open Alerts" },
          keywords: ["bell", "notifications", "unread", "messages"],
        },
      ],
    },
    {
      id: "my-day",
      title: "My Day",
      topics: [
        {
          id: "my-day-screen",
          title: "Read My Day",
          summary: "Your day at the top, then only what needs you.",
          blocks: [
            {
              kind: "steps",
              steps: [
                {
                  text: 'Open My Day. Today\'s date is under the title, and the line at the top shows where your day stands, such as "Start your day" (highlighted).',
                  shot: "staff/my-day",
                },
                "Tap the words in that line to open your attendance.",
                'Read the groups below it: "Not noted", "Changes requested", "Overdue" and "Due today".',
                '"This week" names each of your deadlines with its time, your events with their place, holidays and your own leave. Tap a row to open it; "Calendar" opens the calendar.',
              ],
            },
            {
              kind: "next",
              text: 'If nothing is waiting, it says "Nothing needs you today."',
            },
            {
              kind: "note",
              text: 'On a laptop "This week" is a column on the right; in a narrow window or on a phone it sits below. "Suggest a task" is a quiet link at the bottom.',
            },
          ],
          link: { href: "/my-day", label: "Open My Day" },
          keywords: ["home", "today", "dashboard", "what's next", "due"],
        },
        {
          id: "start-day",
          title: "Start your day",
          summary: "Record that you are working. The start time is the moment you tap.",
          blocks: [
            {
              kind: "steps",
              steps: [
                "Open My Day.",
                {
                  text: 'Tap "Start day" (highlighted) in the line at the top. It shows the time it will record, such as "Start day · 9:41 am".',
                  shot: "staff/start-day",
                },
                'Wait for "Your day has started".',
              ],
            },
            {
              kind: "next",
              text: "Your attendance shows you as working. When you finish, tap End day.",
            },
            {
              kind: "note",
              text: "There is no confirmation, so tap it when you actually begin. If your day is already started on another device, MaxOff tells you and refreshes. On a half day, Start day and End day still work.",
            },
          ],
          link: { href: "/my-day", label: "Open My Day" },
          keywords: ["attendance", "check in", "clock in", "begin", "present"],
        },
        {
          id: "started-working-prompt",
          title: 'The "Started working?" prompt',
          summary: "A reminder to start your day, or to choose leave.",
          blocks: [
            {
              kind: "text",
              text: 'On a working day, when you open the app and have not started, MaxOff asks "Started working?". It does not appear on a day off, on approved leave, or on your joining day.',
            },
            {
              kind: "steps",
              steps: [
                'Tap "Start day" if you are working.',
                'Or tap "On leave today? Choose leave".',
                "Pick Leave (the whole day off) or Half day, and add a reason if you like.",
                'Tap "Record leave".',
              ],
            },
            {
              kind: "next",
              text: 'You see "Sent to the Owner". If you choose "Just looking", the prompt comes back when you next open the app, but not more than once every 30 minutes.',
            },
            {
              kind: "note",
              text: "Comp leave cannot be chosen here. Request it from Attendance & leave.",
            },
          ],
          keywords: ["popup", "reminder", "ask", "leave today", "just looking"],
        },
        {
          id: "end-day",
          title: "End your day",
          summary: "Record that you have finished. It is final for the day.",
          blocks: [
            {
              kind: "steps",
              steps: [
                'Open My Day and tap "End day". "End your day?" asks you to confirm.',
                'Answer "Any expenses to claim today?". Choose Yes to add them next.',
                'If you worked late, tap "Worked late? Add an overtime note" and say roughly how long and what you did.',
                {
                  text: 'Tap "End day" (highlighted).',
                  shot: "staff/end-day",
                },
              ],
            },
            {
              kind: "example",
              text: 'You finish at 7:15 pm after a long edit. Tap End day, choose Yes for expenses, add the claim, then tap "Done".',
            },
            {
              kind: "next",
              text: 'You see "Your day has ended". You can keep using MaxOff afterwards.',
            },
            {
              kind: "note",
              text: 'The end time is now, and it is final for today: there is no resume. If you choose Yes for expenses, the button reads "End day, add expenses" and the claim form opens.',
            },
          ],
          link: { href: "/my-day", label: "Open My Day" },
          keywords: ["finish", "check out", "clock out", "overtime", "expenses", "leave work"],
        },
        {
          id: "forgot-end-day",
          title: "I forgot to end my day",
          summary: "You can still end it, until the cutoff the next morning.",
          blocks: [
            {
              kind: "text",
              text: "At 8:30 pm MaxOff reminds you: \"You haven't ended your day.\" If you forget completely, you can end yesterday's day the next morning.",
            },
            {
              kind: "steps",
              steps: [
                'Open My Day. The line reads "Yesterday not ended".',
                'Tap "End day".',
                "Read \"End yesterday's day?\". The end time recorded is now, on yesterday's day.",
                "Confirm.",
              ],
            },
            {
              kind: "next",
              text: "Yesterday is closed, and the end time is final.",
            },
            {
              kind: "note",
              text: 'You can do this only before the cutoff (5:00 am unless the Owner changed it) and before you start today. After that, the day stays "End of day not recorded" and no end time is made up. Put the late work in an overtime note instead. The Owner can see which days were not ended.',
            },
          ],
          link: { href: "/my-day", label: "Open My Day" },
          keywords: ["missed", "late", "yesterday", "not ended", "reminder", "8:30"],
        },
        {
          id: "work-on-day-off",
          title: "Working on a day off or leave day",
          summary: "Tell the Owner you worked, so the day is counted.",
          blocks: [
            {
              kind: "text",
              text: 'On a day off, the button on My Day reads "I worked today". On a day of leave, it reads "I\'m working today".',
            },
            {
              kind: "steps",
              steps: [
                "Open My Day.",
                'Tap "I worked today" or "I\'m working today".',
                "Read the message and confirm.",
              ],
            },
            {
              kind: "next",
              text: 'You see "Sent to the Owner", who decides. Your leave request stays as it is.',
            },
            {
              kind: "note",
              text: 'If you forgot, you can still tell the Owner within the last 7 days from the Attendance tab, using "I worked that day".',
            },
          ],
          link: { href: "/leave/attendance", label: "Open Attendance" },
          keywords: ["sunday", "holiday", "weekly off", "comp leave", "worked", "extra day"],
        },
      ],
    },
    {
      id: "leave",
      title: "Attendance and leave",
      topics: [
        {
          id: "request-leave",
          title: "Request leave",
          summary: "Ask for a full day or a half day off. The Owner decides.",
          blocks: [
            {
              kind: "steps",
              steps: [
                "Open Leave.",
                {
                  text: 'Tap "Request leave". Choose the "Kind of leave" (highlighted): Leave or Half day.',
                  shot: "staff/request-leave",
                },
                'If you have comp leave, the line above the dates says how much is left. Pick the "First day" and "Last day" (an empty one reads "Choose a date"; tap it to open the calendar). A half day has a single "Date".',
                'Under the dates MaxOff shows how long it is, such as "2 days".',
                "Add a reason if you like. It is optional.",
                'Tap "Request leave".',
              ],
            },
            {
              kind: "example",
              text: "Two days off from Monday 9 Nov to Tuesday 10 Nov: Kind of leave = Leave, First day = 9 Nov, Last day = 10 Nov.",
            },
            {
              kind: "next",
              text: 'You see "Leave requested". The Owner approves or declines it.',
            },
            {
              kind: "note",
              text: "You can withdraw a request while it waits.",
            },
          ],
          link: { href: "/leave", label: "Open Leave" },
          keywords: ["holiday", "time off", "day off", "vacation", "half day", "sick", "absent"],
        },
        {
          id: "comp-leave",
          title: "Use comp leave",
          summary: "Spend a comp leave credit. Only shown when you have one.",
          blocks: [
            {
              kind: "text",
              text: 'When the Owner has granted you comp leave, "Request leave" also offers "Comp leave (1 day)" and "Comp leave, half day (½)". The hint tells you how much you have and the date to use it by.',
            },
            {
              kind: "steps",
              steps: [
                'Open Leave and tap "Request leave".',
                "Choose a comp leave kind. If you do not have credit, these are not shown.",
                "Pick a working day before the use-by date.",
                'Tap "Request leave".',
              ],
            },
            {
              kind: "next",
              text: 'The Owner decides. Under your requests you see "Comp leave: N · use by …".',
            },
            {
              kind: "note",
              text: "Comp leave cannot be changed. To move it, cancel it and request it again.",
            },
          ],
          link: { href: "/leave", label: "Open Leave" },
          keywords: ["compensatory", "credit", "earned", "use by", "balance"],
        },
        {
          id: "change-leave",
          title: "Withdraw, change or cancel leave",
          summary: "What you can do depends on the request's status.",
          blocks: [
            {
              kind: "steps",
              steps: [
                {
                  text: 'Open Leave and find the request. While it is "Waiting", tap "Withdraw" (highlighted).',
                  shot: "staff/leave-list",
                },
                'Once it is approved and has not ended, tap "Change this leave" or ask to cancel.',
              ],
            },
            {
              kind: "next",
              text: 'A change or cancellation goes to the Owner. You see "Change sent to the Owner" or "Cancellation sent to the Owner".',
            },
            {
              kind: "note",
              text: 'Only one change can be open at a time. Leave you chose at the start-of-day prompt cannot be withdrawn. Leave that has already ended says "This leave has ended. Ask the Owner to correct it."',
            },
          ],
          link: { href: "/leave", label: "Open Leave" },
          keywords: ["undo", "cancel", "edit", "reschedule", "withdraw", "move"],
        },
        {
          id: "leave-status",
          title: "What the status words mean",
          summary: "Waiting, Approved, Not approved and the rest.",
          blocks: [
            {
              kind: "steps",
              steps: [
                "Waiting: the Owner has not decided yet.",
                "Approved: the leave is on.",
                'Not approved: the Owner declined. You see "The Owner\'s reason: …".',
                "Withdrawn: you took the request back.",
                "Replaced: a change you asked for took its place.",
                'Cancelled, or "Leave cancelled": the leave was cancelled.',
              ],
            },
            {
              kind: "note",
              text: '"Set by the Owner" marks leave the Owner created for you.',
            },
          ],
          link: { href: "/leave", label: "Open Leave" },
          keywords: ["rejected", "declined", "pending", "approved", "decision", "reason"],
        },
        {
          id: "attendance-tab",
          title: "Check your attendance",
          summary: "See your days a month at a time. Only the Owner corrects a day.",
          blocks: [
            {
              kind: "steps",
              steps: [
                {
                  text: 'Open Leave and tap the "Attendance" tab (highlighted).',
                  shot: "staff/attendance-tab",
                },
                'Use "Previous month" and "Next month" to move. Each row has the date, how it was recorded, the start and end times ("Not recorded" for a start or end that never came; today\'s end shows "—" until you end the day), and notes.',
                "Open a day to read the Owner's reason and its history.",
              ],
            },
            {
              kind: "next",
              text: "If a day looks wrong, ask the Owner: the line under the table says so too. The original always stays beside the correction.",
            },
            {
              kind: "note",
              text: 'Only the Owner corrects a day. In the last 7 days, each row has "Add overtime note", or "I worked that day" on a day off.',
            },
          ],
          link: { href: "/leave/attendance", label: "Open Attendance" },
          keywords: ["history", "wrong", "correct", "record", "present", "absent", "mistake"],
        },
      ],
    },
    {
      id: "tasks",
      title: "Tasks",
      topics: [
        {
          id: "my-tasks",
          title: "Find your tasks",
          summary: "See the work given to you, grouped by what needs you.",
          blocks: [
            {
              kind: "steps",
              steps: [
                {
                  text: 'Open Tasks. "My tasks" starts with "Not noted" (highlighted), then "Changes requested", "Due today", "Upcoming" and "Overdue". A group with nothing in it is not shown.',
                  shot: "staff/my-tasks",
                },
                'At the bottom are "N tasks with the reviewers", "All my tasks" and "Your suggestions".',
                'On a laptop, "This week" sits beside the list (below it on a narrow window), as on My Day: each of your deadlines by name and time, your events with their place, holidays and your own leave. A phone shows only the list.',
                'Each row shows the task on one line, who and when under it, a speech bubble with the number of new comments beside the title, and chips on the right of the title, such as a red "2 days late" or "3 h late" on a late task, and the task\'s state, then ›. On a small phone a long chip is shortened with “…”; the task\'s page shows it in full. Tap a task to open it.',
              ],
            },
            {
              kind: "next",
              text: 'An empty list says "Nothing on your list".',
            },
            {
              kind: "note",
              text: "You do not create tasks yourself; you can suggest one.",
            },
          ],
          link: { href: "/tasks", label: "Open Tasks" },
          keywords: ["to do", "work", "assigned", "list", "due", "overdue", "all tasks"],
        },
        {
          id: "task-page",
          title: "Read a task page",
          summary: "The top line says what is needed from you.",
          blocks: [
            {
              kind: "steps",
              steps: [
                'Open a task. The top shows its state as a chip (beside the title on a laptop) and its priority, then the due time on its own line, such as "Due today 6:00 pm · in 3 h", in red when overdue.',
                "Read the box under it. It says what is needed from you.",
                'Switch between "Work" (the brief, "Stages" and the hand-in), "Chat" and "Details" (who is on it and about the task). The clock in the header opens the task\'s History, where your own changes read "You".',
              ],
            },
            {
              kind: "note",
              text: 'There is one next-step button at a time, such as "Mark done". On a laptop it sits at the top, beside the History clock; on a phone it sits in a bar at the bottom.',
            },
          ],
          link: { href: "/tasks", label: "Open Tasks" },
          keywords: ["brief", "details", "status", "due", "priority", "activity"],
        },
        {
          id: "task-noted",
          title: "Note a task, then start work",
          summary: 'Say you have seen a task with "Task Noted", then begin.',
          blocks: [
            {
              kind: "steps",
              steps: [
                'Open the task. It says "Tap Task Noted to say you\'ve seen it."',
                {
                  text: 'Tap "Task Noted" (highlighted).',
                  shot: "staff/task-noted",
                },
                'When you begin, tap "Start work". Only the primary owner starts the work.',
                "Tick the stages as you finish them.",
              ],
            },
            {
              kind: "next",
              text: 'You see "Noted". People on the task show as "Noted" or "Not noted".',
            },
            {
              kind: "note",
              text: "Noting is not finishing. Every assignee notes the task, but only the primary owner marks it done.",
            },
          ],
          link: { href: "/tasks", label: "Open Tasks" },
          keywords: ["acknowledge", "seen", "accept", "start", "begin", "noted"],
        },
        {
          id: "task-stages",
          title: "Tick off stages",
          summary: "Tick stages as you finish them. You never reorder them.",
          blocks: [
            {
              kind: "steps",
              steps: [
                {
                  text: "Open the task while it is with you. Find the Stages list (highlighted).",
                  shot: "staff/task-stages",
                },
                "Tick each stage as it is done.",
              ],
            },
            {
              kind: "next",
              text: 'The count shows "N of M done" and each tick shows who made it.',
            },
            {
              kind: "note",
              text: "You cannot add, remove or reorder a task's stages. A task's stages may be reordered only by the Owner, its creator or its approving Admin. Stages are locked once the task is handed in: \"Locked while it's with the reviewers. Chat stays open.\" If stages look wrong, tell the person who made the task in the chat.",
            },
          ],
          link: { href: "/tasks", label: "Open Tasks" },
          keywords: ["checklist", "steps", "tick", "order", "reorder", "locked", "add stage"],
        },
        {
          id: "mark-done",
          title: "Hand in your work with Mark done",
          summary: "Send your finished work for review. Only the primary owner does this.",
          blocks: [
            {
              kind: "steps",
              steps: [
                'Open the task and tap "Mark done".',
                {
                  text: "Add a note (highlighted) if you like, such as a link to the work (a Drive folder, for example).",
                  shot: "staff/mark-done",
                },
                'If the task is overdue, answer "Why is it late?". It is required.',
                "Send it.",
              ],
            },
            {
              kind: "example",
              text: 'Reel 1 edit is due at 6:00 pm and you finish at 6:40 pm. In the hand-in, link the folder and answer "Why is it late?" with the reason.',
            },
            {
              kind: "next",
              text: 'Your hand-in appears in the "Hand-in" section and the task goes for review. It is locked until then; comments stay open.',
            },
            {
              kind: "note",
              text: "Other assignees note the task, tick stages and comment, but do not mark it done. If you are a coordinator for a freelancer, you hand in for them.",
            },
          ],
          link: { href: "/tasks", label: "Open Tasks" },
          keywords: ["finish", "complete", "submit", "done", "late", "hand in", "link", "review"],
        },
        {
          id: "changes-requested",
          title: "When changes are requested",
          summary: "Read the reason, make the changes, then Mark done again.",
          blocks: [
            {
              kind: "text",
              text: 'If a reviewer wants changes, the task comes back to you as "Changes requested". Stages open up again.',
            },
            {
              kind: "steps",
              steps: [
                "Open the task and read the box. It says who asked for changes and why.",
                "Make the changes. Ask in the chat if something is unclear.",
                'Tap "Mark done again".',
              ],
            },
            {
              kind: "next",
              text: "Your new hand-in is added to the earlier ones and goes for review again.",
            },
            {
              kind: "note",
              text: 'If a finished task is reopened, it is back with you. Your old hand-in is folded away under "Earlier hand-in · reopened ‹date›: ‹reason›"; tap it to read it.',
            },
          ],
          link: { href: "/tasks", label: "Open Tasks" },
          keywords: ["rework", "redo", "feedback", "returned", "revise", "fix", "reopened"],
        },
        {
          id: "task-chat",
          title: "Chat on a task",
          summary: "Ask a question or share a link on the task.",
          blocks: [
            {
              kind: "steps",
              steps: [
                'Open the task and tap "Chat". On a phone it opens full screen; ‹ takes you back to the task. On a laptop it fills the screen under the tabs; scroll down and the tabs stay at the top while the chat grows, and ⤢ at the right end of the chat’s header, beside the names, opens it large (Esc, ✕ or back closes it).',
                'Tap "Message…" at the bottom and type. The box grows as you write.',
                "Tap the round send button. On a laptop, Enter sends and Shift+Enter starts a new line.",
              ],
            },
            {
              kind: "next",
              text: 'Everyone on the task sees your message. Yours sit on the right; others\' on the left with their photo and name. The tab shows "Chat · N new" when something is unread.',
            },
            {
              kind: "text",
              text: 'Chat opens at a red "New" line where unread messages start, otherwise at the latest. Days are divided ("Today", "Yesterday", "Mon 20 Oct"). Quiet lines in the middle show when someone noted the task, the deadline moved or a reminder went out; the full story is in History (the clock in the header).',
            },
            {
              kind: "text",
              text: 'If you scroll up and a message arrives, tap "Jump to latest". Older messages appear when you tap "Load earlier" at the top.',
            },
            {
              kind: "note",
              text: "Chat stays open even while the task is with the reviewers.",
            },
          ],
          link: { href: "/tasks", label: "Open Tasks" },
          keywords: ["comment", "message", "discussion", "ask", "reply", "new", "load earlier"],
        },
        {
          id: "freelancer-tasks",
          title: "Tasks for a freelancer you coordinate",
          summary: "You note, start and hand in on their behalf.",
          blocks: [
            {
              kind: "text",
              text: 'If you coordinate a freelancer, their tasks appear on your list marked "For ‹their name›" or "You, and for ‹their name›".',
            },
            {
              kind: "steps",
              steps: [
                "Open the task from your list.",
                'Tap the button with their name, such as "Noted for ‹their name›", "Start work for ‹their name›" or "Mark done for ‹their name›".',
                'In the chat, use "Writing as" to choose yourself or the freelancer.',
              ],
            },
            {
              kind: "example",
              text: 'A freelancer you coordinate finishes Shoot prep and sends you the link. You open the task and tap "Mark done for ‹their name›".',
            },
            {
              kind: "note",
              text: 'On Me, under My work, "Your freelancers" lists them with a phone link each.',
            },
          ],
          link: { href: "/me", label: "Open Me" },
          keywords: ["coordinator", "external", "outsourced", "on behalf", "freelance"],
        },
        {
          id: "suggest-task",
          title: "Suggest a task",
          summary: "Send an idea; the Owner or an Admin turns it into a task.",
          blocks: [
            {
              kind: "text",
              text: "You cannot create tasks, but you can suggest one. The button is on My tasks, on My Day and on a day in the Calendar.",
            },
            {
              kind: "steps",
              steps: [
                'Tap "Suggest a task".',
                {
                  text: 'Write "What needs doing" (highlighted).',
                  shot: "staff/suggest-task",
                },
                'Add "Details (optional)" if it helps.',
                'Tap "Send suggestion".',
              ],
            },
            {
              kind: "next",
              text: 'You see "Suggestion sent". The Owner or an Admin makes it a task, or says why not. "Your suggestions" opens the "Suggested tasks" page, with "Waiting" and "Decided".',
            },
            {
              kind: "note",
              text: "The words are Waiting, Became a task, Declined and Withdrawn. You can withdraw your own suggestion while it waits.",
            },
          ],
          link: { href: "/tasks/requests", label: "Open Suggested tasks" },
          keywords: ["request", "idea", "new task", "propose", "ask for", "create"],
        },
      ],
    },
    {
      id: "calendar",
      title: "Calendar",
      topics: [
        {
          id: "calendar-what",
          title: "What the Calendar shows you",
          summary: "Your events, due dates, leave and holidays.",
          blocks: [
            {
              kind: "steps",
              steps: [
                {
                  text: "Open Calendar. Today’s date is a red circle on a lightly shaded box.",
                  shot: "staff/calendar",
                },
                "Read it: your own event tasks (name, then time) and your freelancers' tasks, each due task by name (amber, red when overdue), your own leave as a soft grey striped bar, holidays and weekly offs (grey). Done things are dimmed with a ✓. A day with more than fits ends in “+N more”; tap it to see the whole day.",
                'Use the "Type" filter to show fewer things.',
                'Open a day and tap "Suggest a task". The day is filled in for you.',
              ],
            },
            {
              kind: "note",
              text: 'You do not see anyone else\'s leave. Your own request still waiting is marked "· requested".',
            },
          ],
          link: { href: "/calendar", label: "Open Calendar" },
          keywords: ["events", "schedule", "holiday", "dates", "filter", "weekly off"],
        },
        {
          id: "calendar-phone",
          title: "Use the Calendar on a phone or laptop",
          summary: "Swipe between sizes on a phone; Day, Week, Month on a laptop.",
          blocks: [
            {
              kind: "text",
              text: "On a phone there is one calendar in three sizes: a week strip, a compact month and a full month.",
            },
            {
              kind: "steps",
              steps: [
                "On a phone, swipe, or tap the handle, to change size.",
                'The day you choose shows under the calendar, with a timeline of the hours around its events; scroll the page to see all of it. The header has "Today" and "Filters" (an icon, with a dot while a filter is on).',
                'On a laptop, choose "Day", "Week" or "Month". It opens on Month. ‹ and › on either side of the month’s name move back and forward, and "Today" just after them brings you back (dimmed while today is already on screen); "Filters" is at the right.',
                'On a phone, a day of the full month opens in a sheet with its timeline and "Suggest a task". On a laptop a day opens in a dialog with "Open day".',
              ],
            },
            {
              kind: "note",
              text: 'Laptop shortcuts: arrow keys to move, T for today, D, W and M for the view. An empty day says "Nothing on this day." A day you are on leave shows "You · On leave" ("You · Leave" where a laptop’s day is narrow; it is never cut short).',
            },
          ],
          link: { href: "/calendar", label: "Open Calendar" },
          keywords: ["swipe", "month", "week", "day", "timeline", "today", "keyboard"],
        },
      ],
    },
    {
      id: "extra-work",
      title: "Extra work and expenses",
      topics: [
        {
          id: "extra-work-note",
          title: "Note overtime or a day worked off",
          summary: "Tell the Owner. The Owner decides if it earns comp leave.",
          blocks: [
            {
              kind: "steps",
              steps: [
                'Open Extra work & expenses and tap "Add note".',
                'Pick the "Day" (one of the last 7).',
                {
                  text: 'Say roughly how long (optional) and "What you worked on" (highlighted).',
                  shot: "staff/extra-work-note",
                },
                "Send it.",
              ],
            },
            {
              kind: "example",
              text: 'Yesterday you stayed until 9:30 pm on Reel 1 edit. Choose yesterday, write "About 2 hours" and "Reel 1 edit".',
            },
            {
              kind: "next",
              text: 'You see "Note sent to the Owner". The outcome shows on the "Extra work" tab: "Waiting for the Owner", "N comp leave granted · use by …" or "Reviewed by the Owner". A comp leave card at the top shows what you have to use.',
            },
            {
              kind: "note",
              text: "Nothing is automatic. The Owner decides whether a note earns comp leave.",
            },
          ],
          link: { href: "/leave/extra-work", label: "Open Extra work" },
          keywords: [
            "overtime",
            "comp leave",
            "late",
            "sunday",
            "day off",
            "extra hours",
            "compensatory",
          ],
        },
        {
          id: "add-expense",
          title: "Claim an expense",
          summary: "Claim what you spent for work. The Owner pays it with your salary.",
          blocks: [
            {
              kind: "steps",
              steps: [
                'Open the "Expenses" tab and tap "Add expense".',
                'Enter "Amount (₹)" (the ₹ is already in the field: type the number), "Category" and "Date".',
                'Write "What was it for?".',
                {
                  text: "Add a receipt photo (highlighted), if one is needed.",
                  shot: "staff/add-expense",
                },
                'Tap "Add claim".',
              ],
            },
            {
              kind: "next",
              text: "The Owner approves it and pays it with your salary. You can withdraw it while it waits.",
            },
            {
              kind: "note",
              text: "A receipt photo is needed when the amount is above the Owner's limit, which is ₹500 unless the Owner changed it. At exactly ₹500, none is needed. The date must be this month, or last month until the 5th. You can also add claims when you end your day.",
            },
          ],
          link: { href: "/leave/expenses", label: "Open Expenses" },
          keywords: [
            "bill",
            "receipt",
            "reimbursement",
            "spent",
            "money",
            "claim",
            "petrol",
            "photo",
          ],
        },
        {
          id: "expense-status",
          title: "Follow an expense claim",
          summary: "Waiting, approved, paid or rejected, and who sees it.",
          blocks: [
            {
              kind: "steps",
              steps: [
                'Waiting for the Owner: you can still "Withdraw" it.',
                "Approved · not paid yet: the Owner agreed; payment comes next.",
                "Paid on …: it was paid with your salary.",
                "Rejected: the Owner gives a reason.",
              ],
            },
            {
              kind: "note",
              text: "Only you and the Owner can see your claims. Nobody else does, and a receipt is shown only to you and the Owner.",
            },
          ],
          link: { href: "/leave/expenses", label: "Open Expenses" },
          keywords: ["status", "paid", "rejected", "withdraw", "privacy", "waiting", "who can see"],
        },
      ],
    },
    {
      id: "notifications",
      title: "Alerts and your phone",
      topics: [
        {
          id: "alerts-screen",
          title: "Read your alerts",
          summary: "Each alert is a tap away from what it is about.",
          blocks: [
            {
              kind: "steps",
              steps: [
                'Open "Alerts" from the bell.',
                "Tap an alert to go straight to the task, leave or claim it is about.",
                {
                  text: 'Switch between "All" and "Unread", and tap "Mark all read" (highlighted) to clear the count.',
                  shot: "staff/alerts",
                },
              ],
            },
            {
              kind: "next",
              text: 'When there is nothing, it says "Nothing yet" or "You\'re all caught up".',
            },
            {
              kind: "note",
              text: "Alerts is one list grouped by day: Today, Yesterday, Earlier this week, then Older. “Show older” at the end adds the next ones. Each row starts with the photo (or initials) of the person who caused it, or a bell when MaxOff sent it itself. An unread alert has a red dot, a bold title and a slightly lighter row; times read like 6:00 pm.",
            },
          ],
          link: { href: "/notifications", label: "Open Alerts" },
          keywords: ["notifications", "unread", "mark all read", "bell", "inbox"],
        },
        {
          id: "notifications-turn-on",
          title: "Turn notifications on",
          summary: "Do it once on each phone or laptop you use.",
          blocks: [
            {
              kind: "steps",
              steps: [
                {
                  text: 'Open Me and find the "Notifications" section (highlighted).',
                  shot: "staff/me-notifications",
                },
                'Tap "Turn on", or "Turn on here" if your phone already has them on.',
                "Allow notifications when asked.",
              ],
            },
            {
              kind: "next",
              text: 'You see "Notifications are on for this device."',
            },
            {
              kind: "note",
              text: "On an iPhone, add MaxOff to the Home Screen first. If it still does not work, see Help and troubleshooting at the end of this guide.",
            },
          ],
          link: { href: "/me", label: "Open Me" },
          keywords: ["push", "enable", "allow", "alerts", "iphone", "phone"],
        },
        {
          id: "use-me",
          title: "Use Me",
          summary: "Your profile, your own pages, notifications and help, in one place.",
          blocks: [
            {
              kind: "text",
              text: "Me opens with who you are: your photo, name and sign-in email, with Edit profile beside them to change your name or phone. Then, in this order: My work (Attendance & leave, Extra work & expenses), Notifications (this device, Your devices and Send a test notification), Appearance, and Help (this guide and Reload app). Sign out of this device is the last button, and the app's version is the small line at the very bottom.",
            },
            {
              kind: "steps",
              steps: [
                "Tap Me in the bottom bar (on a laptop, in the sidebar).",
                "Tap Edit profile to change your name or phone, then Save.",
                "Tap a row under My work or Help to open it.",
              ],
            },
          ],
          link: { href: "/me", label: "Open Me" },
          keywords: ["profile", "account", "photo", "phone number", "help", "version"],
        },
        {
          id: "appearance",
          title: "Change light or dark",
          summary: "Choose Light, Dark or System on Me.",
          blocks: [
            {
              kind: "steps",
              steps: ['Open Me and find "Appearance".', "Choose Light, Dark or System."],
            },
            {
              kind: "note",
              text: "System follows your phone.",
            },
          ],
          link: { href: "/me", label: "Open Me" },
          keywords: ["dark mode", "theme", "light", "night", "colours"],
        },
        {
          id: "sign-out",
          title: "Sign out of this device",
          summary: "Notifications stop here. Your working day is not affected.",
          blocks: [
            {
              kind: "steps",
              steps: [
                'Open Me and scroll to the end: "Sign out of this device" is the last button, in red outline.',
                "Tap it.",
                'Read "Sign out of this device?" and confirm.',
              ],
            },
            {
              kind: "next",
              text: "Notifications stop on this device.",
            },
            {
              kind: "note",
              text: "Your working day is not affected, and you can still end it from another sign-in.",
            },
          ],
          link: { href: "/me", label: "Open Me" },
          keywords: ["log out", "logout", "leave app", "switch account", "sign out"],
        },
      ],
    },
    {
      id: "help",
      title: "Help and troubleshooting",
      topics: [
        missingButtonTopic(
          "MaxOff shows you only what is yours to do. Your role does not include deciding leave, expenses or extra work, creating or editing tasks, or seeing other people's leave or attendance, so those buttons are not there. A button also depends on the step the item is at. \"Mark done\" is only for the task's primary owner, and a task's stages are locked while it is with the reviewers. If you think a button should be there, ask the Owner.",
        ),
        ...COMMON_HELP_TOPICS,
      ],
    },
  ],
};
