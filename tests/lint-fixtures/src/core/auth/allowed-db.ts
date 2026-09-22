// core/auth owns a table, so it may hold a client.
import { fixtureServerClient } from "../db/server";

export const session = fixtureServerClient();
