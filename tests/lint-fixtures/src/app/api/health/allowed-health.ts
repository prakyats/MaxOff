// The health route may reach core/db/health.ts by file (3c.1, ARCHITECTURE §3.1).
import { fixtureDatabaseReachable } from "../../../core/db/health";

export const fine = fixtureDatabaseReachable();
