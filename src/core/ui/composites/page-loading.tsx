import { type LoadingShape, LoadingState } from "./loading-state";
import { PageHeader } from "./page-header";

/*
 * Its own file (v7.0): a screen's loading header with its skeleton. `loading-state.tsx`, which
 * list screens load in the browser, no longer brings the page header with it once a tap drawing
 * (Me's) draws this one in the browser too.
 */

/**
 * What a route's `loading.tsx` renders: **the title bar straight away**, then a skeleton shaped
 * like that route's content.
 *
 * The header needs no data, so showing it during the load means you can always tell which
 * screen you are on — the alternative is a moment of anonymous grey blocks. Everything below it
 * is a tracing of the real content, so nothing jumps when the data arrives.
 */
export function PageLoading({
  title,
  description,
  help,
  shape,
  count,
  actions,
  back,
  avatars,
  children,
}: {
  title: string;
  /**
   * The page's own header line and help, passed as the page passes them: the description takes
   * a line under the title on a wide screen, the help a button beside it on a phone, so a
   * loading screen without them moves the content when the page arrives (4C review S7).
   */
  description?: string | undefined;
  help?: string | undefined;
  shape: LoadingShape;
  count?: number | undefined;
  actions?: number | undefined;
  back?: { href: string; label: string } | undefined;
  /** `cards` led by a person's photo (People, V5b-D). */
  avatars?: boolean | undefined;
  /** Replaces the default skeleton when a screen needs a shape of its own (e.g. the calendar). */
  children?: React.ReactNode;
}) {
  return (
    <>
      <PageHeader
        title={title}
        {...(description ? { description } : {})}
        {...(help ? { help } : {})}
        {...(back ? { back } : {})}
      />
      {children ?? (
        <LoadingState
          shape={shape}
          count={count}
          actions={actions}
          avatars={avatars}
          label={`Loading ${title}`}
        />
      )}
    </>
  );
}
