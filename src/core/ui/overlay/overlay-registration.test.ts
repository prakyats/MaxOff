import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Every overlay in the app is registered with the back-gesture controller (task 1.5,
 * ARCHITECTURE §14.1).
 *
 * Registration happens inside the `Dialog`, `AlertDialog` and `Sheet` **roots**, so the way to
 * miss it is not to forget a hook — it is to reach past those roots for Radix directly. This
 * enumerates the source rather than trusting a reviewer to notice, the same approach as
 * `loading-routes.test.ts`.
 *
 * The bug that motivated it: the People detail sheet looked registered (it does use our `Sheet`)
 * but had no history entry, so back navigated instead of closing it. That one was a controller
 * bug rather than a missing registration — covered by `overlay-history.test.ts` and
 * `e2e/back-gesture.spec.ts` — and it is why this file checks wiring, not just imports.
 */
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const srcDir = path.join(root, "src");
const primitivesDir = path.join(srcDir, "core/ui/primitives");

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...sourceFiles(child));
    } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".test.ts")) {
      found.push(child);
    }
  }
  return found;
}

const files = sourceFiles(srcDir).map((file) => ({
  path: path.relative(root, file).replaceAll("\\", "/"),
  text: readFileSync(file, "utf8"),
  inPrimitives: file.startsWith(primitivesDir),
}));

/** Roots, not their parts: `<DialogContent>` is inside a `<Dialog>` that is already registered. */
const ROOT_TAG = /<(Sheet|Dialog|AlertDialog)[\s/>]/;

describe("every overlay goes through the registered roots", () => {
  it("finds the source at all (guards against a silently empty sweep)", () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((file) => file.path.endsWith("core/ui/composites/data-table.tsx"))).toBe(
      true,
    );
  });

  it("nothing outside the primitives imports radix-ui directly", () => {
    // Reaching past our roots is the only way to get an unregistered overlay.
    const offenders = files
      .filter((file) => !file.inPrimitives && file.text.includes('from "radix-ui"'))
      .map((file) => file.path);
    expect(offenders).toEqual([]);
  });

  it("every file that renders an overlay root takes it from our primitives", () => {
    const renderers = files.filter((file) => !file.inPrimitives && ROOT_TAG.test(file.text));
    // The detail sheet, the confirm and reason dialogs, the team dialogs, the More sheet...
    expect(renderers.length).toBeGreaterThanOrEqual(5);

    for (const file of renderers) {
      const fromOurs =
        /from "@\/core\/ui\/primitives\/(sheet|dialog|alert-dialog)"/.test(file.text) ||
        /from "@\/core\/ui"/.test(file.text) ||
        /from "\.\.?\/(primitives\/)?(sheet|dialog|alert-dialog)"/.test(file.text);
      expect(fromOurs, `${file.path} renders an overlay root from somewhere else`).toBe(true);
    }
  });

  it("names the overlays it is covering, so a shrinking sweep is visible", () => {
    const renderers = files
      .filter((file) => !file.inPrimitives && ROOT_TAG.test(file.text))
      .map((file) => file.path.replace("src/", ""));
    // Not an exhaustive allow-list — a new overlay is welcome and needs no edit here. This only
    // pins the ones that exist, so a refactor that quietly drops one shows up as a failure.
    for (const expected of [
      "core/ui/composites/data-table.tsx", // the People / list detail sheet
      "core/ui/composites/confirm-dialog.tsx",
      "core/ui/shell/more-sheet.tsx",
    ]) {
      expect(renderers, `${expected} no longer renders an overlay`).toContain(expected);
    }
  });

  it("each root actually registers, rather than merely existing", () => {
    for (const file of ["sheet", "dialog", "alert-dialog"]) {
      const text = readFileSync(path.join(primitivesDir, `${file}.tsx`), "utf8");
      expect(text, file).toContain("useOverlayOpenState");
      // Controlled or uncontrolled, the root must hand the real state to the controller.
      expect(text, file).toMatch(/useOverlayOpenState\(\{\s*open,\s*defaultOpen,\s*onOpenChange/);
      expect(text, file).toContain("open={isOpen}");
      expect(text, file).toContain("onOpenChange={setOpen}");
    }
  });
});
