import { LoadingState } from "@/core/ui/composites/loading-state";

/**
 * The requests list under the layout's header and tabs (which stay painted): cards on a phone,
 * the table from `md` up. No pager row: it only appears past 20 requests.
 */
export default function Loading() {
  return (
    <>
      <LoadingState shape="cards" count={5} label="Loading your leave" className="md:hidden" />
      <LoadingState
        shape="table"
        columns={["w-1/4", "w-1/4", "w-1/6", "w-1/6"]}
        label="Loading your leave"
        className="hidden md:block"
      />
    </>
  );
}
