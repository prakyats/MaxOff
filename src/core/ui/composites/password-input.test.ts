import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Every password field in the app goes through `PasswordInput`, so every one of them gets the
 * show/hide toggle (task 1.5, ARCHITECTURE §14.1).
 *
 * A source sweep rather than a browser test, for the same reason as `overlay-registration`: the
 * way to miss this is to reach past the component, and `/set-password` cannot be opened in a
 * test anyway — without a valid recovery token it redirects to `/login`.
 */
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const srcDir = path.join(root, "src");

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(child));
    else if (/\.tsx$/.test(entry.name)) found.push(child);
  }
  return found;
}

const files = sourceFiles(srcDir)
  .filter((file) => !file.endsWith("password-input.tsx"))
  .map((file) => ({
    path: path.relative(root, file).replaceAll("\\", "/"),
    text: readFileSync(file, "utf8"),
  }));

describe("password fields", () => {
  it("finds the source at all", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("never renders a raw type=password input", () => {
    const offenders = files
      .filter((file) => file.text.includes('type="password"'))
      .map((f) => f.path);
    expect(offenders, "use PasswordInput so the field gets a show/hide toggle").toEqual([]);
  });

  it("covers the fields that exist today", () => {
    const users = files.filter((file) => file.text.includes("<PasswordInput")).map((f) => f.path);
    expect(users).toContain("src/core/auth/components/login-form.tsx");
    expect(users).toContain("src/core/auth/components/set-password-form.tsx");
  });

  it("keeps autocomplete required, because autofill keys off it", () => {
    const component = readFileSync(
      fileURLToPath(new URL("./password-input.tsx", import.meta.url)),
      "utf8",
    );
    // Not optional in the type, and never rewritten when the field is revealed.
    expect(component).toContain('autoComplete: "current-password" | "new-password"');
    expect(component).toContain('type={revealed ? "text" : "password"}');
    expect(component).toContain('type="button"');
    expect(component).toContain("aria-pressed={revealed}");
  });
});
