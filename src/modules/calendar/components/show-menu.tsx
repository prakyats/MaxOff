"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/core/ui/primitives/dropdown-menu";
import { whenOnPageEntry } from "@/core/ui/overlay/overlay-history";

import { CALENDAR_SHOWS, type CalendarShow, parseShow, SHOW_LABELS } from "../domain/show";
import { ShowTrigger } from "./show-trigger";

/**
 * The All · Tasks · Client work menu (laptop and phone) behind `ShowControl`, which loads it after the page
 * (ARCHITECTURE §19). The open menu is a layer (back closes it, §14.2 a); a choice is view state
 * and leaves no history behind. `defaultOpen`: the button was pressed before this code had arrived.
 */
export function ShowMenu({
  show,
  onShow,
  defaultOpen = false,
  className,
}: {
  show: CalendarShow;
  onShow: (show: CalendarShow) => void;
  defaultOpen?: boolean;
  className?: string;
}) {
  return (
    <DropdownMenu defaultOpen={defaultOpen}>
      <DropdownMenuTrigger asChild>
        <ShowTrigger show={show} className={className} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-40" data-menu="calendar-show">
        <DropdownMenuRadioGroup
          value={show}
          onValueChange={(value) => {
            onShow(parseShow(value));
            // A choice closes the menu by hand, which leaves its entry spent (overlay-history);
            // backed out once the menu has closed, so a choice adds no step at all and the next
            // back leaves the calendar (§14.2 d), even after a view's replace.
            window.setTimeout(() => whenOnPageEntry(() => undefined), 0);
          }}
        >
          {CALENDAR_SHOWS.map((option) => (
            <DropdownMenuRadioItem key={option} value={option} data-show={option}>
              {SHOW_LABELS[option]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
