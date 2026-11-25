import { z } from "zod";

/**
 * A create's request key (v7.0 unit 2, `useRequestKey`): optional, so a caller that sends none
 * creates exactly as before. A repeat with the same key is answered with the first create's id.
 */
export const requestKeySchema = z.uuid().optional();
