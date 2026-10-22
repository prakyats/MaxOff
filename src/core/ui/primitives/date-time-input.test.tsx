import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { addISTDays, formatDateField, spokenDateField, todayIST } from "@/core/time";

import { DateInput, DateTimeInput, TimeInput } from "./date-time-input";

/** V5b major change 6 (option C): the native field stays; its value reads the MaxOff way. */
describe("DateInput / TimeInput / DateTimeInput", () => {
  const day = addISTDays(todayIST(), 1);

  it("keeps the native input, its name and value, and lays the label over it", () => {
    const out = renderToStaticMarkup(<DateInput name="dueDate" value={day} onChange={() => {}} />);
    expect(out).toContain('type="date"');
    expect(out).toContain('name="dueDate"');
    expect(out).toContain(`value="${day}"`);
    expect(out).toContain(formatDateField(day, todayIST()));
    expect(out).toContain("text-transparent");
    // The label never takes a tap: the native picker opens under it.
    expect(out).toContain("pointer-events-none");
  });

  it("gives a screen reader the full date as the field's description", () => {
    const out = renderToStaticMarkup(
      <DateInput value={day} aria-describedby="hint" onChange={() => {}} />,
    );
    expect(out).toContain(spokenDateField(day));
    expect(out).toMatch(/aria-describedby="[^"]+ hint"/);
  });

  it("says what to do when empty", () => {
    expect(renderToStaticMarkup(<DateInput value="" onChange={() => {}} />)).toContain(
      "Choose a date",
    );
    expect(renderToStaticMarkup(<TimeInput defaultValue="" />)).toContain("Choose a time");
    expect(renderToStaticMarkup(<DateTimeInput defaultValue="" />)).toContain(
      "Choose a date and time",
    );
  });

  it("reads a time as 6:00 pm on the native time field", () => {
    const out = renderToStaticMarkup(<TimeInput defaultValue="18:00" />);
    expect(out).toContain('type="time"');
    expect(out).toContain("6:00 pm");
  });
});
