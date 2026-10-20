import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { formatDateTime, formatTime, formatWallTime } from "./ist";

describe("formatTime (B1: one time format)", () => {
  it("is lower-case on the 12-hour clock, in IST", () => {
    expect(formatTime("2026-10-19T12:30:00Z")).toBe("6:00 pm");
    expect(formatTime("2026-10-19T04:21:00Z")).toBe("9:51 am");
  });

  it("shows midnight and noon as 12", () => {
    expect(formatTime("2026-10-19T18:30:00Z")).toBe("12:00 am");
    expect(formatTime("2026-10-19T06:30:00Z")).toBe("12:00 pm");
  });
});

describe("formatDateTime", () => {
  it("joins an IST date and the time", () => {
    expect(formatDateTime("2026-10-19T12:30:00Z")).toBe("19 Oct, 6:00 pm");
    expect(formatDateTime("2026-10-19T12:30:00Z", "EEE d MMM")).toBe("Mon 19 Oct, 6:00 pm");
  });

  it("takes the date from IST across midnight UTC", () => {
    expect(formatDateTime("2026-10-19T19:00:00Z")).toBe("20 Oct, 12:30 am");
  });
});

describe("formatWallTime", () => {
  it("shows a stored wall-clock time the same way", () => {
    expect(formatWallTime("05:00")).toBe("5:00 am");
    expect(formatWallTime("18:00")).toBe("6:00 pm");
    expect(formatWallTime("20:30:00")).toBe("8:30 pm");
    expect(formatWallTime("00:15")).toBe("12:15 am");
    expect(formatWallTime("12:00")).toBe("12:00 pm");
  });

  it("refuses anything else", () => {
    expect(() => formatWallTime("25:00")).toThrow(RangeError);
    expect(() => formatWallTime("6 pm")).toThrow(RangeError);
  });
});

/** Every `.ts`/`.tsx` file under `src/`, tests and `core/time` itself left out. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("no other time format in src/ (B1)", () => {
  it("passes no time token (h, H, m, a) to a date pattern outside core/time", () => {
    const root = join(__dirname, "..", "..");
    const timeDir = join(root, "core", "time");
    const offenders = sources(root)
      .filter((path) => !path.startsWith(timeDir))
      .flatMap((path) => {
        const text = readFileSync(path, "utf8");
        const found: string[] = [];
        // formatIST(…, "pattern") and date-fns style constants such as `"d MMM, h:mm a"`.
        for (const match of text.matchAll(
          /formatIST\([^;"()]*(?:\([^()]*\)[^;"()]*)*,\s*"([^"]*)"\)/g,
        )) {
          if (/[hHma]/.test((match[1] ?? "").replace(/'[^']*'/g, ""))) {
            found.push(`${relative(root, path)}: "${match[1]}"`);
          }
        }
        for (const match of text.matchAll(/"([^"\n]*\b(?:h|HH):mm[^"\n]*)"/g)) {
          found.push(`${relative(root, path)}: "${match[1]}"`);
        }
        if (/toLocaleTimeString|hour12|hour:\s*"/.test(text)) found.push(relative(root, path));
        return found;
      });
    expect(offenders).toEqual([]);
  });
});
