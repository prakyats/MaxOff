import { backgroundGet } from "@/core/http/background-route";
import { type LateRule, readLateRule } from "@/modules/attendance";

/**
 * Today's Late rule for the Start-day prompt (v1.9 W4, the working-hours sample §1): the start time,
 * when Late begins and the suggested reason ("Shoot at 2:00 pm"), read when the prompt opens so a
 * late Start day asks the reason first. A background call (ARCHITECTURE §4.4): a plain request,
 * never a server action; the layout itself reads nothing new.
 */
export const dynamic = "force-dynamic";

export const GET = backgroundGet(async (): Promise<LateRule | null> => readLateRule());
