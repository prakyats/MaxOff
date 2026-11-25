import { uploadApiPost } from "@/modules/uploads";

/**
 * `POST /api/upload/said-done`: the upload page's public API (v4.5, WORKFLOWS §5B.2). Authenticated by
 * the link's token in `Authorization: UploadLink <token>` (plan A8); the request and answer
 * shapes, the limits and the headers are `modules/uploads` (`domain/api.ts`,
 * `actions/public-api.ts`).
 */
export const POST = uploadApiPost("said-done");
