// Cron routes call core or module functions; they never hold the service client.
import { fixtureServiceClient } from "../../../core/db/service";

export const wrong = fixtureServiceClient();
