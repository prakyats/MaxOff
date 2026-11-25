import { backgroundPost } from "@/core/http/background-route";
import { checkUploaderFilesInDrive } from "@/modules/uploads";

/**
 * "Removed in Drive" for the files on an open sheet (v4.5, Q7): `{ uploaderId, fileIds }`, sent by
 * the sheet once it is on screen, never on the task page's first render. Answers the sheet as it
 * now stands. A background call (ARCHITECTURE §4.4), same origin only.
 */
export const POST = backgroundPost((body) => checkUploaderFilesInDrive(body));
