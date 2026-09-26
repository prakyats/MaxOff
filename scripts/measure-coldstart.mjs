// The Worker's cold start (task 2.8 c): the first request after an idle period, kept apart from
// the `/` redirect and from the network. Signed out, so it needs no account.
//
//   node scripts/measure-coldstart.mjs --base https://phase-2-maxoff-staging.<sub>.workers.dev
//                                      [--path /login] [--samples 6] [--idle 300] [--warm 3]
//
// Each sample waits `--idle` seconds without touching the Worker, then requests `--path` once
// and `--warm` more times, each on a fresh connection so every row pays the same DNS + TLS. A
// static asset (`/manifest.webmanifest`) is served by Workers Assets without running the Worker,
// so it stands in for the network. Reported per request, from curl's timings:
//   server   first byte − TLS done: the Worker's own time (plus one round trip)
//   total    the whole response
//
// What a cold start looks like (2.8, measured): idling does not reliably evict an isolate (five
// minutes did not), but a fresh connection often lands on an isolate that has not run the Worker
// yet, anywhere in the pool, and that request takes seconds where a warm one takes a few hundred
// ms. The two groups do not overlap, so the summary splits every request at `--split` ms (1000)
// and reports each group. Right after a new version is uploaded every isolate is new: run the
// probe then (`--idle 0 --no-first-wait`) to see the most cold starts.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .reduce(
      (pairs, arg, i, all) =>
        arg.startsWith("--") ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs,
      [],
    ),
);
if (!args.base) throw new Error("--base is required");
const path = args.path ?? "/login";
const samples = Number(args.samples ?? 6);
const idle = Number(args.idle ?? 300);
const warm = Number(args.warm ?? 3);
const split = Number(args.split ?? 1000);

async function time(url) {
  const { stdout } = await run("curl", [
    "-s",
    "-o",
    process.platform === "win32" ? "NUL" : "/dev/null",
    "-w",
    "%{http_code} %{time_appconnect} %{time_starttransfer} %{time_total}",
    url,
  ]);
  const [status, tls, firstByte, total] = stdout.trim().split(" ");
  const ms = (seconds) => Math.round(Number(seconds) * 1000);
  return { status, server: ms(firstByte) - ms(tls), total: ms(total) };
}

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const all = [];
const asset = [];
for (let sample = 1; sample <= samples; sample++) {
  if (sample > 1 || !("no-first-wait" in args)) {
    await new Promise((resolve) => setTimeout(resolve, idle * 1000));
  }
  const first = await time(`${args.base}${path}`);
  const rest = [];
  for (let i = 0; i < warm; i++) rest.push(await time(`${args.base}${path}`));
  const network = await time(`${args.base}/manifest.webmanifest`);
  all.push(first.server, ...rest.map((r) => r.server));
  asset.push(network.server);
  console.warn(
    `+${Math.round(performance.now() / 1000)} s  sample ${sample}: first ${first.status} ` +
      `server ${first.server} total ${first.total} · then server ` +
      `${rest.map((r) => r.server).join(", ")} · asset ${network.server}`,
  );
}
const cold = all.filter((ms) => ms >= split);
const hot = all.filter((ms) => ms < split);
const range = (values) =>
  values.length
    ? `median ${median(values)} ms (${Math.min(...values)}–${Math.max(...values)})`
    : "none";
console.warn(
  `${path}: ${all.length} requests · cold (≥ ${split} ms) ${cold.length}: ${range(cold)} · ` +
    `warm ${hot.length}: ${range(hot)} · static asset median ${median(asset)} ms`,
);
