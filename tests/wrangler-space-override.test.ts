import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The upload space guard's test override (v4.5, S7; advisor 25 Nov 2026) lives under
 * `env.staging.vars` in `wrangler.jsonc` and nowhere else: never at the top level (which some
 * wrangler paths inherit into every environment) and never in production's environment, which
 * keeps the decided 10 GB step and 10 GB reserve.
 */
const OVERRIDE = ["UPLOAD_SPACE_STEP_BYTES", "UPLOAD_SPACE_RESERVE_BYTES"];

type Env = { vars?: Record<string, string> };
type Config = Env & { env: Record<string, Env> };

/** `wrangler.jsonc` as JSON: its `//` comments and trailing commas removed, strings kept. */
function readConfig(): Config {
  const text = readFileSync(path.join(process.cwd(), "wrangler.jsonc"), "utf8");
  let out = "";
  let quote = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quote) {
      out += char;
      if (char === "\\") out += text[++i] ?? "";
      else if (char === '"') quote = false;
      continue;
    }
    if (char === '"') {
      quote = true;
      out += char;
      continue;
    }
    if (char === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    out += char;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1")) as Config;
}

describe("wrangler.jsonc: the space guard's test override is staging's alone", () => {
  const config = readConfig();
  it("staging sets a 1 GB step and no reserve", () => {
    expect(config.env.staging?.vars).toMatchObject({
      UPLOAD_SPACE_STEP_BYTES: "1000000000",
      UPLOAD_SPACE_RESERVE_BYTES: "0",
    });
  });
  it("neither the top level nor production names it", () => {
    for (const name of OVERRIDE) {
      expect(config.vars?.[name], `top-level ${name}`).toBeUndefined();
      expect(config.env.production?.vars?.[name], `production ${name}`).toBeUndefined();
    }
    expect(Object.keys(config.env).sort()).toEqual(["production", "staging"]);
  });
});
