import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { can } from "@/core/permissions";
import { navFor } from "@/core/ui/shell/nav";

import { guideFor, guideShotsFor } from "../domain/guide";
import { normalise, searchGuide, stepText, topicCount } from "../domain/search";
import { GUIDE_SHOTS } from "../domain/shots.generated";
import type { Guide, GuideBlock, GuideRole } from "../domain/types";

const ROLES: readonly GuideRole[] = ["owner", "admin", "staff"];

function textOf(guide: Guide): string {
  const block = (b: GuideBlock) => (b.kind === "steps" ? b.steps.map(stepText).join(" ") : b.text);
  return guide.sections
    .flatMap((s) => [
      s.title,
      ...s.topics.flatMap((t) => [
        t.title,
        t.summary,
        ...(t.keywords ?? []),
        ...t.blocks.map(block),
        t.link?.label ?? "",
      ]),
    ])
    .join("\n");
}

function linksOf(guide: Guide): string[] {
  return guide.sections.flatMap((s) => s.topics.flatMap((t) => (t.link ? [t.link.href] : [])));
}

/** The routes that exist under `src/app/(app)` (route groups folded away). */
const APP = path.join(process.cwd(), "src/app/(app)");
function routeExists(href: string): boolean {
  const pathname = new URL(href, "http://x").pathname;
  const parts = pathname.split("/").filter(Boolean);
  const walk = (dir: string, rest: string[]): boolean => {
    if (rest.length === 0)
      return existsSync(path.join(dir, "page.tsx")) || groups(dir).some((g) => walk(g, []));
    const [head, ...tail] = rest as [string, ...string[]];
    const direct = path.join(dir, head);
    if (existsSync(direct) && walk(direct, tail)) return true;
    return groups(dir).some((g) => walk(g, rest));
  };
  return walk(APP, parts);
}
function groups(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith("("))
    .map((e) => path.join(dir, e.name));
}

/** The top-level screens a role reaches: its navigation, Me and what Me opens, and Alerts. */
function reachable(role: GuideRole): Set<string> {
  const firsts = navFor(role).map((item) => item.href.split("/")[1] ?? "");
  // Me opens "Attendance & leave" and "Extra work & expenses" for everyone who marks attendance
  // (an Admin too, whose navigation has no Leave tab); the Owner has neither.
  const own = can(role, "attendance.self") ? ["leave"] : [];
  return new Set([...firsts, ...own, "me", "notifications"]);
}

