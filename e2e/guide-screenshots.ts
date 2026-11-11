import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { type BrowserContext, expect, type Locator, type Page, test } from "@playwright/test";

import { addISTDays, istInstant, istWeekday, systemClock, todayIST } from "../src/core/time";
import { GUIDE_SHOTS } from "../src/modules/guide/domain/shots.generated";
import {
  type AdminDay,
  type CrewDay,
  type DemoIds,
  GUIDE_SHOT_LIST,
  type GuideDays,
  type GuideRole,
  type GuideShot,
  ROLE_DAYS,
} from "./guide-shots";
import {
  memberIdOf,
  removeClientFixture,
  removeRequestsTitled,
  removeTasksTitled,
  resetAttendanceAndLeave,
  resetExpenseClaims,
  serviceRest,
  serviceSelect,
  serviceInsert,
  serviceUpdate,
  supabaseAuth,
  taskTypeId,
  USERS,
} from "./helpers";

/**
 * The in-app guide's screenshots (ROADMAP 6b.14, Release 2), never part of `pnpm test:e2e` or CI
 * (its own config, `playwright.guide.config.ts`). Run it on a freshly reset **local** database:
 *
 *   pnpm db:reset && pnpm guide:screenshots
 *
 * and `pnpm db:reset` again before the flow tests: the run renames the three seeded sign-ins to
 * neutral role names and deactivates every other seeded person (the e2e fixture people), so no
 * picture shows a real-looking name or a test person, and the flow tests need them back.
 *
 * It makes neutral demo data, signs in through the real form as each role at a laptop size
 * (1440×900, scale 2, light theme), opens every screen `guide-shots.ts` lists, outlines the
 * element the step is about with a numbered badge, crops, converts to WebP in the browser and
 * writes `public/guide/<role>/<name>.webp` and the manifest
 * `src/modules/guide/domain/shots.generated.ts`. The registry is the source: a release re-runs this
 * to refresh every picture.
 *
 * `GUIDE_ONLY=owner/task-hold-menu,staff/task-on-hold pnpm guide:screenshots` makes only the listed
 * pictures (a comma-separated list of ids, or of prefixes ending in `*`: `owner/task-hold*`); every
 * other picture and its manifest entry stay as they are. For a release's new topics, when the rest
 * would be retaken at a time of day that changes them. The run itself is refused outside 11:15 am to
 * 5:30 pm IST (`assertDaytime`): every picture's day is built for daytime.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const LOCAL = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/;
if (!LOCAL.test(SUPABASE_URL)) {
  throw new Error(
    `guide:screenshots runs on the local stack only; NEXT_PUBLIC_SUPABASE_URL is "${SUPABASE_URL}".`,
  );
}

/** The largest WebP a guide picture may be, and the lowest quality tried to get under it. */
const MAX_BYTES = 120 * 1024;
const MIN_QUALITY = 0.6;
const SCALE = 2;
/** How long one step of a picture may wait for its element: a missing one fails that picture. */
const STEP_TIMEOUT = 15_000;
/** Room around a cropped region, in CSS px. */
const PAD = 24;
/** A strong blue: the app keeps red for urgent, destructive and commit actions (ARCHITECTURE §14.1). */
const ACCENT = "#2563eb";
const MANIFEST = "src/modules/guide/domain/shots.generated.ts";

const { owner, admin, staff } = USERS;

/** The pictures this run makes: `GUIDE_ONLY`'s ids and `prefix*`es, or every one. */
/** `GUIDE_ANYTIME=1`: a run-once escape from the daytime guard (`assertDaytime`). */
const ANYTIME = process.env.GUIDE_ANYTIME === "1";
const ONLY = (process.env.GUIDE_ONLY ?? "")
  .split(",")
  .map((entry) => entry.trim())
  .filter((entry) => entry !== "");
const matches = (entry: string, id: string) =>
  entry.endsWith("*") ? id.startsWith(entry.slice(0, -1)) : id === entry;
const wanted = (id: string) => ONLY.length === 0 || ONLY.some((entry) => matches(entry, id));
const unknown = ONLY.filter((entry) => !GUIDE_SHOT_LIST.some((shot) => matches(entry, shot.id)));
if (unknown.length > 0) {
  throw new Error(`GUIDE_ONLY names no picture in e2e/guide-shots.ts: ${unknown.join(", ")}`);
}

/** The names the pictures show for the three seeded sign-ins: roles, never a person. */
const DISPLAY_NAMES = {
  [owner.email]: "Studio Owner",
  [admin.email]: "Sample Admin",
  [staff.email]: "Sample Member",
} as const;

// ── PostgREST as a seeded person, one sign-in each (GoTrue allows 30 a 5 minutes locally) ──────

type Person = { readonly email: string; readonly password: string };
const tokens = new Map<string, string>();

