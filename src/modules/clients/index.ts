/**
 * modules/clients: the public API (ARCHITECTURE §3.1: `app → modules (index.ts only) → core`).
 * Clients, their Admin, contacts and brand basics (PRODUCT §4.4). Task 3.1 ships the schema, the
 * transition functions and this server surface; the screens arrive with 3.4.
 *
 * Client components are not exported here: a route imports them one file at a time from
 * `components/` (ADR-0011 amendment, task 2.8), because a barrel is not tree-shaken per route.
 */
export {
  CLIENT_ACTION_LABELS,
  CLIENT_STATE_LABELS,
  CLIENT_STATE_NOTES,
  CLIENT_STATES,
  clientLifecycleActions,
  sortClients,
  type Client,
  type ClientAdminAssignment,
  type ClientBrand,
  type ClientContact,
  type ClientLabel,
  type ClientLifecycleAction,
  type ClientState,
} from "./domain/clients";
export {
  CLIENT_NAME_MAX,
  CLIENT_TEXT_MAX,
  CONTACT_NAME_MAX,
  GSTIN_PATTERN,
  HTTPS_URL_PATTERN,
} from "./domain/limits";
export { type BrandColor, type BrandFont } from "./domain/schemas";
export {
  getBrand,
  getClient,
  getOwnerNotes,
  listAdminAssignments,
  listClientLabels,
  listClients,
  listContacts,
} from "./data/clients";
export {
  activateClient,
  archiveContact,
  assignClientAdmin,
  closeClient,
  createClient,
  createContact,
  pauseClient,
  reactivateClient,
  restoreContact,
  setPrimaryContact,
  updateBrand,
  updateClient,
  updateContact,
  updateOwnerNotes,
} from "./actions/clients";
