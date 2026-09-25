import { describe, expect, it } from "vitest";

import { LAUNCH_INTRO_SCRIPT, LAUNCH_SESSION_KEY } from "./launch-intro";

/** Runs the head script against a fake window and says whether it marked a launch. */
function run({
  standalone = false,
  iosStandalone = false,
  launched = false,
  storageThrows = false,
}: {
  standalone?: boolean;
  iosStandalone?: boolean;
  launched?: boolean;
  storageThrows?: boolean;
}): { marked: boolean; stored: string | null } {
  const store = new Map<string, string>(launched ? [[LAUNCH_SESSION_KEY, "1"]] : []);
  const attributes = new Map<string, string>();
  const sessionStorage = {
    getItem: (key: string) => {
      if (storageThrows) throw new Error("SecurityError");
      return store.get(key) ?? null;
    },
    setItem: (key: string, value: string) => void store.set(key, value),
  };
  const window = {
    matchMedia: (query: string) => ({
      matches: standalone && query === "(display-mode: standalone)",
    }),
    navigator: { standalone: iosStandalone },
  };
  const document = {
    documentElement: { setAttribute: (name: string, value: string) => attributes.set(name, value) },
  };
  new Function("window", "sessionStorage", "document", LAUNCH_INTRO_SCRIPT)(
    window,
    sessionStorage,
    document,
  );
  return { marked: attributes.has("data-launch"), stored: store.get(LAUNCH_SESSION_KEY) ?? null };
}

describe("the launch intro's head script (2.7)", () => {
  it("marks the first document of an installed window", () => {
    expect(run({ standalone: true })).toEqual({ marked: true, stored: "1" });
    expect(run({ iosStandalone: true })).toEqual({ marked: true, stored: "1" });
  });

  it("never plays twice in a session: a reload is not a cold start", () => {
    expect(run({ standalone: true, launched: true }).marked).toBe(false);
  });

  it("never plays in a browser tab", () => {
    expect(run({})).toEqual({ marked: false, stored: null });
  });

  it("stays quiet when storage is blocked", () => {
    expect(run({ standalone: true, storageThrows: true }).marked).toBe(false);
  });
});