async function tokenOf(person: Person): Promise<string> {
  const cached = tokens.get(person.email);
  if (cached) return cached;
  const { url, apikey } = supabaseAuth();
  const answer = await fetch(`${url}/token?grant_type=password`, {
    method: "POST",
    headers: { apikey, "content-type": "application/json" },
    body: JSON.stringify({ email: person.email, password: person.password }),
  });
  expect(answer.ok, `sign-in for ${person.email}`).toBe(true);
  const { access_token: token } = (await answer.json()) as { access_token: string };
  tokens.set(person.email, token);
  return token;
}

async function rest(person: Person, path: string, init: RequestInit): Promise<string> {
  const { url, apikey } = supabaseAuth();
  const response = await fetch(`${url.replace(/\/auth\/v1$/, "/rest/v1")}/${path}`, {
    ...init,
    headers: {
      apikey,
      authorization: `Bearer ${await tokenOf(person)}`,
      "content-type": "application/json",
      prefer: "return=representation",
    },
  });
  const text = await response.text();
  expect(response.ok, `${init.method ?? "GET"} ${path} as ${person.email}: ${text}`).toBe(true);
  return text;
}

async function rpc<T = unknown>(
  person: Person,
  fn: string,
  args: Record<string, unknown>,
): Promise<T> {
  const text = await rest(person, `rpc/${fn}`, { method: "POST", body: JSON.stringify(args) });
  return (text ? JSON.parse(text) : null) as T;
}

async function insertRow(
  person: Person,
  table: string,
  row: Record<string, unknown>,
): Promise<void> {
  await rest(person, table, { method: "POST", body: JSON.stringify(row) });
}

async function patchRows(
  person: Person,
  path: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await rest(person, path, { method: "PATCH", body: JSON.stringify(patch) });
}

/**
 * Only the three seeded sign-ins are active, under neutral role names. The seed's other people
 * are the flow tests' fixtures ("Test Gate Staff (desktop)", …): each is deactivated through the
 * Owner's own transition (audited), freelancers first so no coordinator is left with one. A run
 * that still finds anyone else active stops before a single picture.
 */
async function onlyTheThreeOfUs(): Promise<void> {
  for (const [email, name] of Object.entries(DISPLAY_NAMES)) {
    await serviceUpdate(`members?email=eq.${encodeURIComponent(email)}`, { full_name: name });
  }
  const keep = new Set<string>(Object.keys(DISPLAY_NAMES));
  const others = (
    await serviceSelect<{ id: string; email: string | null; engagement: string }>(
      "members?status=eq.active&select=id,email,engagement",
    )
  ).filter((member) => !keep.has(member.email ?? ""));
  others.sort(
    (a, b) => Number(b.engagement === "freelance") - Number(a.engagement === "freelance"),
  );
  for (const member of others) {
    await rpc(owner, "member_deactivate", {
      member_id: member.id,
      reason: "Not shown in the guide's pictures (local database)",
    });
  }
  const left = (
    await serviceSelect<{ full_name: string; email: string | null }>(
      "members?status=eq.active&select=full_name,email",
    )
  ).filter((member) => !keep.has(member.email ?? ""));
  if (left.length > 0) {
    throw new Error(
      `guide:screenshots shows only the three seeded sign-ins, but these are still active: ${left
        .map((member) => member.full_name)
        .join(", ")}. Run \`pnpm db:reset\` and try again.`,
    );
  }
}

// ── The demo data ──────────────────────────────────────────────────────────────────────────────

const CLIENT = "Sample Client";
const PRESET = "Video steps";
const TEMPLATE = "Monthly reels";
/** Every task the demo makes starts with one of these; earlier copies are removed by them. */
const TASK_TITLES = [
  "Reel 1 edit",
  "Reel 2 edit",
  "Reel 3 edit",
  "Reel 4 edit",
  "Post 1 design",
  "Post 2 design",
];
/** Why the demo's held task and held project wait (v1.9 On hold). */
const HOLD_REASON = "Client hasn't sent the footage";
const PROJECT_HOLD_REASON = "Client paused content for Diwali week";
const REQUEST = "Refresh the studio backdrop";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
/** "October 2026", as a monthly cycle is labelled. */
function monthLabel(day: string): string {
  return `${MONTHS[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}`;
}

function workingDay(offset: number): string {
  let day = addISTDays(todayIST(), offset);
  while (istWeekday(day) === 0 || istWeekday(day) === 6) day = addISTDays(day, 1);
  return day;
}

async function stagesOfTask(taskId: string): Promise<{ id: string }[]> {
  return serviceSelect<{ id: string }>(`task_stages?task_id=eq.${taskId}&select=id&order=position`);
}

async function tickTaskStages(taskId: string, count: number): Promise<void> {
  const stages = await stagesOfTask(taskId);
  for (const stage of stages.slice(0, count)) {
    await patchRows(staff, `task_stages?id=eq.${stage.id}`, {
      done_at: systemClock().toISOString(),
      on_behalf_of: null,
    });
  }
}

