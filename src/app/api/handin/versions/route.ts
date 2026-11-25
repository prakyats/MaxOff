import { backgroundGet } from "@/core/http/background-route";
import { readHandinVersions } from "@/modules/handin";

/**
 * v5.0: a task's hand-in versions (`?task=<id>`), re-read by the Hand-in card while files upload.
 * A background call (ARCHITECTURE §4.4); the database decides who sees what (DATA-MODEL §8b).
 */
export const dynamic = "force-dynamic";

export const GET = backgroundGet((query) => readHandinVersions({ taskId: query.get("task") }));
