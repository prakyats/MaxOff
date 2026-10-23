"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/core/ui/primitives/dropdown-menu";

import { CALENDAR_SHOWS, type CalendarShow, parseShow, SHOW_LABELS } from "../domain/show";
import { ShowTrigger } from "./show-trigger";

/**
 * The laptop's All · Tasks · Client work menu behind `ShowControl`, which loads it after the page
 * (ARCHITECTURE §19). The open menu is a layer (back closes it, §14.2 a); a choice is view state
 * and adds no history. `defaultOpen`: the button was pressed before this code had arrived.
 */
export function ShowMenu({
  show,
  onShow,
  defaultOpen = false,
}: {
  show: CalendarShow;
  onShow: (show: CalendarShow) => void;
  defaultOpen?: boolean;
}) {
  return (
    <DropdownMenu defaultOpen={defaultOpen}>
      <DropdownMenuTrigger asChild>
        <ShowTrigger show={show} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-40" data-menu="calendar-show">
        <DropdownMenuRadioGroup value={show} onValueChange={(value) => onShow(parseShow(value))}>
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
