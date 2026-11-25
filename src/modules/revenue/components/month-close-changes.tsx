import type { ChangeRow } from "../domain/month-close-view";

import { CLOSE_CARD, CLOSE_ROW, CLOSE_ROW_TEXT } from "./month-close-layout";

/** "Changed since close": each line that moved, then one "Month total" row with each total that moved. */
export function ChangeList({
  changes,
  totals,
}: {
  changes: readonly ChangeRow[];
  totals: readonly { key: string; text: string }[];
}) {
  if (changes.length === 0 && totals.length === 0) {
    return (
      <div className={CLOSE_CARD} data-slot="month-close-unchanged">
        <div className={CLOSE_ROW}>
          <div className={CLOSE_ROW_TEXT}>
            <p className="font-medium">Nothing has moved.</p>
            <p className="text-muted-foreground text-xs">
              Every revenue line and total is as it was saved.
            </p>
          </div>
        </div>
      </div>
    );
  }
  return (
    <ul className={CLOSE_CARD} data-slot="month-close-changes">
      {changes.map((change) => (
        <li key={change.key} className={CLOSE_ROW} data-slot="month-close-change">
          <span className={CLOSE_ROW_TEXT}>
            <span className="font-medium break-words">{change.what}</span>
            <span
              className="text-muted-foreground text-xs break-words"
              data-slot="month-close-change-detail"
            >
              {change.detail}
            </span>
            {change.figures.map((figure) => (
              <span
                key={figure}
                className="text-xs break-words tabular-nums"
                data-slot="month-close-change-figure"
              >
                {figure}
              </span>
            ))}
          </span>
        </li>
      ))}
      {totals.length > 0 ? (
        <li className={CLOSE_ROW} data-slot="month-close-total">
          <span className={CLOSE_ROW_TEXT}>
            <span className="font-medium">Month total</span>
            {totals.map((total) => (
              <span
                key={total.key}
                className="text-xs break-words tabular-nums"
                data-slot="month-close-total-figure"
              >
                {total.text}
              </span>
            ))}
          </span>
        </li>
      ) : null}
    </ul>
  );
}
