import { backgroundGet } from "@/core/http/background-route";
import { readUploadCardFor } from "@/modules/uploads";

/**
 * The Uploads card's own re-read (v4.5, WORKFLOWS §5B.3): `?task=<id>`, every few seconds while
 * something is uploading and the card is on screen (the written exception to ARCHITECTURE §10a).
 * A background call (§4.4): a plain request, never a server action that could hold a navigation.
 */
export const dynamic = "force-dynamic";

export const GET = backgroundGet((query) => readUploadCardFor({ taskId: query.get("task") }));
