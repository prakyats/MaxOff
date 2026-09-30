/** A Settings section's header line: the description on a wide screen, the help sheet on a phone. */
export type SectionHeader = { readonly description: string; readonly help: string };

function same(text: string): SectionHeader {
  return { description: text, help: text };
}

/**
 * Each Settings section's header copy, shared by its page and its loading screen, so the header
 * never changes when the data arrives (4C review S7, ARCHITECTURE §14.1: a skeleton traces its
 * screen, the header included).
 */
export const SETTINGS_HEADERS = {
  company: {
    description: "The name people see across MaxOff, and the timezone every date is read in.",
    help: "MaxOff runs on IST everywhere. The company name is what people see across the app.",
  },
  customFields: same(
    "Extra fields on clients, contacts and tasks. Client and contact fields apply to every client or one client only, task fields to every task or one task type; project and item fields are the Owner's.",
  ),
  daysOff: same(
    "A day off means nobody is marked absent. People may still log in and mark attendance, and the day shows as worked on a day off.",
  ),
  expenses: same(
    "The categories people choose when they claim an expense, and the amount above which a claim needs a receipt photo.",
  ),
  jobTitles: same(
    "What people do, shown next to their name. A job title carries no permissions: roles do that.",
  ),
  taskTypes: same(
    "The kinds of task offered when one is created. An archived type stays on the tasks that have it.",
  ),
  templates: same(
    "Task templates for work that repeats: a type, a priority, stages and field defaults. New task offers them under Start from.",
  ),
  thresholds: same(
    "How long MaxOff waits before it reminds someone, escalates to the Admin and then to you, and how much email one person can get in a day.",
  ),
} as const satisfies Record<string, SectionHeader>;
