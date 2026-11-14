import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { HOLD_PROXY_PORT } from "../e2e/hold-proxy-config";

/**
 * The local stack's ports are reserved before it starts on CI (X5, 2026-11-11): they sit inside
 * Linux's ephemeral range, so an outgoing connection made while the images pull could take one
 * first, and `supabase start` failed with "address already in use" (pgTAP, CI run 42077454642).
 */
const read = (...path: string[]) => readFileSync(join(process.cwd(), ...path), "utf8");
const ci = read(".github", "workflows", "ci.yml");

/** Linux's default `net.ipv4.ip_local_port_range` on the runners. */
const EPHEMERAL = { from: 32768, to: 60999 };

/** Every job of ci.yml, by its id, as its own text. */
function jobs(): Record<string, string> {
  const body = ci.slice(ci.indexOf("\njobs:\n"));
  const starts = [...body.matchAll(/^ {2}([a-z][\w-]*):$/gm)];
  return Object.fromEntries(
    starts.map((match, index) => [
      match[1]!,
      body.slice(match.index, starts[index + 1]?.index ?? body.length),
    ]),
  );
}

const RESERVE = /sysctl -w net\.ipv4\.ip_local_reserved_ports=([\d,-]+)/;

function reserved(job: string): Set<number> {
  const ports = new Set<number>();
  for (const part of job.match(RESERVE)?.[1]?.split(",") ?? []) {
    const [from, to = from] = part.split("-").map(Number);
    for (let port = from!; port <= to!; port += 1) ports.add(port);
  }
  return ports;
}

/** Every port the local stack listens on that Linux could hand out as a source port. */
function stackPorts(): number[] {
  const config = [...read("supabase", "config.toml").matchAll(/^\w*port = (\d+)$/gm)].map((match) =>
    Number(match[1]),
  );
  return [...config, HOLD_PROXY_PORT].filter(
    (port) => port >= EPHEMERAL.from && port <= EPHEMERAL.to,
  );
}

describe("the CI jobs that start the local stack", () => {
  const starting = Object.entries(jobs()).filter(([, job]) => job.includes("supabase start"));

  it("are the pgTAP job and the Playwright shards", () => {
    expect(starting.map(([id]) => id)).toEqual(["db", "e2e"]);
  });

  it("reserve the stack's ports before it starts", () => {
    for (const [id, job] of starting) {
      const reserve = job.search(RESERVE);
      expect(reserve, `${id}: the reservation`).toBeGreaterThan(-1);
      expect(reserve, id).toBeLessThan(job.indexOf("supabase start"));
    }
  });

  it("cover every port of config.toml and the hold proxy inside the ephemeral range", () => {
    const ports = stackPorts();
    expect(ports).toEqual(expect.arrayContaining([54321, 54322, HOLD_PROXY_PORT]));
    for (const [id, job] of starting) {
      const held = reserved(job);
      expect(
        ports.filter((port) => !held.has(port)),
        id,
      ).toEqual([]);
    }
  });
});