async function createTask(args: {
  title: string;
  by: { email: string; password: string };
  approver: string | null;
  stages: string[];
  day: number;
  assignees: string[];
  primary: string;
}): Promise<string> {
  return rpc<string>(args.by, "task_create", {
    title: args.title,
    description: null,
    task_type_id: await taskTypeId("Normal"),
    client_id: null,
    priority: "medium",
    due_at: istInstant(workingDay(args.day), "18:00"),
    assignee_ids: args.assignees,
    primary_owner_id: args.primary,
    approving_admin_id: args.approver,
    stages: args.stages,
  });
}

/**
 * Neutral demo data, made again on every run (earlier copies removed by name first): one Active
 * client run by the seeded Admin, a stage preset, a monthly and a one-time project, a template,
 * tasks in the states the shots need, a waiting leave request, a waiting expense claim and a
 * suggested task by the Crew member. Local stack only (the helpers refuse any other URL).
 */
async function makeDemo(): Promise<DemoIds> {
  await onlyTheThreeOfUs();
  const [org] = await serviceSelect<{ id: string }>("organizations?select=id&limit=1");
  const orgId = org?.id;
  const adminId = await memberIdOf(admin.email);
  const staffId = await memberIdOf(staff.email);

  for (const title of TASK_TITLES) await removeTasksTitled(title);
  await removeRequestsTitled(REQUEST);
  await removeClientFixture(CLIENT);
  await serviceRest(`stage_presets?name=eq.${encodeURIComponent(PRESET)}`, { method: "DELETE" });
  await serviceRest(`project_templates?name=eq.${encodeURIComponent(TEMPLATE)}`, {
    method: "DELETE",
  });
  // The Crew member's day starts on screen (the Start-day shot); their leave and claims are the
  // demo's own.
  await resetAttendanceAndLeave(staffId);
  await resetAttendanceAndLeave(adminId);
  await resetExpenseClaims(staffId);
  // Alerts from earlier runs point at tasks that are gone: each role's list starts fresh.
  for (const id of [adminId, staffId, await memberIdOf(owner.email)]) {
    await serviceRest(`notifications?recipient_id=eq.${id}`, { method: "DELETE" });
  }

  // The client, its preset and its work.
  const client = await serviceInsert<{ id: string }>("clients", {
    org_id: orgId,
    name: CLIENT,
    admin_id: adminId,
  });
  await rpc(owner, "client_activate", { client_id: client.id });
  const videoSteps = ["Script", "Shoot", "Edit", "Review"];
  await serviceInsert("stage_presets", {
    org_id: orgId,
    name: PRESET,
    stages: videoSteps,
    created_by: adminId,
  });
  const design = [{ label: "Design", stages: ["Draft", "Final"] }];
  const projectId = await rpc<string>(admin, "project_create_grouped", {
    client_id: client.id,
    name: "Monthly retainer",
    recurrence: "monthly",
    stage_groups: [{ label: PRESET, stages: videoSteps }],
    deliverables: [
      ...["Reel 1", "Reel 2", "Reel 3", "Reel 4"].map((title) => ({ title, stage_groups: null })),
      ...["Post 1", "Post 2"].map((title) => ({ title, stage_groups: design })),
    ],
  });
  await rpc(admin, "project_create_grouped", {
    client_id: client.id,
    name: "Launch video",
    recurrence: "one_time",
    delivery_date: workingDay(14),
    stage_groups: [{ label: null, stages: ["Script", "Shoot", "Edit"] }],
    deliverables: [{ title: "Launch film", stage_groups: null }],
  });
  const items = await serviceSelect<{ id: string; title: string }>(
    `project_items?project_id=eq.${projectId}&select=id,title&order=position`,
  );
  const itemId = (title: string) => items.find((item) => item.title === title)?.id ?? "";
  const tick = async (title: string, count: number) => {
    const stages = await serviceSelect<{ id: string }>(
      `project_item_stage_list?item_id=eq.${itemId(title)}&archived_at=is.null&select=id&order=position`,
    );
    for (const stage of stages.slice(0, count)) {
      await rpc(admin, "item_stage_tick", {
        stage_id: stage.id,
        done: true,
      });
    }
  };
  await tick("Reel 1", 4);
  await rpc(admin, "item_mark_done", { item_id: itemId("Reel 1") });
  await tick("Reel 2", 2);
  await tick("Post 1", 1);

  await insertRow(admin, "project_templates", {
    name: TEMPLATE,
    recurrence: "monthly",
    stage_groups: [{ label: PRESET, stages: videoSteps }],
    deliverables: [1, 2, 3, 4].map((n) => ({ title: `Reel ${n}`, stage_groups: null })),
  });

  // The tasks, each in the state its shots need.
  const crew = { assignees: [staffId], primary: staffId };
  const cut = ["Rough cut", "Colour", "Sound"];
  const notNoted = await createTask({
    title: "Reel 1 edit",
    by: admin,
    approver: adminId,
    stages: cut,
    day: 2,
    ...crew,
  });
  const started = await createTask({
    title: "Reel 2 edit",
    by: admin,
    approver: adminId,
    stages: cut,
    day: 3,
    ...crew,
  });
  await rpc(staff, "task_acknowledge", { task_id: started });
  await rpc(staff, "task_start", { task_id: started });
  await tickTaskStages(started, 1);
  const handedIn = await createTask({
    title: "Reel 3 edit",
    by: admin,
    approver: adminId,
    stages: cut,
    day: 1,
    ...crew,
  });
  const checked = await createTask({
    title: "Reel 4 edit",
    by: admin,
    approver: adminId,
    stages: cut,
    day: 1,
    ...crew,
  });
  const ownerOnly = await createTask({
    title: "Post 1 design",
    by: owner,
    approver: null,
    stages: [],
    day: 1,
    ...crew,
  });
  for (const id of [handedIn, checked, ownerOnly]) {
    await rpc(staff, "task_acknowledge", { task_id: id });
    await rpc(staff, "task_start", { task_id: id });
    await tickTaskStages(id, cut.length);
    await rpc(staff, "task_submit_done", {
      task_id: id,
      note: "Ready for a look.",
    });
  }
  await rpc(admin, "task_review", {
    task_id: checked,
    decision: "approved",
  });

  // On hold (v1.9): the Admin's "Post 2 design", noted by the Crew member and held, its deadline
  // passed meanwhile (so Resume asks for a new one); and a monthly project held with a deliverable
  // whose date passed and one left in last month (the resume sheet's two kinds of row).
  const held = await createTask({
    title: "Post 2 design",
    by: admin,
    approver: adminId,
    stages: cut,
    day: 2,
    ...crew,
  });
  await rpc(staff, "task_acknowledge", { task_id: held });
  await rpc(admin, "task_hold", { task_id: held, reason: HOLD_REASON });
  await rpc(owner, "task_update_assignment", {
    task_id: held,
    changes: { due_at: istInstant(addISTDays(todayIST(), -1), "18:00") },
  });
  const heldProjectId = await rpc<string>(admin, "project_create_grouped", {
    client_id: client.id,
    name: "Festive campaign",
    recurrence: "monthly",
    stage_groups: [{ label: null, stages: ["Edit", "Review"] }],
    deliverables: [{ title: "Festive reel", stage_groups: null }],
  });
  const [festiveReel] = await serviceSelect<{ id: string }>(
    `project_items?project_id=eq.${heldProjectId}&select=id`,
  );
  await serviceUpdate(`project_items?id=eq.${festiveReel?.id}`, {
    planned_date: addISTDays(todayIST(), -1),
  });
  const monthStart = `${todayIST().slice(0, 8)}01` as ReturnType<typeof todayIST>;
  const lastMonthEnd = addISTDays(monthStart, -1);
  const lastMonth = await serviceInsert<{ id: string }>("project_cycles", {
    org_id: orgId,
    project_id: heldProjectId,
    period_start: `${lastMonthEnd.slice(0, 8)}01`,
    period_end: lastMonthEnd,
    label: monthLabel(lastMonthEnd),
    generated_by: "schedule",
  });
  await serviceInsert("project_items", {
    org_id: orgId,
    project_id: heldProjectId,
    cycle_id: lastMonth.id,
    origin_cycle_id: lastMonth.id,
    title: "Teaser cut",
    position: "a0",
  });
  await rpc(admin, "project_hold", { project_id: heldProjectId, reason: PROJECT_HOLD_REASON });

  // The Crew member's waiting requests.
  await rpc(staff, "leave_submit", {
    type: "leave",
    start_date: workingDay(10),
    end_date: workingDay(10),
    reason: "Family function",
  });
  const [travel] = await serviceSelect<{ id: string }>(
    "list_items?list_key=eq.expense_category&name=eq.Travel&archived_at=is.null&select=id",
  );
  await rpc(staff, "expense_claim_submit", {
    expense_date: todayIST(),
    amount: 80,
    category_id: travel?.id,
    note: "Auto to the shoot",
  });
  await rpc(staff, "task_request_create", { title: REQUEST });

  return {
    clientId: client.id,
    projectId,
    heldProjectId,
    staffId,
    tasks: { notNoted, started, handedIn, checked, ownerOnly, held },
  };
}

