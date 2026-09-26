"use client";

import { useEffect } from "react";

import { issueDayPass } from "../actions";

/**
 * Mounted by the `(app)` layout when the day needed no choice but there was no pass yet
 * (ARCHITECTURE §8): asks the server once to set today's pass, so the next page load skips the
 * database. Renders nothing; the page is already on screen.
 */
export function IssueDayPass() {
  useEffect(() => {
    void issueDayPass();
  }, []);
  return null;
}
