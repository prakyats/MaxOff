import { LoadingState } from "@/core/ui/composites/loading-state";

/**
 * A person's requests (2.4) under the layout's header and tabs (which stay painted): cards on
 * a phone and the table from `md` up, as on the member's own /leave.
 */
export default function Loading() {
  return (
    <>
      <LoadingState shape="cards" count={5} label="Loading their leave" className="md:hidden" />
      <LoadingState
        shape="table"
        columns={["w-1/4", "w-1/4", "w-1/6", "w-1/6"]}
        label="Loading their leave"
        className="hidden md:block"
      />
    </>
  );
}