// ── Today's working day (v1.9 W4) ──────────────────────────────────────────────────────────────

/** The Crew member's shoot today, whose start the late sheet suggests as the reason. */
const SHOOT = "Product shoot";
const LATE_REASON = "Traffic on the way";
/** How long ago each ask was made, in minutes (the wait for an answer is 30). */
const ASKED_AGO = { asked: 12, no_answer: 35, approved: 20, left_unanswered: 40 } as const;

/** The stage each person's day was last built to: a picture rebuilds only what it changes. */
const built: { crew?: CrewDay; admin?: AdminDay } = {};

/** Today's day of a person gone: its early-leave asks, its events and the day itself. */
async function clearToday(memberId: string): Promise<void> {
  const today = todayIST();
  await serviceRest(`early_leave_requests?member_id=eq.${memberId}`, { method: "DELETE" });
  const days = await serviceSelect<{ id: string }>(
    `attendance_days?member_id=eq.${memberId}&work_date=eq.${today}&select=id`,
  );
  for (const day of days) {
    await serviceRest(`attendance_events?attendance_day_id=eq.${day.id}`, { method: "DELETE" });
  }
  await serviceRest(`attendance_days?member_id=eq.${memberId}&work_date=eq.${today}`, {
    method: "DELETE",
  });
}

