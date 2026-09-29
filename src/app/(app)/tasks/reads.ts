import "server-only";

import { cache } from "react";

import { listAllDefinitions } from "@/core/custom-fields/server";
import { listTaskTypes } from "@/modules/tasks";
import { listCurrentCoordinators, listDirectory } from "@/modules/team";

/**
 * The reads a task's page and the task dialog's setup share, once per request (4B review S11):
 * the page renders both for the Owner and Admins, and each used to read these four itself.
 */
export const readTaskTypes = cache(listTaskTypes);
export const readDirectory = cache(listDirectory);
export const readCoordinators = cache(listCurrentCoordinators);
export const readTaskDefinitions = cache(() => listAllDefinitions("task"));
