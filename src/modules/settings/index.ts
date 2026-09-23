/**
 * modules/settings: the public API (ARCHITECTURE §3.1: `app → modules (index.ts only) → core`).
 * The Owner's control centre (PRODUCT §4.16). `core/lists` owns the list_items table; this
 * module owns the screens that edit it.
 */
export { CompanyForm } from "./components/company-form";
export { HolidaysPanel } from "./components/holidays-panel";
export { ListManager, type ManagedListItem } from "./components/list-manager";
export { ThresholdsForm } from "./components/thresholds-form";
export { WeeklyOffForm } from "./components/weekly-off-form";
export { getCompany, getSettings, listHolidays } from "./data/settings";
export {
  describeWeeklyOff,
  type Company,
  type Holiday,
  type OrgSettings,
  type Thresholds,
} from "./domain/settings";
