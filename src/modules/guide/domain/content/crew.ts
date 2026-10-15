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
              text: 'On a phone, the bar at the bottom has five tabs: My Day, Tasks, Calendar, Leave and Me. On a laptop, the same places sit in the sidebar, and Leave is called "Attendance & leave". The sidebar also has "Extra work & expenses".',
            },
            {
              kind: "text",
              text: 'On a phone, "Extra work & expenses" is a row on Me. It says "Note extra work and claim what you spent."',
            },
            {
              kind: "steps",
              steps: [
                "My Day: your working day and what needs you today.",
                "Tasks: the work given to you.",
                "Calendar: your events, due dates, leave and holidays.",
                "Leave: attendance and leave requests.",
                "Me: your profile, notifications and help.",
              ],
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
              kind: "text",
              text: 'The bell shows when something needs your eye. On a phone it sits in the title bar of each page. On a laptop it is in the top bar, with a count of unread alerts. Tap it to open "Alerts".',
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
              kind: "text",
              text: 'The line at the top shows where your day stands, such as "Not started", with one button for the next step. Tap the words to open your attendance. Below it, tasks are grouped by what needs you: "Not noted", "Changes requested", "Overdue" and "Due today". If nothing is waiting it says "Nothing needs you today."',
            },
            {
              kind: "text",
              text: '"N more in the next 7 days" opens Tasks. "Events" lists your own events for today and tomorrow, and one quiet line shows the next holiday or your own approved leave. "Suggest a task" is at the bottom.',
            },
          ],
          link: { href: "/my-day", label: "Open My Day" },
          keywords: ["home", "today", "dashboard", "what's next", "due"],
        },
        {
          id: "start-day",
          title: "Start your day",
          summary: "Tap Start day: the start time is the moment you tap.",
          blocks: [
            {
              kind: "text",
              text: "Starting the day records that you are working. There is no confirmation. The start time is the moment you tap, so tap it when you actually begin.",
            },
            {
              kind: "steps",
              steps: [
                "Open My Day.",
                'Tap "Start day" in the line at the top.',
                'Wait for "Your day has started".',
              ],
            },
            {
              kind: "note",
              text: "On a half day, Start day and End day still work. If your day is already started on another device, MaxOff tells you and refreshes.",
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
              text: 'On a working day, when you open the app and have not started, MaxOff asks "Started working?". If you choose "Just looking", it comes back when you next open the app, but not more than once every 30 minutes. It does not appear on a day off, on approved leave, or on your joining day.',
            },
            {
              kind: "steps",
              steps: [
                'Tap "Start day" if you are working.',
                'Or tap "On leave today? Choose leave".',
                "Pick Leave (the whole day off) or Half day, and add a reason if you like.",
                'Tap "Record leave". You see "Sent to the Owner".',
              ],
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
          summary: "Tap End day when you finish. It is final for the day.",
          blocks: [
            {
              kind: "text",
              text: '"End your day?" asks you to confirm. The end time is now, and it is final for today: there is no resume. You can keep using MaxOff afterwards.',
            },
            {
              kind: "steps",
              steps: [
                'Tap "End day" on My Day.',
                'Answer "Any expenses to claim today?". Choose Yes to add them next.',
                'If you worked late, tap "Worked late? Add an overtime note" and say roughly how long and what you did.',
                'Tap "End day". You see "Your day has ended".',
              ],
            },
            {
              kind: "example",
              text: 'You finish at 7:15 PM after a long edit. Tap End day, choose Yes for expenses, add the claim, then tap "Done".',
            },
            {
              kind: "note",
              text: 'If you choose Yes for expenses, the button reads "End day, add expenses" and the claim form opens. The overtime option is hidden when that day already has an overtime note.',
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
              text: "At 8:30 PM MaxOff reminds you: \"You haven't ended your day.\" If you are still working, carry on. If you forget completely, you can end yesterday's day the next morning, but only before the cutoff (05:00 unless the Owner changed it) and before you start today.",
            },
            {
              kind: "steps",
              steps: [
                'Open My Day. The line reads "Yesterday not ended".',
                'Tap "End day".',
                "Read \"End yesterday's day?\". The end time recorded is now, on yesterday's day, and it is final.",
                "Confirm.",
              ],
            },
            {
              kind: "note",
              text: 'After the cutoff, the day stays "End of day not recorded". No end time is made up. Put the late work in an overtime note instead. The Owner can see which days were not ended.',
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
              text: 'On a day off, the button on My Day reads "I worked today". On a day of leave, it reads "I\'m working today". Either one goes to the Owner, who decides. Your leave request stays as it is.',
            },
            {
              kind: "steps",
              steps: [
                "Open My Day.",
                'Tap "I worked today" or "I\'m working today".',
                'Read the message and confirm. You see "Sent to the Owner".',
              ],
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
          summary: "A full day or a half day. The Owner decides.",
          blocks: [
            {
              kind: "text",
              text: 'Open Leave and tap "Request leave". The Owner approves or declines it, and you can withdraw it while it waits.',
            },
            {
              kind: "steps",
              steps: [
                'Choose the "Kind of leave": Leave or Half day.',
                'Pick the "First day" and "Last day". A half day has a single "Date".',
                "Add a reason if you like. It is optional.",
                'Tap "Request leave". You see "Leave requested".',
              ],
            },
            {
              kind: "example",
              text: "Two days off from Monday 9 Nov to Tuesday 10 Nov: Kind of leave = Leave, First day = 9 Nov, Last day = 10 Nov.",
            },
          ],
          link: { href: "/leave", label: "Open Leave" },
          keywords: ["holiday", "time off", "day off", "vacation", "half day", "sick", "absent"],
        },
        {
          id: "comp-leave",
          title: "Use comp leave",
          summary: "Only shown when you have a credit to spend.",
          blocks: [
            {
              kind: "text",
              text: 'When the Owner has granted you comp leave, "Request leave" also offers "Comp leave (1 day)" and "Comp leave, half day (½)". The hint tells you how much you have and the date to use it by. Under your requests you will see "Comp leave: N · use by …".',
            },
            {
              kind: "steps",
              steps: [
                'Tap "Request leave".',
                "Choose a comp leave kind. If you do not have credit, these are not shown.",
                "Pick a working day before the use-by date.",
                'Tap "Request leave".',
              ],
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
              kind: "text",
              text: 'While a request is "Waiting", you can "Withdraw" it. Once it is approved and has not ended, you can change it ("Change this leave") or ask to cancel. Both go to the Owner, and you see "Change sent to the Owner" or "Cancellation sent to the Owner".',
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
              kind: "text",
              text: '"Set by the Owner" marks leave the Owner created for you.',
            },
          ],
          link: { href: "/leave", label: "Open Leave" },
          keywords: ["rejected", "declined", "pending", "approved", "decision", "reason"],
        },
        {
          id: "attendance-tab",
          title: "Check your attendance",
          summary: "A month at a time. Only the Owner corrects a day.",
          blocks: [
            {
              kind: "text",
              text: 'The "Attendance" tab shows one month per page, with "Previous month" and "Next month". Each row has the date, how it was recorded, the start and end times, and notes. Open a day to read the Owner\'s reason and its history.',
            },
            {
              kind: "text",
              text: "If a day looks wrong, ask the Owner. Only the Owner corrects a day, and the original always stays beside the correction.",
            },
            {
              kind: "note",
              text: 'In the last 7 days, each row has "Add overtime note", or "I worked that day" on a day off.',
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
          summary: "My tasks groups the work given to you by what needs you.",
          blocks: [
            {
              kind: "text",
              text: '"My tasks" is grouped as "Not noted", "Changes requested", "Due today", "Upcoming" and "Overdue". At the bottom are "N tasks with the reviewers", "All my tasks" and "Your suggestions". An empty list says "Nothing on your list". You do not create tasks yourself; you can suggest one.',
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
              kind: "text",
              text: 'The top of a task shows its status, priority and due time, such as "Due today 6:00 PM · in 3 h", in red when overdue. Under it, one sentence says what is needed from you. There is one next-step button at a time; on a phone it sits in a bar at the bottom.',
            },
            {
              kind: "text",
              text: 'Switch between "Work" (the brief, "Stages" and the hand-in), "Chat", "Activity" and "Details" (who is on it and about the task).',
            },
          ],
          link: { href: "/tasks", label: "Open Tasks" },
          keywords: ["brief", "details", "status", "due", "priority", "activity"],
        },
        {
          id: "task-noted",
          title: "Note a task, then start work",
          summary: 'Every assignee taps "Task Noted" to say they have seen it.',
          blocks: [
            {
              kind: "text",
              text: 'Everyone on a task taps "Task Noted" to say they have seen it. The person who is the primary owner then starts the work. People on the task show as "Noted" or "Not noted".',
            },
            {
              kind: "steps",
              steps: [
                'Open the task. It says "Tap Task Noted to say you\'ve seen it."',
                'Tap "Task Noted". You see "Noted".',
                'When you begin, tap "Start work".',
                "Tick the stages as you finish them.",
              ],
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
              kind: "text",
              text: "While the task is with you, you tick its stages as they are done. The count shows \"N of M done\" and each tick shows who made it. You cannot add, remove or reorder a task's stages. A task's stages may be reordered only by the Owner, its creator or its approving Admin.",
            },
            {
              kind: "note",
              text: 'Stages are locked once the task is handed in: "Locked while it\'s with the reviewers. Chat stays open." If stages look wrong, tell the person who made the task in the chat.',
            },
          ],
          link: { href: "/tasks", label: "Open Tasks" },
          keywords: ["checklist", "steps", "tick", "order", "reorder", "locked", "add stage"],
        },
        {
          id: "mark-done",
          title: "Hand in your work with Mark done",
          summary: "Only the primary owner marks a task done.",
          blocks: [
            {
              kind: "text",
              text: "Only the primary owner marks a task done. Other assignees note it, tick stages and comment. Marking done sends it for review, and the task is locked until then; comments stay open. If you are a coordinator for a freelancer, you hand in for them.",
            },
            {
              kind: "steps",
              steps: [
                'Tap "Mark done".',
                "Add a note if you like, such as a link to the work (a Drive folder, for example).",
                'If the task is overdue, answer "Why is it late?". It is required.',
                'Send it. Your hand-in appears in the "Hand-in" section.',
              ],
            },
            {
              kind: "example",
              text: 'Reel 1 edit is due at 6:00 PM and you finish at 6:40 PM. In the hand-in, link the folder and answer "Why is it late?" with the reason.',
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
              text: 'If a reviewer wants changes, the task comes back to you as "Changes requested". A box on the task says who asked for changes and why. Stages open up again.',
            },
            {
              kind: "steps",
              steps: [
                "Open the task and read the box.",
                "Make the changes. Ask in the chat if something is unclear.",
                'Tap "Mark done again". Your new hand-in is added to the earlier ones.',
              ],
            },
          ],
          link: { href: "/tasks", label: "Open Tasks" },
          keywords: ["rework", "redo", "feedback", "returned", "revise", "fix"],
        },
        {
          id: "task-chat",
          title: "Chat on a task",
          summary: "Write a comment on the task. Chat stays open when locked.",
          blocks: [
            {
              kind: "text",
              text: 'Use "Chat" on the task to ask a question or share a link. On a phone it opens as a sheet, and the tab shows "Chat · N new" when there is something unread. Tap "Write a comment" to reply. Chat stays open even while the task is with the reviewers.',
            },
          ],
          link: { href: "/tasks", label: "Open Tasks" },
          keywords: ["comment", "message", "discussion", "ask", "reply"],
        },
        {
          id: "freelancer-tasks",
          title: "Tasks for a freelancer you coordinate",
          summary: "You note, start and hand in on their behalf.",
          blocks: [
            {
              kind: "text",
              text: 'If you coordinate a freelancer, their tasks appear on your list marked "For ‹their name›" or "You, and for ‹their name›". The buttons say, for example, "Noted for ‹their name›", "Start work for ‹their name›" and "Mark done for ‹their name›". At the bottom of Me, "Your freelancers" lists them with a phone link each.',
            },
            {
              kind: "text",
              text: 'In the chat, "Writing as" lets you choose yourself or the freelancer.',
            },
            {
              kind: "example",
              text: 'A freelancer you coordinate finishes Shoot prep and sends you the link. You open the task and tap "Mark done for ‹their name›".',
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
              text: "You cannot create tasks, but you can suggest one. The Owner or an Admin makes it a task, or says why not. The button is on My tasks, on My Day and on a day in the Calendar.",
            },
            {
              kind: "steps",
              steps: [
                'Tap "Suggest a task".',
                'Write "What needs doing".',
                'Add "Details (optional)" if it helps.',
                'Tap "Send suggestion". You see "Suggestion sent".',
              ],
            },
            {
              kind: "text",
              text: '"Your suggestions" opens the "Suggested tasks" page. It has "Waiting" and "Decided". The words are Waiting, Became a task, Declined and Withdrawn. You can withdraw your own suggestion while it waits.',
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
              kind: "text",
              text: 'You see your own event tasks and your freelancers\' tasks, due tasks as "Due · N", your own leave (a request still waiting is marked "· requested"), holidays and weekly offs. You do not see anyone else\'s leave. The only filter is "Type".',
            },
            {
              kind: "text",
              text: 'On a day, tap "Suggest a task" and the day is filled in for you.',
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
              text: 'On a phone there is one calendar in three sizes: a week strip, a compact month and a full month. Swipe, or tap the handle, to change size. The day you choose shows a timeline. The header has "Today" and "Filters".',
            },
            {
              kind: "text",
              text: 'On a laptop, choose "Day", "Week" or "Month". It opens on Month. The day popup has "Open day". Shortcuts: arrow keys to move, T for today, D, W and M for the view. An empty day says "Nothing on this day."',
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
              kind: "text",
              text: 'If you worked late, or on a day off, add a note. The Owner decides whether it earns comp leave. Nothing is automatic. You see the outcome on the "Extra work" tab: "Waiting for the Owner", "N comp leave granted · use by …" or "Reviewed by the Owner". A comp leave card at the top shows what you have to use.',
            },
            {
              kind: "steps",
              steps: [
                'Open Extra work & expenses and tap "Add note".',
                'Pick the "Day" (one of the last 7).',
                'Say roughly how long (optional) and "What you worked on".',
                'Send it. You see "Note sent to the Owner".',
              ],
            },
            {
              kind: "example",
              text: 'Yesterday you stayed until 9:30 PM on Reel 1 edit. Choose yesterday, write "About 2 hours" and "Reel 1 edit".',
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
          summary: "Add the amount and what it was for; a receipt for big amounts.",
          blocks: [
            {
              kind: "text",
              text: "Claim what you spent for work. The Owner approves it and pays it with your salary. You can withdraw it while it waits. You can also add claims when you end your day.",
            },
            {
              kind: "steps",
              steps: [
                'Open the "Expenses" tab and tap "Add expense".',
                'Enter "Amount (₹)", "Category" and "Date".',
                'Write "What was it for?".',
                "Add a receipt photo, if one is needed.",
                'Tap "Add claim".',
              ],
            },
            {
              kind: "note",
              text: "A receipt photo is needed when the amount is above the Owner's limit, which is ₹500 unless the Owner changed it. At exactly ₹500, none is needed. The date must be this month, or last month until the 5th.",
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
              kind: "text",
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
              kind: "text",
              text: '"Alerts" lists your notifications. Tap one to go straight to the task, leave or claim it is about. Switch between "All" and "Unread", and tap "Mark all read" to clear the count. When there is nothing, it says "Nothing yet" or "You\'re all caught up".',
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
                'Open Me and find the "Notifications" row.',
                'Tap "Turn on", or "Turn on here" if your phone already has them on.',
                "Allow notifications when asked.",
                'Look for "Notifications are on for this device."',
              ],
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
          id: "appearance",
          title: "Change light or dark",
          summary: "Choose Light, Dark or System on Me.",
          blocks: [
            {
              kind: "text",
              text: 'On Me, under "Appearance", choose Light, Dark or System. System follows your phone.',
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
              kind: "text",
              text: 'On Me, "Sign out of this device" has a "Sign out" button. It asks "Sign out of this device?" and tells you that notifications stop on this device. Your working day is not affected, and you can still end it from another sign-in.',
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
