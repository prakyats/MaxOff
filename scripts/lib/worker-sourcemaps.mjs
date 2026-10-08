// Readable Sentry stack traces on the Worker (ROADMAP 6.6, ARCHITECTURE §18.2): the pure parts of
// `scripts/worker-sourcemaps.mjs`, unit-tested in `tests/worker-sourcemaps.test.ts`.
//
// Why a debug id of our own: `wrangler deploy` bundles `worker/index.js`, OpenNext's
// `.open-next/worker.js` and every Next chunk into ONE file, so a server stack frame is a line
// and column in that file. Turbopack gives every chunk its own debug id (`globalThis._debugIds`,
// registered as each chunk loads), and once they all live in one file the Sentry SDK keeps
// whichever chunk registered last for it: the event would name a chunk's map, which does not
// fit the Worker's lines. The registration below gives the Worker file the one debug id its own
// source map is uploaded under, and freezes the registry so a chunk loaded later cannot replace it.

import path from "node:path";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The statement put first in `.open-next/worker.js` before the Worker is bundled. It keys the id
 * by its own stack (the SDK reads the file name from it, as for any debug id), replaces whatever
 * the middleware's chunks registered while their modules loaded, and freezes the registry:
 * Turbopack's registration writes into it inside a `try`, so a later chunk changes nothing.
 * @param {string} debugId a lower-case UUID
 * @returns {string}
 */
export function debugIdRegistration(debugId) {
  if (!UUID.test(debugId)) throw new Error(`Not a debug id: ${debugId}`);
  return (
    `;!function(){try{var e=globalThis,n=(new e.Error).stack;n&&Object.defineProperty(e,"_debugIds",` +
    `{value:Object.freeze({[n]:"${debugId}"}),writable:!1,enumerable:!1,configurable:!1})}catch(e){}}();`
  );
}

/**
 * A source that is the app's own code (its content is kept in the uploaded map).
 * @param {string} source
 */
export function isAppSource(source) {
  return source.startsWith("src/");
}

/**
 * A map source as a path from the repository root. Wrangler writes them relative to its output
 * directory, through OpenNext's copies (`.open-next/server-functions/default/…`,
 * `.open-next/middleware/…`), which are dropped so a frame reads `src/…`. Sources that are not
 * paths (`node-built-in-modules:fs`) are kept as they are.
 * @param {string} source
 * @param {{ mapDir: string, root: string }} where
 */
export function normalizeSource(source, { mapDir, root }) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(source)) return source;
  const fromRoot = path.relative(root, path.resolve(mapDir, source)).split(path.sep).join("/");
  return fromRoot.replace(/^\.open-next\/(?:server-functions\/default|middleware)\//, "");
}

/**
 * The Worker's map as it is uploaded: sources from the repository root, the app's own sources
 * with their content and every other content left out (node_modules and Next's runtime make up
 * nearly all of the size), and the debug id the bundle registers. Does not change `map`.
 * @param {{ sources: string[], sourcesContent?: (string | null)[] } & Record<string, unknown>} map
 * @param {{ debugId: string, mapDir: string, root: string }} options
 */
export function prepareWorkerMap(map, { debugId, mapDir, root }) {
  const sources = map.sources.map((source) => normalizeSource(source, { mapDir, root }));
  const sourcesContent = sources.map((source, index) =>
    isAppSource(source) ? (map.sourcesContent?.[index] ?? null) : null,
  );
  return { ...map, sources, sourcesContent, debug_id: debugId, debugId };
}

/**
 * The bundle as it is uploaded: the deployed code unchanged, plus the comment `sentry-cli` reads
 * the debug id from (after the last line, so no line or column moves).
 * @param {string} code
 * @param {string} debugId
 */
export function stampDebugId(code, debugId) {
  return `${code.endsWith("\n") ? code : `${code}\n`}//# debugId=${debugId}\n`;
}