/**
 * A person's day today, built with the app's own functions (Start day, the late reason, Ask to
 * leave early, the Owner's answer, End day), then a few fixed times written as service role: the
 * start (10:22 am, Late 22 min; the Admin 9:58 am, on time) and when an ask was made (dated back
 * from now), so every run shows the same states whatever the hour between 11:15 am and 5:30 pm.
 */
async function buildDay(
  person: Person,
  memberId: string,
  stage: CrewDay | AdminDay,
  late: boolean,
): Promise<void> {
  const today = todayIST();
  await clearToday(memberId);
  if (stage === "not_started" || stage === "not_started_shoot") return;
  await rpc(person, "attendance_start_day", {});
  await serviceUpdate(`attendance_days?member_id=eq.${memberId}&work_date=eq.${today}`, {
    started_at: istInstant(today, late ? "10:22" : "09:58"),
    late_minutes: late ? 22 : null,
  });
  if (late) await rpc(person, "attendance_late_reason", { reason: LATE_REASON });
  if (stage === "late" || stage === "started") return;
  let requestId: string;
  try {
    requestId = await rpc<string>(person, "attendance_ask_leave_early", {
      reason: late ? "Doctor's appointment at 5" : "Bank closes at 4",
    });
  } catch (error) {
    // A night run (GUIDE_ANYTIME, always with GUIDE_ONLY): after 6:00 pm the day has ended and
    // no ask can be made, so this day stays started. Only the early-leave pictures need the ask,
    // and a night run keeps their daytime pictures (it never names them in GUIDE_ONLY).
    if (ANYTIME && String(error).includes("Your day ended")) return;
    throw error;
  }
  const ago = stage === "asked" && !late ? 8 : ASKED_AGO[stage];
  await serviceUpdate(`early_leave_requests?id=eq.${requestId}`, {
    requested_at: new Date(systemClock().getTime() - ago * 60_000).toISOString(),
  });
  if (stage === "approved") {
    await rpc(owner, "early_leave_decide", { request_id: requestId, decision: "approve" });
  }
  if (stage === "left_unanswered") await rpc(person, "attendance_end_day", {});
}

/** The Crew member's shoot at 3:00 pm today, there only while a picture needs it. */
async function setShoot(on: boolean, staffId: string): Promise<void> {
  const shoots = await serviceSelect<{ id: string }>(
    `tasks?title=eq.${encodeURIComponent(SHOOT)}&select=id`,
  );
  // Its "new task" alert goes with it: Alerts never lists a task that is gone.
  for (const shoot of shoots) {
    await serviceRest(`notifications?entity_id=eq.${shoot.id}`, { method: "DELETE" });
  }
  await removeTasksTitled(SHOOT);
  if (!on) return;
  const today = todayIST();
  await rpc(owner, "task_create", {
    title: SHOOT,
    description: null,
    task_type_id: await taskTypeId("Shoot / Site Visit"),
    client_id: null,
    priority: "medium",
    due_at: istInstant(today, "18:00"),
    assignee_ids: [staffId],
    primary_owner_id: staffId,
    approving_admin_id: null,
    stages: [],
    event_date: today,
    event_start_at: istInstant(today, "15:00"),
    event_end_at: istInstant(today, "17:00"),
    location: "Studio B",
  });
}

/**
 * When work starts: 10:00 am, except for the late sheet's picture, where it is 22 minutes and 10
 * seconds before now so the sheet reads "You're starting 22 minutes late" like the strip's "Late
 * 22 min" (the sheet's picture shows the sheet alone, never the start time).
 */
async function setWorkStart(lateSheet: boolean): Promise<void> {
  const start = lateSheet
    ? new Date(systemClock().getTime() - (22 * 60 + 10) * 1000).toLocaleTimeString("en-GB", {
        timeZone: "Asia/Kolkata",
        hour12: false,
      })
    : "10:00:00";
  await serviceUpdate("org_settings?org_id=not.is.null", { work_start_time: start });
}

async function buildDays(days: GuideDays): Promise<void> {
  if (days.crew && days.crew !== built.crew) {
    await setWorkStart(days.crew === "not_started_shoot");
    await setShoot(days.crew === "not_started_shoot", demo.staffId);
    await buildDay(staff, demo.staffId, days.crew, true);
    built.crew = days.crew;
  }
  if (days.admin && days.admin !== built.admin) {
    await buildDay(admin, await memberIdOf(admin.email), days.admin, false);
    built.admin = days.admin;
  }
}

// ── The pictures ───────────────────────────────────────────────────────────────────────────────

