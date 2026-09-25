/**
 * modules/settings: the public API (ARCHITECTURE §3.1: `app → modules (index.ts only) → core`).
 * The Owner's control centre (PRODUCT §4.16). `core/lists` owns the list_items table; this
 * module owns the screens that edit it.
 *
 * Client components are not exported here: a route imports them one file at a time from
 * `components/` (ADR-0011 amendment, task 2.8), because a barrel is not tree-shaken per route.
 */
export { getCompany, getSettings, listHolidays } from "./data/settings";
export {
  describeWeeklyOff,
  type Company,
  type Holiday,
  type OrgSettings,
  type Thresholds,
} from "./domain/settings";