describe.each(ROLES)("the %s guide", (role) => {
  const guide = guideFor(role);

  it("is the reader's own and has topics", () => {
    expect(guide.role).toBe(role);
    expect(topicCount(guide.sections)).toBeGreaterThan(5);
  });

  it("gives every section and topic a unique id, a title, a summary and a body", () => {
    const ids = guide.sections.flatMap((s) => [s.id, ...s.topics.map((t) => t.id)]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
    for (const section of guide.sections) {
      expect(section.title.trim()).not.toBe("");
      expect(section.topics.length).toBeGreaterThan(0);
      for (const topic of section.topics) {
        expect(topic.title.trim(), topic.id).not.toBe("");
        expect(topic.summary.trim(), topic.id).not.toBe("");
        expect(topic.blocks.length, topic.id).toBeGreaterThan(0);
      }
    }
  });

  it("labels examples once: the screen adds “Example:”, the text never repeats it", () => {
    for (const topic of guide.sections.flatMap((s) => s.topics)) {
      for (const block of topic.blocks) {
        if (block.kind === "example") expect(block.text, topic.id).not.toMatch(/^example/i);
      }
    }
  });

  it("links only into screens that exist and this role reaches", () => {
    const allowed = reachable(role);
    for (const href of linksOf(guide)) {
      expect(routeExists(href), `${href} exists`).toBe(true);
      expect(allowed.has(href.split("/")[1] ?? ""), `${role} reaches ${href}`).toBe(true);
    }
  });

  it("uses only screenshots that exist, taken as this role (Crew pictures never show others' screens)", () => {
    for (const topic of guide.sections.flatMap((s) => s.topics)) {
      for (const block of topic.blocks) {
        if (block.kind !== "steps") continue;
        for (const step of block.steps) {
          if (typeof step === "string" || !step.shot) continue;
          expect(step.shot.startsWith(`${role}/`), `${topic.id}: ${step.shot}`).toBe(true);
          const shot = GUIDE_SHOTS[step.shot];
          expect(shot, `${topic.id}: ${step.shot} is generated`).toBeDefined();
          expect(shot?.alt.trim(), step.shot).not.toBe("");
          expect(existsSync(path.join(process.cwd(), "public", shot?.src ?? "")), step.shot).toBe(
            true,
          );
        }
      }
    }
  });

  it("hands the page only the screenshots its own steps show (no other role's reach the browser)", () => {
    const shots = guideShotsFor(guide);
    const used = guide.sections
      .flatMap((s) => s.topics)
      .flatMap((t) => t.blocks)
      .flatMap((b) => (b.kind === "steps" ? b.steps : []))
      .flatMap((step) => (typeof step === "string" || !step.shot ? [] : [step.shot]));
    expect(Object.keys(shots).sort()).toEqual([...new Set(used)].sort());
    for (const [id, shot] of Object.entries(shots)) {
      expect(id.startsWith(`${role}/`), id).toBe(true);
      expect(shot).toBe(GUIDE_SHOTS[id]);
    }
  });

  it("ends with Help and troubleshooting: a missing button, reload, installing, notifications", () => {
    const help = guide.sections.at(-1);
    expect(help?.id).toBe("help");
    const text = normalise(help ? textOf({ role, sections: [help] }) : "");
    for (const word of ["role", "reload", "install", "notification"]) {
      expect(text, word).toContain(word);
    }
  });
});

describe("what each role is told", () => {
  it("never tells Crew about client work, approvals, settings or money (invariants 2 and 4)", () => {
    const text = normalise(textOf(guideFor("staff")));
    for (const word of [
      "client",
      "project",
      "deliverable",
      "stage group",
      "preset",
      "template",
      "revenue",
      "settings",
      "approvals",
    ]) {
      expect(text, word).not.toContain(word);
    }
  });

  it("tells Crew they never reorder a task's stages (owner 2026-10-15)", () => {
    expect(normalise(textOf(guideFor("staff")))).toMatch(/reorder|order of the stages/);
  });

  it("gives the Owner and Admins client work, the Crew guide none of their topics", () => {
    const crew = new Set(guideFor("staff").sections.flatMap((s) => s.topics.map((t) => t.id)));
    for (const role of ["owner", "admin"] as const) {
      const text = normalise(textOf(guideFor(role)));
      for (const word of ["deliverable", "stage group", "template", "preview"]) {
        expect(text, `${role}: ${word}`).toContain(word);
      }
      const sections = guideFor(role).sections.map((s) => s.id);
      expect(sections).toContain("clients");
    }
    expect([...crew].some((id) => id.startsWith("client") || id.startsWith("project"))).toBe(false);
  });

  it("keeps money out of the Admin guide (invariant 2)", () => {
    expect(normalise(textOf(guideFor("admin")))).not.toMatch(/revenue|\bamount\b|\bprice\b/);
  });
});

describe("searchGuide", () => {
  const guide: Guide = {
    role: "staff",
    sections: [
      {
        id: "day",
        title: "Your day",
        topics: [
          {
            id: "start",
            title: "Start day",
            summary: "Mark that you are working.",
            blocks: [{ kind: "steps", steps: ["Open My Day", "Tap Start day"] }],
          },
          {
            id: "leave",
            title: "Ask for leave",
            summary: "A full or half day.",
            blocks: [{ kind: "text", text: "Choose the dates." }],
            keywords: ["holiday", "time off"],
          },
        ],
      },
      {
        id: "help",
        title: "Help and troubleshooting",
        topics: [
          {
            id: "reload",
            title: "Nothing changed after an edit",
            summary: "Reload the screen.",
            blocks: [{ kind: "note", text: "Pull down, or use Reload app on Me." }],
          },
        ],
      },
    ],
  };

  it("keeps everything for an empty or blank query", () => {
    expect(searchGuide(guide, "")).toBe(guide.sections);
    expect(searchGuide(guide, "   ")).toBe(guide.sections);
  });

  it("matches every word in any order, across title, text, steps and keywords", () => {
    expect(searchGuide(guide, "half leave").flatMap((s) => s.topics.map((t) => t.id))).toEqual([
      "leave",
    ]);
    expect(searchGuide(guide, "HOLIDAY").flatMap((s) => s.topics.map((t) => t.id))).toEqual([
      "leave",
    ]);
    expect(searchGuide(guide, "tap start").flatMap((s) => s.topics.map((t) => t.id))).toEqual([
      "start",
    ]);
    expect(searchGuide(guide, "reload app").map((s) => s.id)).toEqual(["help"]);
  });

  it("drops sections with no match and finds nothing for a word nowhere in the guide", () => {
    expect(searchGuide(guide, "start").map((s) => s.id)).toEqual(["day"]);
    expect(searchGuide(guide, "zzz")).toEqual([]);
  });

  it("folds case, accents and punctuation", () => {
    expect(normalise("Task-Noted, Café!")).toBe("task noted cafe");
  });
});