type Produced = { src: string; width: number; height: number; alt: string };
type Box = { x: number; y: number; width: number; height: number };
/** A crop's region and the band of the viewport it may take (below a top bar, above a band). */
type Region = Box & { minY: number; maxY: number };

const produced = new Map<string, Produced>();
const failures: string[] = [];
let demo: DemoIds;

test.describe.configure({ mode: "serial" });

/**
 * The pictures show a working day as it is lived (v1.9 W4): a Crew member started at 10:22 am and
 * asks to leave early, at the latest, 40 minutes before now; every ask must still be before the
 * 6:00 pm end. So the run is between 11:15 am and 5:30 pm IST, and refuses to start otherwise.
 */
function assertDaytime(): void {
  // A run-once escape (owner, 3 Nov 2026 evening: "the guide pictures may be taken at night"):
  // `GUIDE_ANYTIME=1` skips this guard for one run; the default stays daytime only. A working-hours
  // picture that cannot show its daytime state at night is then kept from the last daytime run.
  if (ANYTIME) {
    // Night runs retake named pictures only: the working-hours ones need the daytime state.
    if (ONLY.length === 0) throw new Error("GUIDE_ANYTIME=1 needs GUIDE_ONLY: name the pictures.");
    return;
  }
  const [hours, minutes] = systemClock()
    .toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour12: false })
    .split(":")
    .map(Number);
  const now = (hours ?? 0) * 60 + (minutes ?? 0);
  if (now < 11 * 60 + 15 || now > 17 * 60 + 30) {
    throw new Error(
      "guide:screenshots runs between 11:15 am and 5:30 pm IST: its pictures show a working day (late starts, asks to leave early) with the working hours on.",
    );
  }
}

test.beforeAll(async () => {
  assertDaytime();
  demo = await makeDemo();
});

/** Signs in through the real form; the Start-day prompt is left for the shots to answer. */
async function signInAs(context: BrowserContext, role: GuideRole): Promise<Page> {
  const user = USERS[role];
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.locator('[data-slot="page-header"]:visible')).toBeVisible();
  return page;
}

/** Starts the day from the prompt when it is there (every shot but the prompt's own). */
async function answerStartPrompt(page: Page): Promise<void> {
  if ((await page.locator('[data-slot="start-day-prompt-mount"]').count()) === 0) return;
  const prompt = page.locator('[data-slot="start-day-prompt"]');
  await expect(prompt).toBeVisible();
  await prompt.getByRole("button", { name: "Start day" }).click();
  await expect(prompt).toBeHidden();
}

/** Nothing is still arriving or moving: hydrated, streamed in, fonts loaded, animations done. */
async function settle(page: Page): Promise<void> {
  await expect(page.locator("html")).toHaveAttribute("data-chrome", /.+/);
  await expect(page.locator('[data-slot="page-header"]:visible')).toBeVisible();
  await expect(page.locator('[data-slot="skeleton"]:visible')).toHaveCount(0);
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => {
      const iterations = animation.effect?.getComputedTiming().iterations;
      return iterations === Infinity || animation.playState !== "running";
    }),
  );
}

/** The outline and the numbered badge, drawn over the page (removed after the picture). */
async function addHighlight(target: Locator, badge: number): Promise<Box> {
  return target.evaluate(
    (element, { badge, accent }) => {
      // A field focused on open draws its focus ring: not part of the step.
      const focused = document.activeElement;
      if (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement) {
        focused.blur();
      }
      // A passing "Saved" toast is not part of the step either (an error toast fails the shot).
      const quiet = document.createElement("style");
      quiet.dataset.guideHighlight = "";
      quiet.textContent = "[data-sonner-toaster] { display: none !important; }";
      document.head.append(quiet);
      const rect = element.getBoundingClientRect();
      const layer = document.createElement("div");
      layer.dataset.guideHighlight = "";
      layer.setAttribute("aria-hidden", "true");
      Object.assign(layer.style, {
        position: "fixed",
        inset: "0",
        pointerEvents: "none",
        zIndex: "2147483647",
      });
      const ring = document.createElement("div");
      Object.assign(ring.style, {
        position: "absolute",
        left: `${rect.left - 4}px`,
        top: `${rect.top - 4}px`,
        width: `${rect.width + 8}px`,
        height: `${rect.height + 8}px`,
        border: `2px solid ${accent}`,
        borderRadius: "8px",
        boxSizing: "border-box",
      });
      // The badge sits outside the outline, never over the element: left of its top-left
      // corner, or above it when the screen has no room on the left.
      const ringLeft = rect.left - 4;
      const ringTop = rect.top - 4;
      const size = 24;
      const gap = 2;
      const roomLeft = ringLeft - gap - size >= 0;
      const roomAbove = ringTop - gap - size >= 0;
      const badgeLeft = roomLeft || !roomAbove ? ringLeft - gap - size : ringLeft;
      const badgeTop = roomLeft || !roomAbove ? ringTop - size / 2 : ringTop - gap - size;
      const dot = document.createElement("div");
      dot.textContent = String(badge);
      Object.assign(dot.style, {
        position: "absolute",
        left: `${badgeLeft}px`,
        top: `${badgeTop}px`,
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: "9999px",
        background: accent,
        color: "#ffffff",
        font: "600 13px/24px system-ui, sans-serif",
        textAlign: "center",
        boxShadow: "0 0 0 2px #ffffff",
      });
      layer.append(ring, dot);
      document.body.append(layer);
      // The ring and the badge, as drawn: what the crop must keep.
      const left = Math.min(ringLeft, badgeLeft) - 2;
      const top = Math.min(ringTop, badgeTop) - 2;
      const right = ringLeft + rect.width + 8 + 2;
      const bottom = ringTop + rect.height + 8 + 2;
      return { x: left, y: top, width: right - left, height: bottom - top };
    },
    { badge, accent: ACCENT },
    { timeout: STEP_TIMEOUT },
  );
}

