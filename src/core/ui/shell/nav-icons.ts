import {
  BellIcon,
  BriefcaseIcon,
  CalendarCheckIcon,
  CalendarDaysIcon,
  CheckSquareIcon,
  CircleUserIcon,
  ClipboardListIcon,
  FileBarChart2Icon,
  LayoutDashboardIcon,
  type LucideIcon,
  MoreHorizontalIcon,
  ReceiptIcon,
  SettingsIcon,
  SunriseIcon,
  UsersIcon,
} from "lucide-react";

import type { NavIconName } from "./nav";

/** Lucide components for `NavItem.icon`. Only client components import this. */
export const NAV_ICONS: Record<NavIconName, LucideIcon> = {
  "layout-dashboard": LayoutDashboardIcon,
  "calendar-days": CalendarDaysIcon,
  users: UsersIcon,
  "check-square": CheckSquareIcon,
  briefcase: BriefcaseIcon,
  "clipboard-list": ClipboardListIcon,
  "file-bar-chart": FileBarChart2Icon,
  settings: SettingsIcon,
  sunrise: SunriseIcon,
  bell: BellIcon,
  "circle-user": CircleUserIcon,
  "calendar-check": CalendarCheckIcon,
  receipt: ReceiptIcon,
  more: MoreHorizontalIcon,
};
