/** Tokens only: colour, type step, radius, shadow and a token in an arbitrary value. */
export const Right = ({ urgent }: { urgent: boolean }) => (
  <div
    className={`bg-card text-foreground rounded-card shadow-raised text-sm ${
      urgent ? "text-danger border-danger border-l-2" : "text-muted-foreground"
    }`}
    style={{ fontSize: "var(--text-xs)" }}
  >
    <span className="bg-muted text-holiday rounded-full text-xs">Diwali</span>
    <span className="rounded-sheet shadow-modal text-2xl text-[var(--holiday)]">68%</span>
    <span className="shadow-floating rounded-md rounded-t-xl text-xs">Issue #89, PR #7</span>
  </div>
);