async function removeHighlight(page: Page): Promise<void> {
  await page.evaluate(() =>
    document.querySelectorAll("[data-guide-highlight]").forEach((n) => n.remove()),
  );
}

/**
 * What a crop keeps of its region. A dialog or a sheet: down to its last visible content (a
 * sheet runs the full height, mostly empty). A part of the page: below the sticky top bar and
 * above the bottom band (a region scrolled under them would show them over its content).
 */
async function regionOf(region: Locator): Promise<Region> {
  return region.evaluate(
    (element) => {
      const box = element.getBoundingClientRect();
      const isLayer = element.matches('[role="dialog"], [role="alertdialog"]');
      if (isLayer) {
        let bottom = box.top;
        for (const child of element.querySelectorAll("*")) {
          const rect = child.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) bottom = Math.max(bottom, rect.bottom);
        }
        const end = Math.min(box.bottom, bottom + 16);
        return {
          x: box.left,
          y: box.top,
          width: box.width,
          height: end - box.top,
          minY: 0,
          maxY: window.innerHeight,
        };
      }
      const bar = document.querySelector('[data-slot="top-bar"]')?.getBoundingClientRect();
      const band = document.querySelector('[data-slot="push-banner"]')?.getBoundingClientRect();
      const minY = bar && bar.height > 0 ? bar.bottom : 0;
      const maxY = band && band.height > 0 ? band.top : window.innerHeight;
      const top = Math.max(box.top, minY);
      const bottom = Math.min(box.bottom, maxY);
      return {
        x: box.left,
        y: top,
        width: box.width,
        height: Math.max(0, bottom - top),
        minY,
        maxY,
      };
    },
    undefined,
    { timeout: STEP_TIMEOUT },
  );
}

/** The crop: the region and the highlight together, padded, inside the viewport. */
function clipOf(page: Page, region: Region | null, mark: Box, pad: number): Box {
  const view = page.viewportSize() ?? { width: 1440, height: 900 };
  if (!region) return { x: 0, y: 0, width: view.width, height: view.height };
  const left = Math.max(0, Math.min(region.x, mark.x) - pad);
  const top = Math.max(region.minY, Math.min(region.y, mark.y) - pad);
  const right = Math.min(view.width, Math.max(region.x + region.width, mark.x + mark.width) + pad);
  const bottom = Math.min(
    region.maxY,
    Math.max(region.y + region.height, mark.y + mark.height) + pad,
  );
  return {
    x: Math.floor(left),
    y: Math.floor(top),
    width: Math.ceil(right - left),
    height: Math.ceil(bottom - top),
  };
}

/**
 * PNG → WebP in the browser (no new dependency): drawn on a canvas and encoded, the quality
 * lowered until the file fits `MAX_BYTES` (never below `MIN_QUALITY`).
 */
async function toWebP(
  converter: Page,
  png: Buffer,
): Promise<{ data: Buffer; width: number; height: number }> {
  const result = await converter.evaluate(
    async ({ base64, maxBytes, minQuality }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      canvas.getContext("2d")?.drawImage(image, 0, 0);
      let quality = 0.9;
      let url = canvas.toDataURL("image/webp", quality);
      const bytes = (dataUrl: string) =>
        Math.floor(((dataUrl.length - dataUrl.indexOf(",") - 1) * 3) / 4);
      while (bytes(url) > maxBytes && quality > minQuality + 1e-9) {
        quality = Math.max(minQuality, quality - 0.05);
        url = canvas.toDataURL("image/webp", quality);
      }
      return { url, width: canvas.width, height: canvas.height };
    },
    { base64: png.toString("base64"), maxBytes: MAX_BYTES, minQuality: MIN_QUALITY },
  );
  if (!result.url.startsWith("data:image/webp")) throw new Error("this browser cannot encode WebP");
  const data = Buffer.from(result.url.slice(result.url.indexOf(",") + 1), "base64");
  return { data, width: result.width, height: result.height };
}

async function capture(page: Page, converter: Page, shot: GuideShot): Promise<void> {
  const [role] = shot.id.split("/") as [GuideRole];
  await buildDays(shot.days ?? ROLE_DAYS[role]);
  await captureNow(page, converter, shot);
}

