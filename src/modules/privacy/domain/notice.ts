/**
 * The staff privacy notice (v7.5 Q1, owner 2026-11-26; docs/handoff/v7.5-plan.md §3 and
 * docs/PRIVACY.md). The owner approved these words and the periods; **a lawyer checks the wording
 * before v8.0**. Any change to the words gets a new `PRIVACY_NOTICE_VERSION` (the day it changed),
 * and the home screen's card then asks everyone to read it again (`privacy_notice_reads`).
 */
export const PRIVACY_NOTICE_VERSION = "2026-11-26";

export const PRIVACY_NOTICE_TITLE = "Your information in MaxOff";

export type NoticeSection = {
  heading: string;
  paragraphs?: readonly string[];
  bullets?: readonly string[];
};

/** How long each kind of record is kept (the owner's periods; the rule per record is docs/PRIVACY.md). */
export const RETENTION = {
  attendanceLeaveExpenses: "8 years",
  tasksChat: "3 years",
  signIn: "1 year",
} as const;

export const PRIVACY_NOTICE_INTRO =
  "MaxOff is Pixora Clips' internal app for running the studio's work. This note says what it keeps about you, why, and for how long.";

export const PRIVACY_NOTICE_SECTIONS: readonly NoticeSection[] = [
  {
    heading: "What we keep",
    bullets: [
      "Your name, work email, phone number, photo (if you add one), role and job title.",
      "Your attendance: when you start and end your day, breaks, and corrections.",
      "Your leave and comp leave requests and their decisions.",
      "Your extra work and expense claims, with the receipts you upload.",
      "The tasks you work on, your notes, your chat messages, and the files you hand in (these go to the studio's Google Drive).",
      "Basic sign-in records: when you signed in, and a scrambled form of your device's internet address, so we can spot misuse.",
    ],
  },
  {
    heading: "Why",
    paragraphs: [
      "To pay you correctly, plan the studio's work, approve leave and expenses, and keep the app secure. We don't sell your information or use it for advertising.",
    ],
  },
  {
    heading: "Who can see it",
    bullets: [
      "The Owner sees everything.",
      "Admins see your work, your availability (not your leave reasons) and your tasks.",
      "Your expense claims are seen only by you and the Owner.",
      "Our service providers store it for us: Supabase (database), Cloudflare (hosting and files), Google (Drive), Resend (email) and Sentry (error reports, without your name or email).",
    ],
  },
  {
    heading: "How long",
    bullets: [
      `While you work with us, and afterwards for as long as the law and the studio's accounts need it: attendance, leave and expense records for ${RETENTION.attendanceLeaveExpenses}, tasks and chat for ${RETENTION.tasksChat}, and sign-in records for ${RETENTION.signIn}.`,
      "Your account is then deactivated and your personal details are removed where the law allows.",
    ],
  },
  {
    heading: "Your rights",
    paragraphs: [
      "You can ask to see what we keep about you, to correct it, or to have it removed when we no longer need it. You can also complain to the Data Protection Board of India.",
    ],
  },
];

export const PRIVACY_QUESTIONS_HEADING = "Questions";

/**
 * Who to ask (owner 2026-11-26: "Contact the Owner", with no name or email, so the notice shows
 * nobody's contact details and no permission changes).
 */
export const PRIVACY_QUESTIONS_LINE =
  "Contact the Owner, who looks after your information for Pixora Clips.";

/** Whether the member still has to read this version (no record, or an older one). */
export function needsReading(readVersion: string | null): boolean {
  return readVersion !== PRIVACY_NOTICE_VERSION;
}
