import type { GuideTopic } from "../types";

/** Help and troubleshooting topics every role's guide ends with (ROADMAP 6b.14). */
export const COMMON_HELP_TOPICS: readonly GuideTopic[] = [
  {
    id: "help-reload",
    title: "Nothing changed after an edit",
    summary: "Pull down to refresh, or reload the app.",
    blocks: [
      {
        kind: "text",
        text: "If a screen looks old or stuck, it usually just needs a fresh look at the data.",
      },
      {
        kind: "steps",
        steps: [
          "Pull down on the screen to refresh it, or close it and open it again.",
          'Still stuck? Open Me and scroll to "Help & troubleshooting".',
          'Tap "Reload app". MaxOff starts again from the beginning.',
        ],
      },
    ],
    link: { href: "/me", label: "Open Me" },
    keywords: ["refresh", "stuck", "old", "not updating", "reload", "frozen"],
  },
  {
    id: "help-install",
    title: "Install MaxOff on your iPhone",
    summary: "An iPhone only notifies the installed app.",
    blocks: [
      {
        kind: "text",
        text: "An iPhone sends notifications only to MaxOff when it is installed on the Home Screen. On Android, notifications work in the browser; installing is optional.",
      },
      {
        kind: "steps",
        steps: [
          "Open MaxOff in Safari and tap Share.",
          'Tap "Add to Home Screen", then "Add".',
          "Open MaxOff from its new icon.",
          "Sign in again. The installed app keeps its own sign-in.",
        ],
      },
      {
        kind: "note",
        text: "Turn notifications on from the installed app, not from Safari. Turning them on in Safari will not reach your Home Screen app.",
      },
    ],
    link: { href: "/me", label: "Open Me" },
    keywords: ["add to home screen", "iphone", "ios", "app", "install", "safari"],
  },
  {
    id: "help-notifications-off",
    title: "Notifications are not arriving",
    summary: "Turn them on, send a test, and check your devices.",
    blocks: [
      {
        kind: "text",
        text: 'Notifications are turned on for each device separately. Open Me and look at the "Notifications" row.',
      },
      {
        kind: "steps",
        steps: [
          'On Me, tap "Turn on". If it says "Turn on here", your phone has them on but this app does not yet.',
          "If the message says they are blocked, allow notifications for MaxOff in your browser or phone, then come back.",
          'Under "Help & troubleshooting", tap "Send a test notification", then "Send test".',
          'Wait for the question "Did it arrive?" and answer it.',
          'Check "Your devices". Tap "Remove" next to a device you no longer use.',
        ],
      },
      {
        kind: "note",
        text: "On an iPhone, install MaxOff on the Home Screen first. Notifications will not work from Safari.",
      },
    ],
    link: { href: "/me", label: "Open Me" },
    keywords: ["push", "alerts", "not receiving", "blocked", "test", "devices", "silent"],
  },
  {
    id: "help-version",
    title: "What to say when you ask for help",
    summary: "Tell the Owner what you did and the version on Me.",
    blocks: [
      {
        kind: "text",
        text: 'The more exactly you describe the problem, the faster it is fixed. At the very bottom of Me is a line that reads "Version …". Include it when you ask for help.',
      },
      {
        kind: "steps",
        steps: [
          "Note the screen you were on and what you tapped.",
          "Note what you expected, and what happened instead.",
          'Open Me, scroll to the bottom and read out the "Version …" line.',
        ],
      },
    ],
    link: { href: "/me", label: "Open Me" },
    keywords: ["support", "bug", "report", "problem", "version", "contact"],
  },
];

/** The "Why is a button missing?" topic: the answer differs by role, so each guide supplies it. */
export function missingButtonTopic(text: string): GuideTopic {
  return {
    id: "help-missing-button",
    title: "Why is a button missing?",
    summary: "Usually your role, or the step the item is at.",
    blocks: [{ kind: "text", text }],
    keywords: ["cannot find", "no button", "greyed", "disabled", "hidden", "missing", "permission"],
  };
}