async function captureNow(page: Page, converter: Page, shot: GuideShot): Promise<void> {
  const path = typeof shot.path === "function" ? shot.path(demo) : shot.path;
  await page.goto(path);
  await expect(page.locator('[data-slot="page-header"]:visible')).toBeVisible();
  if (!shot.keepStartPrompt) await answerStartPrompt(page);
  await settle(page);
  if (shot.prepare) {
    await shot.prepare(page);
    await settle(page);
  }
  const errors = page.locator('[data-sonner-toast][data-type="error"]:visible');
  expect(await errors.count(), "no error toast on screen").toBe(0);

  // No hover state left over from the last tap.
  await page.mouse.move(0, 0);
  const target = shot.highlight(page);
  await expect(target).toBeVisible();
  await target.scrollIntoViewIfNeeded();
  await settle(page);
  const regionLocator = shot.crop?.(page);
  if (regionLocator) await expect(regionLocator).toBeVisible();
  const region = regionLocator ? await regionOf(regionLocator) : null;
  const mark = await addHighlight(target, shot.badge ?? 1);
  try {
    const png = await page.screenshot({
      clip: clipOf(page, region, mark, shot.cropPadding ?? PAD),
      animations: "disabled",
      caret: "hide",
    });
    const webp = await toWebP(converter, png);
    const [role, name] = shot.id.split("/") as [GuideRole, string];
    const file = join("public", "guide", role, `${name}.webp`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, webp.data);
    produced.set(shot.id, {
      src: `/guide/${role}/${name}.webp`,
      width: Math.round(webp.width / SCALE),
      height: Math.round(webp.height / SCALE),
      alt: shot.alt,
    });
  } finally {
    await removeHighlight(page);
  }
}

for (const role of ["staff", "admin", "owner"] as const satisfies readonly GuideRole[]) {
  test(`the ${role}'s pictures`, async ({ context }) => {
    // The project's laptop (1440×900, scale 2, light colour scheme), one context per role.
    // Headless Chromium answers "denied" for notifications; a laptop that has not been asked
    // yet answers "default", which is what Me's Notifications row is pictured for.
    await context.addInitScript(() => {
      if (typeof Notification !== "undefined") {
        Object.defineProperty(Notification, "permission", { get: () => "default" });
      }
    });
    // Light theme whatever the machine prefers (next-themes reads "theme").
    await context.addInitScript(() => {
      try {
        window.localStorage.setItem("theme", "light");
      } catch {
        // Storage refused: the colour scheme above still picks light.
      }
    });
    try {
      // Signed in with the day built: a Start-day prompt left open would cover every screen.
      await buildDays(ROLE_DAYS[role]);
      const page = await signInAs(context, role);
      const converter = await context.newPage();
      const shots = GUIDE_SHOT_LIST.filter(
        (entry) => entry.id.startsWith(`${role}/`) && wanted(entry.id),
      );
      for (const shot of shots) {
        try {
          await capture(page, converter, shot);
        } catch (error) {
          const reason = error instanceof Error ? error.message.split("\n")[0] : String(error);
          failures.push(`${shot.id}: ${reason}`);
          await page.keyboard.press("Escape").catch(() => undefined);
        }
      }
    } finally {
      await context.close();
    }
  });
}

test.afterAll(() => {
  writeManifest();
  if (failures.length > 0) {
    throw new Error(`${failures.length} picture(s) not made:\n${failures.join("\n")}`);
  }
});

/**
 * `src/modules/guide/domain/shots.generated.ts`: every picture made, in the registry's order. An
 * entry a run did not make keeps its earlier one: a `GUIDE_ONLY` run's other pictures, and a
 * picture that failed (its earlier file is still on disk; a run refused by the daytime guard
 * once dropped all three it was asked for).
 */
function writeManifest(): void {
  const lines = GUIDE_SHOT_LIST.flatMap((shot) => {
    const entry = produced.get(shot.id) ?? GUIDE_SHOTS[shot.id];
    if (!entry) return [];
    return [
      `  ${JSON.stringify(shot.id)}: {`,
      `    src: ${JSON.stringify(entry.src)},`,
      `    width: ${entry.width},`,
      `    height: ${entry.height},`,
      `    alt: ${JSON.stringify(entry.alt)},`,
      "  },",
    ];
  });
  const source = [
    "// Generated by `pnpm guide:screenshots` (e2e/guide-screenshots.ts) from e2e/guide-shots.ts.",
    "// Do not edit: change the registry and run the script again.",
    "",
    '/** The guide\'s laptop screenshots by shot id ("<role>/<name>"); width and height in CSS px. */',
    "export const GUIDE_SHOTS: Readonly<",
    "  Record<string, { src: string; width: number; height: number; alt: string }>",
    "> = {",
    ...lines,
    "};",
    "",
  ].join("\n");
  writeFileSync(MANIFEST, source);
}
