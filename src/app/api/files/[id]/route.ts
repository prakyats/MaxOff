import { z } from "zod";

import { getCurrentMember } from "@/core/auth/server";
import { isRasterMime, PREVIEW_CACHE_SECONDS, SVG_MIME } from "@/core/storage";
import { getFile, getPreviewOf, getStorageAdapter } from "@/core/storage/server";

/**
 * Previews and thumbnails in lists (ARCHITECTURE §11, kickoff 3 decision 12): the same-origin
 * image route. `/api/*` is public in the proxy, so this authenticates itself: the file row is
 * read under RLS with the viewer's session (a visitor with no active member never reaches the
 * database: the `anon` role has no privilege on `files`), and `app.file_visible()` is the permission check
 * the record needs (a client logo to whoever may see the client or its label, an avatar to
 * `team.view` and the person, the company logo to any member). A file nobody may see is a 404,
 * never a 403. `?variant=preview` serves the newest ready browser-made preview of the original,
 * or the original itself when none was made (a raster as it is; an SVG as the sanitised
 * document), so a tile never shows a broken image.
 *
 * A file never changes (replacing one is a new id), so the browser may keep it for a day,
 * privately. Every answer of this route carries a CSP that forbids scripts and external loads
 * and sandboxes the document (`FILE_ROUTE_CSP` in `core/http/response-headers`, applied by
 * `next.config.ts`, which is the one place a response header survives), on top of the
 * sanitising an SVG gets at upload; a file is only ever an `<img>` source. An SVG is sent as
 * an attachment (ARCHITECTURE §11: SVG and HTML are never served inline), which a browser
 * ignores for an `<img>` subresource and honours on a direct visit.
 */
const paramsSchema = z.object({ id: z.uuid() });

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success) return new Response(null, { status: 404 });
  const wantsPreview = new URL(request.url).searchParams.get("variant") === "preview";
  if (!(await getCurrentMember())) return new Response(null, { status: 404 });

  const original = await getFile(parsed.data.id);
  if (!original || original.status !== "ready") return new Response(null, { status: 404 });

  // The preview when asked for one and it exists; the original stands in for a missing one.
  const file = (wantsPreview ? await getPreviewOf(original.id) : null) ?? original;
  if (!isRasterMime(file.mime) && file.mime !== SVG_MIME)
    return new Response(null, { status: 404 });

  const object = await getStorageAdapter().get(file.storageKey);
  if (!object) return new Response(null, { status: 404 });

  const headers = new Headers({
    "content-type": file.mime,
    "content-length": String(object.size),
    "cache-control": `private, max-age=${PREVIEW_CACHE_SECONDS}, immutable`,
    "content-disposition": `${file.mime === SVG_MIME ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    "x-content-type-options": "nosniff",
  });
  if (object.etag) headers.set("etag", object.etag);
  return new Response(object.body, { status: 200, headers });
}
