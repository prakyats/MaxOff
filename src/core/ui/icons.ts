import {
  ArchiveIcon,
  BellIcon,
  CheckIcon,
  ChevronRightIcon,
  HistoryIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
} from "lucide-react";

/**
 * **One icon per concept** (v1.8 consistency sweep, owner 2026-10-21; docs/DESIGN.md "Patterns"):
 * the icon a screen shows for these concepts comes from here, never a synonym of its own.
 * `icons.test.ts` fails on the known synonyms (an ellipsis, a pen, a ringing bell for Remind) and
 * on History's clock imported anywhere else.
 */
export const ICONS = {
  /** History: the clock with an arrow, in every detail header. */
  history: HistoryIcon,
  edit: PencilIcon,
  archive: ArchiveIcon,
  remind: BellIcon,
  approve: CheckIcon,
  add: PlusIcon,
  /** More: ⋯, a row's or a record's menu. */
  more: MoreHorizontalIcon,
  /** Open: ›, a row that opens. */
  open: ChevronRightIcon,
} as const;
