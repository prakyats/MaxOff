// The carve-out is one file: the health route still may not hold a database client.
import { fixtureServiceClient } from "../../../core/db/service";

export const wrong = fixtureServiceClient();
