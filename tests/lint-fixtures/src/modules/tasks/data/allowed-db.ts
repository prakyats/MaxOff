// data/ is the layer that touches the database.
import { createClient } from "@supabase/supabase-js";

import { fixtureServerClient } from "../../../core/db/server";
import { taskRule } from "../domain/rules";

export const repo = { createClient, client: fixtureServerClient(), taskRule };
