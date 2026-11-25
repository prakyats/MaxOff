import { backgroundGet } from "@/core/http/background-route";
import { readUploaderSheetFor } from "@/modules/uploads";

/**
 * One uploader's sheet (v4.5, WORKFLOWS §5B.3): `?uploader=<id>`, read when the sheet opens. It
 * never waits on Google; the Drive check is `POST /api/uploads/drive-check`, sent after the sheet
 * is on screen. A background call (ARCHITECTURE §4.4).
 */
export const dynamic = "force-dynamic";

export const GET = backgroundGet((query) =>
  readUploaderSheetFor({ uploaderId: query.get("uploader") }),
);
