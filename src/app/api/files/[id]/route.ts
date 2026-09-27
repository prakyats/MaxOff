import { z } from "zod";

import { isRasterMime, PREVIEW_CACHE_SECONDS, SVG_MIME } from "@/core/storage";
import { getFile, getPreviewOf, getStorageAdapter } from "@/core/storage/server";

/**
 * Previews and thumbnails in lists (ARCHITECTURE §11, kickoff 3 decision 12): the same-origin
 * image route. `/api/*` is public in the proxy, so this authenticates itself: the file row is
 * read under RLS with the viewer's session, and `app.file_visible()` is the permission check
 * the record needs (a client logo to whoever may see the client or its label, an avatar to
 * `team.view` and the person, the company logo to any member). A file nobody may see is a 404,
 * never a 403. `?variant=preview` serves the newest ready browser-made preview of the original.
 *
 * A file never changes (replacing one is a new id), so the browser may keep it for a day,
 * privately. SVG is served with a CSP that forbids scripts and external loads on top of the
 * sanitising done at upload; it is only ever an `<img>` source.
 */
const paramsSchema = z.object({ id: z.uuid() });

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success) return new Response(null, { status: 404 });
  const wantsPreview = new URL(request.url).searchParams.get("variant") === "preview";

  const original = await getFile(parsed.data.id);
  if (!original || original.status !== "ready") return new Response(null, { status: 404 });

  // The preview when asked for one and it exists; a raster original stands in for a missing
  // preview, an SVG never does (it is only displayed through its preview).
  let file = original;
  if (wantsPreview) {
    const preview = await getPreviewOf(original.id);
    if (preview) file = preview;
    else if (!isRasterMime(original.mime)) return new Response(null, { status: 404 });
  }
  if (!isRasterMime(file.mime) && file.mime !== SVG_MIME)
    return new Response(null, { status: 404 });

  const object = await getStorageAdapter().get(file.storageKey);
  if (!object) return new Response(null, { status: 404 });

  const headers = new Headers({
    "content-type": file.mime,
    "content-length": String(object.size),
    "cache-control": `private, max-age=${PREVIEW_CACHE_SECONDS}, immutable`,
    "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    "x-content-type-options": "nosniff",
  });
  if (object.etag) headers.set("etag", object.etag);
  if (file.mime === SVG_MIME) {
    headers.set(
      "content-security-policy",
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    );
  }
  return new Response(object.body, { status: 200, headers });
}
